import { useUiStore, type Screen } from '@/store/uiStore';

interface Tab {
  id: Screen;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { id: 'home', label: 'Главная', icon: '🏰' },
  { id: 'collection', label: 'Коллекция', icon: '📚' },
  { id: 'battle', label: 'Бой', icon: '⚔️' },
  { id: 'quests', label: 'Задания', icon: '📜' },
  { id: 'profile', label: 'Профиль', icon: '👤' },
];

export default function BottomNav() {
  const screen = useUiStore((s) => s.screen);
  const setScreen = useUiStore((s) => s.setScreen);

  return (
    <nav style={nav}>
      {TABS.map((t) => {
        const active = screen === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setScreen(t.id)}
            style={{
              ...tab,
              color: active ? '#ffd267' : '#9ba1b0',
              background: active ? 'rgba(255, 210, 103, 0.08)' : 'transparent',
            }}
          >
            <span style={{ fontSize: 19, lineHeight: '20px' }}>{t.icon}</span>
            <span style={{ fontSize: 9.5, marginTop: 2 }}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

const nav: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: 4,
  padding: '6px 6px calc(6px + env(safe-area-inset-bottom, 0px))',
  borderTop: '1px solid #1a2030',
  background: 'linear-gradient(180deg, #0e1320 0%, #0a0d14 100%)',
  flexShrink: 0,
};

const tab: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 0,
  padding: '6px 2px',
  borderRadius: 10,
  border: 'none',
  cursor: 'pointer',
  transition: 'background 150ms',
};
