import Header from '@/components/Header';
import { useUiStore } from '@/store/uiStore';
import { useUserStore } from '@/store/userStore';

export default function MenuPage() {
  const setScreen = useUiStore((s) => s.setScreen);
  const isAuthed = useUserStore((s) => s.status === 'authenticated');

  return (
    <div style={page}>
      <Header />

      <main style={main}>
        <div style={logoBlock}>
          <div style={logoBadge}>⚔️</div>
          <h1 style={title}>CYBER ROYALE</h1>
          <p style={subtitle}>минималистичная fantasy arena</p>
        </div>

        <button
          onClick={() => setScreen('battle')}
          disabled={!isAuthed}
          style={{ ...playBtn, opacity: isAuthed ? 1 : 0.5 }}
        >
          Играть
        </button>
      </main>

      <nav style={bottomNav}>
        <NavBtn icon="🃏" label="Колода" onClick={() => setScreen('deck')} />
        <NavBtn icon="📚" label="Карты" onClick={() => setScreen('cards')} />
        <NavBtn icon="👤" label="Профиль" onClick={() => setScreen('profile')} />
      </nav>
    </div>
  );
}

function NavBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={navBtn}>
      <span style={{ fontSize: 22 }}>{icon}</span>
      <span style={{ fontSize: 12 }}>{label}</span>
    </button>
  );
}

const page: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
};

const main: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  padding: '24px',
  gap: 36,
};

const logoBlock: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
};

const logoBadge: React.CSSProperties = {
  width: 72,
  height: 72,
  borderRadius: 18,
  background: 'linear-gradient(135deg, #2a3142 0%, #151a25 100%)',
  border: '1px solid #2a3142',
  display: 'grid',
  placeItems: 'center',
  fontSize: 36,
};

const title: React.CSSProperties = {
  margin: 0,
  fontSize: 28,
  letterSpacing: 3,
  fontWeight: 800,
};

const subtitle: React.CSSProperties = {
  margin: 0,
  opacity: 0.55,
  fontSize: 13,
  letterSpacing: 1,
};

const playBtn: React.CSSProperties = {
  width: '100%',
  maxWidth: 280,
  padding: '18px 24px',
  borderRadius: 16,
  border: 'none',
  background: 'linear-gradient(180deg, #ffd267 0%, #f0a83a 100%)',
  color: '#1a1a1a',
  fontSize: 18,
  fontWeight: 800,
  letterSpacing: 1,
  cursor: 'pointer',
  boxShadow: '0 8px 24px rgba(240, 168, 58, 0.25), inset 0 -3px 0 rgba(0,0,0,0.15)',
};

const bottomNav: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 8,
  padding: '12px 14px calc(12px + env(safe-area-inset-bottom, 0px))',
  borderTop: '1px solid #1a2030',
  background: '#0b0d12',
};

const navBtn: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: '10px 6px',
  borderRadius: 12,
  border: '1px solid #2a3142',
  background: '#151a25',
  color: '#e7ecf3',
  cursor: 'pointer',
};
