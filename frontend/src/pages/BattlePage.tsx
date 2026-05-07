import { useEffect, useRef, useState } from 'react';
import type Phaser from 'phaser';
import WebApp from '@twa-dev/sdk';
import { createGame, getArenaScene } from '@/game/PhaserGame';
import { useUiStore } from '@/store/uiStore';
import { useUserStore } from '@/store/userStore';
import { reportBattle } from '@/api/battles';
import EnergyIcon from '@/components/EnergyIcon';
import { playSound, soundEngine } from '@/audio/soundEngine';
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

  // Подключаем встроенную TG WebApp BackButton — она появляется в шапке
  // Telegram сама и заменяет нашу кастомную кнопку «←».
  useEffect(() => {
    const onBack = () => {
      playSound('buttonClick');
      setScreen('home');
    };
    try {
      WebApp.BackButton.show();
      WebApp.BackButton.onClick(onBack);
    } catch {
      /* вне Telegram — silently игнорируем */
    }
    return () => {
      try {
        WebApp.BackButton.offClick(onBack);
        WebApp.BackButton.hide();
      } catch {
        /* no-op */
      }
    };
  }, [setScreen]);

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
      <div className="arena-vignette" />
      <div className="arena-scanlines" />

      {/* Кастомная back-кнопка убрана — вместо неё используем
          встроенную TG WebApp BackButton (см. useEffect выше). */}

      <MuteButton />

      {/* TopBar (таймер + звёзды) временно скрыт по запросу. */}
      {/* <TopBar /> */}

      <div style={hudWrap}>
        <EnergyBar />
        <HandPanel />
      </div>

      <ResultOverlay onExit={() => setScreen('home')} onPlayAgain={playAgain} />
    </div>
  );
}

function MuteButton() {
  const [muted, setMuted] = useState(soundEngine.isMuted());
  return (
    <button
      className="mute-button"
      onClick={() => {
        const next = soundEngine.toggleMute();
        setMuted(next);
        if (!next) playSound('buttonClick');
      }}
      style={muteBtn}
      aria-label={muted ? 'Включить звук' : 'Выключить звук'}
      title={muted ? 'Включить звук' : 'Выключить звук'}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}

// TopBar (таймер + звёзды) временно отключён. Сохранено для возврата позже —
// если расскоментируете <TopBar /> выше и эту функцию, всё снова заработает.
// function TopBar() {
//   const td = useBattleStore((s) => s.towersDestroyed);
//   const timeLeft = useBattleStore((s) => s.matchTimeLeftMs);
//   return (
//     <>
//       <div style={starsCorner}>
//         <Badge>
//           <span style={{ color: '#7fb9ff' }}>★ {td.player}</span>
//           <span style={{ opacity: 0.4, margin: '0 6px' }}>:</span>
//           <span style={{ color: '#ff8585' }}>{td.enemy} ★</span>
//         </Badge>
//       </div>
//       <div style={timeCorner}>
//         <Badge>
//           <span style={{ opacity: 0.7 }}>⏱</span>
//           <span style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
//             {formatTime(timeLeft)}
//           </span>
//         </Badge>
//       </div>
//     </>
//   );
// }

// Badge временно скрыт вместе с TopBar.
// function Badge({ children }: { children: React.ReactNode }) {
//   return <div style={badge}>{children}</div>;
// }

function EnergyBar() {
  const energy = useBattleStore((s) => s.energy);
  const pulse = useBattleStore((s) => s.insufficientPulse);
  // Полоса разбита на 10 ячеек. Каждая ячейка показывает «свою» долю
  // энергии: ячейка i заполняется по мере того как energy идёт от i до i+1.
  const cells = Array.from({ length: MAX_ENERGY }, (_, i) =>
    Math.max(0, Math.min(1, energy - i)),
  );
  return (
    <div style={energySegmentRow} key={pulse}>
      {cells.map((fill, i) => (
        <div key={i} style={energySegmentOuter}>
          <div
            style={{
              ...energySegmentFill,
              transform: `scaleX(${fill})`,
              opacity: fill === 0 ? 0.25 : 1,
            }}
          />
        </div>
      ))}
      <div style={energySegmentLabel}>
        <EnergyIcon size={10} />
        <span style={{ marginLeft: 3, fontVariantNumeric: 'tabular-nums' }}>
          {Math.floor(energy)}
        </span>
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
      playSound('insufficient');
      return;
    }
    if (isSelected) {
      clear();
      playSound('buttonClick');
    } else {
      select(card.code);
      playSound('cardSelect');
    }
  };

  const isSpell = card.kind === 'spell';
  return (
    <button
      className="battle-card"
      onClick={onClick}
      style={{
        ...cardBtn,
        borderColor: isSelected ? (isSpell ? '#b08fff' : '#ffd267') : '#2a3142',
        outline: isSelected ? `2px solid ${isSpell ? 'rgba(176,143,255,0.45)' : 'rgba(255,210,103,0.45)'}` : 'none',
        opacity: canAfford ? 1 : 0.5,
        transform: isSelected ? 'translateY(-4px)' : 'translateY(0)',
        filter: canAfford ? 'saturate(1.08)' : 'grayscale(0.25)',
        boxShadow: isSelected
          ? isSpell
            ? '0 10px 22px rgba(124,92,255,0.34), inset 0 0 18px rgba(176,143,255,0.18)'
            : '0 10px 22px rgba(255,210,103,0.28), inset 0 0 18px rgba(255,210,103,0.14)'
          : canAfford
            ? '0 5px 14px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05)'
            : 'inset 0 1px 0 rgba(255,255,255,0.03)',
        background: isSelected
          ? 'linear-gradient(180deg, #2a3142 0%, #181d2a 100%)'
          : 'linear-gradient(180deg, #181d2a 0%, #0f1320 100%)',
      }}
    >
      <div style={cardIcon}>{card.icon}</div>
      <div style={cardName}>{card.name}</div>
      <div style={cardCost}>
        <EnergyIcon size={10} />
        <span style={{ marginLeft: 3 }}>{card.energyCost}</span>
      </div>
    </button>
  );
}

