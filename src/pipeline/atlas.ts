import type { CharacterManifest } from './manifest.js';
import { expectedFrameNames } from './manifest.js';

/** Phaser "JSON Array" atlas (what `this.load.atlas(key, png, json)` consumes). */
export interface PhaserAtlas {
  frames: Array<{
    filename: string;
    frame: { x: number; y: number; w: number; h: number };
    rotated: boolean;
    trimmed: boolean;
    spriteSourceSize: { x: number; y: number; w: number; h: number };
    sourceSize: { w: number; h: number };
  }>;
  meta?: Record<string, unknown>;
}

export interface AtlasCheck {
  missing: string[];
  unexpected: string[];
  outOfBounds: string[];
  duplicates: string[];
}

/** Cross-check an atlas against its manifest (references and bounds). */
export function checkAtlas(atlas: PhaserAtlas, manifest: CharacterManifest, imageSize?: { width: number; height: number }): AtlasCheck {
  const names = atlas.frames.map((f) => f.filename);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const n of names) { if (seen.has(n)) duplicates.push(n); seen.add(n); }
  const expected = new Set(expectedFrameNames(manifest));
  const missing = [...expected].filter((n) => !seen.has(n));
  const unexpected = names.filter((n) => !expected.has(n));
  const outOfBounds = imageSize
    ? atlas.frames.filter((f) => f.frame.x < 0 || f.frame.y < 0 || f.frame.x + f.frame.w > imageSize.width || f.frame.y + f.frame.h > imageSize.height).map((f) => f.filename)
    : [];
  return { missing, unexpected, outOfBounds, duplicates };
}

export function atlasIsClean(c: AtlasCheck): boolean {
  return !c.missing.length && !c.outOfBounds.length && !c.duplicates.length;
}
