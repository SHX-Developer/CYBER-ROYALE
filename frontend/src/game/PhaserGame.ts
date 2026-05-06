import Phaser from 'phaser';
import {
  ARENA_COLORS,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BRIDGES,
  COLS,
  LANE_PATHS,
  LANE_PATHS_PX,
  LANES,
  PLAYER_FIRST_ROW,
  RIVER_BOTTOM_ROW,
  RIVER_TOP_ROW,
  ROWS,
  TILE,
  TOWER_LAYOUTS,
  rectToPx,
  type Lane,
  type Side,
  type Vec,
} from './arena';
import { Tower } from './tower';
import { Unit, UNIT_STATS, type UnitType } from './unit';

interface TowerView {
  body: Phaser.GameObjects.Graphics;
  hpBar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  rangeCircle: Phaser.GameObjects.Graphics;
}

interface UnitView {
  body: Phaser.GameObjects.Graphics;
  hpBar: Phaser.GameObjects.Graphics;
}

type AttackTarget =
  | { kind: 'unit'; ref: Unit }
  | { kind: 'tower'; ref: Tower };

/** Запас восприятия сверх собственного range — в этом радиусе юнит решает, куда идти. */
const PERCEPTION_BONUS = 80;

export class ArenaScene extends Phaser.Scene {
  towers: Tower[] = [];
  units: Unit[] = [];

  private towerViews = new Map<string, TowerView>();
  private unitViews = new Map<string, UnitView>();
  private nextUnitId = 1;

  constructor() {
    super('Arena');
  }

  create() {
    this.cameras.main.setBackgroundColor('#0b0d12');
    this.drawZones();
    this.drawLanes();
    this.drawRiver();
    this.drawBridges();
    this.drawGrid();
    this.drawSideLabels();
    this.spawnTowers();
  }

  override update(time: number, deltaMs: number) {
    const dt = deltaMs / 1000;
    for (const unit of this.units) {
      if (unit.isDead) continue;
      this.tickUnit(unit, time, dt);
    }
  }

  // ───── Цикл боя одного юнита ─────

  private tickUnit(unit: Unit, time: number, dt: number) {
    const target = this.pickTarget(unit);

    if (!target) {
      // Никого не нашли — продолжаем по линии.
      this.advanceUnitWaypoints(unit, dt);
      unit.state = 'moving';
      return;
    }

    const tx = targetX(target);
    const ty = targetY(target);
    const tr = targetRadius(target);
    const dx = tx - unit.x;
    const dy = ty - unit.y;
    const dist = Math.hypot(dx, dy);
    const attackDist = unit.range + tr;

    if (dist <= attackDist) {
      // В радиусе атаки — стоим, бьём по таймеру.
      unit.state = 'attacking';
      const cooldownMs = unit.attackSpeed * 1000;
      if (time - unit.lastAttackAt >= cooldownMs) {
        this.applyDamage(target, unit.damage);
        unit.lastAttackAt = time;
        this.flashAttack(unit, { x: tx, y: ty });
      }
      this.updateUnitView(unit);
      return;
    }

    // Не в радиусе.
    unit.state = 'moving';
    if (target.kind === 'unit') {
      // По вражескому юниту идём напрямую.
      this.moveUnitToward(unit, { x: tx, y: ty }, dt);
    } else if (unit.waypointIndex < unit.waypoints.length) {
      // По башне — пока есть waypoint'ы, идём по линии (через мост).
      this.advanceUnitWaypoints(unit, dt);
    } else {
      // Линия пройдена, идём напрямую к башне.
      this.moveUnitToward(unit, { x: tx, y: ty }, dt);
    }
  }

