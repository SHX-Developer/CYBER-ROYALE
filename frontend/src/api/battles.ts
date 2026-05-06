import { apiPost } from './client';
import type { UserProfile } from '@/store/userStore';

export type BattleOutcome = 'won' | 'lost' | 'draw';

export interface ReportBattlePayload {
  userId: string;
  outcome: BattleOutcome;
  destroyedTowers: number;
  lostTowers: number;
  duration: number;
  rewardCoins: number;
  rewardXp: number;
}

export interface ReportBattleResponse {
  battle: {
    id: string;
    status: 'WIN' | 'LOSS' | 'DRAW';
    duration: number;
    destroyedTowers: number;
    lostTowers: number;
    rewardCoins: number;
    rewardXp: number;
  };
  user: UserProfile;
}

export function reportBattle(p: ReportBattlePayload) {
  return apiPost<ReportBattleResponse>('/battles/report', p);
}
