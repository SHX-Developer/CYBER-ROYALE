/**
 * Выбор цели юнитом. Чистая логика, без рендера.
 *
 * Приоритет:
 *   1) ближайший вражеский юнит в perception-радиусе (танк игнорирует юнитов
 *      и идёт сразу к башням — он их главная угроза);
 *   2) ближайшая живая ВРАЖЕСКАЯ башня (любого типа: если боковая снесена
 *      и ближе король — атаковать короля).
 */
import { TILE } from '@/game/arena';
import type { Tower } from '@/game/tower';
import type { Unit } from '@/game/unit';

export type AttackTarget =
  | { kind: 'unit'; ref: Unit }
  | { kind: 'tower'; ref: Tower };

export const PERCEPTION_BONUS = 80;

export function towerHalfSize(t: Tower): number {
  return (Math.max(t.rect.w, t.rect.h) * TILE) / 2;
}

export function targetCenter(t: AttackTarget): { x: number; y: number } {
  return { x: t.ref.x, y: t.ref.y };
}

export function targetEdgeRadius(t: AttackTarget): number {
  return t.kind === 'unit' ? t.ref.radius : towerHalfSize(t.ref);
}

export function pickTarget(
  unit: Unit,
  units: readonly Unit[],
  towers: readonly Tower[],
): AttackTarget | null {
  const perception = unit.range + PERCEPTION_BONUS;

  // Танк игнорирует юнитов и идёт прямо на башни.
  if (unit.type !== 'tank') {
    let bestUnit: Unit | null = null;
    let bestUnitDist = Infinity;
    for (const other of units) {
      if (other.team === unit.team || other.isDead) continue;
      const d = Math.hypot(unit.x - other.x, unit.y - other.y) - other.radius;
      if (d <= perception && d < bestUnitDist) {
        bestUnit = other;
        bestUnitDist = d;
      }
    }
    if (bestUnit) return { kind: 'unit', ref: bestUnit };
  }

  // Ближайшая живая башня (princess или king — без приоритета).
  let bestTower: Tower | null = null;
  let bestTowerDist = Infinity;
  for (const t of towers) {
    if (t.team === unit.team || t.isDestroyed) continue;
    const half = towerHalfSize(t);
    const d = Math.hypot(unit.x - t.x, unit.y - t.y) - half;
    if (d < bestTowerDist) {
      bestTower = t;
      bestTowerDist = d;
    }
  }
  if (bestTower) return { kind: 'tower', ref: bestTower };
  return null;
}
