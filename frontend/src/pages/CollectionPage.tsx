import { useEffect, useMemo, useState } from 'react';
import CardTile from '@/components/CardTile';
import { fetchCards, type Card } from '@/api/cards';

type Filter = 'all' | 'UNIT' | 'SPELL';

export default function CollectionPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Card | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    fetchCards()
      .then((data) => {
        setCards(data);
        setStatus('ok');
      })
      .catch((err: Error) => {
        setError(err.message);
        setStatus('error');
      });
  }, []);

  const visible = useMemo(() => {
    if (filter === 'all') return cards;
    return cards.filter((c) => c.type === filter);
  }, [cards, filter]);

  return (
    <div style={page}>
      <header style={header}>
        <h2 style={title}>Коллекция {cards.length ? `(${cards.length})` : ''}</h2>
      </header>

      <div style={filters}>
        <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')}>
          Все
        </FilterBtn>
        <FilterBtn active={filter === 'UNIT'} onClick={() => setFilter('UNIT')}>
          Юниты
        </FilterBtn>
        <FilterBtn active={filter === 'SPELL'} onClick={() => setFilter('SPELL')}>
          Спеллы
        </FilterBtn>
      </div>

      {status === 'loading' && <div style={hint}>Загрузка карт…</div>}
      {status === 'error' && (
        <div style={{ ...hint, color: '#ff8585' }}>Не удалось загрузить карты: {error}</div>
      )}

      {status === 'ok' && (
        <div style={grid}>
          {visible.map((card) => (
            <CardTile key={card.id} card={card} onClick={() => setSelected(card)} />
          ))}
        </div>
      )}

      {selected && <CardModal card={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        ...filterBtn,
        background: active ? '#2a3142' : '#151a25',
        borderColor: active ? '#3a4358' : '#2a3142',
      }}
    >
      {children}
    </button>
  );
}

function CardModal({ card, onClose }: { card: Card; onClose: () => void }) {
  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalIcon}>{card.icon}</div>
        <h3 style={{ margin: 0 }}>{card.name}</h3>
        <div style={{ opacity: 0.6, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
          {card.type === 'SPELL' ? 'spell' : 'unit'} · стоимость {card.energyCost}⚡
        </div>
        {card.description && <p style={{ opacity: 0.85, margin: 0 }}>{card.description}</p>}

        <div style={modalStats}>
          {card.hp != null && <ModalStat label="HP" value={card.hp} />}
          {card.damage != null && (
            <ModalStat label={card.code === 'heal' ? 'Лечение' : 'Урон'} value={card.damage} />
          )}
          {card.attackSpeed != null && <ModalStat label="Скорость атаки" value={card.attackSpeed} />}
          {card.range != null && <ModalStat label="Дальность" value={card.range} />}
          {card.moveSpeed != null && <ModalStat label="Скорость" value={card.moveSpeed} />}
        </div>

        <button onClick={onClose} style={closeBtn}>
          Закрыть
        </button>
      </div>
    </div>
  );
}

function ModalStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={modalStatBox}>
      <div style={{ fontSize: 11, opacity: 0.6 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const page: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '15px 16px 16px',
  gap: 12,
};

const header: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const title: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  letterSpacing: 1,
};

const filters: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

const filterBtn: React.CSSProperties = {
  flex: 1,
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid #2a3142',
  color: '#e7ecf3',
  fontSize: 13,
  cursor: 'pointer',
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 10,
};

const hint: React.CSSProperties = {
  textAlign: 'center',
  padding: 32,
  opacity: 0.6,
};

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.65)',
  display: 'grid',
  placeItems: 'center',
  padding: 16,
  zIndex: 100,
};

const modal: React.CSSProperties = {
  width: '100%',
  maxWidth: 320,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 12,
  padding: 20,
  borderRadius: 16,
  background: '#151a25',
  border: '1px solid #2a3142',
  textAlign: 'center',
};

const modalIcon: React.CSSProperties = {
  width: 72,
  height: 72,
  borderRadius: 16,
  background: '#0f1320',
  border: '1px solid #1f2738',
  display: 'grid',
  placeItems: 'center',
  fontSize: 40,
};

const modalStats: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 8,
  width: '100%',
};

const modalStatBox: React.CSSProperties = {
  padding: 10,
  borderRadius: 10,
  background: '#0f1320',
  border: '1px solid #1f2738',
};

const closeBtn: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  borderRadius: 10,
  border: '1px solid #2a3142',
  background: '#0f1320',
  color: '#e7ecf3',
  fontSize: 14,
  cursor: 'pointer',
  marginTop: 4,
};
