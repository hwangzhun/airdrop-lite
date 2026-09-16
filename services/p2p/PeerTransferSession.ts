import type { ControlMessage, ReceivedFile, Role, SignalMessage, TransferManifest, TransferRoute } from '../../types';
import { MAX_FILE_BYTES, sha256Blob } from './hash';

const CHUNK_SIZE = 32 * 1024 as 32768;
const HIGH_WATER = 1024 * 1024;
const LOW_WATER = 256 * 1024;

export interface PeerEvents {
  onJoinRequest?: () => void;
  onJoinRejected?: () => void;
  onConnected?: (route: TransferRoute) => void;
  onRoute?: (route: TransferRoute) => void;
  onManifest?: (manifest: TransferManifest) => void;
  onProgress?: (percent: number) => void;
  onComplete?: (file?: ReceivedFile) => void;
  onVerificationFailed?: () => void;
  onPeerLeft?: () => void;
  onError?: (message: string) => void;
}

export class PeerTransferSession {
  private readonly role: Role;
  private readonly iceServers: RTCIceServer[];
  private readonly events: PeerEvents;
  private readonly file?: File;
  private readonly fileHash?: string;
  private socket?: WebSocket;
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private manifest?: TransferManifest;
  private chunks: ArrayBuffer[] = [];
  private receivedBytes = 0;
  private receiverAccepted = false;
  private sending = false;
  private finished = false;
  private closed = false;
  private connectTimer?: number;

  constructor(role: Role, iceServers: RTCIceServer[], events: PeerEvents, file?: File, fileHash?: string) {
    this.role = role;
    this.iceServers = iceServers;
    this.events = events;
    this.file = file;
    this.fileHash = fileHash;
  }

