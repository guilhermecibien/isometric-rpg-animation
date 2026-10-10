import type { Direction4, Direction8, Vec2 } from './types.js';
import { DIRECTIONS_8 } from './types.js';
import type { IsoProjection } from './iso.js';

/** Screen angle (radians, atan2(y, x) with y down) of each direction's facing. */
const ANGLE_OF: Record<Direction8, number> = {
  E: 0,
  SE: Math.PI / 4,
  S: Math.PI / 2,
  SW: (3 * Math.PI) / 4,
  W: Math.PI,
  NW: (-3 * Math.PI) / 4,
  N: -Math.PI / 2,
  NE: -Math.PI / 4,
};

export interface DirectionResolverOptions {
  projection: IsoProjection;
  /**
   * Maps a canonical screen direction to the direction label used by the sprite
   * sheet, for assets authored with a different convention. Identity by default.
   */
  spriteConvention?: Partial<Record<Direction8, Direction8>>;
  /** Extra angular hysteresis (radians) before switching away from the current direction. */
  hysteresis?: number;
  /** Movement shorter than this is ignored (keeps the previous direction). */
  deadZone?: number;
}

/**
 * Resolves facing directions. A world-space movement vector is first PROJECTED to
 * the screen, then bucketed — sprite orientation is never assumed to equal the
 * cartesian direction.
 */
export class DirectionResolver {
  private readonly projection: IsoProjection;
  private readonly convention: Partial<Record<Direction8, Direction8>>;
  private readonly hysteresis: number;
  private readonly deadZone: number;

  constructor(opts: DirectionResolverOptions) {
    this.projection = opts.projection;
    this.convention = opts.spriteConvention ?? {};
    this.hysteresis = opts.hysteresis ?? 0.12;
    this.deadZone = opts.deadZone ?? 1e-6;
  }

  static fromScreenVector(v: Vec2, previous?: Direction8, hysteresis = 0): Direction8 | undefined {
    if (Math.hypot(v.x, v.y) < 1e-9) return previous;
    const angle = Math.atan2(v.y, v.x);
    let best: Direction8 = DIRECTIONS_8[0];
    let bestDiff = Infinity;
    for (const d of DIRECTIONS_8) {
      let diff = Math.abs(angle - ANGLE_OF[d]);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      // Hysteresis: bias toward staying on the previous direction near boundaries.
      if (d === previous) diff -= hysteresis;
      if (diff < bestDiff) { bestDiff = diff; best = d; }
    }
    return best;
  }

  /** Direction for a world-space movement vector. */
  fromWorldVector(v: Vec2, previous?: Direction8): Direction8 | undefined {
    if (Math.hypot(v.x, v.y) < this.deadZone) return previous;
    return DirectionResolver.fromScreenVector(this.projection.worldDeltaToScreen(v), previous, this.hysteresis);
  }

  fromScreenVector(v: Vec2, previous?: Direction8): Direction8 | undefined {
    return DirectionResolver.fromScreenVector(v, previous, this.hysteresis);
  }

  /** Direction from point `a` to point `b`, both in world space. */
  fromWorldPoints(a: Vec2, b: Vec2, previous?: Direction8): Direction8 | undefined {
    return this.fromWorldVector({ x: b.x - a.x, y: b.y - a.y }, previous);
  }

  /** Label used in the sprite sheet for a canonical direction. */
  toSpriteDirection(d: Direction8): Direction8 {
    return this.convention[d] ?? d;
  }

  static screenVectorOf(d: Direction8): Vec2 {
    return { x: Math.cos(ANGLE_OF[d]), y: Math.sin(ANGLE_OF[d]) };
  }

  /** Snap to 4 directions; diagonals go to the vertical axis neighbour by default. */
  static reduceTo4(d: Direction8, preferHorizontal = false): Direction4 {
    switch (d) {
      case 'S': case 'N': case 'E': case 'W': return d;
      case 'SE': return preferHorizontal ? 'E' : 'S';
      case 'SW': return preferHorizontal ? 'W' : 'S';
      case 'NE': return preferHorizontal ? 'E' : 'N';
      default: return preferHorizontal ? 'W' : 'N';
    }
  }

  /** Shortest rotation (in 45° steps, signed) from a to b. */
  static turnSteps(a: Direction8, b: Direction8): number {
    const ia = DIRECTIONS_8.indexOf(a);
    const ib = DIRECTIONS_8.indexOf(b);
    let d = (ib - ia + 8) % 8;
    if (d > 4) d -= 8;
    return d;
  }

  static rotate(d: Direction8, steps: number): Direction8 {
    const i = DIRECTIONS_8.indexOf(d);
    return DIRECTIONS_8[(((i + steps) % 8) + 8) % 8] as Direction8;
  }
}
