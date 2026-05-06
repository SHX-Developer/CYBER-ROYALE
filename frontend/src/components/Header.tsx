import { useUserStore } from '@/store/userStore';

export default function Header() {
  const { status, profile, error } = useUserStore();

  return (
    <header style={wrap}>
      <div style={leftBlock}>
        {profile && status === 'authenticated' ? (
          <>
            {profile.photoUrl ? (
              <img src={profile.photoUrl} alt="" width={40} height={40} style={avatar} />
            ) : (
              <div style={avatarFallback}>
                {(profile.firstName ?? profile.username ?? 'P').charAt(0).toUpperCase()}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <strong style={nameStyle}>
                {profile.firstName ?? profile.username ?? `id${profile.telegramId}`}
              </strong>
              <span style={levelStyle}>уровень 1</span>
            </div>
          </>
        ) : (
          <span style={{ opacity: 0.6, fontSize: 13 }}>
            {status === 'error' ? `вход не удался: ${error ?? ''}` : 'загрузка…'}
          </span>
        )}
      </div>

      <div style={balances}>
        <Balance icon="🪙" value={profile?.coins ?? 0} />
        <Balance icon="💎" value={profile?.gems ?? 0} />
      </div>
    </header>
  );
}

function Balance({ icon, value }: { icon: string; value: number }) {
  return (
    <div style={balancePill}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const wrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 14px',
  borderBottom: '1px solid #1a2030',
  background: 'linear-gradient(180deg, #0f1320 0%, #0b0d12 100%)',
  position: 'sticky',
  top: 0,
};

const leftBlock: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
  flex: 1,
};

const avatar: React.CSSProperties = {
  borderRadius: 20,
  border: '1px solid #2a3142',
  flexShrink: 0,
};

const avatarFallback: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 20,
  background: '#2a3142',
  display: 'grid',
  placeItems: 'center',
  fontWeight: 700,
  flexShrink: 0,
};

const nameStyle: React.CSSProperties = {
  fontSize: 14,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const levelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.65,
};

const balances: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexShrink: 0,
};

const balancePill: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderRadius: 999,
  background: '#151a25',
  border: '1px solid #2a3142',
  fontSize: 13,
};
