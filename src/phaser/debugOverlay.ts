import type Phaser from 'phaser';
import type { IsoProjection, Vec2 } from '../core/index.js';
import type { IsometricCharacterController } from './characterController.js';

export interface DebugFlags {
  grid: boolean;
  collisions: boolean;
  pivot: boolean;
  feet: boolean;
  path: boolean;
  text: boolean;
}

export const DEFAULT_DEBUG: DebugFlags = { grid: true, collisions: true, pivot: true, feet: true, path: true, text: true };

export interface DebugOverlayOptions {
  scene: Phaser.Scene;
  projection: IsoProjection;
  gridSize: { cols: number; rows: number };
  isBlocked?: (cx: number, cy: number) => boolean;
}

/** Graphics-based diagnostics: grid, blocked cells, pivot, foot markers, path, state text. */
export class DebugOverlay {
  readonly flags: DebugFlags = { ...DEFAULT_DEBUG };
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private readonly trail: Vec2[] = [];

  constructor(private readonly o: DebugOverlayOptions) {
    this.g = o.scene.add.graphics().setDepth(1e9);
    this.text = o.scene.add.text(8, 8, '', { fontFamily: 'monospace', fontSize: '12px', color: '#fff', backgroundColor: '#000a' }).setScrollFactor(0).setDepth(1e9 + 1);
  }

  private diamond(cx: number, cy: number): Vec2[] {
    const p = this.o.projection;
    return [p.worldToScreen({ x: cx, y: cy }), p.worldToScreen({ x: cx + 1, y: cy }), p.worldToScreen({ x: cx + 1, y: cy + 1 }), p.worldToScreen({ x: cx, y: cy + 1 })];
  }

  draw(c: IsometricCharacterController, fps: number): void {
    const { g, flags } = this;
    g.clear();
    const { cols, rows } = this.o.gridSize;
    if (flags.grid || flags.collisions) {
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const d = this.diamond(x, y);
        const blocked = this.o.isBlocked?.(x, y) ?? false;
        if (flags.collisions && blocked) { g.fillStyle(0xff3355, 0.35); g.fillPoints(d, true); }
        if (flags.grid) { g.lineStyle(1, 0xffffff, 0.12); g.strokePoints(d, true); }
      }
    }
    const ground = c.screen;
    if (flags.path) {
      const rem = c.movement.remainingPath;
      if (rem.length) {
        g.lineStyle(2, 0x44ddff, 0.9);
        g.beginPath(); g.moveTo(ground.x, ground.y);
        for (const w of rem) { const s = this.o.projection.worldToScreen(w); g.lineTo(s.x, s.y); }
        g.strokePath();
        const last = this.o.projection.worldToScreen(rem[rem.length - 1] as Vec2);
        g.fillStyle(0x44ddff, 1); g.fillCircle(last.x, last.y, 4);
      }
    }
    if (flags.pivot) {
      g.lineStyle(1, 0xffee00, 1);
      g.strokeCircle(ground.x, ground.y, 5);
      g.lineBetween(ground.x - 8, ground.y, ground.x + 8, ground.y);
      g.lineBetween(ground.x, ground.y - 8, ground.x, ground.y + 8);
    }
    const out = c.last;
    if (flags.feet && out) {
      const def = c.animation.registry.get(out.animKey);
      if (def) {
        for (const f of c.anchor.footPositions(def, out.direction, out.frameIndex, ground, out.flipX)) {
          g.fillStyle(f.contact ? 0x33ff66 : 0xff9933, 1);
          g.fillCircle(f.pos.x, f.pos.y, f.contact ? 3 : 2);
        }
      }
    }
    if (flags.text) {
      const o = out;
      this.text.setVisible(true).setText([
        `FPS ${fps.toFixed(0)}  state ${o?.state ?? '-'}  anim ${o?.animKey ?? '-'}  dir ${o?.direction ?? '-'}${o?.flipX ? ' (flipped)' : ''}`,
        `frame ${o?.frameIndex ?? '-'}  rate ${(o?.rate ?? 1).toFixed(2)}${o?.syncClamped ? '  SYNC CLAMPED' : ''}  speed ${c.movement.speed.toFixed(2)} u/s  mode ${c.movement.mode}  sync ${c.syncMode}`,
      ]);
    } else this.text.setVisible(false);
  }

  destroy(): void {
    this.g.destroy();
    this.text.destroy();
  }
}
