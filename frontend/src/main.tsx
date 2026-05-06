import React from 'react';
import ReactDOM from 'react-dom/client';
import WebApp from '@twa-dev/sdk';
import App from './App';
import { loginWithTelegram } from './api/auth';
import { useUserStore } from './store/userStore';

// Telegram Web App init (no-op outside Telegram)
let initData = '';
try {
  WebApp.ready();
  WebApp.expand();
  initData = WebApp.initData ?? '';
} catch {
  // Running outside Telegram — fine for local dev (DEV_AUTO_LOGIN на бэке).
}

// Логинимся ещё до первого рендера — store обновится сам через хук.
useUserStore.getState().setLoading();
loginWithTelegram(initData)
  .then((res) => useUserStore.getState().setProfile(res.user))
  .catch((err: Error) => useUserStore.getState().setError(err.message));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
