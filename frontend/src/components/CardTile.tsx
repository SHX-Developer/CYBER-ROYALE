import type { Card } from '@/api/cards';

interface Props {
  card: Card;
  onClick?: () => void;
}

export default function CardTile({ card, onClick }: Props) {
  const isSpell = card.type === 'SPELL';

  return (
    <button onClick={onClick} style={tile} aria-label={card.name}>
      <div style={{ ...energyBadge, ...(isSpell ? spellBadge : unitBadge) }}>
        {card.energyCost}
      </div>
      <div style={iconBox}>{card.icon}</div>
      <div style={nameStyle}>{card.name}</div>
      <div style={typeBadge}>{isSpell ? 'spell' : 'unit'}</div>

      <div style={statsRow}>
        {card.hp != null && <Stat icon="❤️" value={card.hp} />}
        {card.damage != null && <Stat icon={isSpell && card.code === 'heal' ? '✨' : '⚔'} value={card.damage} />}
        {card.range != null && <Stat icon="🎯" value={card.range} />}
      </div>
    </button>
  );
}

function Stat({ icon, value }: { icon: string; value: number }) {
  return (
    <span style={statChip}>
      <span>{icon}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </span>
  );
}

const tile: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  padding: '14px 10px 10px',
  borderRadius: 14,
  border: '1px solid #2a3142',
  background: 'linear-gradient(180deg, #181d2a 0%, #11151f 100%)',
  color: '#e7ecf3',
  cursor: 'pointer',
  textAlign: 'center',
};

const iconBox: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: 12,
  background: '#0f1320',
  border: '1px solid #1f2738',
  display: 'grid',
  placeItems: 'center',
  fontSize: 32,
};

const nameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  marginTop: 2,
};

const typeBadge: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 1,
  textTransform: 'uppercase',
  opacity: 0.55,
};

const statsRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 4,
  marginTop: 4,
};

const statChip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '2px 6px',
  borderRadius: 999,
  background: '#0b0d12',
  border: '1px solid #1f2738',
  fontSize: 11,
};

const energyBadge: React.CSSProperties = {
  position: 'absolute',
  top: 6,
  left: 6,
  width: 26,
  height: 26,
  borderRadius: 13,
  display: 'grid',
  placeItems: 'center',
  fontSize: 13,
  fontWeight: 800,
  color: '#1a1a1a',
};

const unitBadge: React.CSSProperties = {
  background: 'linear-gradient(180deg, #ffd267 0%, #f0a83a 100%)',
};

const spellBadge: React.CSSProperties = {
  background: 'linear-gradient(180deg, #b08fff 0%, #7c5cff 100%)',
  color: '#0b0d12',
};
