import SubPage from '@/components/SubPage';
import { useUserStore } from '@/store/userStore';

export default function ProfilePage() {
  const profile = useUserStore((s) => s.profile);

  if (!profile) {
    return <SubPage title="Профиль" />;
  }

  return (
    <SubPage title="Профиль">
      <div style={card}>
        <div style={row}>
          {profile.photoUrl ? (
            <img src={profile.photoUrl} alt="" width={64} height={64} style={avatar} />
          ) : (
            <div style={{ ...avatar, ...avatarFallback }}>
              {(profile.firstName ?? profile.username ?? 'P').charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {profile.firstName ?? profile.username ?? `id${profile.telegramId}`}
            </div>
            {profile.username && <div style={{ opacity: 0.6 }}>@{profile.username}</div>}
            <div style={{ opacity: 0.6, fontSize: 12, marginTop: 4 }}>
              telegramId: {profile.telegramId}
            </div>
          </div>
        </div>

        <div style={statsGrid}>
          <Stat label="Уровень" value={profile.level} />
          <Stat label="Монеты" value={profile.coins} icon="🪙" />
          <Stat label="Гемы" value={profile.gems} icon="💎" />
        </div>
      </div>
    </SubPage>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon?: string }) {
  return (
    <div style={statBox}>
      <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
        {icon && <span style={{ marginRight: 6 }}>{icon}</span>}
        {value}
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  padding: 16,
  borderRadius: 14,
  background: '#151a25',
  border: '1px solid #2a3142',
};

const row: React.CSSProperties = {
  display: 'flex',
  gap: 14,
  alignItems: 'center',
};

const avatar: React.CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: 32,
  border: '1px solid #2a3142',
  flexShrink: 0,
};

const avatarFallback: React.CSSProperties = {
  background: '#2a3142',
  display: 'grid',
  placeItems: 'center',
  fontSize: 24,
  fontWeight: 700,
};

const statsGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 8,
};

const statBox: React.CSSProperties = {
  padding: 12,
  borderRadius: 10,
  background: '#0f1320',
  border: '1px solid #1f2738',
  textAlign: 'center',
};
