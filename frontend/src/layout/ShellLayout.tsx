import { useUiStore } from '@/store/uiStore';
import HomePage from '@/pages/HomePage';
import CollectionPage from '@/pages/CollectionPage';
import BattleHomePage from '@/pages/BattleHomePage';
import QuestsPage from '@/pages/QuestsPage';
import ProfilePage from '@/pages/ProfilePage';
import BottomNav from './BottomNav';

export default function ShellLayout() {
  const screen = useUiStore((s) => s.screen);

  return (
    <div style={shell}>
      <main style={main}>
        {screen === 'home' && <HomePage />}
        {screen === 'collection' && <CollectionPage />}
        {screen === 'battle' && <BattleHomePage />}
        {screen === 'quests' && <QuestsPage />}
        {screen === 'profile' && <ProfilePage />}
      </main>
      <BottomNav />
    </div>
  );
}

const shell: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background:
    'radial-gradient(ellipse at 50% 0%, #2a1d4a 0%, #0b0d12 48%), #0b0d12',
};

const main: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  // 30px отступа на всех страницах + safe-area-inset.
  // Учитывает «шапку» Telegram WebApp с back/close кнопкой и More-меню,
  // чтобы контент никогда не оказывался под ней.
  paddingTop: 'calc(env(safe-area-inset-top, 0px) + 30px)',
};
