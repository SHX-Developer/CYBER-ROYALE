import { create } from 'zustand';

export type Screen = 'menu' | 'deck' | 'cards' | 'profile' | 'battle';

interface UiState {
  screen: Screen;
  setScreen: (screen: Screen) => void;
}

export const useUiStore = create<UiState>((set) => ({
  screen: 'menu',
  setScreen: (screen) => set({ screen }),
}));
