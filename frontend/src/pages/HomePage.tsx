import { useUiStore } from '@/store/uiStore';
import { useUserStore } from '@/store/userStore';

export default function HomePage() {
  const setScreen = useUiStore((s) => s.setScreen);
  const profile = useUserStore((s) => s.profile);
  const isAuthed = useUserStore((s) => s.status === 'authenticated');
  const winRate =
    profile && profile.battlesCount > 0
      ? Math.round((profile.wins / profile.battlesCount) * 100)
      : 0;

  return (
    <div style={page}>
      <div style={topBar}>
        <ProfileChip />
        <ResourceBar />
      </div>

      <div style={hero}>
        <div style={logoBadge}>
          <span style={{ fontSize: 36 }}>⚔️</span>
        </div>
        <h1 style={title}>CYBER ROYALE</h1>
        <p style={subtitle}>минималистичная fantasy arena</p>
      </div>

      <div style={statsRow}>
        <Stat label="Уровень" value={String(profile?.level ?? 1)} />
        <Stat label="Бои" value={String(profile?.battlesCount ?? 0)} />
        <Stat label="Винрейт" value={`${winRate}%`} />
      </div>

      <button
        onClick={() => setScreen('arena')}
        disabled={!isAuthed}
        style={{ ...playBtn, opacity: isAuthed ? 1 : 0.5 }}
      >
        ИГРАТЬ
      </button>

      <button onClick={() => setScreen('collection')} style={secondaryBtn}>
        📚 Открыть коллекцию
      </button>
    </div>
  );
}

function ProfileChip() {
  const profile = useUserStore((s) => s.profile);
  if (!profile) return <div style={chip}>Загрузка…</div>;
  const name = profile.firstName ?? profile.username ?? `id${profile.telegramId}`;
  return (
    <div style={chip}>
      {profile.photoUrl ? (
        <img src={profile.photoUrl} alt="" style={chipAvatar} />
      ) : (
        <div style={{ ...chipAvatar, ...avatarFallback }}>{name.charAt(0).toUpperCase()}</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <strong style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </strong>
        <small style={{ opacity: 0.6, fontSize: 11 }}>ур. {profile.level}</small>
      </div>
    </div>
  );
}

function ResourceBar() {
  const profile = useUserStore((s) => s.profile);
  return (
    <div style={resources}>
      <Pill icon={<span>🪙</span>} value={profile?.coins ?? 0} />
      <Pill icon={<span>💎</span>} value={profile?.gems ?? 0} />
    </div>
  );
}

function Pill({ icon, value }: { icon: React.ReactNode; value: number }) {
  return (
    <div style={pill}>
      <span style={{ fontSize: 12 }}>{icon}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 12 }}>{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={statBox}>
      <div style={{ fontSize: 10, opacity: 0.55, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{value}</div>
    </div>
  );
}

const page: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  padding: '14px 16px 24px',
  minHeight: '100%',
  background:
    'radial-gradient(ellipse at 50% -10%, #2a1d4a 0%, #0b0d12 55%), linear-gradient(180deg, #0b0d12 0%, #0b0d12 100%)',
};

const topBar: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
};

const chip: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px 6px 6px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid #2a3142',
  minWidth: 0,
  flex: '0 1 60%',
};

const chipAvatar: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 15,
  border: '1px solid #2a3142',
  flexShrink: 0,
};

const avatarFallback: React.CSSProperties = {
  background: '#2a3142',
  display: 'grid',
  placeItems: 'center',
  fontWeight: 700,
};

const resources: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexShrink: 0,
};

const pill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 9px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid #2a3142',
  color: '#e7ecf3',
};

const hero: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  marginTop: 14,
};

const logoBadge: React.CSSProperties = {
  width: 86,
  height: 86,
  borderRadius: 22,
  background: 'linear-gradient(135deg, #3d2068 0%, #1a1024 100%)',
  border: '1px solid #4d3088',
  display: 'grid',
  placeItems: 'center',
  boxShadow: '0 8px 24px rgba(123, 67, 255, 0.25)',
};

const title: React.CSSProperties = {
  margin: 0,
  fontSize: 28,
  letterSpacing: 4,
  fontWeight: 900,
  background: 'linear-gradient(180deg, #ffd267 0%, #ff9b3a 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
};

const subtitle: React.CSSProperties = {
  margin: 0,
  opacity: 0.55,
  fontSize: 12,
  letterSpacing: 1,
};

const statsRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 8,
  marginTop: 8,
};

const statBox: React.CSSProperties = {
  padding: '10px 8px',
  borderRadius: 12,
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid #2a3142',
  textAlign: 'center',
};

const playBtn: React.CSSProperties = {
  marginTop: 10,
  width: '100%',
  padding: '16px 18px',
  borderRadius: 16,
  border: '1px solid #f0a83a',
  background: 'linear-gradient(180deg, #ffd267 0%, #f0a83a 100%)',
  color: '#1a1a1a',
  fontSize: 17,
  fontWeight: 900,
  letterSpacing: 2,
  cursor: 'pointer',
  boxShadow: '0 10px 28px rgba(240, 168, 58, 0.25), inset 0 -4px 0 rgba(0,0,0,0.18)',
};

const secondaryBtn: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  borderRadius: 12,
  border: '1px solid #2a3142',
  background: '#151a25',
  color: '#e7ecf3',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
