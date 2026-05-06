import { create } from 'zustand';

export type CardCode = 'warrior' | 'archer' | 'tank' | 'fireball';

export interface CardSlot {
  code: CardCode;
  name: string;
  energyCost: number;
  icon: string;
  /** 'unit' — кладёт юнита; 'spell' — мгновенный эффект на точке. */
  kind: 'unit' | 'spell';
}

export const HAND: CardSlot[] = [
  { code: 'warrior', name: 'Воин', energyCost: 3, icon: '⚔️', kind: 'unit' },
  { code: 'archer', name: 'Стрелок', energyCost: 3, icon: '🏹', kind: 'unit' },
  { code: 'tank', name: 'Танк', energyCost: 5, icon: '🛡️', kind: 'unit' },
  { code: 'fireball', name: 'Огненный удар', energyCost: 4, icon: '🔥', kind: 'spell' },
];

export const MAX_ENERGY = 10;
export const START_ENERGY = 5;
export const ENERGY_REGEN_INTERVAL_MS = 2800;

export type GameState = 'playing' | 'won' | 'lost';

interface BattleState {
  selectedCard: CardCode | null;
  energy: number;
  towersDestroyed: { player: number; enemy: number };
  gameState: GameState;
  /** Импульс «не хватает энергии» — UI на это мигает. */
  insufficientPulse: number;

  selectCard: (code: CardCode) => void;
  clearSelected: () => void;
  setEnergy: (v: number) => void;
  addEnergy: (delta: number) => void;
  spendEnergy: (cost: number) => boolean;
  pulseInsufficient: () => void;
  setTowersDestroyed: (side: 'player' | 'enemy', count: number) => void;
  setGameState: (s: GameState) => void;
  reset: () => void;
}

export const useBattleStore = create<BattleState>((set, get) => ({
  selectedCard: null,
  energy: START_ENERGY,
  towersDestroyed: { player: 0, enemy: 0 },
  gameState: 'playing',
  insufficientPulse: 0,

  selectCard: (code) => {
    if (get().gameState !== 'playing') return;
    set({ selectedCard: code });
  },
  clearSelected: () => set({ selectedCard: null }),

  setEnergy: (v) => set({ energy: Math.max(0, Math.min(MAX_ENERGY, v)) }),
  addEnergy: (delta) =>
    set((s) => ({ energy: Math.max(0, Math.min(MAX_ENERGY, s.energy + delta)) })),

  spendEnergy: (cost) => {
    const { energy } = get();
    if (energy < cost) return false;
    set({ energy: energy - cost });
    return true;
  },
  pulseInsufficient: () => set((s) => ({ insufficientPulse: s.insufficientPulse + 1 })),

  setTowersDestroyed: (side, count) =>
    set((s) => ({ towersDestroyed: { ...s.towersDestroyed, [side]: count } })),
  setGameState: (gameState) => set({ gameState }),

  reset: () =>
    set({
      selectedCard: null,
      energy: START_ENERGY,
      towersDestroyed: { player: 0, enemy: 0 },
      gameState: 'playing',
      insufficientPulse: 0,
    }),
}));
