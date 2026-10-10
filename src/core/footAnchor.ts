import type { Direction8, Vec2 } from './types.js';
import type { AnimationDefinition } from './types.js';

export interface AnchorConfig {
  /** Sprite pivot in frame pixels (origin of the frame is its top-left). */
  pivot: Vec2;
  /** Ground contact point relative to pivot. Default (0,0): pivot IS the ground point. */
  groundOffset?: Vec2;
}

/**
 * Computes where a sprite must be drawn so that its ground point lands exactly on
 * the character's projected world position (sub-pixel positions are rounded to
 * avoid shimmer unless `pixelSnap` is false).
 */
export class FootAnchorController {
  constructor(private readonly cfg: AnchorConfig, private readonly pixelSnap = true) {}

  /** Normalised origin to give Phaser's sprite.setOrigin(). */
  originFor(frameSize: Vec2): Vec2 {
    return { x: this.cfg.pivot.x / frameSize.x, y: this.cfg.pivot.y / frameSize.y };
  }

  spritePosition(groundScreen: Vec2): Vec2 {
    const g = this.cfg.groundOffset ?? { x: 0, y: 0 };
    const p = { x: groundScreen.x - g.x, y: groundScreen.y - g.y };
    return this.pixelSnap ? { x: Math.round(p.x), y: Math.round(p.y) } : p;
  }

  /** Shadow centre: always on the ground plane regardless of jump height. */
  shadowPosition(groundScreen: Vec2): Vec2 {
    return { ...groundScreen };
  }

  /** Planted-foot positions for the current frame in screen space (for debug overlays). */
  footPositions(def: AnimationDefinition, dir: Direction8, frame: number, groundScreen: Vec2, flipX: boolean): Array<{ id: string; pos: Vec2; contact: boolean }> {
    const frameMarkers = def.footMarkers?.[dir]?.[frame] ?? [];
    return frameMarkers.map((m) => ({
      id: m.id,
      contact: m.contact,
      pos: { x: groundScreen.x + (flipX ? -m.x : m.x), y: groundScreen.y + m.y },
    }));
  }
}
