/**
 * BFS-pathfinding по grid-клеткам арены + line-of-sight smoothing.
 *
 *   findPath(from, to) — кратчайший путь по walkable-клеткам.
 *   pathToPixels(path) — конвертирует клетки в пиксельные waypoint'ы.
 *   smoothPath(path)   — выкидывает промежуточные клетки, если между
 *                        двумя точками есть прямая линия видимости
 *                        (нет воды/блоков). Юниты идут по диагонали
 *                        свободно, не цепляясь за решётку.
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
      const path = reconstructPath(cameFrom, startKey, endKey);
      return smoothPath(from, path);
    }
    for (const [dc, dr] of DIRS) {
      const nx = cur.col + dc;
      const ny = cur.row + dr;
      const nk = `${nx},${ny}`;
      if (visited.has(nk)) continue;
      if (!isWalkable(nx, ny)) continue;
      visited.add(nk);
      cameFrom.set(nk, cellKey(cur));
      queue.push({ col: nx, row: ny });
    }
  }
  return [];
}

/**
 * String-pulling smoothing.
 * Идём от старта; для текущей позиции берём самую дальнюю точку, до которой
 * есть прямая «линия видимости» по walkable-тайлам — делаем её следующим
 * waypoint'ом, дальше повторяем. На выходе путь по диагонали и без зигзагов
 * по клеткам.
 */
function smoothPath(start: Cell, cells: Cell[]): Cell[] {
  if (cells.length <= 1) return cells;
  const out: Cell[] = [];
  let from = start;
  let i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i) {
      if (lineOfSight(from, cells[j])) break;
      j--;
    }
    out.push(cells[j]);
    from = cells[j];
    i = j + 1;
  }
  return out;
}

/** Проверяет прямую видимость между двумя клетками (без воды/блоков). */
function lineOfSight(a: Cell, b: Cell): boolean {
  // Bresenham-подобный обход: шагаем по более длинной оси, делаем суб-шаги.
  let x0 = a.col;
  let y0 = a.row;
  const x1 = b.col;
  const y1 = b.row;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    if (!isWalkable(x0, y0)) return false;
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    // При диагональном шаге проверяем оба соседних тайла, чтобы не «срезать» угол сквозь стену.
    if (e2 > -dy && e2 < dx) {
      if (!isWalkable(x0 + sx, y0) && !isWalkable(x0, y0 + sy)) return false;
    }
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
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
