import { useEffect, useMemo, useState } from 'react';
import CardTile from '@/components/CardTile';
import { fetchCards, type Card } from '@/api/cards';
import {
  ALL_CARD_CODES,
  CARDS,
  DECK_SIZE,
  useBattleStore,
  type CardCode,
} from '@/store/battleStore';
import { UNIT_STATS, type UnitType } from '@/game/unit';
import { SPELL_STATS, type SpellCode } from '@/game/spells';

type Filter = 'all' | 'UNIT' | 'SPELL';

export default function CollectionPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Card | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  const deck = useBattleStore((s) => s.deck);
  const toggleDeckCard = useBattleStore((s) => s.toggleDeckCard);
  const moveDeckCard = useBattleStore((s) => s.moveDeckCard);

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

  const mergedCards = useMemo(() => mergeCards(cards), [cards]);

  const visible = useMemo(() => {
    if (filter === 'all') return mergedCards;
    return mergedCards.filter((c) => c.type === filter);
  }, [mergedCards, filter]);

  const deckCards = useMemo(
    () => deck.map((code) => mergedCards.find((card) => card.code === code)).filter(Boolean) as Card[],
    [deck, mergedCards],
  );

  const onDeckSlotClick = (index: number) => {
    if (index >= deck.length) return;
    if (swapFrom == null) {
      setSwapFrom(index);
      return;
    }
    if (swapFrom !== index) moveDeckCard(swapFrom, index);
    setSwapFrom(null);
  };

  return (
    <div style={page}>
      <header style={header}>
        <h2 style={title}>Коллекция {mergedCards.length ? `(${mergedCards.length})` : ''}</h2>
      </header>

      <section style={deckPanel}>
        <div style={deckHeader}>
          <div style={deckTitle}>Моя колода</div>
          <div style={{ ...deckCount, color: deck.length === DECK_SIZE ? '#98f5c1' : '#ffd267' }}>
            {deck.length}/{DECK_SIZE}
          </div>
        </div>
        <div style={deckGrid}>
          {Array.from({ length: DECK_SIZE }).map((_, index) => {
            const card = deckCards[index];
            const active = swapFrom === index;
            return (
              <button
                key={index}
                type="button"
                draggable={Boolean(card)}
                onClick={() => onDeckSlotClick(index)}
                onDragStart={(e) => {
                  if (!card) return;
                  e.dataTransfer.setData('text/plain', String(index));
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = Number(e.dataTransfer.getData('text/plain'));
                  if (Number.isFinite(from)) moveDeckCard(from, index);
                  setSwapFrom(null);
                }}
                style={{
                  ...deckSlot,
                  borderColor: active ? '#ffd267' : card ? '#3a4358' : '#2a3142',
                  background: active ? '#2a2532' : card ? '#151a25' : '#10141d',
                }}
              >
                {card ? (
                  <>
                    <span style={slotCost}>{card.energyCost}</span>
                    <span style={slotIcon}>{card.icon}</span>
                    <span style={slotName}>{card.name}</span>
                  </>
                ) : (
                  <span style={emptySlot}>+</span>
                )}
              </button>
            );
          })}
        </div>
      </section>

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
        <div style={{ ...hint, color: '#ff8585' }}>
          Не удалось загрузить карты с backend: {error}. Показываю локальный каталог.
        </div>
      )}

      {(status === 'ok' || status === 'error') && (
        <div style={grid}>
          {visible.map((card) => (
            <CardTile
              key={card.code}
              card={card}
              selected={deck.includes(card.code as CardCode)}
              disabled={!deck.includes(card.code as CardCode) && deck.length >= DECK_SIZE}
              onClick={() => toggleDeckCard(card.code as CardCode)}
              onInfo={() => setSelected(card)}
            />
          ))}
        </div>
      )}

      {selected && <CardModal card={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function mergeCards(remote: Card[]): Card[] {
  const byCode = new Map(remote.map((card) => [card.code, card]));
  for (const code of ALL_CARD_CODES) {
    if (!byCode.has(code)) byCode.set(code, buildLocalCard(code));
  }
  return ALL_CARD_CODES.map((code) => byCode.get(code)).filter(Boolean) as Card[];
}

function buildLocalCard(code: CardCode): Card {
  const def = CARDS[code];
  if (def.kind === 'spell') {
    const stats = SPELL_STATS[code as SpellCode];
    return {
      id: `local-${code}`,
      code,
      name: def.name,
      type: 'SPELL',
      energyCost: def.energyCost,
      hp: null,
      damage: stats.unitImpact,
      attackSpeed: null,
      range: pxToCells(stats.radius),
      moveSpeed: null,
      description:
        code === 'heal'
          ? 'Лечит союзников в области несколько секунд.'
          : 'Наносит урон юнитам и башням в области.',
      icon: def.icon,
    };
  }

  const stats = UNIT_STATS[code as UnitType];
  return {
    id: `local-${code}`,
    code,
    name: def.name,
    type: 'UNIT',
    energyCost: def.energyCost,
    hp: stats.maxHp,
    damage: stats.damage,
    attackSpeed: stats.attackSpeed,
    range: pxToCells(stats.range),
    moveSpeed: pxToCells(stats.moveSpeed),
    description: unitDescription(code),
    icon: def.icon,
  };
}

function pxToCells(value: number) {
  return Math.round((value / 40) * 10) / 10;
}

function unitDescription(code: CardCode): string {
  switch (code) {
    case 'lancer':
      return 'Боец ближнего боя с увеличенной дистанцией удара.';
    case 'guardian':
      return 'Средний танк для удержания линии.';
    case 'bombardier':
      return 'Дальний взрывной урон против плотных атак.';
    case 'frost_witch':
      return 'Магический дальний урон с ледяными эффектами.';
    case 'stormcaller':
      return 'Дорогой дальний юнит с сильным ударом молнией.';
    case 'drone':
      return 'Быстрый дешёвый стрелок для давления.';
    case 'berserker':
      return 'Очень быстро атакует в ближнем бою.';
    case 'priest':
      return 'Дешёвый дальний юнит поддержки.';
    default:
      return CARDS[code].kind === 'unit' ? 'Боевой юнит для арены.' : '';
  }
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
  padding: '20px 16px 16px',
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

const deckPanel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
  borderRadius: 8,
  border: '1px solid #2a3142',
  background: '#0f1320',
};

const deckHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const deckTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: 0,
};

const deckCount: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  fontVariantNumeric: 'tabular-nums',
};

const deckGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 8,
};

const deckSlot: React.CSSProperties = {
  position: 'relative',
  minWidth: 0,
  minHeight: 78,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  padding: '8px 6px 7px',
  borderRadius: 8,
  border: '1px solid #2a3142',
  color: '#e7ecf3',
  cursor: 'grab',
  textAlign: 'center',
};

const slotCost: React.CSSProperties = {
  position: 'absolute',
  top: 4,
  left: 4,
  width: 20,
  height: 20,
  borderRadius: 10,
  display: 'grid',
  placeItems: 'center',
  background: '#ffd267',
  color: '#121212',
  fontSize: 11,
  fontWeight: 900,
};

const slotIcon: React.CSSProperties = {
  fontSize: 24,
  lineHeight: 1,
};

const slotName: React.CSSProperties = {
  width: '100%',
  minHeight: 26,
  display: 'block',
  overflow: 'hidden',
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1.15,
};

const emptySlot: React.CSSProperties = {
  fontSize: 24,
  opacity: 0.35,
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
