/**
 * BattleEngine — детерминированная симуляция боя.
 *
 * Содержит весь мир (юниты, башни, энергия, время) и тикает его без какой-либо
 * связи с Phaser/React/DOM. Внешний слой (PhaserGame) подаёт на вход команды и
 * слушает события для рендера.
 *
 * Этап 29 — подготовка к онлайну: эту же логику можно будет позже выполнять
 * на сервере, реплицируя state между клиентами через WebSocket.
 */
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  COLS,
  LANES,
  PLAYER_FIRST_ROW,
  RIVER_TOP_ROW,
  ROWS,
  TILE,
  TOWER_LAYOUTS,
  type Lane,
  type Side,
  type Vec,
} from '@/game/arena';
import { findPath, pathToPixels, type Cell } from '@/game/pathfinding';
import { Tower } from '@/game/tower';
import { Unit, type UnitType } from '@/game/unit';
import { SPELL_STATS, type SpellCode } from '@/game/spells';
import {
  MATCH_DURATION_MS,
  MAX_ENERGY,
  START_ENERGY,
} from '@/store/battleStore';
import {
  pickTarget,
  targetCenter,
  targetEdgeRadius,
  towerHalfSize,
} from './systems/targeting';
import { advanceUnitWaypoints, moveUnitToward } from './systems/movement';
import type {
  BattleEngineState,
  BattleEvent,
  BattleListener,
  BattleOutcome,
  Projectile,
} from './types';

/** При range >= этого порога юнит/башня атакует через projectile. */
const RANGED_THRESHOLD = 80;
const PROJECTILE_SPEED = 360; // px/sec
const PROJECTILE_HIT_RADIUS = 10;
const PURSUIT_REPATH_MS = 280;
/** Жёсткий лимит юнитов на команду — для FPS на мобиле. */
const MAX_UNITS_PER_TEAM = 20;

export interface SpawnUnitParams {
  team: Side;
  type: UnitType;
  lane: Lane;
  /** Опционально: точка спавна на сетке. Если не указано — спавн на линии. */
  cell?: Cell;
}

export interface CastSpellParams {
  team: Side;
  code: SpellCode;
  x: number;
  y: number;
}

export class BattleEngine {
  state: BattleEngineState;

  private listeners: BattleListener[] = [];
  private nextUnitId = 1;
  private nextProjectileId = 1;

  constructor() {
    this.state = {
      units: [],
      towers: this.buildTowers(),
      projectiles: [],
      energy: { player: START_ENERGY, enemy: START_ENERGY },
      towersDestroyed: { player: 0, enemy: 0 },
      timeMs: 0,
      matchDurationMs: MATCH_DURATION_MS,
      outcome: null,
    };
  }

  // ───── pub-sub ─────

  on(fn: BattleListener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(e: BattleEvent) {
    for (const l of this.listeners) l(e);
  }

  // ───── основной тик ─────

  tick(deltaMs: number) {
    if (this.state.outcome) return;
    this.state.timeMs += deltaMs;
    const dt = deltaMs / 1000;

    for (const unit of this.state.units) {
      if (unit.isDead) continue;
      this.tickUnit(unit, dt);
    }

    this.tickTowers(dt);
    this.tickProjectiles(dt);

    if (this.state.timeMs >= this.state.matchDurationMs) {
      this.handleTimeout();
    } else {
      const left = Math.max(0, this.state.matchDurationMs - this.state.timeMs);
      this.emit({ kind: 'timeTick', timeLeftMs: left });
    }
  }

  /** Башни сами стреляют проджектайлом по ближайшему вражескому юниту в range. */
  private tickTowers(_dt: number) {
    for (const tower of this.state.towers) {
      if (tower.isDestroyed) continue;
      const target = this.findTowerTarget(tower);
      if (!target) continue;

      const cooldownMs = tower.attackSpeed * 1000;
      if (this.state.timeMs - tower.lastAttackAt < cooldownMs) continue;
      tower.lastAttackAt = this.state.timeMs;

      this.spawnProjectile({
        team: tower.team,
        x: tower.x,
        y: tower.y,
        damage: tower.damage,
        targetUnitId: target.id,
        fallbackX: target.x,
        fallbackY: target.y,
        kind: 'magic',
      });
    }
  }

  private findTowerTarget(tower: Tower): Unit | null {
    let best: Unit | null = null;
    let bestDist = Infinity;
    for (const u of this.state.units) {
      if (u.isDead || u.team === tower.team) continue;
      if (tower.lane && u.lane !== tower.lane) continue;
      const d = Math.hypot(u.x - tower.x, u.y - tower.y);
      if (d <= tower.range && d < bestDist) {
        best = u;
        bestDist = d;
      }
    }
    return best;
  }

  private tickProjectiles(dt: number) {
    if (this.state.projectiles.length === 0) return;
    const survivors: Projectile[] = [];
    for (const p of this.state.projectiles) {
      // Целимся в живую цель, либо в её последнюю точку.
      let tx = p.fallbackX;
      let ty = p.fallbackY;
      if (p.targetUnitId) {
        const u = this.state.units.find((it) => it.id === p.targetUnitId);
        if (u && !u.isDead) {
          tx = u.x;
          ty = u.y;
        }
      } else if (p.targetTowerId) {
        const t = this.state.towers.find((it) => it.id === p.targetTowerId);
        if (t && !t.isDestroyed) {
          tx = t.x;
          ty = t.y;
        }
      }

      const dx = tx - p.x;
      const dy = ty - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= PROJECTILE_HIT_RADIUS) {
        // Хит: применяем урон к актуальной цели.
        if (p.targetUnitId) {
          const u = this.state.units.find((it) => it.id === p.targetUnitId);
          if (u && !u.isDead) this.damageUnit(u, p.damage);
        } else if (p.targetTowerId) {
          const t = this.state.towers.find((it) => it.id === p.targetTowerId);
          if (t && !t.isDestroyed) this.damageTower(t, p.damage);
        }
        this.emit({ kind: 'projectileHit', projectile: p });
        continue;
      }

      const step = p.speed * dt;
      const t = Math.min(1, step / dist);
      p.x += dx * t;
      p.y += dy * t;
      survivors.push(p);
    }
    this.state.projectiles = survivors;
  }

