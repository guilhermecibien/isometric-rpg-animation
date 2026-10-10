import type { Vec2 } from './types.js';
import type { IsoProjection } from './iso.js';

export interface DepthItem {
  id: string;
  world: Vec2;
  z?: number;
  layer?: number;
  /** Apply the computed depth to the engine object. */
  apply(depth: number): void;
}

/** Engine-agnostic depth sorter; adapters only implement `apply`. */
export class IsometricDepthManager {
  private items = new Map<string, DepthItem>();
  constructor(private readonly projection: IsoProjection) {}

  add(item: DepthItem): void { this.items.set(item.id, item); }
  remove(id: string): void { this.items.delete(id); }
  clear(): void { this.items.clear(); }
  get size(): number { return this.items.size; }

  depthOf(item: Pick<DepthItem, 'world' | 'z' | 'layer'>): number {
    return this.projection.depthOf(item.world, { z: item.z, layer: item.layer });
  }

  /** Recompute and push depths; returns ids in draw order (back → front). */
  update(): string[] {
    const ordered = [...this.items.values()]
      .map((it) => ({ it, d: this.depthOf(it) }))
      .sort((a, b) => a.d - b.d || a.it.id.localeCompare(b.it.id));
    ordered.forEach(({ it, d }) => it.apply(d));
    return ordered.map((o) => o.it.id);
  }
}
