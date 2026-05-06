import Phaser from 'phaser';
import {
  ARENA_COLORS,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BRIDGES,
  COLS,
  LANE_PATHS,
  PLAYER_FIRST_ROW,
  RIVER_BOTTOM_ROW,
  RIVER_TOP_ROW,
  ROWS,
  TILE,
  TOWERS,
  rectToPx,
} from './arena';

/**
 * Прототип боевой сцены. Только статичный рендер арены —
 * половины игрока/врага, река, мосты, две линии, шесть башен.
 * Юниты, energy, drag-and-drop карт — на следующих этапах.
 */
class ArenaScene extends Phaser.Scene {
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
    this.drawTowers();
    this.drawSideLabels();
  }

  /** Половины поля: верх — враг, низ — игрок. */
  private drawZones() {
    const g = this.add.graphics();

    // зона врага
    g.fillStyle(ARENA_COLORS.enemyZone, 1);
    g.fillRect(0, 0, ARENA_WIDTH, RIVER_TOP_ROW * TILE);

    // зона игрока
    g.fillStyle(ARENA_COLORS.playerZone, 1);
    g.fillRect(
      0,
      (RIVER_BOTTOM_ROW + 1) * TILE,
      ARENA_WIDTH,
      ARENA_HEIGHT - (RIVER_BOTTOM_ROW + 1) * TILE,
    );
  }

  /** Жёлто-песочные тропы вдоль каждой линии. */
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

  /** Река — синяя полоса посередине, с тёмной кромкой сверху и снизу. */
  private drawRiver() {
    const g = this.add.graphics();

    // основное полотно
    g.fillStyle(ARENA_COLORS.river, 1);
    g.fillRect(0, RIVER_TOP_ROW * TILE, ARENA_WIDTH, 2 * TILE);

    // кромки
    g.fillStyle(ARENA_COLORS.riverEdge, 1);
    g.fillRect(0, RIVER_TOP_ROW * TILE, ARENA_WIDTH, 2);
    g.fillRect(0, (RIVER_BOTTOM_ROW + 1) * TILE - 2, ARENA_WIDTH, 2);
  }

  /** Два моста — деревянно-песочные плитки поверх реки. */
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

  /** Тонкая сетка тайлов — пригодится при отладке расстановки карт. */
  private drawGrid() {
    const g = this.add.graphics();
    g.lineStyle(1, ARENA_COLORS.grid, 0.08);
    for (let c = 1; c < COLS; c++) {
      g.lineBetween(c * TILE, 0, c * TILE, ARENA_HEIGHT);
    }
    for (let r = 1; r < ROWS; r++) {
      // не рисуем сетку поверх реки, чтобы не мешала
      if (r === RIVER_TOP_ROW || r === RIVER_BOTTOM_ROW + 1) continue;
      g.lineBetween(0, r * TILE, ARENA_WIDTH, r * TILE);
    }
  }

  /** Шесть башен: 3 врага сверху, 3 игрока снизу. */
  private drawTowers() {
    for (const tower of TOWERS) {
      const r = rectToPx(tower.rect);

      const isKing = tower.kind === 'king';
      const fill =
        tower.side === 'enemy'
          ? isKing
            ? ARENA_COLORS.enemyKingTower
            : ARENA_COLORS.enemyTower
          : isKing
            ? ARENA_COLORS.playerKingTower
            : ARENA_COLORS.playerTower;
      const stroke =
        tower.side === 'enemy'
          ? isKing
            ? ARENA_COLORS.enemyKingEdge
            : ARENA_COLORS.enemyTowerEdge
          : isKing
            ? ARENA_COLORS.playerKingEdge
            : ARENA_COLORS.playerTowerEdge;

      const g = this.add.graphics();
      g.fillStyle(fill, 1);
      g.lineStyle(2, stroke, 1);
      g.fillRoundedRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 6);
      g.strokeRoundedRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 6);

      // корона на короле — отметим жёлтой точкой
      if (isKing) {
        const crown = this.add.graphics();
        crown.fillStyle(0xf2c14e, 1);
        crown.fillCircle(r.cx, r.cy, 6);
      }

      // подпись для отладки
      this.add
        .text(r.cx, r.cy + (isKing ? 18 : 0), tower.kind === 'king' ? 'KING' : 'TOWER', {
          fontFamily: 'system-ui, sans-serif',
          fontSize: isKing ? '11px' : '10px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setAlpha(0.85);
    }
  }

  /** «ВРАГ» / «ИГРОК» по центрам половин — чтобы было ясно, где чьё. */
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
