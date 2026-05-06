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
};

const main: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
};
