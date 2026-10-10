import type Phaser from 'phaser';
import type { IsoProjection } from '../core/iso.js';
import type { Vec2 } from '../core/types.js';

export interface KeyboardInputOptions {
  /** Keys per screen direction; defaults to WASD + arrows. */
  keys?: { up: string[]; down: string[]; left: string[]; right: string[]; run: string[] };
  /** `screen`: W moves up on screen (usual for iso games). `world`: W moves along -y world. */
  space?: 'screen' | 'world';
}

const DEFAULT_KEYS = {
  up: ['W', 'UP'], down: ['S', 'DOWN'], left: ['A', 'LEFT'], right: ['D', 'RIGHT'], run: ['SHIFT'],
};

/** Polls the keyboard and returns a WORLD-space direction (projected from screen input). */
export class KeyboardInput {
  private readonly keys: Record<string, Phaser.Input.Keyboard.Key>;
  private readonly map: Required<KeyboardInputOptions>['keys'];
  private readonly space: 'screen' | 'world';

  constructor(scene: Phaser.Scene, private readonly projection: IsoProjection, opts: KeyboardInputOptions = {}) {
    this.map = opts.keys ?? DEFAULT_KEYS;
    this.space = opts.space ?? 'screen';
    const kb = scene.input.keyboard;
    if (!kb) throw new Error('KeyboardInput: scene.input.keyboard is unavailable (keyboard plugin disabled?)');
    const all = [...new Set(Object.values(this.map).flat())];
    this.keys = kb.addKeys(all.join(',')) as Record<string, Phaser.Input.Keyboard.Key>;
  }

  private down(names: string[]): boolean {
    return names.some((n) => this.keys[n]?.isDown);
  }

  read(): { world: Vec2; active: boolean; run: boolean } {
    const v = { x: (this.down(this.map.right) ? 1 : 0) - (this.down(this.map.left) ? 1 : 0), y: (this.down(this.map.down) ? 1 : 0) - (this.down(this.map.up) ? 1 : 0) };
    const active = v.x !== 0 || v.y !== 0;
    const world = !active ? { x: 0, y: 0 } : this.space === 'screen' ? this.projection.screenDeltaToWorld(v) : v;
    return { world, active, run: this.down(this.map.run) };
  }

  destroy(scene: Phaser.Scene): void {
    const kb = scene.input.keyboard;
    if (!kb) return;
    for (const k of Object.values(this.keys)) kb.removeKey(k, true);
  }
}

/** Click-to-move: converts pointer position to world and notifies the caller. */
export class PointerInput {
  private handler?: (p: Phaser.Input.Pointer) => void;

  constructor(private readonly scene: Phaser.Scene, private readonly projection: IsoProjection) {}

  attach(onTarget: (world: Vec2, pointer: Phaser.Input.Pointer) => void, button: 'left' | 'right' = 'left'): void {
    this.detach();
    this.handler = (p) => {
      if (button === 'left' ? !p.leftButtonDown() : !p.rightButtonDown()) return;
      onTarget(this.projection.screenToWorld({ x: p.worldX, y: p.worldY }), p);
    };
    this.scene.input.on('pointerdown', this.handler);
  }

  detach(): void {
    if (this.handler) this.scene.input.off('pointerdown', this.handler);
    this.handler = undefined;
  }
}
