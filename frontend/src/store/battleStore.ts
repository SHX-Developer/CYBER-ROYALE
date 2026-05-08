import { create } from 'zustand';

export type CardCode =
  | 'warrior'
  | 'archer'
  | 'tank'
  | 'assassin'
  | 'squad'
  | 'mage'
  | 'lancer'
  | 'guardian'
  | 'bombardier'
  | 'frost_witch'
  | 'stormcaller'
  | 'drone'
  | 'berserker'
  | 'priest'
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
  lancer: { code: 'lancer', name: 'Копейщик', energyCost: 3, icon: '🔱', kind: 'unit' },
  guardian: { code: 'guardian', name: 'Страж', energyCost: 4, icon: '🛡️', kind: 'unit' },
  bombardier: { code: 'bombardier', name: 'Бомбардир', energyCost: 4, icon: '💣', kind: 'unit' },
  frost_witch: { code: 'frost_witch', name: 'Ледяная ведьма', energyCost: 4, icon: '❄️', kind: 'unit' },
  stormcaller: { code: 'stormcaller', name: 'Громовержец', energyCost: 5, icon: '⚡', kind: 'unit' },
  drone: { code: 'drone', name: 'Дрон', energyCost: 2, icon: '🛸', kind: 'unit' },
  berserker: { code: 'berserker', name: 'Берсерк', energyCost: 3, icon: '🪓', kind: 'unit' },
  priest: { code: 'priest', name: 'Жрец', energyCost: 3, icon: '🔔', kind: 'unit' },
  fireball: { code: 'fireball', name: 'Огненный удар', energyCost: 4, icon: '🔥', kind: 'spell' },
  heal: { code: 'heal', name: 'Лечение', energyCost: 2, icon: '✨', kind: 'spell' },
};

export const ALL_CARD_CODES = Object.keys(CARDS) as CardCode[];
export const DECK_SIZE = 8;
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
export const MATCH_DURATION_MS = 3 * 60 * 1000; // 3 минуты
const DECK_STORAGE_KEY = 'cyber_royale_active_deck_v2';

export type GameState = 'playing' | 'won' | 'lost' | 'draw';

export interface MatchResult {
  outcome: 'won' | 'lost' | 'draw';
  durationSec: number;
  /** Сколько вражеских башен разрушил игрок. */
  towersDestroyed: number;
  /** Сколько своих башен потерял игрок. */
  towersLost: number;
  coinsEarned: number;
  xpEarned: number;
}

interface BattleState {
  /** Колода длиной 8: первые HAND_SIZE — рука, deck[HAND_SIZE] — следующая. */
  deck: CardCode[];
  selectedCard: CardCode | null;
  energy: number;
  towersDestroyed: { player: number; enemy: number };
  gameState: GameState;
  insufficientPulse: number;
  matchTimeLeftMs: number;
  result: MatchResult | null;

  selectCard: (code: CardCode) => void;
  clearSelected: () => void;
  setEnergy: (v: number) => void;
  addEnergy: (delta: number) => void;
  spendEnergy: (cost: number) => boolean;
  cycleCard: (code: CardCode) => void;
  setDeck: (deck: CardCode[]) => void;
  toggleDeckCard: (code: CardCode) => void;
  moveDeckCard: (from: number, to: number) => void;
  pulseInsufficient: () => void;
  setTowersDestroyed: (side: 'player' | 'enemy', count: number) => void;
  setGameState: (s: GameState) => void;
  setMatchTimeLeft: (ms: number) => void;
  setResult: (r: MatchResult) => void;
  reset: () => void;
}

export const useBattleStore = create<BattleState>((set, get) => ({
  deck: readSavedDeck(),
  selectedCard: null,
  energy: START_ENERGY,
  towersDestroyed: { player: 0, enemy: 0 },
  gameState: 'playing',
  insufficientPulse: 0,
  matchTimeLeftMs: MATCH_DURATION_MS,
  result: null,

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

  setDeck: (deck) =>
    set(() => {
      const next = normalizeDeck(deck);
      saveDeck(next);
      return { deck: next, selectedCard: null };
    }),

  toggleDeckCard: (code) =>
    set((s) => {
      const exists = s.deck.includes(code);
      const next = exists
        ? s.deck.length > 1
          ? s.deck.filter((c) => c !== code)
          : s.deck
        : s.deck.length < DECK_SIZE
          ? [...s.deck, code]
          : s.deck;
      saveDeck(next);
      return { deck: next, selectedCard: s.selectedCard === code ? null : s.selectedCard };
    }),

  moveDeckCard: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.deck.length || to >= s.deck.length) {
        return s;
      }
      const next = [...s.deck];
      const [card] = next.splice(from, 1);
      next.splice(to, 0, card);
      saveDeck(next);
      return { deck: next, selectedCard: null };
    }),

  pulseInsufficient: () => set((s) => ({ insufficientPulse: s.insufficientPulse + 1 })),

  setTowersDestroyed: (side, count) =>
    set((s) => ({ towersDestroyed: { ...s.towersDestroyed, [side]: count } })),
  setGameState: (gameState) => set({ gameState }),
  setMatchTimeLeft: (ms) => set({ matchTimeLeftMs: ms }),
  setResult: (result) => set({ result }),

  reset: () =>
    set((s) => ({
      deck: normalizeDeck(s.deck),
      selectedCard: null,
      energy: START_ENERGY,
      towersDestroyed: { player: 0, enemy: 0 },
      gameState: 'playing',
      insufficientPulse: 0,
      matchTimeLeftMs: MATCH_DURATION_MS,
      result: null,
    })),
}));

function normalizeDeck(deck: readonly CardCode[]): CardCode[] {
  const seen = new Set<CardCode>();
  const next: CardCode[] = [];
  for (const code of deck) {
    if (!CARDS[code] || seen.has(code)) continue;
    seen.add(code);
    next.push(code);
    if (next.length >= DECK_SIZE) break;
  }
  return next.length > 0 ? next : [...STARTER_DECK];
}

function readSavedDeck(): CardCode[] {
  try {
    const raw = localStorage.getItem(DECK_STORAGE_KEY);
    if (!raw) return [...STARTER_DECK];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeDeck(parsed as CardCode[]) : [...STARTER_DECK];
  } catch {
    return [...STARTER_DECK];
  }
}

function saveDeck(deck: readonly CardCode[]) {
  try {
    localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(deck));
  } catch {
    /* localStorage может быть недоступен в приватном режиме */
  }
}
