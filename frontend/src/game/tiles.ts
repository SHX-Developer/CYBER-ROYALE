/**
 * Типизированная сетка арены 9×18.
 *
 *   grass       — обычная трава, можно ставить юнитов и ходить по ней
 *   road        — дорожка вдоль линии (косметика, тоже walkable + placeable)
 *   bridge      — настил через реку, walkable, но не placeable
 *   water       — река, не walkable и не placeable
 *   tower_zone  — клетки занятые башнями: walkable (юнит может зайти и атаковать),
 *                 не placeable
 *   blocked     — служебное (декор, скалы) — ни walkable, ни placeable
 *
 * Грид строится один раз из аналитической формулы, повторяет геометрию
 * из arena.ts. При изменении расположения башен/реки нужно поправить и здесь.
 */
import { COLS, ROWS } from './arena';

export type TileType = 'grass' | 'road' | 'bridge' | 'water' | 'tower_zone' | 'blocked';

const RIVER_TOP = 8;
const RIVER_BOTTOM = 9;
const PRINCESS_W = 2;
const PRINCESS_H = 2;
const KING_W = 3;
const KING_H = 3;
const BRIDGE_COLS = new Set([1, 7]);
const LANE_COLS = new Set([1, 7]);

function deriveTileType(col: number, row: number): TileType {
  // Король врага — верх-центр
  const kingColStart = Math.floor((COLS - KING_W) / 2);
  if (row < KING_H && col >= kingColStart && col < kingColStart + KING_W) {
    return 'tower_zone';
  }
  // Король игрока — низ-центр
  if (row >= ROWS - KING_H && col >= kingColStart && col < kingColStart + KING_W) {
    return 'tower_zone';
  }
  // Принцессы врага — верх, ряды 2..3
  if (row >= 2 && row < 2 + PRINCESS_H) {
    if (col < PRINCESS_W) return 'tower_zone';
    if (col >= COLS - PRINCESS_W) return 'tower_zone';
  }
  // Принцессы игрока — низ, ряды ROWS-2-PRINCESS_H..ROWS-2-1
  if (row >= ROWS - 2 - PRINCESS_H && row < ROWS - 2) {
    if (col < PRINCESS_W) return 'tower_zone';
    if (col >= COLS - PRINCESS_W) return 'tower_zone';
  }
  // Река
  if (row === RIVER_TOP || row === RIVER_BOTTOM) {
    if (BRIDGE_COLS.has(col)) return 'bridge';
    return 'water';
  }
  // Дорожки на боковых линиях
  if (LANE_COLS.has(col)) return 'road';
  return 'grass';
}

export const TILE_GRID: TileType[][] = (() => {
  const g: TileType[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: TileType[] = [];
    for (let c = 0; c < COLS; c++) row.push(deriveTileType(c, r));
    g.push(row);
  }
  return g;
})();

export function tileAt(col: number, row: number): TileType | null {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  return TILE_GRID[row][col];
}

export function isWalkable(col: number, row: number): boolean {
  const t = tileAt(col, row);
  if (!t) return false;
  return t !== 'water' && t !== 'blocked';
}

/** Можно ли поставить юнита на эту клетку. Только нижняя половина и grass/road. */
export function isPlaceableForPlayer(col: number, row: number): boolean {
  if (row < ROWS / 2 + 1) return false; // только своя половина (после реки)
  const t = tileAt(col, row);
  return t === 'grass' || t === 'road';
}
