import { apiGet } from './client';

export type CardType = 'UNIT' | 'SPELL';

export interface Card {
  id: string;
  code: string;
  name: string;
  type: CardType;
  energyCost: number;
  hp: number | null;
  damage: number | null;
  attackSpeed: number | null;
  range: number | null;
  moveSpeed: number | null;
  description: string | null;
  icon: string;
}

export function fetchCards() {
  return apiGet<Card[]>('/cards');
}
