import { useUiStore } from '@/store/uiStore';
import { useUserStore } from '@/store/userStore';
import { playSound } from '@/audio/soundEngine';

export default function BattleHomePage() {
  const setScreen = useUiStore((s) => s.setScreen);
  const isAuthed = useUserStore((s) => s.status === 'authenticated');

  return (
    <div style={page}>
      <header style={header}>
        <h2 style={title}>Бой</h2>
      </header>

      <div style={modeCard}>
        <div style={{ fontSize: 40 }}>🤖</div>
        <h3 style={{ margin: 0, fontSize: 18 }}>Против бота</h3>
        <p style={{ margin: 0, opacity: 0.65, fontSize: 13, textAlign: 'center' }}>
          Тренировочная арена 1 на 1. 3 минуты, 8 карт, цель — снести вражеского короля.
        </p>
        <button
          onClick={() => {
            playSound('buttonClick');
            setScreen('arena');
          }}
          disabled={!isAuthed}
          style={{ ...primaryBtn, opacity: isAuthed ? 1 : 0.5 }}
        >
          В бой
        </button>
      </div>

      <div style={{ ...modeCard, opacity: 0.55 }}>
        <div style={{ fontSize: 40 }}>🌐</div>
        <h3 style={{ margin: 0, fontSize: 18 }}>Онлайн 1 на 1</h3>
        <p style={{ margin: 0, opacity: 0.65, fontSize: 13, textAlign: 'center' }}>
          PvP появится после открытия серверной симуляции. Архитектура уже готова — дело за WebSocket.
        </p>
        <button disabled style={{ ...primaryBtn, opacity: 0.4 }}>
          Скоро
        </button>
      </div>
    </div>
  );
}

const page: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '14px 16px 16px',
  gap: 14,
};

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
};

const title: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  letterSpacing: 1,
};

const modeCard: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
  padding: 18,
  borderRadius: 16,
  background: 'linear-gradient(180deg, #181d2a 0%, #0f1320 100%)',
  border: '1px solid #2a3142',
};

const primaryBtn: React.CSSProperties = {
  width: '100%',
  padding: '14px 18px',
  borderRadius: 12,
  border: '1px solid #f0a83a',
  background: 'linear-gradient(180deg, #ffd267 0%, #f0a83a 100%)',
  color: '#1a1a1a',
  fontSize: 15,
  fontWeight: 800,
  letterSpacing: 1,
  cursor: 'pointer',
  marginTop: 4,
};
