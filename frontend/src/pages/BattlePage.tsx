import { useEffect, useRef } from 'react';
import type Phaser from 'phaser';
import { createGame, getArenaScene } from '@/game/PhaserGame';
import { useUiStore } from '@/store/uiStore';

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
    };
  }, []);

  const spawn = (team: 'player' | 'enemy', lane: 'left' | 'right') => {
    const scene = getArenaScene(gameRef.current);
    scene?.spawnUnit('warrior', team, lane);
  };

  return (
    <div style={page}>
      <div ref={containerRef} style={canvasWrap} />
      <button onClick={() => setScreen('menu')} style={backBtn} aria-label="Выйти из боя">
        ←
      </button>

      <div style={spawnBar}>
        <SpawnBtn label="⚔️ Player L" onClick={() => spawn('player', 'left')} variant="player" />
        <SpawnBtn label="⚔️ Player R" onClick={() => spawn('player', 'right')} variant="player" />
        <SpawnBtn label="🤖 Enemy L" onClick={() => spawn('enemy', 'left')} variant="enemy" />
        <SpawnBtn label="🤖 Enemy R" onClick={() => spawn('enemy', 'right')} variant="enemy" />
      </div>
    </div>
  );
}

function SpawnBtn({
  label,
  onClick,
  variant,
}: {
  label: string;
  onClick: () => void;
  variant: 'player' | 'enemy';
}) {
  const bg =
    variant === 'player'
      ? 'linear-gradient(180deg, #2a5d8a 0%, #1c4063 100%)'
      : 'linear-gradient(180deg, #c1334a 0%, #8a1f33 100%)';
  return (
    <button onClick={onClick} style={{ ...spawnBtnBase, background: bg }}>
      {label}
    </button>
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

const spawnBar: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
  left: 0,
  right: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 8,
  padding: '0 16px',
  zIndex: 10,
};

const spawnBtnBase: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.15)',
  color: '#ffffff',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: 0.3,
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
};
