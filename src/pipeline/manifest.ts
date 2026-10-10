import type { AnimationDefinition, Direction8, FootMarker, Vec2 } from '../core/types.js';
import { DIRECTIONS_8 } from '../core/types.js';
import { AnimationRegistry, PROFILES } from '../core/animationRegistry.js';
import type { Logger } from '../core/types.js';

export const MANIFEST_SCHEMA_VERSION = 1;

export interface ManifestAnimation {
  frames: number;
  fps: number;
  loop: boolean;
  directions: Direction8[];
  events?: { frame: number; name: string }[];
  cycleTravel?: Partial<Record<Direction8, Vec2>>;
  footMarkers?: Partial<Record<Direction8, FootMarker[][]>>;
  frameDurations?: number[];
}

export interface CharacterManifest {
  schemaVersion: number;
  id: string;
  name?: string;
  profile: string;
  frame: { width: number; height: number };
  /** Ground contact point in frame pixels (top-left origin). */
  pivot: Vec2;
  shadow?: { rx: number; ry: number };
  atlas: { image: string; data: string };
  animations: Record<string, ManifestAnimation>;
  source?: { method?: string; referenceImages?: string[]; license?: string };
  analysis?: Record<string, unknown>;
}

export class ManifestError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid character manifest:\n - ${problems.join('\n - ')}`);
    this.name = 'ManifestError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Structural validation with every problem collected (not just the first). */
export function validateManifest(input: unknown): string[] {
  const p: string[] = [];
  if (!isObj(input)) return ['manifest must be an object'];
  if (input.schemaVersion !== MANIFEST_SCHEMA_VERSION) p.push(`schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`);
  if (typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(input.id)) p.push('id must be a non-empty identifier');
  if (typeof input.profile !== 'string') p.push('profile must be a string');
  const f = input.frame;
  if (!isObj(f) || !isNum(f.width) || !isNum(f.height) || f.width <= 0 || f.height <= 0) p.push('frame.width/height must be positive numbers');
  const pv = input.pivot;
  if (!isObj(pv) || !isNum(pv.x) || !isNum(pv.y)) p.push('pivot.x/y must be numbers');
  else if (isObj(f) && isNum(f.width) && isNum(f.height) && (pv.x < 0 || pv.x > f.width || pv.y < 0 || pv.y > f.height)) p.push('pivot lies outside the frame');
  const a = input.atlas;
  if (!isObj(a) || typeof a.image !== 'string' || typeof a.data !== 'string') p.push('atlas.image and atlas.data must be strings');
  if (!isObj(input.animations) || Object.keys(input.animations).length === 0) {
    p.push('animations must be a non-empty object');
    return p;
  }
  for (const [key, raw] of Object.entries(input.animations)) {
    const w = `animations.${key}`;
    if (!isObj(raw)) { p.push(`${w} must be an object`); continue; }
    if (!isNum(raw.frames) || !Number.isInteger(raw.frames) || raw.frames < 1) p.push(`${w}.frames must be an integer >= 1`);
    if (!isNum(raw.fps) || raw.fps <= 0) p.push(`${w}.fps must be > 0`);
    if (typeof raw.loop !== 'boolean') p.push(`${w}.loop must be boolean`);
    if (!Array.isArray(raw.directions) || raw.directions.length === 0) p.push(`${w}.directions must be a non-empty array`);
    else for (const d of raw.directions) if (!DIRECTIONS_8.includes(d as Direction8)) p.push(`${w}.directions contains invalid "${String(d)}"`);
    if (Array.isArray(raw.events)) {
      for (const e of raw.events) {
        if (!isObj(e) || !isNum(e.frame) || typeof e.name !== 'string') p.push(`${w}.events entries need frame and name`);
        else if (isNum(raw.frames) && (e.frame < 0 || e.frame >= raw.frames)) p.push(`${w}.events "${e.name}" frame ${e.frame} out of range`);
      }
    }
    if (Array.isArray(raw.frameDurations) && isNum(raw.frames) && raw.frameDurations.length !== raw.frames) p.push(`${w}.frameDurations length must equal frames`);
    if (isObj(raw.footMarkers) && isNum(raw.frames)) {
      for (const [d, perFrame] of Object.entries(raw.footMarkers)) {
        if (!Array.isArray(perFrame) || perFrame.length !== raw.frames) p.push(`${w}.footMarkers.${d} must have one entry per frame`);
      }
    }
  }
  return p;
}

export function parseManifest(input: unknown): CharacterManifest {
  const problems = validateManifest(input);
  if (problems.length) throw new ManifestError(problems);
  return input as CharacterManifest;
}

export function manifestToDefinitions(m: CharacterManifest): AnimationDefinition[] {
  return Object.entries(m.animations).map(([key, a]) => ({
    key,
    frames: a.frames,
    fps: a.fps,
    loop: a.loop,
    directions: a.directions,
    events: a.events,
    cycleTravel: a.cycleTravel,
    footMarkers: a.footMarkers,
    frameDurations: a.frameDurations,
  }));
}

export function buildRegistry(m: CharacterManifest, logger?: Logger): AnimationRegistry {
  const profile = PROFILES[m.profile];
  const reg = new AnimationRegistry({ profile: profile ?? 'humanoid', logger });
  if (!profile) logger?.warn(`Unknown profile "${m.profile}", using humanoid`);
  reg.registerAll(manifestToDefinitions(m));
  const missing = reg.missingRequired();
  if (missing.length) logger?.warn(`Character "${m.id}" lacks required animations for profile ${reg.profile.id}: ${missing.join(', ')}`);
  return reg;
}

export function atlasFrameName(anim: string, dir: Direction8, index: number): string {
  return `${anim}/${dir}/${index}`;
}

/** Every atlas frame name implied by a manifest, used to verify atlas integrity. */
export function expectedFrameNames(m: CharacterManifest): string[] {
  const out: string[] = [];
  for (const [key, a] of Object.entries(m.animations)) for (const d of a.directions) for (let i = 0; i < a.frames; i++) out.push(atlasFrameName(key, d, i));
  return out;
}
