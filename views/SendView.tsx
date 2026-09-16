import React, { useEffect, useRef, useState } from 'react';
import { QrCode } from '../components/QrCode';
import { createRoom, websocketUrl } from '../services/p2p/api';
import { sha256Blob, validateFile } from '../services/p2p/hash';
import { PeerTransferSession } from '../services/p2p/PeerTransferSession';
import type { TransferRoute } from '../types';

type Stage = 'idle' | 'preparing' | 'waiting' | 'connecting' | 'ready' | 'transferring' | 'checking' | 'complete' | 'error';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export const SendView: React.FC = () => {
  const [stage, setStage] = useState<Stage>('idle');
  const [file, setFile] = useState<File>();
  const [roomCode, setRoomCode] = useState('');
  const [route, setRoute] = useState<TransferRoute>('unknown');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<PeerTransferSession | undefined>(undefined);

  useEffect(() => () => sessionRef.current?.close(), []);

  const chooseFile = (next?: File) => {
    if (!next) return;
    try {
      validateFile(next);
      setFile(next);
      setError('');
    } catch (reason) {
      setFile(undefined);
      setError(reason instanceof Error ? reason.message : '文件不可用');
    }
  };

  const start = async () => {
    if (!file) return;
    setStage('preparing');
    setError('');
    try {
      const hash = await sha256Blob(file);
      const room = await createRoom();
      sessionStorage.setItem(`airdrop-owner-${room.roomCode}`, room.ownerToken);
      setRoomCode(room.roomCode);
      const session = new PeerTransferSession('sender', room.iceServers, {
        onJoinRequest: () => {
          setStage('connecting');
          sessionRef.current?.approveJoin();
        },
        onConnected: currentRoute => {
          setRoute(currentRoute);
          setStage('ready');
        },
        onRoute: setRoute,
        onProgress: value => {
          setProgress(value);
          setStage(value >= 100 ? 'checking' : 'transferring');
        },
        onComplete: () => {
          setStage('complete');
          sessionStorage.removeItem(`airdrop-owner-${room.roomCode}`);
        },
        onVerificationFailed: () => {
          setError('接收方文件校验失败，请重新传输');
          setStage('error');
        },
        onPeerLeft: () => {
          setError('接收方已离开房间');
          setStage('error');
        },
        onError: message => {
          setError(message);
          setStage('error');
        },
      }, file, hash);
      sessionRef.current = session;
      await session.connectSignal(websocketUrl(room.roomCode, 'sender', room.ownerToken));
      setStage('waiting');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建房间失败');
      setStage('error');
    }
  };

  const reset = () => {
    sessionRef.current?.close();
    sessionRef.current = undefined;
    setStage('idle'); setFile(undefined); setRoomCode('');
    setProgress(0); setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const shareLink = roomCode ? `${window.location.href.split('#')[0]}#receive?code=${roomCode}` : '';
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'AirDrop-Lite 文件接收', text: `取件码：${roomCode}`, url: shareLink });
      else await navigator.clipboard.writeText(shareLink);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError('分享失败，请手动复制页面链接');
    }
  };

  if (stage === 'complete') return (
    <section className="card stack" aria-live="polite">
      <div className="complete-mark">✓</div>
      <div className="hero"><h1>传输已结束</h1><p>文件已经过接收方 SHA-256 校验，可以退出本网站。</p></div>
      <button className="secondary" onClick={reset}>发送其他文件</button>
    </section>
  );

  return (
    <section>
      <div className="hero"><h1>发送文件</h1><p>选择文件，生成一个临时取件码。</p></div>
      <div className="card stack">
        {stage === 'idle' && <>
          <label className={`drop-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={event => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}>
            <input ref={inputRef} className="hidden-input" type="file" onChange={event => chooseFile(event.target.files?.[0])} />
            <span className="drop-icon">↑</span>
            <strong>{file ? file.name : '点击或拖入文件'}</strong>
            <span className="muted">{file ? formatBytes(file.size) : '单文件最大 100 MB'}</span>
          </label>
          <button className="primary" disabled={!file} onClick={start}>创建传输房间</button>
        </>}

        {stage === 'preparing' && <p className="status">正在计算文件哈希并创建安全房间…</p>}

        {stage === 'waiting' && <>
          <div><p className="status">临时取件码</p><div className="room-code">{roomCode}</div></div>
          <QrCode value={shareLink} />
          <button className="secondary" onClick={() => void share()}>分享接收链接</button>
          <div className="file-summary"><strong>{file?.name}</strong><span>{file && formatBytes(file.size)}</span></div>
          <p className="status">把链接发给对方即可，打开后会自动开始传输。房间将在 10 分钟后失效…</p>
        </>}

        {stage === 'connecting' && <p className="status">正在协商点对点连接，必要时自动使用 TURN…</p>}

        {stage === 'ready' && <><RouteNotice route={route} /><p className="status">接收方已连接，正在自动开始传输…</p></>}

        {['transferring', 'checking'].includes(stage) && <>
          <RouteNotice route={route} />
          <div className="file-summary"><strong>{file?.name}</strong><span>{file && formatBytes(file.size)}</span></div>
          <div className="progress-track"><div className="progress-bar" style={{ width: `${progress}%` }} /></div>
          <p className="status">{stage === 'checking' ? '发送完成，等待接收方校验…' : `正在发送 ${progress}%`}</p>
        </>}

        {stage === 'error' && <><p className="status error">{error}</p><button className="secondary" onClick={reset}>重新开始</button></>}
        {error && stage === 'idle' && <p className="status error">{error}</p>}
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
