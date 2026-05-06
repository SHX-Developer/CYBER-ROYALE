import Phaser from 'phaser';
import {
  ARENA_COLORS,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BRIDGES,
  COLS,
  LANE_PATHS,
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

  override update(_time: number, deltaMs: number) {
    const dt = deltaMs / 1000;
    for (const unit of this.units) {
      if (unit.isDead) continue;
      // Игроки идут вверх (y уменьшается), враги — вниз (y растёт).
      const dir = unit.team === 'player' ? -1 : 1;
      unit.y += dir * unit.moveSpeed * dt;

      // Граничные стопы — пока не доходим до атакующей логики.
      // Игрок останавливается у вражеского короля, враг — у игрока.
      const minY = TILE * 1.5;
      const maxY = ARENA_HEIGHT - TILE * 1.5;
      if (unit.y < minY) unit.y = minY;
      if (unit.y > maxY) unit.y = maxY;

      this.updateUnitView(unit);
    }
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
   * Для MVP — без drag&drop, точка спавна жёстко: «у своих ворот, на линии».
   */
  spawnUnit(type: UnitType, team: Side, lane: Lane): Unit {
    const laneCol = LANES[lane].col;
    const x = laneCol * TILE + TILE / 2;
    // По y: игрок — между своей принцессой и рекой; враг — зеркально.
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

    // HP-bar над кругом
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

  /** Сколько юнитов сейчас на арене — используется в подписи кнопки. */
  unitCount(): number {
    return this.units.length;
  }
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

// Помощник для React-слоя: типобезопасно достаёт нашу сцену из game.scene.
export function getArenaScene(game: Phaser.Game | null): ArenaScene | null {
  if (!game) return null;
  const scene = game.scene.getScene('Arena');
  return (scene as ArenaScene) ?? null;
}

// Подсказка по доступным статам — экспортим, чтобы UI мог показать тултип.
export { UNIT_STATS };
