/**
 * Runtime-модель юнита, который ходит по арене.
 *
 * Единицы:
 *   range, moveSpeed — пиксели (px и px/sec) — удобно сравнивать с координатами
 *   attackSpeed — секунд между атаками
 *   target = 'ground' | 'air' | 'any' — кого юнит может атаковать
 */
import type { Lane, Side, Vec } from './arena';

export type UnitType =
  | 'warrior'
  | 'archer'
  | 'tank'
  | 'assassin'
  | 'squad'
  | 'mage'
  | 'lancer'
  | 'guardian'
  | 'bombardier'
  | 'frost_witch'
  | 'stormcaller'
  | 'drone'
  | 'berserker'
  | 'priest';
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
    maxHp: 520,
    damage: 78,
    attackSpeed: 1.05,
    range: 40,
    moveSpeed: 60,
    target: 'ground',
    radius: 14,
  },
  archer: {
    maxHp: 250,
    damage: 58,
    attackSpeed: 1,
    range: 125,
    moveSpeed: 60,
    target: 'any',
    radius: 12,
  },
  tank: {
    maxHp: 1450,
    damage: 105,
    attackSpeed: 1.6,
    range: 40,
    moveSpeed: 30,
    target: 'ground',
    radius: 18,
  },
  assassin: {
    maxHp: 220,
    damage: 88,
    attackSpeed: 0.75,
    range: 40,
    moveSpeed: 108, // быстрый: ~1.8 tiles/sec * 60
    target: 'ground',
    radius: 12,
  },
  squad: {
    // На MVP — один объединённый юнит. Когда появится механика отрядов,
    // карта будет спавнить 4 мини-юнита с этими полями.
    maxHp: 560,
    damage: 62,
    attackSpeed: 1.1,
    range: 40,
    moveSpeed: 72,
    target: 'ground',
    radius: 14,
  },
  mage: {
    maxHp: 360,
    damage: 112,
    attackSpeed: 1.4,
    range: 160,
    moveSpeed: 54,
    target: 'any',
    radius: 14,
  },
  lancer: {
    maxHp: 460,
    damage: 95,
    attackSpeed: 1.15,
    range: 62,
    moveSpeed: 66,
    target: 'ground',
    radius: 13,
  },
  guardian: {
    maxHp: 900,
    damage: 70,
    attackSpeed: 1.3,
    range: 42,
    moveSpeed: 42,
    target: 'ground',
    radius: 16,
  },
  bombardier: {
    maxHp: 320,
    damage: 150,
    attackSpeed: 1.8,
    range: 135,
    moveSpeed: 45,
    target: 'ground',
    radius: 13,
  },
  frost_witch: {
    maxHp: 330,
    damage: 70,
    attackSpeed: 1.25,
    range: 145,
    moveSpeed: 54,
    target: 'any',
    radius: 13,
  },
  stormcaller: {
    maxHp: 420,
    damage: 145,
    attackSpeed: 1.7,
    range: 165,
    moveSpeed: 48,
    target: 'any',
    radius: 14,
  },
  drone: {
    maxHp: 170,
    damage: 45,
    attackSpeed: 0.9,
    range: 105,
    moveSpeed: 96,
    target: 'any',
    radius: 10,
  },
  berserker: {
    maxHp: 420,
    damage: 65,
    attackSpeed: 0.65,
    range: 40,
    moveSpeed: 90,
    target: 'ground',
    radius: 13,
  },
  priest: {
    maxHp: 300,
    damage: 50,
    attackSpeed: 1.2,
    range: 120,
    moveSpeed: 54,
    target: 'any',
    radius: 12,
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

  pursuitTargetId: string | null = null;
  pursuitRepathAt = Number.NEGATIVE_INFINITY;
  pursuitWaypoints: Vec[] = [];
  pursuitWaypointIndex = 0;

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
