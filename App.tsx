import React, { useState, useEffect } from 'react';
import { SendView } from './views/SendView';
import { ReceiveView } from './views/ReceiveView';
import { AdminView } from './views/AdminView';
import { ViewState } from './types';

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>(ViewState.SEND);
  const [receiveCode, setReceiveCode] = useState<string>('');

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1); // remove #
      const params = new URLSearchParams(hash.split('?')[1]);
      const path = hash.split('?')[0];

      if (path === 'receive') {
        setView(ViewState.RECEIVE);
        const code = params.get('code');
        if (code) setReceiveCode(code);
      } else if (path === 'admin') {
        setView(ViewState.ADMIN);
      } else {
        setView(ViewState.SEND);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange(); // Initial check

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = (newView: string) => {
    window.location.hash = newView.toLowerCase();
  };

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8">
      {/* Navigation */}
      <nav className="mb-12 bg-white/50 backdrop-blur-sm p-1.5 rounded-full border border-zinc-200/60 shadow-sm flex space-x-1">
        <button
          onClick={() => navigate('send')}
          className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
            view === ViewState.SEND 
              ? 'bg-black text-white shadow-md' 
              : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
          }`}
        >
          发送
        </button>
        <button
          onClick={() => navigate('receive')}
          className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
            view === ViewState.RECEIVE 
              ? 'bg-black text-white shadow-md' 
              : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
          }`}
        >
          接收
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="w-full max-w-5xl animate-fade-in">
        {view === ViewState.SEND && <SendView />}
        {view === ViewState.RECEIVE && <ReceiveView initialCode={receiveCode} />}
        {view === ViewState.ADMIN && <AdminView />}
      </main>

      {/* Footer / Admin Link */}
      <footer className="mt-auto pt-12 text-center space-y-2 w-full">
        {view !== ViewState.ADMIN && (
            <button 
            onClick={() => navigate('admin')}
            className="text-xs text-zinc-300 hover:text-zinc-500 transition-colors inline-block"
            >
            后台管理
            </button>
        )}
        <div className="text-xs text-zinc-400 space-y-1">
          <div>
            v{import.meta.env.VITE_APP_VERSION || '1.0.0'}
          </div>
          <div className="text-zinc-300">
            © 2025 <span className="font-medium">Hwangzhun</span> | MIT License
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;