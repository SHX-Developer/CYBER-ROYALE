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
  LANE_PATHS_PX,
  LANES,
  PLAYER_FIRST_ROW,
  RIVER_TOP_ROW,
  TILE,
  TOWER_LAYOUTS,
  type Lane,
  type Side,
  type Vec,
} from '@/game/arena';
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
} from './types';

export interface SpawnUnitParams {
  team: Side;
  type: UnitType;
  lane: Lane;
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

  constructor() {
    this.state = {
      units: [],
      towers: this.buildTowers(),
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

    if (this.state.timeMs >= this.state.matchDurationMs) {
      this.handleTimeout();
    } else {
      const left = Math.max(0, this.state.matchDurationMs - this.state.timeMs);
      this.emit({ kind: 'timeTick', timeLeftMs: left });
    }
  }

  private tickUnit(unit: Unit, dt: number) {
    const target = pickTarget(unit, this.state.units, this.state.towers);

    if (!target) {
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
        this.applyAttack(unit, target.kind === 'unit' ? target.ref : null, target.kind === 'tower' ? target.ref : null);
        unit.lastAttackAt = this.state.timeMs;
        this.emit({
          kind: 'attack',
          from: { x: unit.x, y: unit.y },
          to: { x: tc.x, y: tc.y },
        });
      }
      return;
    }

    unit.state = 'moving';
    if (target.kind === 'unit') {
      moveUnitToward(unit, tc, dt);
    } else if (unit.waypointIndex < unit.waypoints.length) {
      advanceUnitWaypoints(unit, dt);
    } else {
      moveUnitToward(unit, tc, dt);
    }
  }

  // ───── урон/смерть/энергия ─────

  private applyAttack(_attacker: Unit, victimUnit: Unit | null, victimTower: Tower | null) {
    if (victimTower) {
      this.damageTower(victimTower, _attacker.damage);
    } else if (victimUnit) {
      this.damageUnit(victimUnit, _attacker.damage);
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

  spawnUnit(params: SpawnUnitParams): Unit {
    const { team, type, lane } = params;
    const laneCol = LANES[lane].col;
    const x = laneCol * TILE + TILE / 2;
    const y =
      team === 'player'
        ? (PLAYER_FIRST_ROW + 2) * TILE + TILE / 2
        : (RIVER_TOP_ROW - 3) * TILE + TILE / 2;

    const unit = new Unit({
      id: `u${this.nextUnitId++}-${type}-${team}`,
      type,
      team,
      lane,
      x,
      y,
      waypoints: LANE_PATHS_PX[lane][team],
    });
    this.state.units.push(unit);
    this.emit({ kind: 'unitSpawned', unit });
    return unit;
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
