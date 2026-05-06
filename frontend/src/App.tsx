import MenuPage from './pages/MenuPage';
import DeckPage from './pages/DeckPage';
import CardsPage from './pages/CardsPage';
import ProfilePage from './pages/ProfilePage';
import BattlePage from './pages/BattlePage';
import { useUiStore } from './store/uiStore';

export default function App() {
  const screen = useUiStore((s) => s.screen);

  switch (screen) {
    case 'deck':
      return <DeckPage />;
    case 'cards':
      return <CardsPage />;
    case 'profile':
      return <ProfilePage />;
    case 'battle':
      return <BattlePage />;
    case 'menu':
    default:
      return <MenuPage />;
  }
}
