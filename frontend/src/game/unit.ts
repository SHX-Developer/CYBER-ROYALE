/**
 * Runtime-модель юнита, который ходит по арене.
 *
 * Единицы:
 *   range, moveSpeed — пиксели (px и px/sec) — удобно сравнивать с координатами
 *   attackSpeed — секунд между атаками
 *   target = 'ground' | 'air' | 'any' — кого юнит может атаковать
 *
 * Стат-табличка карт (cards.ts) лежит в тайлах — не путать с этой.
 */
import type { Lane, Side, Vec } from './arena';

export type UnitType = 'warrior';
export type UnitTarget = 'ground' | 'air' | 'any';
export type UnitState = 'moving' | 'attacking';

export interface UnitStats {
  maxHp: number;
  damage: number;
  attackSpeed: number; // секунд
  range: number; // px
  moveSpeed: number; // px/sec
  target: UnitTarget;
  /** Цвет круга — пока вместо ассетов спрайтов. */
  radius: number;
}

export const UNIT_STATS: Record<UnitType, UnitStats> = {
  warrior: {
    maxHp: 500,
    damage: 80,
    attackSpeed: 1,
    range: 40,
    moveSpeed: 60,
    target: 'ground',
    radius: 14,
  },
};

export interface UnitInit {
  id: string;
  type: UnitType;
  team: Side;
  lane: Lane;
  x: number;
  y: number;
  /** Точки маршрута; юнит идёт по ним, пока не нашёл цель. */
  waypoints: Vec[];
}

export class Unit {
  readonly id: string;
  readonly type: UnitType;
  readonly team: Side;
  readonly lane: Lane;

  x: number;
  y: number;

  hp: number;
  readonly maxHp: number;
  readonly damage: number;
  readonly attackSpeed: number;
  readonly range: number;
  readonly moveSpeed: number;
  readonly target: UnitTarget;
  readonly radius: number;

  isDead = false;
  state: UnitState = 'moving';
  /** Время последней атаки в мс scene-time; -∞ → первый удар сразу при сближении. */
  lastAttackAt = Number.NEGATIVE_INFINITY;

  readonly waypoints: Vec[];
  waypointIndex = 0;

  constructor(init: UnitInit) {
    const stats = UNIT_STATS[init.type];

    this.id = init.id;
    this.type = init.type;
    this.team = init.team;
    this.lane = init.lane;
    this.x = init.x;
    this.y = init.y;

    this.hp = stats.maxHp;
    this.maxHp = stats.maxHp;
    this.damage = stats.damage;
    this.attackSpeed = stats.attackSpeed;
    this.range = stats.range;
    this.moveSpeed = stats.moveSpeed;
    this.target = stats.target;
    this.radius = stats.radius;

    this.waypoints = init.waypoints;
  }

  takeDamage(amount: number): boolean {
    if (this.isDead) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp === 0) {
      this.isDead = true;
      return true;
    }
    return false;
  }

  get hpRatio(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  /** Текущая активная путевая точка (или null, если маршрут пройден). */
  currentWaypoint(): Vec | null {
    return this.waypoints[this.waypointIndex] ?? null;
  }
}
