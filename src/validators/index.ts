import type { CharacterManifest } from '../pipeline/manifest.js';
import { validateManifest } from '../pipeline/manifest.js';
import { PROFILES } from '../core/animationRegistry.js';
import { measureFootSlide, nominalGroundSpeed } from '../core/footSync.js';
import { DIRECTIONS_8 } from '../core/types.js';
import { IsoProjection } from '../core/iso.js';
import { DirectionResolver } from '../core/directions.js';

export type Severity = 'error' | 'warning' | 'info';
/** "objective" checks are measurable facts; "heuristic" ones need human review. */
export type CheckKind = 'objective' | 'heuristic';

export interface Finding {
  id: string;
  severity: Severity;
  kind: CheckKind;
  message: string;
  where?: string;
}

export interface ValidationOptions {
  /** Max tolerated foot slide in px per frame before warning. */
  maxFootSlidePx?: number;
  /** Walk/run speeds in WORLD units (cells) per second that the game will use. */
  gameSpeeds?: { walk?: number; run?: number };
  /** Projection used to turn world speed into screen speed; defaults to manifest.source.projection or 64x32. */
  projection?: { tileWidth: number; tileHeight: number };
}

/** Manifest-level validation: structure, profile completeness, timing, foot contacts. */
export function validateCharacter(m: CharacterManifest, opts: ValidationOptions = {}): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding) => out.push(f);
  for (const p of validateManifest(m)) add({ id: 'manifest.structure', severity: 'error', kind: 'objective', message: p });
  if (out.length) return out;

  const profile = PROFILES[m.profile];
  if (!profile) add({ id: 'profile.unknown', severity: 'warning', kind: 'objective', message: `Unknown profile "${m.profile}"` });
  else {
    for (const k of profile.required) if (!m.animations[k]) add({ id: 'profile.required', severity: 'error', kind: 'objective', message: `Missing required animation "${k}"`, where: k });
    const wanted = profile.directions === 8 ? DIRECTIONS_8 : (['S', 'W', 'N', 'E'] as const);
    for (const [k, a] of Object.entries(m.animations)) {
      const missing = wanted.filter((d) => !a.directions.includes(d));
      if (missing.length) add({ id: 'directions.incomplete', severity: 'warning', kind: 'objective', message: `Animation "${k}" lacks directions ${missing.join(',')} (mirroring/nearest fallback will be used)`, where: k });
    }
  }

  const maxSlide = opts.maxFootSlidePx ?? 1.0;
  for (const [k, a] of Object.entries(m.animations)) {
    if (a.frames / a.fps > 3) add({ id: 'timing.long', severity: 'warning', kind: 'objective', message: `"${k}" lasts ${(a.frames / a.fps).toFixed(2)}s`, where: k });
    if (a.loop && (k === 'death')) add({ id: 'timing.loop', severity: 'warning', kind: 'objective', message: 'death should not loop', where: k });
    if (a.cycleTravel && a.footMarkers) {
      for (const d of a.directions) {
        const ct = a.cycleTravel[d]; const fm = a.footMarkers[d];
        if (!ct || !fm) continue;
        const r = measureFootSlide(fm, ct, a.loop);
        if (r.samples === 0) add({ id: 'foot.nocontacts', severity: 'warning', kind: 'objective', message: `"${k}/${d}" has no planted-foot frames to verify`, where: `${k}/${d}` });
        else if (r.maxSlide > maxSlide) add({ id: 'foot.slide', severity: 'warning', kind: 'objective', message: `"${k}/${d}" foot slide max ${r.maxSlide.toFixed(2)}px/frame (mean ${r.meanSlide.toFixed(2)})`, where: `${k}/${d}` });
      }
    } else if (['walk', 'run'].includes(k)) {
      add({ id: 'foot.nodata', severity: 'info', kind: 'objective', message: `"${k}" has no cycleTravel/footMarkers: playback cannot be foot-synced and slide cannot be measured`, where: k });
    }
  }

  const srcProj = (m.source as { projection?: { tileWidth: number; tileHeight: number } } | undefined)?.projection;
  const proj = new IsoProjection(opts.projection ?? srcProj ?? { tileWidth: 64, tileHeight: 32 });
  for (const [k, speed] of Object.entries(opts.gameSpeeds ?? {})) {
    const a = m.animations[k];
    if (!a || !speed) continue;
    for (const d of a.directions) {
      const nom = nominalGroundSpeed({ key: k, ...a }, d);
      if (!nom) continue;
      // The same world speed covers a different number of screen pixels per direction.
      const w = proj.screenDeltaToWorld(DirectionResolver.screenVectorOf(d));
      const wl = Math.hypot(w.x, w.y);
      const s = proj.worldDeltaToScreen({ x: (w.x / wl) * speed, y: (w.y / wl) * speed });
      const ratio = Math.hypot(s.x, s.y) / nom;
      if (ratio < 0.6 || ratio > 1.6) add({ id: 'speed.range', severity: 'warning', kind: 'objective', message: `Game ${k} speed ${speed} u/s is ${ratio.toFixed(2)}× the stride speed in ${d}; outside the sync range (0.6–1.6×)`, where: `${k}/${d}` });
    }
  }

  add({ id: 'visual.review', severity: 'info', kind: 'heuristic', message: 'Naturalness, weight, anticipation and silhouette readability cannot be verified automatically: review the preview GIFs and the demo.' });
  return out;
}

export function summarize(findings: Finding[]): { errors: number; warnings: number; infos: number; ok: boolean } {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  return { errors, warnings, infos: findings.length - errors - warnings, ok: errors === 0 };
}
