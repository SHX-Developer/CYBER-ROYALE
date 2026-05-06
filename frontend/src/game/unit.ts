/**
 * Runtime-модель юнита, который ходит по арене.
 *
 * Единицы:
 *   range, moveSpeed — пиксели (px и px/sec) — удобно сравнивать с координатами
 *   attackSpeed — секунд между атаками
 *   target = 'ground' | 'air' | 'any' — кого юнит может атаковать
 */
import type { Lane, Side, Vec } from './arena';

export type UnitType = 'warrior' | 'archer' | 'tank' | 'assassin' | 'squad' | 'mage';
export type UnitTarget = 'ground' | 'air' | 'any';
export type UnitState = 'idle' | 'moving' | 'attacking' | 'dead';

export interface UnitStats {
  maxHp: number;
  damage: number;
  attackSpeed: number; // секунд
  range: number; // px
  moveSpeed: number; // px/sec
  target: UnitTarget;
  /** Радиус круга в визуализации — пока вместо ассетов спрайтов. */
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
  archer: {
    maxHp: 250,
    damage: 60,
    attackSpeed: 1,
    range: 125,
    moveSpeed: 60,
    target: 'any',
    radius: 12,
  },
  tank: {
    maxHp: 1500,
    damage: 100,
    attackSpeed: 1.5,
    range: 40,
    moveSpeed: 30,
    target: 'ground',
    radius: 18,
  },
  assassin: {
    maxHp: 200,
    damage: 90,
    attackSpeed: 0.8,
    range: 40,
    moveSpeed: 108, // быстрый: ~1.8 tiles/sec * 60
    target: 'ground',
    radius: 12,
  },
  squad: {
    // На MVP — один объединённый юнит. Когда появится механика отрядов,
    // карта будет спавнить 4 мини-юнита с этими полями.
    maxHp: 600,
    damage: 60,
    attackSpeed: 1.1,
    range: 40,
    moveSpeed: 72,
    target: 'ground',
    radius: 14,
  },
  mage: {
    maxHp: 350,
    damage: 120,
    attackSpeed: 1.4,
    range: 160,
    moveSpeed: 54,
    target: 'any',
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
  state: UnitState = 'idle';
  /** Время последней атаки в мс scene-time; -∞ → первый удар сразу при сближении. */
  lastAttackAt = Number.NEGATIVE_INFINITY;

  /** Цель, которую юнит уже начал атаковать. Нужна, чтобы не бросать башню
   *  из-за случайного врага рядом. */
  lockedTarget: { kind: 'unit' | 'tower'; id: string } | null = null;

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
      this.state = 'dead';
      return true;
    }
    return false;
  }

  heal(amount: number) {
    if (this.isDead) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  get hpRatio(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  /** Текущая активная путевая точка (или null, если маршрут пройден). */
  currentWaypoint(): Vec | null {
    return this.waypoints[this.waypointIndex] ?? null;
  }
}
