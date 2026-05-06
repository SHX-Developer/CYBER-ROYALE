import { create } from 'zustand';

export type CardCode =
  | 'warrior'
  | 'archer'
  | 'tank'
  | 'assassin'
  | 'squad'
  | 'mage'
  | 'fireball'
  | 'heal';

export interface CardDef {
  code: CardCode;
  name: string;
  energyCost: number;
  icon: string;
  /** 'unit' — кладёт юнита; 'spell' — мгновенный эффект на точке. */
  kind: 'unit' | 'spell';
}

/** Полный каталог карт MVP. Соответствует backend `cards.ts`/seed. */
export const CARDS: Record<CardCode, CardDef> = {
  warrior: { code: 'warrior', name: 'Воин', energyCost: 3, icon: '⚔️', kind: 'unit' },
  archer: { code: 'archer', name: 'Стрелок', energyCost: 3, icon: '🏹', kind: 'unit' },
  tank: { code: 'tank', name: 'Танк', energyCost: 5, icon: '🛡️', kind: 'unit' },
  assassin: { code: 'assassin', name: 'Убийца', energyCost: 2, icon: '🗡️', kind: 'unit' },
  squad: { code: 'squad', name: 'Отряд', energyCost: 3, icon: '👥', kind: 'unit' },
  mage: { code: 'mage', name: 'Маг', energyCost: 4, icon: '🪄', kind: 'unit' },
  fireball: { code: 'fireball', name: 'Огненный удар', energyCost: 4, icon: '🔥', kind: 'spell' },
  heal: { code: 'heal', name: 'Лечение', energyCost: 2, icon: '✨', kind: 'spell' },
};

/** Стартовая колода игрока — 8 карт, как в Clash Royale. */
export const STARTER_DECK: CardCode[] = [
  'warrior',
  'archer',
  'tank',
  'fireball',
  'mage',
  'assassin',
  'squad',
  'heal',
];

export const HAND_SIZE = 4;
export const MAX_ENERGY = 10;
export const START_ENERGY = 5;
export const ENERGY_REGEN_INTERVAL_MS = 2800;

export type GameState = 'playing' | 'won' | 'lost';

interface BattleState {
  /** Колода длиной 8: первые HAND_SIZE — рука, deck[HAND_SIZE] — следующая. */
  deck: CardCode[];
  selectedCard: CardCode | null;
  energy: number;
  towersDestroyed: { player: number; enemy: number };
  gameState: GameState;
  /** Импульс «не хватает энергии / нельзя сюда» — UI на это мигает. */
  insufficientPulse: number;

  selectCard: (code: CardCode) => void;
  clearSelected: () => void;
  setEnergy: (v: number) => void;
  addEnergy: (delta: number) => void;
  spendEnergy: (cost: number) => boolean;
  /** После применения карта уходит в конец очереди. */
  cycleCard: (code: CardCode) => void;
  pulseInsufficient: () => void;
  setTowersDestroyed: (side: 'player' | 'enemy', count: number) => void;
  setGameState: (s: GameState) => void;
  reset: () => void;
}

export const useBattleStore = create<BattleState>((set, get) => ({
  deck: [...STARTER_DECK],
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

  cycleCard: (code) =>
    set((s) => {
      const i = s.deck.indexOf(code);
      if (i < 0 || i >= HAND_SIZE) return s;
      const used = s.deck[i];
      const newDeck = [...s.deck];
      newDeck.splice(i, 1);
      newDeck.push(used);
      return { deck: newDeck, selectedCard: null };
    }),

  pulseInsufficient: () => set((s) => ({ insufficientPulse: s.insufficientPulse + 1 })),

  setTowersDestroyed: (side, count) =>
    set((s) => ({ towersDestroyed: { ...s.towersDestroyed, [side]: count } })),
  setGameState: (gameState) => set({ gameState }),

  reset: () =>
    set({
      deck: [...STARTER_DECK],
      selectedCard: null,
      energy: START_ENERGY,
      towersDestroyed: { player: 0, enemy: 0 },
      gameState: 'playing',
      insufficientPulse: 0,
    }),
}));