  /**
   * Выбор цели по приоритету:
   *   1) ближайший вражеский юнит в perception-радиусе
   *   2) ближайшая живая принцесса
   *   3) король
   */
  private pickTarget(unit: Unit): AttackTarget | null {
    const perception = unit.range + PERCEPTION_BONUS;

    // 1) ближайший вражеский юнит в perception
    let bestUnit: Unit | null = null;
    let bestUnitDist = Infinity;
    for (const other of this.units) {
      if (other.team === unit.team || other.isDead) continue;
      const d = Math.hypot(unit.x - other.x, unit.y - other.y) - other.radius;
      if (d <= perception && d < bestUnitDist) {
        bestUnit = other;
        bestUnitDist = d;
      }
    }
    if (bestUnit) return { kind: 'unit', ref: bestUnit };

    // 2) ближайшая живая принцесса
    let bestPrincess: Tower | null = null;
    let bestPrincessDist = Infinity;
    // 3) король (запасной вариант)
    let king: Tower | null = null;
    let kingDist = Infinity;

    for (const t of this.towers) {
      if (t.team === unit.team || t.isDestroyed) continue;
      const half = towerHalfSize(t);
      const d = Math.hypot(unit.x - t.x, unit.y - t.y) - half;
      if (t.type === 'princess' && d < bestPrincessDist) {
        bestPrincess = t;
        bestPrincessDist = d;
      }
      if (t.type === 'king' && d < kingDist) {
        king = t;
        kingDist = d;
      }
    }

    if (bestPrincess) return { kind: 'tower', ref: bestPrincess };
    if (king) return { kind: 'tower', ref: king };
    return null;
  }

  private moveUnitToward(unit: Unit, point: Vec, dt: number) {
    const dx = point.x - unit.x;
    const dy = point.y - unit.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    const step = unit.moveSpeed * dt;
    const t = Math.min(1, step / dist);
    unit.x += dx * t;
    unit.y += dy * t;
    this.updateUnitView(unit);
  }

  private advanceUnitWaypoints(unit: Unit, dt: number) {
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
    this.updateUnitView(unit);
  }

  private applyDamage(target: AttackTarget, amount: number) {
    if (target.kind === 'tower') {
      this.damageTower(target.ref.id, amount);
    } else {
      this.damageUnit(target.ref, amount);
    }
  }

  private damageUnit(unit: Unit, amount: number) {
    const destroyed = unit.takeDamage(amount);
    this.updateUnitView(unit);
    if (destroyed) {
      const view = this.unitViews.get(unit.id);
      view?.body.destroy();
      view?.hpBar.destroy();
      this.unitViews.delete(unit.id);
    }
  }

  private flashAttack(from: Vec, to: Vec) {
    const line = this.add.graphics();
    line.lineStyle(2, 0xffffff, 0.8);
    line.lineBetween(from.x, from.y, to.x, to.y);
    this.tweens.add({
      targets: line,
      alpha: 0,
      duration: 220,
      onComplete: () => line.destroy(),
    });
  }

  // ───── Статика арены ─────

  private drawZones() {
    const g = this.add.graphics();
    g.fillStyle(ARENA_COLORS.enemyZone, 1);
    g.fillRect(0, 0, ARENA_WIDTH, RIVER_TOP_ROW * TILE);
    g.fillStyle(ARENA_COLORS.playerZone, 1);
    g.fillRect(
      0,
      (RIVER_BOTTOM_ROW + 1) * TILE,
      ARENA_WIDTH,
      ARENA_HEIGHT - (RIVER_BOTTOM_ROW + 1) * TILE,
    );
  }

