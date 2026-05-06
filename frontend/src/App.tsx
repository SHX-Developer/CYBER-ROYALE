import BattlePage from './pages/BattlePage';
import ShellLayout from './layout/ShellLayout';
import { useUiStore } from './store/uiStore';

export default function App() {
  const screen = useUiStore((s) => s.screen);
  if (screen === 'arena') return <BattlePage />;
  return <ShellLayout />;
}
