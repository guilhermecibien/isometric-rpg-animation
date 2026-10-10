import type { AnimationDefinition, AnimationKind, Direction8, Logger } from './types.js';
import { DIRECTIONS_8, silentLogger } from './types.js';
import { DirectionResolver } from './directions.js';

export type Anatomy = 'humanoid' | 'quadruped' | 'flying' | 'legless' | 'custom';

export interface AnimationProfile {
  id: string;
  anatomy: Anatomy;
  directions: 4 | 8;
  /** Animations that MUST exist for the profile to be considered complete. */
  required: string[];
  /** Nice-to-have animations; absence only produces a warning. */
  optional: string[];
  /** state → ordered animation keys to try (first existing wins). */
  fallbacks: Record<string, string[]>;
}

const COMMON_FALLBACKS: Record<string, string[]> = {
  IDLE: ['idle'],
  START_WALK: ['start_walk'],
  WALK: ['walk', 'run'],
  RUN: ['run', 'walk'],
  STOP_WALK: ['stop_walk'],
  TURN: ['turn'],
  ATTACK: ['attack', 'special'],
  CAST: ['cast', 'attack'],
  HIT: ['hit', 'take_damage'],
  DEATH: ['death'],
};

export const PROFILES: Record<string, AnimationProfile> = {
  humanoid: {
    id: 'humanoid', anatomy: 'humanoid', directions: 8,
    required: ['idle', 'walk'],
    optional: ['run', 'start_walk', 'stop_walk', 'turn', 'attack', 'attack_combo', 'cast', 'hit', 'knockback', 'death', 'spawn', 'victory', 'special'],
    fallbacks: COMMON_FALLBACKS,
  },
  quadruped: {
    id: 'quadruped', anatomy: 'quadruped', directions: 8,
    required: ['idle', 'walk'],
    optional: ['run', 'attack', 'bite', 'claw', 'charge', 'jump', 'hit', 'death', 'spawn'],
    fallbacks: { ...COMMON_FALLBACKS, ATTACK: ['attack', 'bite', 'claw', 'charge'] },
  },
  flying: {
    id: 'flying', anatomy: 'flying', directions: 8,
    required: ['idle'],
    optional: ['walk', 'attack', 'hit', 'death', 'dive'],
    fallbacks: { ...COMMON_FALLBACKS, WALK: ['fly', 'walk', 'idle'], RUN: ['fly', 'run', 'walk', 'idle'] },
  },
  legless: {
    id: 'legless', anatomy: 'legless', directions: 4,
    required: ['idle'],
    optional: ['move', 'slither', 'attack', 'hit', 'death'],
    fallbacks: { ...COMMON_FALLBACKS, WALK: ['move', 'slither', 'walk', 'idle'], RUN: ['move', 'slither', 'run', 'idle'] },
  },
};

export interface ResolvedAnimation {
  def: AnimationDefinition;
  /** Direction actually used (after fallback / convention mapping). */
  direction: Direction8;
  /** Phaser/animation key, `${key}/${direction}`. */
  fullKey: string;
  flipX: boolean;
}

export function animationFullKey(key: string, dir: Direction8): string {
  return `${key}/${dir}`;
}

/** Direction → mirrored counterpart, used when a sheet only provides one side. */
const MIRROR: Partial<Record<Direction8, Direction8>> = {
  W: 'E', SW: 'SE', NW: 'NE', E: 'W', SE: 'SW', NE: 'NW',
};

export class AnimationRegistry {
  private readonly defs = new Map<string, AnimationDefinition>();
  readonly profile: AnimationProfile;
  private readonly log: Logger;
  private readonly warned = new Set<string>();

  constructor(opts: { profile?: AnimationProfile | string; logger?: Logger } = {}) {
    const p = opts.profile ?? 'humanoid';
    const resolved = typeof p === 'string' ? PROFILES[p] : p;
    if (!resolved) throw new Error(`Unknown profile ${String(p)}`);
    this.profile = resolved;
    this.log = opts.logger ?? silentLogger;
  }

  register(def: AnimationDefinition): void {
    if (def.frames < 1) throw new RangeError(`Animation ${def.key}: frames must be >= 1`);
    if (!(def.fps > 0)) throw new RangeError(`Animation ${def.key}: fps must be > 0`);
    this.defs.set(def.key, def);
  }

  registerAll(defs: AnimationDefinition[]): void {
    defs.forEach((d) => this.register(d));
  }

  has(key: string): boolean { return this.defs.has(key); }
  get(key: string): AnimationDefinition | undefined { return this.defs.get(key); }
  keys(): string[] { return [...this.defs.keys()]; }

  /** Animations required by the profile that are missing. */
  missingRequired(): string[] {
    return this.profile.required.filter((k) => !this.defs.has(k));
  }

  missingOptional(): string[] {
    return this.profile.optional.filter((k) => !this.defs.has(k));
  }

  /** Pick the best animation key for a logical state, honouring profile fallbacks. */
  keyForState(state: string): string | undefined {
    const chain = this.profile.fallbacks[state] ?? [state.toLowerCase()];
    for (const k of chain) if (this.defs.has(k)) return k;
    if (!this.warned.has(state)) {
      this.warned.add(state);
      this.log.warn(`No animation available for state ${state} (tried: ${chain.join(', ')})`);
    }
    return undefined;
  }

  /** Resolve key+direction to something playable: exact → mirror → nearest direction. */
  resolve(key: string, dir: Direction8): ResolvedAnimation | undefined {
    const def = this.defs.get(key);
    if (!def) return undefined;
    if (def.directions.includes(dir)) return { def, direction: dir, fullKey: animationFullKey(key, dir), flipX: false };
    const m = MIRROR[dir];
    if (m && def.directions.includes(m)) return { def, direction: m, fullKey: animationFullKey(key, m), flipX: true };
    // nearest by angular distance
    let best: Direction8 | undefined;
    let bestDist = Infinity;
    for (const d of def.directions) {
      const dist = Math.abs(DirectionResolver.turnSteps(dir, d));
      if (dist < bestDist) { bestDist = dist; best = d; }
    }
    if (!best) return undefined;
    return { def, direction: best, fullKey: animationFullKey(key, best), flipX: false };
  }

  /** Every Phaser-style animation key needed (key/direction). */
  allFullKeys(): string[] {
    const out: string[] = [];
    for (const def of this.defs.values()) for (const d of def.directions) out.push(animationFullKey(def.key, d));
    return out;
  }

  static allDirections(): readonly Direction8[] { return DIRECTIONS_8; }

  static kindOf(key: string): AnimationKind | undefined {
    return key as AnimationKind;
  }
}
