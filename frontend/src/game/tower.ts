/**
 * Runtime-модель башни. Геометрия (где стоит) лежит в arena.ts;
 * здесь — состояние и характеристики, которые меняются в бою.
 *
 * Замечание про единицы:
 *   range у башен в пикселях (160/150) — соответствует ТЗ Этапа 7
 *   и удобно сравнивать с координатами Phaser. У карт `range` — в тайлах,
 *   там это игровая дальность. Не путать.
 */
import { rectToPx, type Lane, type RectInTiles, type Side, type TowerType } from './arena';

export interface TowerStats {
  maxHp: number;
  damage: number;
  range: number; // px
  attackSpeed: number; // секунд между атаками
}

/**
 * ТЗ Этапа 7. Для удобного балансинга позже — собрано в одном месте.
 * Принцессы стреляют быстрее — на их платформе стоит лучница.
 */
export const TOWER_STATS: Record<TowerType, TowerStats> = {
  king: { maxHp: 3000, damage: 80, range: 160, attackSpeed: 1 },
  princess: { maxHp: 1800, damage: 55, range: 225, attackSpeed: 0.55 },
};

export interface TowerInit {
  id: string;
  team: Side;
  type: TowerType;
  rect: RectInTiles;
  lane?: Lane;
}

export class Tower {
  readonly id: string;
  readonly team: Side;
  readonly type: TowerType;
  readonly lane?: Lane;
  readonly rect: RectInTiles;

  /** Центр башни в пикселях. */
  readonly x: number;
  readonly y: number;

  hp: number;
  readonly maxHp: number;
  readonly damage: number;
  readonly range: number;
  readonly attackSpeed: number;
  isDestroyed = false;

  /** Время последней атаки (мс от start), пригодится на следующем этапе. */
  lastAttackAt = 0;

  constructor(init: TowerInit) {
    const r = rectToPx(init.rect);
    const stats = TOWER_STATS[init.type];

    this.id = init.id;
    this.team = init.team;
    this.type = init.type;
    this.lane = init.lane;
    this.rect = init.rect;

    // Lane-offset: визуально и по логике сдвигаем боковые принцессы так,
    // чтобы они стояли по оси дорожки (lane), а не у внешнего края арены.
    // Левая принцесса смещается вправо на ~20px, правая — влево на 20px.
    const laneOffsetX = init.lane === 'left' ? 20 : init.lane === 'right' ? -20 : 0;
    this.x = r.cx + laneOffsetX;
    this.y = r.cy;

    this.hp = stats.maxHp;
    this.maxHp = stats.maxHp;
    this.damage = stats.damage;
    this.range = stats.range;
    this.attackSpeed = stats.attackSpeed;
  }

  /** Получить урон. Возвращает true, если башня в этот раз разрушилась. */
  takeDamage(amount: number): boolean {
    if (this.isDestroyed) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp === 0) {
      this.isDestroyed = true;
      return true;
    }
    return false;
  }

  /** Доля HP в [0..1] — для индикатора. */
  get hpRatio(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }
}
