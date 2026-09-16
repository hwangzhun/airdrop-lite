import React, { useEffect, useState } from 'react';
import { SendView } from './views/SendView';
import { ReceiveView } from './views/ReceiveView';

type View = 'send' | 'receive';

function readLocation(): { view: View; code: string } {
  const raw = window.location.hash.replace(/^#/, '');
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  return { view: path === 'receive' ? 'receive' : 'send', code: (params.get('code') || '').toUpperCase() };
}

const App: React.FC = () => {
  const [location, setLocation] = useState(readLocation);

  useEffect(() => {
    const update = () => setLocation(readLocation());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  const navigate = (view: View) => { window.location.hash = view; };

  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={() => navigate('send')} aria-label="返回发送页">
          <span className="brand-mark">A</span><span>AirDrop-Lite</span>
        </button>
        <nav className="nav-tabs" aria-label="主要导航">
          <button className={location.view === 'send' ? 'active' : ''} onClick={() => navigate('send')}>发送</button>
          <button className={location.view === 'receive' ? 'active' : ''} onClick={() => navigate('receive')}>接收</button>
        </nav>
      </header>
      <main className="main-content">
        {location.view === 'send' ? <SendView /> : <ReceiveView initialCode={location.code} />}
      </main>
      <footer>
        <p>文件优先点对点直传，直连失败时通过 Cloudflare TURN 加密中继。</p>
        <p>双方需保持页面打开 · 单文件最大 100 MB</p>
      </footer>
    </div>
  );
};

export default App;
