import { Suspense, lazy } from 'react';
import ShellLayout from './layout/ShellLayout';
import { useUiStore } from './store/uiStore';

const BattlePage = lazy(() => import('./pages/BattlePage'));

export default function App() {
  const screen = useUiStore((s) => s.screen);
  if (screen === 'arena') {
    return (
      <Suspense fallback={<div style={battleFallback}>Загрузка боя...</div>}>
        <BattlePage />
      </Suspense>
    );
  }
  return <ShellLayout />;
}

const battleFallback: React.CSSProperties = {
  height: '100%',
  display: 'grid',
  placeItems: 'center',
  background:
    'radial-gradient(circle at 50% 38%, rgba(255,210,103,0.08), transparent 24%), #0b0d12',
  color: '#e7ecf3',
  fontSize: 13,
  fontWeight: 700,
};
