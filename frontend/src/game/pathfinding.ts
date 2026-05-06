/**
 * BFS-pathfinding по grid-клеткам арены.
 *
 *   findPath(from, to) — кратчайший путь по walkable-клеткам с учётом
 *   воды/блоков. Возвращает массив клеток (без стартовой).
 *
 *   pathToPixels(path) — конвертирует клетки в координаты центров для
 *   waypoint'ов юнита.
 *
 * Используется на спавне юнита: маршрут от спавн-клетки до клетки целевой
 * принцессы. Юнит идёт по этим waypoint'ам, попадая на мост, минуя воду.
 */
import { TILE } from './arena';
import { isWalkable } from './tiles';

export interface Cell {
  col: number;
  row: number;
}

export interface Vec {
  x: number;
  y: number;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const cellKey = (c: Cell): string => `${c.col},${c.row}`;

export function findPath(from: Cell, to: Cell): Cell[] {
  if (!isWalkable(from.col, from.row)) return [];

  const startKey = cellKey(from);
  const endKey = cellKey(to);
  if (startKey === endKey) return [];

  const visited = new Set<string>([startKey]);
  const cameFrom = new Map<string, string>();
  const queue: Cell[] = [from];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cellKey(cur) === endKey) {
      return reconstructPath(cameFrom, startKey, endKey);
    }
    for (const [dc, dr] of DIRS) {
      const nx = cur.col + dc;
      const ny = cur.row + dr;
      const nk = `${nx},${ny}`;
      if (visited.has(nk)) continue;
      // Башенный юнит-путь: разрешаем зайти даже на tower_zone цели
      // (юнит должен дойти и атаковать). Но запрещаем water/blocked.
      if (!isWalkable(nx, ny)) continue;
      visited.add(nk);
      cameFrom.set(nk, cellKey(cur));
      queue.push({ col: nx, row: ny });
    }
  }
  return [];
}

function reconstructPath(
  cameFrom: Map<string, string>,
  startKey: string,
  endKey: string,
): Cell[] {
  const out: Cell[] = [];
  let cur = endKey;
  while (cur !== startKey) {
    const [c, r] = cur.split(',').map(Number);
    out.unshift({ col: c, row: r });
    const prev = cameFrom.get(cur);
    if (!prev) return [];
    cur = prev;
  }
  return out;
}

export function pathToPixels(path: Cell[]): Vec[] {
  return path.map((c) => ({
    x: c.col * TILE + TILE / 2,
    y: c.row * TILE + TILE / 2,
  }));
}
