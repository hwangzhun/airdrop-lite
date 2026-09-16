import React, { useEffect, useRef, useState } from 'react';
import { joinRoom, websocketUrl } from '../services/p2p/api';
import { PeerTransferSession } from '../services/p2p/PeerTransferSession';
import type { ReceivedFile, TransferManifest, TransferRoute } from '../types';

type Stage = 'idle' | 'joining' | 'waiting' | 'connecting' | 'receiving' | 'checking' | 'complete' | 'error';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export const ReceiveView: React.FC<{ initialCode?: string }> = ({ initialCode = '' }) => {
  const [code, setCode] = useState(initialCode.slice(0, 6));
  const [stage, setStage] = useState<Stage>('idle');
  const [route, setRoute] = useState<TransferRoute>('unknown');
  const [manifest, setManifest] = useState<TransferManifest>();
  const [receivedFile, setReceivedFile] = useState<ReceivedFile>();
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const sessionRef = useRef<PeerTransferSession | undefined>(undefined);
  const autoJoinStarted = useRef(false);

  useEffect(() => () => sessionRef.current?.close(), []);
  useEffect(() => () => {
    if (receivedFile) URL.revokeObjectURL(receivedFile.url);
  }, [receivedFile]);

  const join = async (requestedCode = code) => {
    if (requestedCode.length !== 6) return;
    setStage('joining'); setError('');
    try {
      const room = await joinRoom(requestedCode);
      sessionStorage.setItem(`airdrop-receiver-${requestedCode}`, room.receiverToken);
      const session = new PeerTransferSession('receiver', room.iceServers, {
        onConnected: nextRoute => {
          setRoute(nextRoute); setStage('connecting');
        },
        onRoute: setRoute,
        onManifest: nextManifest => {
          setManifest(nextManifest);
          setStage('receiving');
        },
        onProgress: value => {
          setProgress(value);
          setStage(value >= 100 ? 'checking' : 'receiving');
        },
        onComplete: file => {
          if (file) setReceivedFile(file);
          sessionStorage.removeItem(`airdrop-receiver-${requestedCode}`);
          setStage('complete');
        },
        onVerificationFailed: () => {
          setError('文件 SHA-256 校验失败，已丢弃接收内容'); setStage('error');
        },
        onPeerLeft: () => { setError('发送方已离开房间'); setStage('error'); },
        onError: message => { setError(message); setStage('error'); },
      });
      sessionRef.current = session;
      await session.connectSignal(websocketUrl(requestedCode, 'receiver', room.receiverToken));
      setStage('waiting');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加入房间失败');
      setStage('error');
    }
  };

  useEffect(() => {
    const requestedCode = initialCode.slice(0, 6);
    if (requestedCode.length !== 6 || autoJoinStarted.current) return;
    autoJoinStarted.current = true;
    void join(requestedCode);
  }, [initialCode]);

  const reset = () => {
    sessionRef.current?.close(); sessionRef.current = undefined;
    if (receivedFile) URL.revokeObjectURL(receivedFile.url);
    setStage('idle'); setManifest(undefined); setReceivedFile(undefined);
    setProgress(0); setError('');
  };

  if (stage === 'complete' && receivedFile) return (
    <section className="card stack" aria-live="polite">
      <div className="complete-mark">✓</div>
      <div className="hero"><h1>文件已接收</h1><p>SHA-256 校验成功，点击下方按钮保存文件。</p></div>
      <div className="file-summary"><strong>{receivedFile.manifest.name}</strong><span>{formatBytes(receivedFile.manifest.size)}</span></div>
      <a className="primary download-link" href={receivedFile.url} download={receivedFile.manifest.name}>保存文件</a>
      <p className="hash">SHA-256: {receivedFile.manifest.sha256}</p>
      <button className="secondary" onClick={reset}>接收其他文件</button>
    </section>
  );

  return (
    <section>
      <div className="hero"><h1>接收文件</h1><p>输入发送方提供的 6 位临时取件码。</p></div>
      <div className="card stack">
        {stage === 'idle' && <>
          <input className="field code-input" value={code} maxLength={6} placeholder="取件码"
            onChange={event => setCode(event.target.value.toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '').slice(0, 6))} />
          <button className="primary" disabled={code.length !== 6} onClick={() => void join()}>下载文件</button>
        </>}
        {stage === 'joining' && <p className="status">正在验证并进入房间…</p>}
        {stage === 'waiting' && <p className="status">已找到文件，正在自动建立连接…</p>}
        {stage === 'connecting' && <p className="status">正在建立 WebRTC 连接…</p>}

        {['receiving', 'checking'].includes(stage) && <>
          <RouteNotice route={route} />
          {manifest && <div className="file-summary"><strong>{manifest.name}</strong><span>{formatBytes(manifest.size)}</span></div>}
          <div className="progress-track"><div className="progress-bar" style={{ width: `${progress}%` }} /></div>
          <p className="status">{stage === 'checking' ? '文件接收完成，正在校验 SHA-256…' : `正在接收 ${progress}%`}</p>
          <button className="link-button" onClick={() => sessionRef.current?.cancel()}>取消传输</button>
        </>}

        {stage === 'error' && <><p className="status error">{error}</p><button className="secondary" onClick={reset}>重新尝试</button></>}
      </div>
    </section>
  );
};

const RouteNotice: React.FC<{ route: TransferRoute }> = ({ route }) => (
  <div className={`notice ${route === 'relay' ? 'relay' : ''}`}>
    {route === 'relay'
      ? '直连不可用：文件将通过 Cloudflare TURN 端到端加密中继。'
      : route === 'direct' ? '已建立点对点直连，文件不会经过中继服务器。' : '连接已建立，正在识别传输路径。'}
  </div>
);
