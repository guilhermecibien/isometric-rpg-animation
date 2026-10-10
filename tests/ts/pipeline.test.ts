import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkAtlas, atlasIsClean, parseManifest, validateManifest, ManifestError, expectedFrameNames, buildRegistry, validateCharacter, summarize, GridPathfinder, MovementController, ProviderRegistry, recommendPaths, type AnimationProvider, type CharacterManifest } from '../../src/index.js';
import { CommandProvider } from '../../src/providers/commandProvider.js';

const root = new URL('../../assets/examples/hero/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('character-manifest.json', root), 'utf8')) as CharacterManifest;
const atlas = JSON.parse(readFileSync(new URL('hero.json', root), 'utf8'));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

describe('atlas ↔ manifest integrity', () => {
  it('shipped atlas matches the manifest exactly and lies inside the image', () => {
    const c = checkAtlas(atlas, manifest, { width: atlas.meta.size.w, height: atlas.meta.size.h });
    expect(atlasIsClean(c)).toBe(true);
    expect(c.unexpected).toEqual([]);
    expect(atlas.frames.length).toBe(expectedFrameNames(manifest).length);
  });
  it('reports missing, duplicate and out-of-bounds frames', () => {
    const a = clone(atlas);
    const removed = a.frames.shift();
    a.frames.push({ ...a.frames[0] });
    a.frames[1].frame.x = 99999;
    const c = checkAtlas(a, manifest, { width: 100, height: 100 });
    expect(c.missing).toContain(removed.filename);
    expect(c.duplicates.length).toBe(1);
    expect(c.outOfBounds.length).toBeGreaterThan(0);
    expect(atlasIsClean(c)).toBe(false);
  });
});

describe('manifest validation', () => {
  it('rejects non-objects and collects all problems', () => {
    expect(validateManifest(null)).toEqual(['manifest must be an object']);
    expect(() => parseManifest({ schemaVersion: 9 })).toThrow(ManifestError);
    try { parseManifest({ schemaVersion: 9, id: '!!' }); } catch (e) { expect((e as ManifestError).problems.length).toBeGreaterThan(3); }
  });
  it('checks footMarkers lengths and frameDurations', () => {
    const m = clone(manifest);
    m.animations.walk!.footMarkers!.E = m.animations.walk!.footMarkers!.E!.slice(1);
    m.animations.idle!.frameDurations = [1];
    const p = validateManifest(m).join('\n');
    expect(p).toContain('footMarkers.E must have one entry per frame');
    expect(p).toContain('frameDurations length');
  });
  it('builds a registry honouring the profile and warns about unknown profiles', () => {
    const warnings: string[] = [];
    const logger = { warn: (m: string) => warnings.push(m), info: () => undefined };
    const m = clone(manifest); m.profile = 'dragon';
    const reg = buildRegistry(m, logger);
    expect(warnings.join()).toContain('Unknown profile "dragon"');
    expect(reg.keyForState('WALK')).toBe('walk');
    expect(reg.keyForState('CAST')).toBe('cast');
    delete m.animations.cast; delete m.animations.attack;
    expect(buildRegistry(m).keyForState('CAST')).toBeUndefined();
  });
});

describe('validators', () => {
  it('shipped character has no errors and no warnings; heuristic review item is always present', () => {
    const f = validateCharacter(manifest, { gameSpeeds: { walk: 1.375, run: 3.325 } });
    expect(summarize(f)).toMatchObject({ errors: 0, warnings: 0, ok: true });
    expect(f.some((x) => x.id === 'visual.review' && x.kind === 'heuristic')).toBe(true);
  });
  it('flags foot slide, missing required animations, and game speeds outside the sync range', () => {
    const m = clone(manifest);
    for (const frame of m.animations.walk!.footMarkers!.S!) for (const mk of frame) { mk.y = 0; mk.contact = true; }
    delete m.animations.idle;
    const f = validateCharacter(m, { gameSpeeds: { walk: 8 } });
    expect(f.some((x) => x.id === 'foot.slide' && x.where === 'walk/S')).toBe(true);
    expect(f.some((x) => x.id === 'profile.required' && x.severity === 'error')).toBe(true);
    expect(f.some((x) => x.id === 'speed.range')).toBe(true);
    expect(summarize(f).ok).toBe(false);
  });
  it('notes when locomotion has no data to verify sync', () => {
    const m = clone(manifest);
    delete m.animations.walk!.cycleTravel; delete m.animations.walk!.footMarkers;
    expect(validateCharacter(m).some((x) => x.id === 'foot.nodata')).toBe(true);
  });
  it('structural errors short-circuit', () => {
    const f = validateCharacter({ ...clone(manifest), frame: { width: 0, height: 0 } });
    expect(f.every((x) => x.id === 'manifest.structure')).toBe(true);
  });
});

describe('GridPathfinder', () => {
  const wall = (x: number, y: number) => x >= 0 && y >= 0 && x < 10 && y < 10 && !(x === 5 && y < 8);
  it('routes around walls, ends on the exact target, never cuts corners', () => {
    const p = new GridPathfinder(wall).findPath({ x: 1.5, y: 1.5 }, { x: 8.2, y: 2.7 })!;
    expect(p.at(-1)).toEqual({ x: 8.2, y: 2.7 });
    expect(p.some((w) => Math.floor(w.x) === 5 && Math.floor(w.y) < 8)).toBe(false);
    let prev = { x: 1, y: 1 };
    for (const w of p) {
      const cx = Math.floor(w.x), cy = Math.floor(w.y);
      if (cx !== prev.x && cy !== prev.y) { expect(wall(cx, prev.y) && wall(prev.x, cy)).toBe(true); }
      prev = { x: cx, y: cy };
    }
  });
  it('returns null for blocked or unreachable goals; trivial path inside a cell', () => {
    const g = new GridPathfinder(wall);
    expect(g.findPath({ x: 1, y: 1 }, { x: 5.5, y: 2.5 })).toBeNull();
    expect(g.findPath({ x: 1, y: 1 }, { x: -3, y: 1 })).toBeNull();
    expect(g.findPath({ x: 1.1, y: 1.1 }, { x: 1.9, y: 1.9 })).toEqual([{ x: 1.9, y: 1.9 }]);
    const closed = new GridPathfinder((x, y) => (x === 0 && y === 0) || (x === 3 && y === 3));
    expect(closed.findPath({ x: 0.5, y: 0.5 }, { x: 3.5, y: 3.5 })).toBeNull();
  });
  it('plugs into MovementController and reaches the goal through obstacles', () => {
    const m = new MovementController({ x: 1.5, y: 1.5 }, { walkSpeed: 3, runSpeed: 5, acceleration: 30, deceleration: 40, pathfinding: new GridPathfinder(wall), collision: { isWalkable: (x, y) => wall(Math.floor(x), Math.floor(y)) }, bodyRadius: 0.1 });
    let arrived = false; m.on('arrived', () => (arrived = true));
    expect(m.moveTo({ x: 8.5, y: 2.5 })).toBe(true);
    for (let t = 0; t < 12000 && !arrived; t += 16) m.update(16);
    expect(arrived).toBe(true);
    expect(Math.hypot(m.position.x - 8.5, m.position.y - 2.5)).toBeLessThan(0.15);
  });
});

describe('providers', () => {
  const fake = (id: string, ok: boolean): AnimationProvider => ({ id, kind: 'command', isAvailable: async () => (ok ? { ok } : { ok, reason: 'no key' }), generateFrames: async () => ({ files: [] }) });
  it('registry rejects duplicates and reports availability without throwing', async () => {
    const r = new ProviderRegistry();
    r.register(fake('a', true)); r.register({ ...fake('b', false), isAvailable: async () => { throw new Error('boom'); } });
    expect(() => r.register(fake('a', true))).toThrow(/already registered/);
    expect(await r.available()).toEqual([{ id: 'a', ok: true }, { id: 'b', ok: false, reason: 'boom' }]);
  });
  it('path recommendation prefers existing sheets, then rigs, and explains', () => {
    const base = { hasSpritesheet: false, hasRig: false, blenderAvailable: false, imageProviderAvailable: false, fidelityNeed: 0.9, budgetHours: 4, partsSeparable: true };
    expect(recommendPaths({ ...base, hasSpritesheet: true })[0]!.path).toBe('existing-spritesheet');
    expect(recommendPaths(base)[0]!.path).toBe('articulated-2d');
    const b3 = recommendPaths({ ...base, partsSeparable: false, blenderAvailable: true, fidelityNeed: 0.3, budgetHours: 10 });
    expect(b3[0]!.path).toBe('blender-3d');
    expect(b3[0]!.reasons.length).toBeGreaterThan(0);
  });
  it('command provider validates config, probes the binary, and runs a tool', async () => {
    expect(() => new CommandProvider({ id: 'x', kind: 'command' })).toThrow(/command is required/);
    expect((await new CommandProvider({ id: 'x', kind: 'command', command: ['definitely-not-a-real-binary-xyz'] }).isAvailable()).ok).toBe(false);
    const script = `const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(JSON.stringify({files:Array.from({length:r.frames},(_,i)=>'f'+i+'.png'),meta:{anim:r.animation}}))`;
    const p = new CommandProvider({ id: 'echo', kind: 'command', command: [process.execPath, '-e', script, '{request}'] });
    expect((await p.isAvailable()).ok).toBe(true);
    const res = await p.generateFrames({ characterId: 'c', referenceImages: [], animation: 'walk', direction: 'E', frames: 3, frameSize: { width: 8, height: 8 }, constraints: [] });
    expect(res.files).toEqual(['f0.png', 'f1.png', 'f2.png']);
    const bad = new CommandProvider({ id: 'bad', kind: 'command', command: [process.execPath, '-e', "console.log('{\"files\":[]}')"] });
    await expect(bad.generateFrames({ characterId: 'c', referenceImages: [], animation: 'walk', direction: 'E', frames: 2, frameSize: { width: 8, height: 8 }, constraints: [] })).rejects.toThrow(/expected 2/);
    const failing = new CommandProvider({ id: 'fail', kind: 'command', command: [process.execPath, '-e', 'process.exit(3)'] });
    await expect(failing.generateFrames({ characterId: 'c', referenceImages: [], animation: 'walk', direction: 'E', frames: 1, frameSize: { width: 8, height: 8 }, constraints: [] })).rejects.toThrow(/exited with 3/);
  });
});