  private drawLanes() {
    const g = this.add.graphics();
    g.fillStyle(ARENA_COLORS.lane, 1);
    g.lineStyle(1, ARENA_COLORS.laneStroke, 0.8);
    for (const path of LANE_PATHS) {
      const r = rectToPx(path);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
  }

  private drawRiver() {
    const g = this.add.graphics();
    g.fillStyle(ARENA_COLORS.river, 1);
    g.fillRect(0, RIVER_TOP_ROW * TILE, ARENA_WIDTH, 2 * TILE);
    g.fillStyle(ARENA_COLORS.riverEdge, 1);
    g.fillRect(0, RIVER_TOP_ROW * TILE, ARENA_WIDTH, 2);
    g.fillRect(0, (RIVER_BOTTOM_ROW + 1) * TILE - 2, ARENA_WIDTH, 2);
  }

  private drawBridges() {
    const g = this.add.graphics();
    g.fillStyle(ARENA_COLORS.bridge, 1);
    g.lineStyle(2, ARENA_COLORS.bridgeStroke, 1);
    for (const b of BRIDGES) {
      const r = rectToPx(b);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }

  private drawGrid() {
    const g = this.add.graphics();
    g.lineStyle(1, ARENA_COLORS.grid, 0.08);
    for (let c = 1; c < COLS; c++) {
      g.lineBetween(c * TILE, 0, c * TILE, ARENA_HEIGHT);
    }
    for (let r = 1; r < ROWS; r++) {
      if (r === RIVER_TOP_ROW || r === RIVER_BOTTOM_ROW + 1) continue;
      g.lineBetween(0, r * TILE, ARENA_WIDTH, r * TILE);
    }
  }

  private drawSideLabels() {
    const labelStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      color: '#ffffff',
      fontStyle: 'bold',
    };
    this.add
      .text(ARENA_WIDTH / 2, (PLAYER_FIRST_ROW - 0.4) * TILE, 'ИГРОК', labelStyle)
      .setOrigin(0.5, 0)
      .setAlpha(0.85);
    this.add
      .text(ARENA_WIDTH / 2, (RIVER_TOP_ROW - 0.6) * TILE, 'ВРАГ', labelStyle)
      .setOrigin(0.5, 1)
      .setAlpha(0.85);
  }

  // ───── Башни ─────

  private spawnTowers() {
    for (const layout of TOWER_LAYOUTS) {
      const tower = new Tower({
        id: layout.id,
        team: layout.team,
        type: layout.type,
        lane: layout.lane,
        rect: layout.rect,
      });
      this.towers.push(tower);
      const view = this.drawTower(tower);
      this.towerViews.set(tower.id, view);
      this.updateTowerHud(tower);
    }
  }

  private drawTower(tower: Tower): TowerView {
    const r = rectToPx(tower.rect);
    const isKing = tower.type === 'king';
    const isPlayer = tower.team === 'player';

    const fill = isPlayer
      ? isKing
        ? ARENA_COLORS.playerKingTower
        : ARENA_COLORS.playerTower
      : isKing
        ? ARENA_COLORS.enemyKingTower
        : ARENA_COLORS.enemyTower;
    const stroke = isPlayer
      ? isKing
        ? ARENA_COLORS.playerKingEdge
        : ARENA_COLORS.playerTowerEdge
      : isKing
        ? ARENA_COLORS.enemyKingEdge
        : ARENA_COLORS.enemyTowerEdge;

    const rangeCircle = this.add.graphics();
    rangeCircle.lineStyle(1, isPlayer ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower, 0.18);
    rangeCircle.strokeCircle(tower.x, tower.y, tower.range);

    const body = this.add.graphics();
    body.fillStyle(fill, 1);
    body.lineStyle(2, stroke, 1);
    body.fillRoundedRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 6);
    body.strokeRoundedRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 6);

    if (isKing) {
      const crown = this.add.graphics();
      crown.fillStyle(0xf2c14e, 1);
      crown.fillCircle(tower.x, tower.y - 2, 6);
    }

    const hpBar = this.add.graphics();
    const hpText = this.add.text(tower.x, r.y - 14, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '11px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    hpText.setOrigin(0.5, 1);

    return { body, hpBar, hpText, rangeCircle };
  }