  private spawnProjectile(init: Omit<Projectile, 'id' | 'speed'>) {
    const proj: Projectile = {
      id: `p${this.nextProjectileId++}`,
      speed: PROJECTILE_SPEED,
      ...init,
    };
    this.state.projectiles.push(proj);
    this.emit({ kind: 'projectileSpawned', projectile: proj });
  }

  private tickUnit(unit: Unit, dt: number) {
    const target =
      this.resolveLockedTarget(unit) ?? pickTarget(unit, this.state.units, this.state.towers);

    if (!target) {
      this.clearPursuitPath(unit);
      this.syncWaypointProgress(unit);
      if (unit.waypointIndex < unit.waypoints.length) {
        advanceUnitWaypoints(unit, dt);
        unit.state = 'moving';
      } else {
        unit.state = 'idle';
      }
      return;
    }

    const tc = targetCenter(target);
    const tr = targetEdgeRadius(target);
    const dx = tc.x - unit.x;
    const dy = tc.y - unit.y;
    const dist = Math.hypot(dx, dy);
    const attackDist = unit.range + tr;

    if (dist <= attackDist) {
      unit.state = 'attacking';
      const cooldownMs = unit.attackSpeed * 1000;
      if (this.state.timeMs - unit.lastAttackAt >= cooldownMs) {
        unit.lockedTarget = { kind: target.kind, id: target.ref.id };
        this.applyAttack(unit, target.kind === 'unit' ? target.ref : null, target.kind === 'tower' ? target.ref : null);
        unit.lastAttackAt = this.state.timeMs;
      }
      return;
    }

    unit.state = 'moving';
    if (target.kind === 'unit') {
      this.moveUnitTowardTargetViaPath(unit, target.ref, dt);
    } else if (unit.waypointIndex < unit.waypoints.length) {
      this.clearPursuitPath(unit);
      this.syncWaypointProgress(unit);
      advanceUnitWaypoints(unit, dt);
    } else {
      this.clearPursuitPath(unit);
      moveUnitToward(unit, tc, dt);
    }
  }

  private resolveLockedTarget(unit: Unit): ReturnType<typeof pickTarget> {
    const lock = unit.lockedTarget;
    if (!lock) return null;

    if (lock.kind === 'unit') {
      if (unit.type === 'tank') {
        unit.lockedTarget = null;
        return null;
      }
      const target = this.state.units.find((u) => u.id === lock.id);
      if (!target || target.isDead || target.team === unit.team) {
        unit.lockedTarget = null;
        return null;
      }
      return { kind: 'unit', ref: target };
    }

    const target = this.state.towers.find((t) => t.id === lock.id);
    if (!target || target.isDestroyed || target.team === unit.team) {
      unit.lockedTarget = null;
      return null;
    }
    return { kind: 'tower', ref: target };
  }

