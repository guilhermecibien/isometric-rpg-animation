import type Phaser from 'phaser';
import { IsometricDepthManager, type IsoProjection, type Vec2 } from '../core/index.js';

/** Registers arbitrary Phaser display objects (trees, walls, NPCs) in the depth sorter. */
export class PhaserDepthManager {
  readonly manager: IsometricDepthManager;
  constructor(projection: IsoProjection) {
    this.manager = new IsometricDepthManager(projection);
  }

  /** `world` may be a getter for moving objects. */
  track(id: string, obj: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Depth, world: Vec2 | (() => Vec2), opts: { z?: number; layer?: number } = {}): void {
    const get = typeof world === 'function' ? world : () => world;
    const item = {
      id,
      get world() { return get(); },
      z: opts.z,
      layer: opts.layer,
      apply: (d: number) => { obj.setDepth(d); },
    };
    this.manager.add(item);
  }

  untrack(id: string): void { this.manager.remove(id); }
  update(): string[] { return this.manager.update(); }
  destroy(): void { this.manager.clear(); }
}
