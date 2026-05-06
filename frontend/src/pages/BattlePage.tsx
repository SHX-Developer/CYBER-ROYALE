import { useEffect, useRef } from 'react';
import type Phaser from 'phaser';
import { createGame, getArenaScene } from '@/game/PhaserGame';
import { useUiStore } from '@/store/uiStore';
import { useUserStore } from '@/store/userStore';
import { reportBattle } from '@/api/battles';
import {
  CARDS,
  HAND_SIZE,
  MAX_ENERGY,
  useBattleStore,
  type CardDef,
} from '@/store/battleStore';

export default function BattlePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const setScreen = useUiStore((s) => s.setScreen);

  // Этап 27: после конца боя отправляем результат на backend.
  const gameState = useBattleStore((s) => s.gameState);
  const result = useBattleStore((s) => s.result);
  const profile = useUserStore((s) => s.profile);
  const setProfile = useUserStore((s) => s.setProfile);
  const reportedRef = useRef(false);

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
      useBattleStore.getState().reset();
    };
  }, []);

  useEffect(() => {
    if (gameState === 'playing') {
      reportedRef.current = false;
      return;
    }
    if (!result || !profile || reportedRef.current) return;
    reportedRef.current = true;

    reportBattle({
      userId: profile.id,
      outcome: result.outcome,
      destroyedTowers: result.towersDestroyed,
      lostTowers: result.towersLost,
      duration: result.durationSec,
      rewardCoins: result.coinsEarned,
      rewardXp: result.xpEarned,
    })
      .then((res) => setProfile(res.user))
      // eslint-disable-next-line no-console
      .catch((err) => console.warn('[battle] report failed', err));
  }, [gameState, result, profile, setProfile]);

  const playAgain = () => {
    reportedRef.current = false;
    const scene = getArenaScene(gameRef.current);
    if (scene) {
      scene.scene.restart(); // create() сам сбросит стор
    } else {
      useBattleStore.getState().reset();
    }
  };

  return (
    <div style={page}>
      <div ref={containerRef} className="arena-tilt" style={canvasWrap} />
      <div className="arena-fog" />

      <button onClick={() => setScreen('menu')} style={backBtn} aria-label="Выйти из боя">
        ←
      </button>

      <TopBar />

      <div style={hudWrap}>
        <EnergyBar />
        <HandPanel />
      </div>

      <ResultOverlay onExit={() => setScreen('menu')} onPlayAgain={playAgain} />
    </div>
  );
}

function TopBar() {
  const td = useBattleStore((s) => s.towersDestroyed);
  const timeLeft = useBattleStore((s) => s.matchTimeLeftMs);
  return (
    <div style={topBar}>
      <Badge>
        <span style={{ color: '#7fb9ff' }}>★ {td.enemy}</span>
        <span style={{ opacity: 0.4, margin: '0 6px' }}>:</span>
        <span style={{ color: '#ff8585' }}>{td.player} ★</span>
      </Badge>
      <Badge>
        <span style={{ opacity: 0.7 }}>⏱</span>
        <span style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(timeLeft)}
        </span>
      </Badge>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <div style={badge}>{children}</div>;
}

function EnergyBar() {
  const energy = useBattleStore((s) => s.energy);
  const pulse = useBattleStore((s) => s.insufficientPulse);
  return (
    <div style={energyOuter} key={pulse}>
      <div
        style={{
          ...energyFill,
          width: `${(energy / MAX_ENERGY) * 100}%`,
        }}
      />
      <div style={energyText}>
        ⚡ {Math.floor(energy)} / {MAX_ENERGY}
      </div>
    </div>
  );
}

function HandPanel() {
  const deck = useBattleStore((s) => s.deck);
  const hand = deck.slice(0, HAND_SIZE);
  const next = deck[HAND_SIZE];

  return (
    <div style={hand4plusNext}>
      {hand.map((code) => (
        <CardSlotButton key={code} card={CARDS[code]} />
      ))}
      <NextCardSlot card={CARDS[next]} />
    </div>
  );
}