  private moveUnitTowardTargetViaPath(unit: Unit, target: Unit, dt: number) {
    if (
      unit.pursuitTargetId !== target.id ||
      this.state.timeMs >= unit.pursuitRepathAt ||
      unit.pursuitWaypointIndex >= unit.pursuitWaypoints.length
    ) {
      const path = findPath(cellFromPx(unit.x, unit.y), cellFromPx(target.x, target.y));
      unit.pursuitTargetId = target.id;
      unit.pursuitRepathAt = this.state.timeMs + PURSUIT_REPATH_MS;
      unit.pursuitWaypoints = pathToPixels(path);
      unit.pursuitWaypointIndex = 0;
    }

    if (unit.pursuitWaypoints.length === 0) {
      this.syncWaypointProgress(unit);
      if (unit.waypointIndex < unit.waypoints.length) advanceUnitWaypoints(unit, dt);
      return;
    }

    const next = unit.pursuitWaypoints[unit.pursuitWaypointIndex];
    moveUnitToward(unit, next, dt);
    if (Math.hypot(unit.x - next.x, unit.y - next.y) < 2) unit.pursuitWaypointIndex++;
  }

  private clearPursuitPath(unit: Unit) {
    unit.pursuitTargetId = null;
    unit.pursuitWaypoints = [];
    unit.pursuitWaypointIndex = 0;
  }

  private syncWaypointProgress(unit: Unit) {
    while (unit.waypointIndex + 1 < unit.waypoints.length) {
      const cur = unit.waypoints[unit.waypointIndex];
      const next = unit.waypoints[unit.waypointIndex + 1];
      const curDist = Math.hypot(unit.x - cur.x, unit.y - cur.y);
      const nextDist = Math.hypot(unit.x - next.x, unit.y - next.y);
      if (nextDist > curDist + 2) break;
      unit.waypointIndex++;
    }
  }

  // ───── урон/смерть/энергия ─────

  private applyAttack(attacker: Unit, victimUnit: Unit | null, victimTower: Tower | null) {
    const isRanged = attacker.range >= RANGED_THRESHOLD;
    if (isRanged) {
      // Дальний юнит — пускает снаряд.
      if (victimTower) {
        this.spawnProjectile({
          team: attacker.team,
          x: attacker.x,
          y: attacker.y,
          damage: attacker.damage,
          targetTowerId: victimTower.id,
          fallbackX: victimTower.x,
          fallbackY: victimTower.y,
          kind: attacker.type === 'mage' ? 'magic' : 'arrow',
        });
      } else if (victimUnit) {
        this.spawnProjectile({
          team: attacker.team,
          x: attacker.x,
          y: attacker.y,
          damage: attacker.damage,
          targetUnitId: victimUnit.id,
          fallbackX: victimUnit.x,
          fallbackY: victimUnit.y,
          kind: attacker.type === 'mage' ? 'magic' : 'arrow',
        });
      }
      return;
    }
    // Ближний — мгновенный удар.
    if (victimTower) {
      this.damageTower(victimTower, attacker.damage);
    } else if (victimUnit) {
      this.damageUnit(victimUnit, attacker.damage);
    }
  }

  damageUnit(unit: Unit, amount: number) {
    if (unit.isDead) return;
    const destroyed = unit.takeDamage(amount);
    this.emit({ kind: 'unitDamaged', unit, amount });
    if (destroyed) this.emit({ kind: 'unitDied', unit });
  }

  damageTower(tower: Tower, amount: number) {
    if (tower.isDestroyed) return;
    const destroyed = tower.takeDamage(amount);
    this.emit({ kind: 'towerDamaged', tower, amount });
    if (destroyed) {
      const sideKey: Side = tower.team;
      const opposite: Side = sideKey === 'player' ? 'enemy' : 'player';
      // Игрок-разрушитель — противоположная команда от team башни.
      this.state.towersDestroyed[opposite] += 1;
      this.emit({ kind: 'towerDestroyed', tower });
      if (tower.type === 'king') {
        this.endGame(tower.team === 'enemy' ? 'won' : 'lost');
      }
    }
  }

  addEnergy(team: Side, amount: number) {
    const cur = this.state.energy[team];
    const next = Math.max(0, Math.min(MAX_ENERGY, cur + amount));
    this.state.energy[team] = next;
    this.emit({ kind: 'energyChanged', team, value: next });
  }

