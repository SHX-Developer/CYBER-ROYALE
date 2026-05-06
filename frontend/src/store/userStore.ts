import { create } from 'zustand';

export interface UserProfile {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  level: number;
  coins: number;
  gems: number;
}

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'error';

interface UserState {
  status: AuthStatus;
  profile: UserProfile | null;
  error: string | null;
  setLoading: () => void;
  setProfile: (p: UserProfile) => void;
  setError: (msg: string) => void;
}

export const useUserStore = create<UserState>((set) => ({
  status: 'idle',
  profile: null,
  error: null,
  setLoading: () => set({ status: 'loading', error: null }),
  setProfile: (profile) => set({ status: 'authenticated', profile, error: null }),
  setError: (error) => set({ status: 'error', error }),
}));