  updateTowerHud(tower: Tower) {
    const view = this.towerViews.get(tower.id);
    if (!view) return;
    const r = rectToPx(tower.rect);
    const isPlayer = tower.team === 'player';
    const barW = r.w - 12;
    const barH = 4;
    const barX = r.x + 6;
    const barY = r.y - 8;
    const fill = isPlayer ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower;

    const bar = view.hpBar;
    bar.clear();
    bar.fillStyle(0x000000, 0.45);
    bar.fillRoundedRect(barX, barY, barW, barH, 2);
    bar.fillStyle(fill, 1);
    bar.fillRoundedRect(barX, barY, Math.max(0, barW * tower.hpRatio), barH, 2);
    bar.lineStyle(1, 0x000000, 0.5);
    bar.strokeRoundedRect(barX, barY, barW, barH, 2);

    view.hpText.setText(`${tower.hp} / ${tower.maxHp}`);
  }

  damageTower(id: string, amount: number) {
    const tower = this.towers.find((t) => t.id === id);
    if (!tower) return;
    const destroyed = tower.takeDamage(amount);
    this.updateTowerHud(tower);
    if (destroyed) {
      const view = this.towerViews.get(id);
      view?.body.setAlpha(0.35);
      view?.rangeCircle.setAlpha(0);
      view?.hpText.setText('×');
    }
  }

  // ───── Юниты ─────

  /**
   * Спавнит юнита заданного типа за указанную команду на указанной линии.
   * Точка спавна задаётся жёстко: для player — между своей принцессой
   * и рекой; для enemy — зеркально.
   */
  spawnUnit(type: UnitType, team: Side, lane: Lane): Unit {
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
    this.units.push(unit);

    const view = this.drawUnit(unit);
    this.unitViews.set(unit.id, view);
    this.updateUnitView(unit);
    return unit;
  }

  private drawUnit(unit: Unit): UnitView {
    const isPlayer = unit.team === 'player';
    const fill = isPlayer ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower;
    const stroke = isPlayer ? ARENA_COLORS.playerTowerEdge : ARENA_COLORS.enemyTowerEdge;

    const body = this.add.graphics();
    body.fillStyle(fill, 1);
    body.lineStyle(2, stroke, 1);
    body.fillCircle(0, 0, unit.radius);
    body.strokeCircle(0, 0, unit.radius);
    body.x = unit.x;
    body.y = unit.y;

    const hpBar = this.add.graphics();
    return { body, hpBar };
  }

  private updateUnitView(unit: Unit) {
    const view = this.unitViews.get(unit.id);
    if (!view) return;
    view.body.x = unit.x;
    view.body.y = unit.y;

    const barW = unit.radius * 2;
    const barH = 3;
    const barX = unit.x - unit.radius;
    const barY = unit.y - unit.radius - 6;
    const fill = unit.team === 'player' ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower;

    const bar = view.hpBar;
    bar.clear();
    bar.fillStyle(0x000000, 0.5);
    bar.fillRect(barX, barY, barW, barH);
    bar.fillStyle(fill, 1);
    bar.fillRect(barX, barY, Math.max(0, barW * unit.hpRatio), barH);
  }

  unitCount(): number {
    return this.units.filter((u) => !u.isDead).length;
  }
}

// ───── helpers ─────

function targetX(t: AttackTarget): number {
  return t.ref.x;
}

function targetY(t: AttackTarget): number {
  return t.ref.y;
}

function targetRadius(t: AttackTarget): number {
  return t.kind === 'unit' ? t.ref.radius : towerHalfSize(t.ref);
}

function towerHalfSize(t: Tower): number {
  return (Math.max(t.rect.w, t.rect.h) * TILE) / 2;
}

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0b0d12',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: ARENA_WIDTH,
      height: ARENA_HEIGHT,
    },
    scene: [ArenaScene],
  });
}

export type { UnitType } from './unit';

export function getArenaScene(game: Phaser.Game | null): ArenaScene | null {
  if (!game) return null;
  const scene = game.scene.getScene('Arena');
  return (scene as ArenaScene) ?? null;
}

export { UNIT_STATS };
