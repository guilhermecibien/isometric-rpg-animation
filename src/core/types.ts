/** Eight compass directions as seen on SCREEN (not world axes). */
export const DIRECTIONS_8 = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'] as const;
export type Direction8 = (typeof DIRECTIONS_8)[number];
export const DIRECTIONS_4 = ['S', 'W', 'N', 'E'] as const;
export type Direction4 = (typeof DIRECTIONS_4)[number];

export interface Vec2 {
  x: number;
  y: number;
}

export type AnimationKind =
  | 'idle' | 'walk' | 'run' | 'start_walk' | 'stop_walk' | 'turn' | 'attack'
  | 'attack_combo' | 'cast' | 'hit' | 'knockback' | 'death' | 'spawn' | 'victory' | 'special';

export interface AnimationEvent {
  /** Frame index (0-based) at which the event fires. */
  frame: number;
  name: string;
}

export interface FootMarker {
  id: string;
  /** Pixel position relative to the frame's pivot (x right, y down). */
  x: number;
  y: number;
  contact: boolean;
}

export interface AnimationDefinition {
  key: string;
  frames: number;
  fps: number;
  loop: boolean;
  /** Directions the animation provides. Missing ones fall back via the registry. */
  directions: Direction8[];
  events?: AnimationEvent[];
  /**
   * Screen-space body travel (px) over one full loop for each direction. Used to
   * sync playback speed with ground speed. Absent for in-place animations.
   */
  cycleTravel?: Partial<Record<Direction8, Vec2>>;
  /** Per direction, per frame: foot markers (pivot-relative) used for slide checks and anchoring. */
  footMarkers?: Partial<Record<Direction8, FootMarker[][]>>;
  /** Optional per-frame duration multipliers (1 = nominal) for variable-length animations. */
  frameDurations?: number[];
}

export interface Logger {
  warn(message: string): void;
  info(message: string): void;
}

export const consoleLogger: Logger = {
  warn: (m) => console.warn(`[iso-anim] ${m}`),
  info: (m) => console.info(`[iso-anim] ${m}`),
};

export const silentLogger: Logger = { warn: () => undefined, info: () => undefined };
