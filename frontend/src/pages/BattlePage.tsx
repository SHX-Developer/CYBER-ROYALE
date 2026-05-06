import { useEffect, useRef } from 'react';
import type Phaser from 'phaser';
import { createGame } from '@/game/PhaserGame';
import { useUiStore } from '@/store/uiStore';
import { HAND, MAX_ENERGY, useBattleStore, type CardSlot } from '@/store/battleStore';

export default function BattlePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const setScreen = useUiStore((s) => s.setScreen);

  useEffect(() => {
    if (!containerRef.current) return;
    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
    }
    gameRef.current = createGame(containerRef.current);
    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      // Сбрасываем стор боя при выходе.
      useBattleStore.getState().reset();
    };
  }, []);

  return (
    <div style={page}>
      <div ref={containerRef} style={canvasWrap} />

      <button onClick={() => setScreen('menu')} style={backBtn} aria-label="Выйти из боя">
        ←
      </button>

      <ScoreBadge />

      <div style={hudWrap}>
        <EnergyBar />
        <HandPanel />
      </div>

      <ResultOverlay onExit={() => setScreen('menu')} />
    </div>
  );
}

function ScoreBadge() {
  const td = useBattleStore((s) => s.towersDestroyed);
  return (
    <div style={scoreBadge}>
      <span style={{ color: '#7fb9ff' }}>★ {td.enemy}</span>
      <span style={{ opacity: 0.4, margin: '0 6px' }}>:</span>
      <span style={{ color: '#ff8585' }}>{td.player} ★</span>
    </div>
  );
}

function EnergyBar() {
  const energy = useBattleStore((s) => s.energy);
  const pulse = useBattleStore((s) => s.insufficientPulse);
  return (
    <div style={energyOuter} key={pulse} className={pulse ? 'energy-pulse' : ''}>
      <div
        style={{
          ...energyFill,
          width: `${(energy / MAX_ENERGY) * 100}%`,
        }}
      />
      <div style={energyText}>⚡ {Math.floor(energy)} / {MAX_ENERGY}</div>
    </div>
  );
}

function HandPanel() {
  return (
    <div style={hand}>
      {HAND.map((card) => (
        <CardSlotButton key={card.code} card={card} />
      ))}
    </div>
  );
}

function CardSlotButton({ card }: { card: CardSlot }) {
  const selected = useBattleStore((s) => s.selectedCard);
  const energy = useBattleStore((s) => s.energy);
  const select = useBattleStore((s) => s.selectCard);
  const clear = useBattleStore((s) => s.clearSelected);
  const pulse = useBattleStore((s) => s.pulseInsufficient);

  const isSelected = selected === card.code;
  const canAfford = energy >= card.energyCost;

  const onClick = () => {
    if (!canAfford) {
      pulse();
      return;
    }
    if (isSelected) clear();
    else select(card.code);
  };

  return (
    <button
      onClick={onClick}
      style={{
        ...cardBtn,
        outline: isSelected ? '2px solid #ffd267' : 'none',
        opacity: canAfford ? 1 : 0.5,
        background: isSelected
          ? 'linear-gradient(180deg, #2a3142 0%, #181d2a 100%)'
          : 'linear-gradient(180deg, #181d2a 0%, #0f1320 100%)',
      }}
    >
      <div style={cardIcon}>{card.icon}</div>
      <div style={cardName}>{card.name}</div>
      <div style={cardCost}>⚡ {card.energyCost}</div>
    </button>
  );
}

function ResultOverlay({ onExit }: { onExit: () => void }) {
  const gameState = useBattleStore((s) => s.gameState);
  if (gameState === 'playing') return null;
  const won = gameState === 'won';
  return (
    <div style={overlay}>
      <div style={overlayCard}>
        <div style={{ fontSize: 56 }}>{won ? '🏆' : '💀'}</div>
        <h2 style={{ margin: 0, fontSize: 24, letterSpacing: 1 }}>
          {won ? 'Победа' : 'Поражение'}
        </h2>
        <p style={{ opacity: 0.65, margin: 0, fontSize: 13, textAlign: 'center' }}>
          {won
            ? 'Вражеский король разрушен.'
            : 'Твой король не выстоял. Попробуй ещё раз.'}
        </p>
        <button onClick={onExit} style={overlayBtn}>
          В меню
        </button>
      </div>
    </div>
  );
}

const page: React.CSSProperties = {
  position: 'relative',
  height: '100%',
  width: '100%',
  background: '#0b0d12',
  overflow: 'hidden',
};

const canvasWrap: React.CSSProperties = {
  width: '100%',
  height: '100%',
};

const backBtn: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  left: 10,
  width: 40,
  height: 40,
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(11,13,18,0.65)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  color: '#e7ecf3',
  fontSize: 20,
  cursor: 'pointer',
  zIndex: 10,
};

const scoreBadge: React.CSSProperties = {
  position: 'absolute',
  top: 14,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '6px 12px',
  borderRadius: 999,
  background: 'rgba(11,13,18,0.65)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#e7ecf3',
  fontSize: 13,
  fontWeight: 700,
  zIndex: 10,
};

const hudWrap: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(8px + env(safe-area-inset-bottom, 0px))',
  left: 0,
  right: 0,
  padding: '0 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  zIndex: 10,
};

const energyOuter: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: 18,
  borderRadius: 999,
  background: 'rgba(11,13,18,0.65)',
  border: '1px solid rgba(255,255,255,0.12)',
  overflow: 'hidden',
};

const energyFill: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  bottom: 0,
  background: 'linear-gradient(90deg, #b08fff 0%, #7c5cff 100%)',
  transition: 'width 200ms linear',
};

const energyText: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 700,
  color: '#ffffff',
  letterSpacing: 0.5,
};

const hand: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 6,
};

const cardBtn: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  padding: '8px 4px',
  borderRadius: 10,
  border: '1px solid #2a3142',
  color: '#e7ecf3',
  cursor: 'pointer',
};

const cardIcon: React.CSSProperties = {
  fontSize: 24,
  lineHeight: '28px',
};

const cardName: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100%',
};

const cardCost: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.85,
};

const overlay: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(0,0,0,0.65)',
  zIndex: 20,
  padding: 24,
};

const overlayCard: React.CSSProperties = {
  width: '100%',
  maxWidth: 320,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 14,
  padding: 24,
  borderRadius: 16,
  background: '#151a25',
  border: '1px solid #2a3142',
  textAlign: 'center',
};

const overlayBtn: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  borderRadius: 12,
  border: '1px solid #2a3142',
  background: 'linear-gradient(180deg, #ffd267 0%, #f0a83a 100%)',
  color: '#1a1a1a',
  fontSize: 15,
  fontWeight: 800,
  cursor: 'pointer',
  marginTop: 4,
};
