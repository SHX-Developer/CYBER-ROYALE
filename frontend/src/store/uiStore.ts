import { create } from 'zustand';

/**
 * Экраны приложения:
 *   home / collection / battle / quests / profile — пять вкладок shell-layout
 *   с постоянной нижней навигацией.
 *   arena — полноэкранный экран матча, навигации нет.
 */
export type Screen = 'home' | 'collection' | 'battle' | 'quests' | 'profile' | 'arena';

interface UiState {
  screen: Screen;
  setScreen: (screen: Screen) => void;
}

export const useUiStore = create<UiState>((set) => ({
  screen: 'home',
  setScreen: (screen) => set({ screen }),
}));
