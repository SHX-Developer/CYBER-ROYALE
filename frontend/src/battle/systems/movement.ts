/**
 * Перемещение юнитов: к точке и по waypoint'ам линии.
 * Чистая логика, мутирует unit.x/y.
 */
import type { Vec } from '@/game/arena';
import type { Unit } from '@/game/unit';

export function moveUnitToward(unit: Unit, point: Vec, dt: number) {
  const dx = point.x - unit.x;
  const dy = point.y - unit.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;
  const step = unit.moveSpeed * dt;
  const t = Math.min(1, step / dist);
  unit.x += dx * t;
  unit.y += dy * t;
}

export function advanceUnitWaypoints(unit: Unit, dt: number) {
  let budget = unit.moveSpeed * dt;
  while (budget > 0 && unit.waypointIndex < unit.waypoints.length) {
    const wp = unit.waypoints[unit.waypointIndex];
    const dx = wp.x - unit.x;
    const dy = wp.y - unit.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) {
      unit.waypointIndex++;
      continue;
    }
    if (budget >= dist) {
      unit.x = wp.x;
      unit.y = wp.y;
      budget -= dist;
      unit.waypointIndex++;
    } else {
      const t = budget / dist;
      unit.x += dx * t;
      unit.y += dy * t;
      budget = 0;
    }
  }
}
