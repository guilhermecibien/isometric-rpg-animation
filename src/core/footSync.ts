import type { AnimationDefinition, Direction8, FootMarker, Vec2 } from './types.js';

export interface PlaybackRange { min: number; max: number }

export interface SyncResult {
  /** Multiplier for the animation's nominal fps. */
  rate: number;
  /** True when the requested ground speed is outside the usable range. */
  clamped: boolean;
  /** Ground speed (px/s) the clamped playback actually matches. */
  matchedSpeed: number;
}

/** Screen-space distance (px) travelled during one loop of the animation in `dir`. */
export function cycleDistance(def: AnimationDefinition, dir: Direction8): number | undefined {
  const t = def.cycleTravel?.[dir];
  return t ? Math.hypot(t.x, t.y) : undefined;
}

/**
 * Playback-rate multiplier so that feet advance exactly as fast as the body moves.
 *   nominal ground speed = cycleDistance * fps / frames  (px/s)
 *   rate = actual / nominal
 * Outside `range` the rate is clamped; callers should switch walk↔run or accept slide.
 */
export function syncRate(
  def: AnimationDefinition,
  dir: Direction8,
  screenSpeed: number,
  range: PlaybackRange = { min: 0.6, max: 1.6 },
): SyncResult | undefined {
  const dist = cycleDistance(def, dir);
  if (dist === undefined || dist <= 0) return undefined;
  const nominal = (dist * def.fps) / def.frames;
  const raw = screenSpeed / nominal;
  const rate = Math.min(range.max, Math.max(range.min, raw));
  return { rate, clamped: rate !== raw, matchedSpeed: nominal * rate };
}

/** Ground speed (px/s) at which the animation plays at nominal fps without sliding. */
export function nominalGroundSpeed(def: AnimationDefinition, dir: Direction8): number | undefined {
  const dist = cycleDistance(def, dir);
  return dist === undefined ? undefined : (dist * def.fps) / def.frames;
}

export interface SlideReport {
  /** Mean absolute foot motion in world (px per frame) over contact frame pairs. */
  meanSlide: number;
  maxSlide: number;
  samples: number;
  /** Pairs checked as [frameA, frameB, slidePx]. */
  worst?: [number, number, number];
}

/**
 * Foot-slide metric. While a foot is planted (contact on two consecutive frames) its
 * position in the sprite must move opposite to the body: pos[i+1]-pos[i] == -bodyStep.
 * Slide is the residual |pos[i+1]-pos[i] + bodyStep| in px/frame.
 */
export function measureFootSlide(
  markers: FootMarker[][],
  bodyTravel: Vec2,
  loop = true,
): SlideReport {
  const n = markers.length;
  const step: Vec2 = { x: bodyTravel.x / n, y: bodyTravel.y / n };
  let sum = 0, max = 0, samples = 0;
  let worst: SlideReport['worst'];
  const last = loop ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = markers[i] ?? [];
    const b = markers[(i + 1) % n] ?? [];
    for (const fa of a) {
      const fb = b.find((m) => m.id === fa.id);
      if (!fb || !fa.contact || !fb.contact) continue;
      const rx = fb.x - fa.x + step.x;
      const ry = fb.y - fa.y + step.y;
      const slide = Math.hypot(rx, ry);
      sum += slide; samples++;
      if (slide > max) { max = slide; worst = [i, (i + 1) % n, slide]; }
    }
  }
  return { meanSlide: samples ? sum / samples : 0, maxSlide: max, samples, worst };
}
