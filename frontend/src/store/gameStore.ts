import { create } from 'zustand';

export type GamePhase = 'menu' | 'battle' | 'result';

interface GameState {
  phase: GamePhase;
  setPhase: (phase: GamePhase) => void;
}

export const useGameStore = create<GameState>((set) => ({
  phase: 'menu',
  setPhase: (phase) => set({ phase }),
}));
