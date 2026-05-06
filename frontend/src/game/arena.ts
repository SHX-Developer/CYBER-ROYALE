/**
 * Геометрия арены.
 *
 * Сетка 9 × 18 тайлов, тайл 40px → 360 × 720 — ровно под Phaser-сцену.
 * Координаты в "тайлах": col [0..8], row [0..17].
 *
 * Логические зоны:
 *   row 0..7   — половина врага
 *   row 8..9   — река (граница)
 *   row 10..17 — половина игрока
 *
 * Линии движения (lanes):
 *   left  — col 1 (ось x = 1.5 тайла)
 *   right — col 6 (ось x = 6.5 тайла)
 *
 * Мосты пересекают реку по этим линиям.
 */

export const TILE = 40;
export const COLS = 9;
export const ROWS = 18;
export const ARENA_WIDTH = COLS * TILE; // 360
export const ARENA_HEIGHT = ROWS * TILE; // 720

export const RIVER_TOP_ROW = 8;
export const RIVER_BOTTOM_ROW = 9; // обе строки = вода
export const ENEMY_LAST_ROW = RIVER_TOP_ROW - 1;
export const PLAYER_FIRST_ROW = RIVER_BOTTOM_ROW + 1;

export type Side = 'player' | 'enemy';
export type Lane = 'left' | 'right';

export interface Vec {
  x: number;
  y: number;
}

export interface TilePos {
  col: number;
  row: number;
}

export interface RectInTiles {
  col: number;
  row: number;
  w: number; // ширина в тайлах
  h: number; // высота в тайлах
}

export const LANES: Record<Lane, { col: number }> = {
  left: { col: 1 }, // тайл 1 (центр оси на 1.5)
  right: { col: 6 }, // тайл 6 (центр оси на 6.5)
};

/**
 * Линии движения юнитов в пикселях.
 *
 * Каждый юнит, поставленный на lane L за команду T, идёт по точкам
 * LANE_PATHS_PX[L][T]. Точка близка → берём следующую. Последняя точка
 * заведена ровно к фронту вражеской половины — оттуда уже targeting
 * подцепит вражеские башни и юниты.
 *
 * Координаты заточены под арену 360×720, lane.left.col=1 (x=60),
 * lane.right.col=6 (x=260). Мосты на этих же x пересекают реку,
 * поэтому путь — прямая линия x=const.
 */
const LEFT_X = LANES.left.col * TILE + TILE / 2; // 60
const RIGHT_X = LANES.right.col * TILE + TILE / 2; // 260
const NEAR_BRIDGE_PLAYER = (RIVER_BOTTOM_ROW + 1) * TILE + TILE / 2; // 420 — после моста
const NEAR_BRIDGE_ENEMY = RIVER_TOP_ROW * TILE - TILE / 2; // 300 — перед мостом снизу для врага
const FRONT_PLAYER_HALF = (PLAYER_FIRST_ROW + 2) * TILE + TILE / 2; // ~500 — фронт игрока
const FRONT_ENEMY_HALF = (RIVER_TOP_ROW - 3) * TILE + TILE / 2; // ~220 — фронт врага

export const LANE_PATHS_PX: Record<Lane, Record<Side, Vec[]>> = {
  left: {
    player: [
      { x: LEFT_X, y: NEAR_BRIDGE_PLAYER }, // подойти к мосту
      { x: LEFT_X, y: FRONT_ENEMY_HALF }, // на вражеский фронт
      { x: LEFT_X, y: 100 }, // у вражеской принцессы
    ],
    enemy: [
      { x: LEFT_X, y: NEAR_BRIDGE_ENEMY },
      { x: LEFT_X, y: FRONT_PLAYER_HALF },
      { x: LEFT_X, y: 620 },
    ],
  },
  right: {
    player: [
      { x: RIGHT_X, y: NEAR_BRIDGE_PLAYER },
      { x: RIGHT_X, y: FRONT_ENEMY_HALF },
      { x: RIGHT_X, y: 100 },
    ],
    enemy: [
      { x: RIGHT_X, y: NEAR_BRIDGE_ENEMY },
      { x: RIGHT_X, y: FRONT_PLAYER_HALF },
      { x: RIGHT_X, y: 620 },
    ],
  },
};

/**
 * Описание расположения башен. Сами стат-показатели (HP, damage, range, …)
 * живут в `tower.ts` — это исключительно геометрия.
 *
 * Башни-принцессы — 2×2 тайла, башня-король — 3×3, всё зеркально.
 */
