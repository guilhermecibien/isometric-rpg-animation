import type { Direction8 } from '../core/types.js';

/**
 * Providers are OPTIONAL integrations that can produce animation frames. Nothing in
 * the runtime or the default pipeline requires one; they only define contracts so a
 * project can plug in image-generation APIs, Blender, or its own tooling.
 */
export type ProviderKind = 'procedural' | 'blender' | 'image-model' | 'command' | 'spritesheet';

export interface FrameRequest {
  characterId: string;
  referenceImages: string[];
  animation: string;
  direction: Direction8;
  frames: number;
  frameSize: { width: number; height: number };
  /** Style/identity constraints from character-manifest.analysis.invariants. */
  constraints: string[];
  seed?: number;
}

export interface FrameResult {
  /** Paths of PNG frames, one per requested frame, same canvas size. */
  files: string[];
  /** Provider-reported metadata (model name, seed, cost…). */
  meta?: Record<string, unknown>;
}

export interface AnimationProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  /** Cheap, side-effect-free availability probe (binary exists, key set, etc.). */
  isAvailable(): Promise<{ ok: boolean; reason?: string }>;
  generateFrames(req: FrameRequest): Promise<FrameResult>;
}

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  /** For kind=command: executable + args; `{request}` is replaced by a JSON file path. */
  command?: string[];
  /** Name of an environment variable holding a secret; secrets are never stored in config. */
  apiKeyEnv?: string;
  options?: Record<string, unknown>;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, AnimationProvider>();
  register(p: AnimationProvider): void {
    if (this.providers.has(p.id)) throw new Error(`Provider "${p.id}" already registered`);
    this.providers.set(p.id, p);
  }
  get(id: string): AnimationProvider | undefined { return this.providers.get(id); }
  list(): AnimationProvider[] { return [...this.providers.values()]; }

  /** Providers that report availability, in registration order. Failures are reasons, not exceptions. */
  async available(): Promise<Array<{ id: string; reason?: string; ok: boolean }>> {
    const out: Array<{ id: string; reason?: string; ok: boolean }> = [];
    for (const p of this.providers.values()) {
      try {
        const r = await p.isAvailable();
        out.push({ id: p.id, ...r });
      } catch (e) {
        out.push({ id: p.id, ok: false, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  }
}

export type ProductionPath = 'existing-spritesheet' | 'articulated-2d' | 'blender-3d' | 'image-model';

export interface PathFacts {
  hasSpritesheet: boolean;
  hasRig: boolean;
  blenderAvailable: boolean;
  imageProviderAvailable: boolean;
  /** 0-1: how critical exact fidelity to the reference art is. */
  fidelityNeed: number;
  /** Rough budget in hours the team will spend per character. */
  budgetHours: number;
  /** Whether the reference is a clean, separable-part illustration. */
  partsSeparable: boolean;
}

export interface PathRecommendation {
  path: ProductionPath;
  score: number;
  reasons: string[];
}

/** Ranks the three production paths (+ optional image model) from the facts we know. */
export function recommendPaths(f: PathFacts): PathRecommendation[] {
  const rec: PathRecommendation[] = [];
  rec.push({
    path: 'existing-spritesheet',
    score: f.hasSpritesheet ? 100 : -1,
    reasons: f.hasSpritesheet ? ['Existing sheets preserve the original art exactly; only cleanup/alignment is needed'] : ['No spritesheet available'],
  });
  const art: string[] = [];
  let a = 40 + (f.partsSeparable ? 25 : -15) + (f.hasRig ? 15 : 0) + (f.fidelityNeed > 0.7 ? 10 : 0);
  art.push(f.partsSeparable ? 'Reference can be split into parts: highest fidelity per hour' : 'Parts are not separable: cut-out rigging will need manual redraw');
  if (f.budgetHours < 2) { a -= 20; art.push('Budget under 2h is tight for rigging and posing'); }
  rec.push({ path: 'articulated-2d', score: a, reasons: art });
  const b: string[] = [];
  let bs = f.blenderAvailable ? 45 : -1;
  if (f.blenderAvailable) {
    if (f.fidelityNeed > 0.7) { bs -= 15; b.push('3D re-render rarely matches hand-drawn reference exactly'); }
    if (f.budgetHours >= 6) { bs += 15; b.push('Budget allows modelling and rig; reusable for many directions/animations'); }
    b.push('Eight directions come for free from camera rotation');
  } else b.push('Blender not detected');
  rec.push({ path: 'blender-3d', score: bs, reasons: b });
  rec.push({
    path: 'image-model',
    score: f.imageProviderAvailable ? 30 + (f.fidelityNeed < 0.4 ? 15 : -10) : -1,
    reasons: f.imageProviderAvailable ? ['Frame-to-frame identity drift needs validation and manual correction'] : ['No image provider configured (optional)'],
  });
  return rec.sort((x, y) => y.score - x.score);
}
