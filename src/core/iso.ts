import type { Vec2 } from './types.js';

export type CameraRotation = 0 | 1 | 2 | 3;

export interface IsoConfig {
  /** Screen width of one grid cell (diamond). */
  tileWidth: number;
  /** Screen height of one grid cell (diamond). */
  tileHeight: number;
  /** World cell edge length in world units. Default 1 (world units == cells). */
  cellSize?: number;
  /** Camera orientation in 90° steps; rotates the world before projecting. */
  cameraRotation?: CameraRotation;
  /** Screen pixels per world-height unit (z axis). */
  heightScale?: number;
  /** Screen position of world origin (0,0,0). */
  origin?: Vec2;
}

/**
 * Configurable isometric projection.
 * World: x grows "right-down" along the grid, y grows "left-down", z is height.
 * Screen: x right, y down. All conversions are exact inverses (z = 0 plane).
 */
export class IsoProjection {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly cellSize: number;
  readonly cameraRotation: CameraRotation;
  readonly heightScale: number;
  readonly origin: Vec2;

  constructor(cfg: IsoConfig) {
    if (!(cfg.tileWidth > 0) || !(cfg.tileHeight > 0)) {
      throw new RangeError('IsoProjection: tileWidth and tileHeight must be > 0');
    }
    this.tileWidth = cfg.tileWidth;
    this.tileHeight = cfg.tileHeight;
    this.cellSize = cfg.cellSize ?? 1;
    this.cameraRotation = cfg.cameraRotation ?? 0;
    this.heightScale = cfg.heightScale ?? cfg.tileHeight;
    this.origin = cfg.origin ?? { x: 0, y: 0 };
  }

  private rotate(p: Vec2): Vec2 {
    switch (this.cameraRotation) {
      case 0: return { x: p.x, y: p.y };
      case 1: return { x: -p.y, y: p.x };
      case 2: return { x: -p.x, y: -p.y };
      default: return { x: p.y, y: -p.x };
    }
  }

  private unrotate(p: Vec2): Vec2 {
    switch (this.cameraRotation) {
      case 0: return { x: p.x, y: p.y };
      case 1: return { x: p.y, y: -p.x };
      case 2: return { x: -p.x, y: -p.y };
      default: return { x: -p.y, y: p.x };
    }
  }

  worldToScreen(world: Vec2, z = 0): Vec2 {
    const r = this.rotate(world);
    const cx = r.x / this.cellSize;
    const cy = r.y / this.cellSize;
    return {
      x: this.origin.x + (cx - cy) * (this.tileWidth / 2),
      y: this.origin.y + (cx + cy) * (this.tileHeight / 2) - z * this.heightScale,
    };
  }

  /** Inverse of worldToScreen for a point on the plane at height z. */
  screenToWorld(screen: Vec2, z = 0): Vec2 {
    const sx = (screen.x - this.origin.x) / (this.tileWidth / 2);
    const sy = (screen.y - this.origin.y + z * this.heightScale) / (this.tileHeight / 2);
    const cx = (sx + sy) / 2;
    const cy = (sy - sx) / 2;
    return this.unrotate({ x: cx * this.cellSize, y: cy * this.cellSize });
  }

  /** Linear inverse of worldDeltaToScreen (for screen-space input such as WASD). */
  screenDeltaToWorld(delta: Vec2): Vec2 {
    const a = this.screenToWorld({ x: this.origin.x, y: this.origin.y });
    const b = this.screenToWorld({ x: this.origin.x + delta.x, y: this.origin.y + delta.y });
    return { x: b.x - a.x, y: b.y - a.y };
  }

  worldToGrid(world: Vec2): Vec2 {
    return { x: Math.floor(world.x / this.cellSize), y: Math.floor(world.y / this.cellSize) };
  }

  /** Center of the grid cell in world coordinates. */
  gridToWorld(cell: Vec2): Vec2 {
    return { x: (cell.x + 0.5) * this.cellSize, y: (cell.y + 0.5) * this.cellSize };
  }

  gridToScreen(cell: Vec2, z = 0): Vec2 {
    return this.worldToScreen(this.gridToWorld(cell), z);
  }

  screenToGrid(screen: Vec2, z = 0): Vec2 {
    return this.worldToGrid(this.screenToWorld(screen, z));
  }

  /** Screen-space displacement for a world-space displacement (linear part only). */
  worldDeltaToScreen(delta: Vec2): Vec2 {
    const a = this.worldToScreen({ x: 0, y: 0 });
    const b = this.worldToScreen(delta);
    return { x: b.x - a.x, y: b.y - a.y };
  }

  /**
   * Painter's-algorithm key: larger = drawn later (in front). `z` lifts the object
   * but does not change its ground-plane ordering; `layer` is a coarse override.
   */
  depthOf(world: Vec2, opts: { z?: number; layer?: number } = {}): number {
    const r = this.rotate(world);
    const ground = (r.x + r.y) / this.cellSize;
    return (opts.layer ?? 0) * 1_000_000 + ground * 100 + (opts.z ?? 0) * 0.01;
  }
}
