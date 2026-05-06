/**
 * Заклинания (spell-карты).
 *
 *   fireball — наносит урон врагам в радиусе. Спецификация Этапа 20:
 *     cost 4, damage юнитам 250, башням 100, radius 90px.
 *   heal — лечит союзных юнитов в радиусе. Из ТЗ Этапа 4: cost 2, +250 HP.
 */

export type SpellCode = 'fireball' | 'heal';

export interface SpellStats {
  cost: number;
  /** Сила воздействия на юнитов (урон/лечение). */
  unitImpact: number;
  /** Сила воздействия на башни (урон); 0 — не действует на башни. */
  towerImpact: number;
  radius: number;
  /** Цвет круга-эффекта. */
  color: number;
  /** true — поражает врагов, false — лечит союзников. */
  hostile: boolean;
}

export const SPELL_STATS: Record<SpellCode, SpellStats> = {
  fireball: {
    cost: 4,
    unitImpact: 250,
    towerImpact: 100,
    radius: 90,
    color: 0xff7733,
    hostile: true,
  },
  heal: {
    cost: 2,
    unitImpact: 250,
    towerImpact: 0,
    radius: 90,
    color: 0x88ffaa,
    hostile: false,
  },
};