function NextCardSlot({ card }: { card: CardDef | undefined }) {
  if (!card) return <div style={nextSlot} />;
  return (
    <div style={nextSlot}>
      <div style={nextLabel}>NEXT</div>
      <div style={{ fontSize: 18 }}>{card.icon}</div>
      <div style={{ fontSize: 9, opacity: 0.8, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        <EnergyIcon size={9} />
        <span>{card.energyCost}</span>
      </div>
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
          <button
            onClick={() => {
              playSound('buttonClick');
              onPlayAgain();
            }}
            style={{ ...overlayBtn, background: accent, flex: 1 }}
          >
            Играть снова
          </button>
          <button
            onClick={() => {
              playSound('buttonClick');
              onExit();
            }}
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
  background:
    'radial-gradient(circle at 50% 38%, rgba(255,210,103,0.08), transparent 24%), #0b0d12',
  overflow: 'hidden',
  touchAction: 'none',
};

const canvasWrap: React.CSSProperties = {
  width: '100%',
  height: '100%',
  touchAction: 'none',
};

// Кнопка mute — верхний правый угол, ниже шапки TG WebApp.
const muteBtn: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(env(safe-area-inset-top, 0px) + 30px)',
  right: 8,
  width: 32,
  height: 32,
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(11,13,18,0.65)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  color: '#e7ecf3',
  fontSize: 14,
  cursor: 'pointer',
  zIndex: 10,
  boxShadow: '0 8px 18px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.08)',
  touchAction: 'manipulation',
};

// const badge: React.CSSProperties = { /* стиль скрытого Badge */ };

const hudWrap: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(max(8px, 1.2svh) + env(safe-area-inset-bottom, 0px))',
  left: 0,
  right: 0,
  padding: '0 max(8px, 2.5vw)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  zIndex: 10,
};

// Эликсир — 10 отдельных ячеек, каждая плавно заполняется по своей доле.
const energySegmentRow: React.CSSProperties = {
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: 'repeat(10, 1fr)',
  gap: 2,
  width: '100%',
  height: 'clamp(14px, 2.2svh, 18px)',
  padding: '2px 30px 2px 2px',
  borderRadius: 8,
  background: 'rgba(11,13,18,0.65)',
  border: '1px solid rgba(255,255,255,0.12)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  boxShadow:
    '0 8px 18px rgba(0,0,0,0.28), 0 0 12px rgba(124, 92, 255, 0.16) inset',
  boxSizing: 'border-box',
};

const energySegmentOuter: React.CSSProperties = {
  position: 'relative',
  height: '100%',
  borderRadius: 3,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.06)',
  overflow: 'hidden',
};

const energySegmentFill: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'linear-gradient(90deg, #c8b0ff 0%, #7c5cff 60%, #5b3dd0 100%)',
  transformOrigin: 'left center',
  transition: 'transform 120ms linear, opacity 120ms linear',
  boxShadow: '0 0 6px rgba(124, 92, 255, 0.55)',
};

const energySegmentLabel: React.CSSProperties = {
  position: 'absolute',
  right: 6,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  alignItems: 'center',
  fontSize: 'clamp(9px, 2.6vw, 11px)',
  fontWeight: 800,
  color: '#ffffff',
  textShadow: '0 1px 2px rgba(0,0,0,0.6)',
};

const hand4plusNext: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr) 0.55fr',
  gap: 'clamp(5px, 1.6vw, 8px)',
};

const cardBtn: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 1,
  padding: 'clamp(6px, 1.7svh, 9px) 3px clamp(5px, 1.4svh, 8px)',
  borderRadius: 9,
  border: '1px solid #2a3142',
  color: '#e7ecf3',
  cursor: 'pointer',
  minHeight: 'clamp(76px, 11.5svh, 92px)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  touchAction: 'manipulation',
};

const cardIcon: React.CSSProperties = {
  fontSize: 'clamp(20px, 5.8vw, 25px)',
  lineHeight: 'clamp(22px, 6.2vw, 27px)',
};

const cardName: React.CSSProperties = {
  fontSize: 'clamp(9px, 2.7vw, 11px)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100%',
};

const cardCost: React.CSSProperties = {
  fontSize: 'clamp(10px, 2.8vw, 12px)',
  opacity: 0.85,
  display: 'inline-flex',
  alignItems: 'center',
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
  background: 'rgba(10,13,20,0.92)',
  color: '#9ba1b0',
  minHeight: 'clamp(76px, 11.5svh, 92px)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
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
