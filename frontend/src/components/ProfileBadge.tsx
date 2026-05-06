import { useUserStore } from '@/store/userStore';

export default function ProfileBadge() {
  const { status, profile, error } = useUserStore();

  if (status === 'loading' || status === 'idle') {
    return <div style={wrap}>Загружаю профиль…</div>;
  }
  if (status === 'error' || !profile) {
    return (
      <div style={{ ...wrap, color: '#ff8585' }}>
        Не удалось войти{error ? `: ${error}` : ''}
      </div>
    );
  }

  const name = profile.firstName || profile.username || `id${profile.telegramId}`;
  return (
    <div style={wrap}>
      {profile.photoUrl ? (
        <img
          src={profile.photoUrl}
          alt=""
          width={40}
          height={40}
          style={{ borderRadius: 20, border: '1px solid #2a3142' }}
        />
      ) : (
        <div style={avatarFallback}>{name.charAt(0).toUpperCase()}</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <strong style={{ fontSize: 14 }}>{name}</strong>
        <small style={{ opacity: 0.7 }}>
          ур. {profile.level} · {profile.coins}🪙 · {profile.gems}💎
        </small>
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 14px',
  borderRadius: 12,
  background: '#151a25',
  border: '1px solid #2a3142',
  width: '100%',
  maxWidth: 280,
};

const avatarFallback: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 20,
  background: '#2a3142',
  display: 'grid',
  placeItems: 'center',
  fontWeight: 600,
};