function CardSlotButton({ card }: { card: CardDef }) {
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

  const isSpell = card.kind === 'spell';
  return (
    <button
      onClick={onClick}
      style={{
        ...cardBtn,
        outline: isSelected ? `2px solid ${isSpell ? '#b08fff' : '#ffd267'}` : 'none',
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

function NextCardSlot({ card }: { card: CardDef | undefined }) {
  if (!card) return <div style={nextSlot} />;
  return (
    <div style={nextSlot}>
      <div style={nextLabel}>NEXT</div>
      <div style={{ fontSize: 18 }}>{card.icon}</div>
      <div style={{ fontSize: 9, opacity: 0.7 }}>⚡{card.energyCost}</div>
    </div>
  );
}

function ResultOverlay({
  onExit,
  onPlayAgain,
}: {
  onExit: () => void;
  onPlayAgain: () => void;
}) {
  const gameState = useBattleStore((s) => s.gameState);
  const result = useBattleStore((s) => s.result);
  if (gameState === 'playing') return null;

  const title =
    gameState === 'won' ? 'Победа' : gameState === 'lost' ? 'Поражение' : 'Ничья';
  const emoji = gameState === 'won' ? '🏆' : gameState === 'lost' ? '💀' : '🤝';
  const accent =
    gameState === 'won'
      ? 'linear-gradient(180deg, #ffd267 0%, #f0a83a 100%)'
      : gameState === 'lost'
        ? 'linear-gradient(180deg, #c1334a 0%, #8a1f33 100%)'
        : 'linear-gradient(180deg, #2a5d8a 0%, #1c4063 100%)';

  return (
    <div style={overlay}>
      <div style={overlayCard}>
        <div style={{ fontSize: 56 }}>{emoji}</div>
        <h2 style={{ margin: 0, fontSize: 26, letterSpacing: 1 }}>{title}</h2>

        {result && (
          <div style={statsGrid}>
            <Stat label="Длительность" value={formatTime(result.durationSec * 1000)} />
            <Stat label="Сломал" value={`★ ${result.towersDestroyed}`} />
            <Stat label="Потерял" value={`☠ ${result.towersLost}`} />
            <Stat label="Монеты" value={`🪙 ${result.coinsEarned}`} />
            <Stat label="Опыт" value={`✨ ${result.xpEarned}`} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <button onClick={onPlayAgain} style={{ ...overlayBtn, background: accent, flex: 1 }}>
            Играть снова
          </button>
          <button
            onClick={onExit}
            style={{
              ...overlayBtn,
              background: '#0f1320',
              color: '#e7ecf3',
              flex: 1,
            }}
          >
            В меню
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={statBox}>
      <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function formatTime(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
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
  top: 8,
  left: 8,
  width: 32,
  height: 32,
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(11,13,18,0.65)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  color: '#e7ecf3',
  fontSize: 16,
  cursor: 'pointer',
  zIndex: 10,
};

const topBar: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  left: 48,
  right: 10,
  display: 'flex',
  justifyContent: 'space-between',
  gap: 6,
  zIndex: 10,
};

const badge: React.CSSProperties = {
  padding: '4px 9px',
  borderRadius: 999,
  background: 'rgba(11,13,18,0.65)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#e7ecf3',
  fontSize: 11,
  fontWeight: 700,
  display: 'inline-flex',
  alignItems: 'center',
};

const hudWrap: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(6px + env(safe-area-inset-bottom, 0px))',
  left: 0,
  right: 0,
  padding: '0 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  zIndex: 10,
};

const energyOuter: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: 13,
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
  fontSize: 9,
  fontWeight: 700,
  color: '#ffffff',
  letterSpacing: 0.5,
};

const hand4plusNext: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr) 0.55fr',
  gap: 5,
};

const cardBtn: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 1,
  padding: '6px 3px 5px',
  borderRadius: 9,
  border: '1px solid #2a3142',
  color: '#e7ecf3',
  cursor: 'pointer',
};

const cardIcon: React.CSSProperties = {
  fontSize: 20,
  lineHeight: '22px',
};

const cardName: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100%',
};

const cardCost: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.85,
};

const nextSlot: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 1,
  padding: '4px 2px',
  borderRadius: 9,
  border: '1px dashed #2a3142',
  background: '#0a0d14',
  color: '#9ba1b0',
};

const nextLabel: React.CSSProperties = {
  fontSize: 8,
  letterSpacing: 1,
  opacity: 0.7,
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

const statsGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 6,
  width: '100%',
};

const statBox: React.CSSProperties = {
  padding: 8,
  borderRadius: 8,
  background: '#0f1320',
  border: '1px solid #1f2738',
  textAlign: 'center',
};

const overlayBtn: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 12,
  border: '1px solid #2a3142',
  color: '#1a1a1a',
  fontSize: 14,
  fontWeight: 800,
  cursor: 'pointer',
  marginTop: 4,
};