  connectSignal(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('无法连接临时房间服务'));
      socket.onmessage = event => this.handleSignal(event.data);
      socket.onclose = event => {
        if (!this.closed && ![1000, 4000, 4001, 4002, 4003].includes(event.code)) this.events.onError?.('房间连接已断开');
      };
    });
  }

  approveJoin(): void {
    if (this.role !== 'sender') return;
    this.sendSignal({ type: 'join-approved' });
    void this.startOffer();
  }

  cancel(reason = '用户取消了传输'): void {
    this.sendControl({ type: 'cancel', reason });
    window.setTimeout(() => this.close(), 100);
  }

  close(): void {
    this.closed = true;
    if (this.connectTimer) window.clearTimeout(this.connectTimer);
    this.channel?.close();
    this.peer?.close();
    this.socket?.close(1000, 'done');
    this.chunks = [];
  }

  private setupPeer(): RTCPeerConnection {
    if (this.peer) return this.peer;
    const peer = new RTCPeerConnection({ iceServers: this.iceServers, iceTransportPolicy: 'all' });
    this.peer = peer;
    peer.onicecandidate = event => {
      if (event.candidate) this.sendSignal({ type: 'ice', candidate: event.candidate.toJSON() });
    };
    peer.ondatachannel = event => this.bindChannel(event.channel);
    peer.onconnectionstatechange = () => {
      if (this.finished || this.closed) return;
      if (peer.connectionState === 'failed') this.fail('当前网络无法建立 WebRTC 连接');
      if (peer.connectionState === 'disconnected') this.events.onError?.('点对点连接已中断');
    };
    this.connectTimer = window.setTimeout(() => {
      if (!['connected', 'completed'].includes(peer.connectionState)) this.fail('连接超时，请检查网络后重试');
    }, 20_000);
    return peer;
  }

  private async startOffer(): Promise<void> {
    try {
      const peer = this.setupPeer();
      this.bindChannel(peer.createDataChannel('file', { ordered: true }));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      this.sendSignal({ type: 'offer', description: offer });
    } catch (error) { this.fail(error instanceof Error ? error.message : '创建连接失败'); }
  }

  private async handleSignal(raw: unknown): Promise<void> {
    try {
      if (typeof raw !== 'string') return;
      const message = JSON.parse(raw) as SignalMessage;
      if (message.type === 'join-request') { this.events.onJoinRequest?.(); return; }
      if (message.type === 'join-rejected') { this.events.onJoinRejected?.(); return; }
      if (message.type === 'join-approved') { this.setupPeer(); return; }
      if (message.type === 'peer-left') {
        if (!this.finished) this.events.onPeerLeft?.();
        return;
      }
      if (message.type === 'error') { this.fail(message.code); return; }

      const peer = this.setupPeer();
      if (message.type === 'offer') {
        await peer.setRemoteDescription(message.description);
        await this.flushCandidates();
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        this.sendSignal({ type: 'answer', description: answer });
      } else if (message.type === 'answer') {
        await peer.setRemoteDescription(message.description);
        await this.flushCandidates();
      } else if (message.type === 'ice') {
        if (peer.remoteDescription) await peer.addIceCandidate(message.candidate);
        else this.pendingCandidates.push(message.candidate);
      }
    } catch (error) { this.fail(error instanceof Error ? error.message : '信令处理失败'); }
  }

  private async flushCandidates(): Promise<void> {
    if (!this.peer?.remoteDescription) return;
    for (const candidate of this.pendingCandidates.splice(0)) await this.peer.addIceCandidate(candidate);
  }

  private bindChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = LOW_WATER;
    channel.onopen = () => void this.handleChannelOpen();
    channel.onmessage = event => void this.handleData(event.data);
    channel.onerror = () => {
      if (!this.finished && !this.closed) this.fail('文件通道发生错误');
    };
    channel.onclose = () => {
      if (!this.closed && !this.finished && !this.sending) this.events.onPeerLeft?.();
    };
  }

  private async handleChannelOpen(): Promise<void> {
    if (this.connectTimer) window.clearTimeout(this.connectTimer);
    const route = await this.detectRoute();
    this.events.onConnected?.(route);
    this.events.onRoute?.(route);
    if (this.role === 'sender' && this.file && this.fileHash) {
      this.manifest = {
        version: 1, transferId: crypto.randomUUID(), name: this.file.name,
        type: this.file.type || 'application/octet-stream', size: this.file.size,
        sha256: this.fileHash, chunkSize: CHUNK_SIZE,
      };
      this.sendControl({ type: 'manifest', manifest: this.manifest });
    }
  }

  private async detectRoute(): Promise<TransferRoute> {
    if (!this.peer) return 'unknown';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, attempt ? 300 : 100));
      const stats = await this.peer.getStats();
      let pair: any;
      stats.forEach((item: any) => {
        if (item.type === 'transport' && item.selectedCandidatePairId) pair = stats.get(item.selectedCandidatePairId);
        if (!pair && item.type === 'candidate-pair' && item.state === 'succeeded' && (item.selected || item.nominated)) pair = item;
      });
      if (pair) {
        const local = stats.get(pair.localCandidateId) as any;
        const remote = stats.get(pair.remoteCandidateId) as any;
        return local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : 'direct';
      }
    }
    return 'unknown';
  }

  private async handleData(data: string | ArrayBuffer | Blob): Promise<void> {
    if (typeof data !== 'string') {
      if (this.role !== 'receiver' || !this.manifest || !this.receiverAccepted) return this.fail('收到未授权的文件数据');
      const chunk = data instanceof Blob ? await data.arrayBuffer() : data;
      if (this.receivedBytes + chunk.byteLength > this.manifest.size || this.receivedBytes + chunk.byteLength > MAX_FILE_BYTES) return this.fail('接收数据超过声明大小');
      this.chunks.push(chunk);
      this.receivedBytes += chunk.byteLength;
      this.events.onProgress?.(this.manifest.size === 0 ? 100 : Math.round(this.receivedBytes / this.manifest.size * 100));
      return;
    }

    const message = JSON.parse(data) as ControlMessage;
    if (message.type === 'manifest' && this.role === 'receiver') {
      if (message.manifest.version !== 1 || message.manifest.size > MAX_FILE_BYTES || message.manifest.size < 0 || message.manifest.chunkSize !== CHUNK_SIZE) return this.fail('文件信息不合法');
      this.manifest = message.manifest;
      this.events.onManifest?.(message.manifest);
      this.receiverAccepted = true;
      this.sendControl({ type: 'accept' });
    } else if (message.type === 'accept' && this.role === 'sender') {
      this.receiverAccepted = true;
      this.maybeStartSending();
    } else if (message.type === 'reject') {
      this.fail('对方拒绝接收文件');
    } else if (message.type === 'cancel') {
      this.fail(message.reason || '对方取消了传输');
    } else if (message.type === 'complete' && this.role === 'receiver') {
      await this.verifyReceivedFile();
    } else if (message.type === 'verified' && this.role === 'sender') {
      if (message.ok && message.actualHash === this.fileHash) {
        this.finished = true;
        this.events.onComplete?.();
        window.setTimeout(() => this.close(), 250);
      }
      else this.events.onVerificationFailed?.();
    }
  }

  private maybeStartSending(): void {
    if (this.role === 'sender' && this.receiverAccepted && !this.sending) void this.sendFile();
  }

  private async sendFile(): Promise<void> {
    if (!this.file || !this.channel || this.channel.readyState !== 'open') return;
    this.sending = true;
    try {
      if (this.file.size === 0) this.events.onProgress?.(100);
      for (let offset = 0; offset < this.file.size; offset += CHUNK_SIZE) {
        if (this.closed) return;
        await this.waitForBuffer();
        const chunk = await this.file.slice(offset, Math.min(offset + CHUNK_SIZE, this.file.size)).arrayBuffer();
        this.channel.send(chunk);
        this.events.onProgress?.(Math.round(Math.min(offset + chunk.byteLength, this.file.size) / this.file.size * 100));
      }
      this.sendControl({ type: 'complete' });
    } catch (error) { this.fail(error instanceof Error ? error.message : '发送失败'); }
  }

  private waitForBuffer(): Promise<void> {
    if (!this.channel || this.channel.bufferedAmount <= HIGH_WATER) return Promise.resolve();
    return new Promise(resolve => this.channel?.addEventListener('bufferedamountlow', () => resolve(), { once: true }));
  }

  private async verifyReceivedFile(): Promise<void> {
    if (!this.manifest || this.receivedBytes !== this.manifest.size) return this.fail('接收字节数与文件信息不一致');
    const blob = new Blob(this.chunks, { type: this.manifest.type });
    const actualHash = await sha256Blob(blob);
    const ok = actualHash === this.manifest.sha256;
    this.sendControl({ type: 'verified', ok, actualHash });
    if (!ok) {
      this.chunks = [];
      this.events.onVerificationFailed?.();
      return;
    }
    const received: ReceivedFile = { manifest: this.manifest, blob, url: URL.createObjectURL(blob) };
    this.chunks = [];
    this.finished = true;
    this.events.onComplete?.(received);
  }

  private sendSignal(message: SignalMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private sendControl(message: ControlMessage): void {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(message));
  }

  private fail(message: string): void { this.events.onError?.(message); }
}
