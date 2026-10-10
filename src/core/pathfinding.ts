import type { PathfindingAdapter } from './movement.js';
import type { Vec2 } from './types.js';

/**
 * Reference A* on a walkable-cell grid (8-connected, no corner cutting). It is a
 * convenience implementation of PathfindingAdapter; games with their own pathfinding
 * should wrap it instead (see references/phaser-integration.md).
 */
export class GridPathfinder implements PathfindingAdapter {
  constructor(
    private readonly isWalkableCell: (cx: number, cy: number) => boolean,
    private readonly cellSize = 1,
    private readonly maxNodes = 20_000,
  ) {}

  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    const cs = this.cellSize;
    const start = { x: Math.floor(from.x / cs), y: Math.floor(from.y / cs) };
    const goal = { x: Math.floor(to.x / cs), y: Math.floor(to.y / cs) };
    if (!this.isWalkableCell(goal.x, goal.y)) return null;
    if (start.x === goal.x && start.y === goal.y) return [{ ...to }];

    const key = (x: number, y: number) => `${x},${y}`;
    const g = new Map<string, number>([[key(start.x, start.y), 0]]);
    const parent = new Map<string, string>();
    const open: Array<{ x: number; y: number; f: number }> = [{ ...start, f: 0 }];
    const closed = new Set<string>();
    const h = (x: number, y: number) => {
      const dx = Math.abs(x - goal.x), dy = Math.abs(y - goal.y);
      return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };
    let expanded = 0;
    while (open.length && expanded++ < this.maxNodes) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if ((open[i] as { f: number }).f < (open[bi] as { f: number }).f) bi = i;
      const cur = open.splice(bi, 1)[0] as { x: number; y: number };
      const ck = key(cur.x, cur.y);
      if (closed.has(ck)) continue;
      closed.add(ck);
      if (cur.x === goal.x && cur.y === goal.y) return this.build(parent, ck, to);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cur.x + dx, ny = cur.y + dy;
        if (!this.isWalkableCell(nx, ny)) continue;
        if (dx && dy && (!this.isWalkableCell(cur.x + dx, cur.y) || !this.isWalkableCell(cur.x, cur.y + dy))) continue;
        const nk = key(nx, ny);
        if (closed.has(nk)) continue;
        const ng = (g.get(ck) as number) + (dx && dy ? Math.SQRT2 : 1);
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng); parent.set(nk, ck);
          open.push({ x: nx, y: ny, f: ng + h(nx, ny) });
        }
      }
    }
    return null;
  }

  private build(parent: Map<string, string>, endKey: string, exact: Vec2): Vec2[] {
    const cells: string[] = [endKey];
    let k = endKey;
    while (parent.has(k)) { k = parent.get(k) as string; cells.push(k); }
    cells.reverse().shift(); // drop the start cell
    const cs = this.cellSize;
    const pts = cells.map((c) => {
      const [x, y] = c.split(',').map(Number) as [number, number];
      return { x: (x + 0.5) * cs, y: (y + 0.5) * cs };
    });
    if (pts.length) pts[pts.length - 1] = { ...exact }; // finish on the clicked point
    return pts;
  }
}