export type TowerType = 'king' | 'princess';

export interface TowerLayout {
  id: string;
  team: Side;
  type: TowerType;
  lane?: Lane; // у princess; у king нет
  rect: RectInTiles;
}

const PRINCESS_W = 2;
const PRINCESS_H = 2;
const KING_W = 3;
const KING_H = 3;

export const TOWER_LAYOUTS: TowerLayout[] = [
  // вражеские (верх)
  {
    id: 'enemy-princess-left',
    team: 'enemy',
    type: 'princess',
    lane: 'left',
    rect: { col: 0, row: 2, w: PRINCESS_W, h: PRINCESS_H },
  },
  {
    id: 'enemy-princess-right',
    team: 'enemy',
    type: 'princess',
    lane: 'right',
    rect: { col: COLS - PRINCESS_W, row: 2, w: PRINCESS_W, h: PRINCESS_H },
  },
  {
    id: 'enemy-king',
    team: 'enemy',
    type: 'king',
    rect: {
      col: Math.floor((COLS - KING_W) / 2),
      row: 0,
      w: KING_W,
      h: KING_H,
    },
  },
  // игрока (низ)
  {
    id: 'player-princess-left',
    team: 'player',
    type: 'princess',
    lane: 'left',
    rect: { col: 0, row: ROWS - 2 - PRINCESS_H, w: PRINCESS_W, h: PRINCESS_H },
  },
  {
    id: 'player-princess-right',
    team: 'player',
    type: 'princess',
    lane: 'right',
    rect: {
      col: COLS - PRINCESS_W,
      row: ROWS - 2 - PRINCESS_H,
      w: PRINCESS_W,
      h: PRINCESS_H,
    },
  },
  {
    id: 'player-king',
    team: 'player',
    type: 'king',
    rect: {
      col: Math.floor((COLS - KING_W) / 2),
      row: ROWS - KING_H,
      w: KING_W,
      h: KING_H,
    },
  },
];

/** Мосты на каждой lane занимают по 1 тайлу шириной × 2 строки реки. */
export const BRIDGES: RectInTiles[] = [
  { col: LANES.left.col, row: RIVER_TOP_ROW, w: 1, h: 2 },
  { col: LANES.right.col, row: RIVER_TOP_ROW, w: 1, h: 2 },
];

/** Дорожки/lanes: визуальная подсказка маршрута юнитов от моста до башни. */
export const LANE_PATHS: RectInTiles[] = [
  // левая верхняя
  { col: LANES.left.col, row: 0, w: 1, h: RIVER_TOP_ROW },
  // правая верхняя
  { col: LANES.right.col, row: 0, w: 1, h: RIVER_TOP_ROW },
  // левая нижняя
  { col: LANES.left.col, row: PLAYER_FIRST_ROW, w: 1, h: ROWS - PLAYER_FIRST_ROW },
  // правая нижняя
  { col: LANES.right.col, row: PLAYER_FIRST_ROW, w: 1, h: ROWS - PLAYER_FIRST_ROW },
];

export function tileToPx(t: TilePos): { x: number; y: number } {
  return { x: t.col * TILE + TILE / 2, y: t.row * TILE + TILE / 2 };
}

export function rectToPx(r: RectInTiles) {
  return {
    x: r.col * TILE,
    y: r.row * TILE,
    w: r.w * TILE,
    h: r.h * TILE,
    cx: r.col * TILE + (r.w * TILE) / 2,
    cy: r.row * TILE + (r.h * TILE) / 2,
  };
}

/** Палитра арены — отдельно, чтобы потом подменить на ассеты. */
export const ARENA_COLORS = {
  enemyZone: 0x6b8a3a, // оливковая зона врага
  playerZone: 0x7fa84a, // ярче — зона игрока
  zoneStripe: 0x000000, // тёмная полоса по границам зон
  river: 0x3a8fb7,
  riverEdge: 0x2a6d8f,
  bridge: 0xd9b87a,
  bridgeStroke: 0xb89a64,
  lane: 0xc9a96a,
  laneStroke: 0xb38f55,
  enemyTower: 0xc1334a,
  enemyTowerEdge: 0x8a1f33,
  enemyKingTower: 0x8a2840,
  enemyKingEdge: 0x5c1a2c,
  playerTower: 0x2a5d8a,
  playerTowerEdge: 0x1c4063,
  playerKingTower: 0x1a3d6a,
  playerKingEdge: 0x10294a,
  grid: 0x000000,
};
