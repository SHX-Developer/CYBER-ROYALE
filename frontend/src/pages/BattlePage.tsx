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

  const handleSpawnWarrior = () => {
    const scene = getArenaScene(gameRef.current);
    scene?.spawnUnit('warrior', 'player', 'left');
  };

  return (
    <div style={page}>
      <div ref={containerRef} style={canvasWrap} />
      <button onClick={() => setScreen('menu')} style={backBtn} aria-label="Выйти из боя">
        ←
      </button>
      <button onClick={handleSpawnWarrior} style={spawnBtn}>
        ⚔️ Spawn Warrior
      </button>
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

const spawnBtn: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '12px 18px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'linear-gradient(180deg, #2a5d8a 0%, #1c4063 100%)',
  color: '#ffffff',
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: 0.5,
  cursor: 'pointer',
  boxShadow: '0 6px 16px rgba(0,0,0,0.4)',
  zIndex: 10,
};
