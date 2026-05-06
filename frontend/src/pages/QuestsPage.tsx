export default function QuestsPage() {
  const stub = [
    { icon: '⚔️', title: 'Победи 3 раза', progress: '0 / 3', reward: '🪙 30' },
    { icon: '🃏', title: 'Используй 10 карт', progress: '0 / 10', reward: '✨ 25' },
    { icon: '🏰', title: 'Снеси 5 башен', progress: '0 / 5', reward: '💎 5' },
  ];

  return (
    <div style={page}>
      <header style={header}>
        <h2 style={title}>Задания</h2>
        <span style={{ fontSize: 11, opacity: 0.55 }}>скоро будут активны</span>
      </header>

      <div style={list}>
        {stub.map((q, i) => (
          <div key={i} style={questCard}>
            <div style={icon}>{q.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{q.title}</div>
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{q.progress}</div>
            </div>
            <div style={reward}>{q.reward}</div>
          </div>
        ))}
      </div>

      <p style={hint}>
        Система ежедневных и сезонных заданий появится в следующем апдейте.
      </p>
    </div>
  );
}

const page: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '14px 16px 16px',
  gap: 12,
};

const header: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
};

const title: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  letterSpacing: 1,
};

const list: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const questCard: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: 12,
  borderRadius: 12,
  background: '#151a25',
  border: '1px solid #2a3142',
  opacity: 0.65,
};

const icon: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 10,
  background: '#0f1320',
  border: '1px solid #1f2738',
  display: 'grid',
  placeItems: 'center',
  fontSize: 22,
};

const reward: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 999,
  background: '#0f1320',
  border: '1px solid #2a3142',
  fontSize: 11,
  fontWeight: 700,
};

const hint: React.CSSProperties = {
  margin: '6px 6px 0',
  fontSize: 12,
  opacity: 0.5,
  textAlign: 'center',
};
