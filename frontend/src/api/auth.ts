import { apiPost } from './client';
import type { UserProfile } from '@/store/userStore';

export interface LoginResponse {
  user: UserProfile;
}

export function loginWithTelegram(initData: string) {
  return apiPost<LoginResponse>('/auth/telegram', { initData });
}