  spendEnergy(team: Side, cost: number): boolean {
    if (this.state.energy[team] < cost) return false;
    this.state.energy[team] -= cost;
    this.emit({ kind: 'energyChanged', team, value: this.state.energy[team] });
    return true;
  }

  // ───── публичные команды ─────

  spawnUnit(params: SpawnUnitParams): Unit | null {
    const { team, type, lane, cell } = params;

    // Лимит юнитов на команду — отбиваем спавн, если переполнено.
    const aliveOnTeam = this.state.units.filter(
      (u) => u.team === team && !u.isDead,
    ).length;
    if (aliveOnTeam >= MAX_UNITS_PER_TEAM) return null;

    const laneCol = LANES[lane].col;
    const spawnCell: Cell = cell
      ? cell
      : team === 'player'
        ? { col: laneCol, row: PLAYER_FIRST_ROW + 2 }
        : { col: laneCol, row: RIVER_TOP_ROW - 3 };

    const x = spawnCell.col * TILE + TILE / 2;
    const y = spawnCell.row * TILE + TILE / 2;

    // Целевая клетка — клетка ближайшей вражеской принцессы на той же стороне поля.
    const targetCell = pickPrincessCell(team, lane);
    const path = findPath(spawnCell, targetCell);
    const waypoints: Vec[] = pathToPixels(path);

    const unit = new Unit({
      id: `u${this.nextUnitId++}-${type}-${team}`,
      type,
      team,
      lane,
      x,
      y,
      waypoints,
    });
    this.state.units.push(unit);
    this.emit({ kind: 'unitSpawned', unit });
    return unit;
  }

  /** Публичный аналог findTowerTarget — Phaser использует для поворота турели. */
  getTowerTarget(tower: Tower): Unit | null {
    return this.findTowerTarget(tower);
  }

  castSpell(params: CastSpellParams) {
    const { code, x, y, team } = params;
    const stats = SPELL_STATS[code];
    this.emit({ kind: 'spellCast', code, x, y, team });

    if (stats.hostile) {
      for (const u of this.state.units) {
        if (u.isDead || u.team === team) continue;
        const d = Math.hypot(u.x - x, u.y - y);
        if (d <= stats.radius) this.damageUnit(u, stats.unitImpact);
      }
      if (stats.towerImpact > 0) {
        for (const t of this.state.towers) {
          if (t.isDestroyed || t.team === team) continue;
          const half = towerHalfSize(t);
          const d = Math.hypot(t.x - x, t.y - y) - half;
          if (d <= stats.radius) this.damageTower(t, stats.towerImpact);
        }
      }
    } else {
      // heal
      for (const u of this.state.units) {
        if (u.isDead || u.team !== team) continue;
        const d = Math.hypot(u.x - x, u.y - y);
        if (d <= stats.radius) {
          u.heal(stats.unitImpact);
          this.emit({ kind: 'unitHealed', unit: u, amount: stats.unitImpact });
        }
      }
    }
  }

  // ───── финал матча ─────

  private handleTimeout() {
    const { player, enemy } = this.state.towersDestroyed;
    if (enemy > player) this.endGame('won');
    else if (player > enemy) this.endGame('lost');
    else this.endGame('draw');
  }

  private endGame(outcome: BattleOutcome) {
    if (this.state.outcome) return;
    this.state.outcome = outcome;
    this.emit({ kind: 'gameOver', outcome });
  }

  // ───── создание стартового мира ─────

  private buildTowers(): Tower[] {
    return TOWER_LAYOUTS.map(
      (l) =>
        new Tower({
          id: l.id,
          team: l.team,
          type: l.type,
          lane: l.lane,
          rect: l.rect,
        }),
    );
  }
}

export type { Vec };
export const ARENA = { width: ARENA_WIDTH, height: ARENA_HEIGHT };

/** Целевая клетка вражеской принцессы для маршрутизации юнита. */
function pickPrincessCell(team: Side, lane: Lane): Cell {
  if (team === 'player') {
    // Игрок идёт к ВЕРХНИМ принцессам.
    return lane === 'left' ? { col: 1, row: 3 } : { col: COLS - 2, row: 3 };
  }
  // Враг идёт к НИЖНИМ принцессам.
  return lane === 'left' ? { col: 1, row: ROWS - 4 } : { col: COLS - 2, row: ROWS - 4 };
}

function cellFromPx(x: number, y: number): Cell {
  return {
    col: Math.max(0, Math.min(COLS - 1, Math.floor(x / TILE))),
    row: Math.max(0, Math.min(ROWS - 1, Math.floor(y / TILE))),
  };
}
