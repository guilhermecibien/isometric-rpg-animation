import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { IsoProjection, parseManifest, type CharacterManifest } from '../../src/index.js';
import { CharacterAssetLoader, IsometricCharacterController, KeyboardInput, PointerInput, PhaserDepthManager, registerPhaserAnimations } from '../../src/phaser/index.js';
import { FakeScene, FakeSprite } from './fakePhaser.js';

const root = new URL('../../assets/examples/hero/', import.meta.url);
const manifestJson = JSON.parse(readFileSync(new URL('character-manifest.json', root), 'utf8'));
const atlasJson = JSON.parse(readFileSync(new URL('hero.json', root), 'utf8'));
const files = { 'chars/character-manifest.json': manifestJson, 'chars/hero.png': {}, 'chars/hero.json': atlasJson };
const proj = new IsoProjection({ tileWidth: 64, tileHeight: 32, origin: { x: 500, y: 100 } });

async function loaded(): Promise<{ scene: FakeScene; manifest: CharacterManifest }> {
  const scene = new FakeScene(files);
  const manifest = await new CharacterAssetLoader(scene.asPhaser()).load({ id: 'hero', manifestUrl: 'chars/character-manifest.json' });
  return { scene, manifest };
}

function make(scene: FakeScene, manifest: CharacterManifest, extra: Partial<ConstructorParameters<typeof IsometricCharacterController>[0]> = {}) {
  return new IsometricCharacterController({
    scene: scene.asPhaser(), manifest, projection: proj, start: { x: 2.5, y: 2.5 },
    movement: { walkSpeed: 1.375, runSpeed: 3.325, acceleration: 14, deceleration: 18 }, keyboard: true, ...extra,
  });
}
const run = (c: IsometricCharacterController, ms: number) => { for (let t = 0; t < ms; t += 16) c.update(t, 16); };

describe('CharacterAssetLoader', () => {
  it('loads manifest then atlas and verifies every declared frame', async () => {
    const { scene, manifest } = await loaded();
    expect(manifest.id).toBe('hero');
    expect(scene.textures.exists('hero')).toBe(true);
    expect(scene.load.count('loaderror')).toBe(0); // listener removed
  });
  it('returns cached results without reloading', async () => {
    const { scene, manifest } = await loaded();
    const again = await new CharacterAssetLoader(scene.asPhaser()).load({ id: 'hero', manifestUrl: 'chars/character-manifest.json' });
    expect(again.id).toBe(manifest.id);
  });
  it('rejects with a useful message when the manifest is missing', async () => {
    const scene = new FakeScene({});
    await expect(new CharacterAssetLoader(scene.asPhaser()).load({ id: 'x', manifestUrl: 'nope/character-manifest.json' })).rejects.toThrow(/Failed to load manifest.*nope/);
    expect(scene.load.count('loaderror')).toBe(0);
  });
  it('rejects when the atlas files are missing', async () => {
    const scene = new FakeScene({ 'chars/character-manifest.json': manifestJson });
    await expect(new CharacterAssetLoader(scene.asPhaser()).load({ id: 'hero', manifestUrl: 'chars/character-manifest.json' })).rejects.toThrow(/Failed to load atlas files/);
  });
  it('rejects a malformed manifest listing every problem', async () => {
    const bad = { ...manifestJson, pivot: { x: -1, y: 0 }, animations: { walk: { frames: 0, fps: 0, loop: 'x', directions: ['Q'] } } };
    const scene = new FakeScene({ 'chars/character-manifest.json': bad });
    await expect(new CharacterAssetLoader(scene.asPhaser()).load({ id: 'hero', manifestUrl: 'chars/character-manifest.json' })).rejects.toThrow(/pivot lies outside[\s\S]*frames must be[\s\S]*fps must be/);
  });
  it('rejects when the atlas lacks frames the manifest declares', async () => {
    const trimmed = { ...atlasJson, frames: atlasJson.frames.slice(10) };
    const scene = new FakeScene({ ...files, 'chars/hero.json': trimmed });
    await expect(new CharacterAssetLoader(scene.asPhaser()).load({ id: 'hero', manifestUrl: 'chars/character-manifest.json' })).rejects.toThrow(/missing \d+ frame/);
  });
});

describe('registerPhaserAnimations', () => {
  it('creates one animation per animation/direction with correct rate and repeat, idempotently', async () => {
    const { scene, manifest } = await loaded();
    const keys = registerPhaserAnimations(scene.asPhaser(), manifest);
    const expected = Object.values(manifest.animations).reduce((n, a) => n + a.directions.length, 0);
    expect(keys.length).toBe(expected);
    const walk = scene.anims.created.get('hero:walk/E')!;
    expect(walk.frameRate).toBe(10); expect(walk.repeat).toBe(-1); expect(walk.frames.length).toBe(8);
    expect(scene.anims.created.get('hero:attack/E')!.repeat).toBe(0);
    registerPhaserAnimations(scene.asPhaser(), manifest);
    expect(scene.anims.created.size).toBe(expected);
  });
});

describe('IsometricCharacterController (Phaser adapter)', () => {
  it('places the sprite on the projected ground point with the manifest pivot as origin', async () => {
    const { scene, manifest } = await loaded();
    const c = make(scene, manifest);
    const g = proj.worldToScreen({ x: 2.5, y: 2.5 });
    expect(c.sprite.x).toBe(Math.round(g.x)); expect(c.sprite.y).toBe(Math.round(g.y));
    const s = c.sprite as unknown as FakeSprite;
    expect(s.originX).toBeCloseTo(manifest.pivot.x / manifest.frame.width);
    expect(s.originY).toBeCloseTo(manifest.pivot.y / manifest.frame.height);
    expect(s.frame.name).toBe('idle/S/0');
  });
  it('keyboard D moves screen-right; frames come from the walk/E atlas set; synced rate ≈ 1', async () => {
    const { scene, manifest } = await loaded();
    const c = make(scene, manifest);
    scene.press('D');
    run(c, 1200);
    expect(c.last!.direction).toBe('E');
    expect(c.last!.animKey).toBe('walk');
    expect((c.sprite as unknown as FakeSprite).frame.name).toMatch(/^walk\/E\/\d$/);
    expect(c.last!.rate).toBeGreaterThan(0.9); expect(c.last!.rate).toBeLessThan(1.1);
    expect(c.world.x).toBeGreaterThan(3); expect(c.world.y).toBeLessThan(2);
    scene.press('D', false);
    run(c, 800);
    expect(c.animation.state).toBe('IDLE');
  });
  it('sprite screen speed equals the animation stride speed (no sliding) at walk speed', async () => {
    const { scene, manifest } = await loaded();
    const c = make(scene, manifest);
    scene.press('D'); run(c, 1500);
    const before = { x: c.sprite.x, y: c.sprite.y };
    run(c, 1000);
    const dist = Math.hypot(c.sprite.x - before.x, c.sprite.y - before.y);
    const walk = manifest.animations.walk!;
    const ct = walk.cycleTravel!.E!;
    const nominal = (Math.hypot(ct.x, ct.y) * walk.fps) / walk.frames; // px/s at rate 1
    expect(dist / nominal).toBeGreaterThan(0.95); expect(dist / nominal).toBeLessThan(1.05); // ±pixel rounding
  });
  it('naive mode disables sync: rate stays 1 even when speed differs from stride speed', async () => {
    const { scene, manifest } = await loaded();
    const c = make(scene, manifest, { syncMode: 'naive' });
    c.movement.opts.walkSpeed = 3.2;
    scene.press('D'); run(c, 1500);
    expect(c.last!.rate).toBe(1);
    c.syncMode = 'synced';
    run(c, 300);
    expect(c.last!.rate).toBeGreaterThan(1.2);
  });
  it('click path then keyboard: held keys do not cancel, a new press does', async () => {
    const { scene, manifest } = await loaded();
    const c = make(scene, manifest, { pathfinding: { findPath: (_f, t) => [t] } });
    scene.press('A');
    expect(c.moveTo({ x: 6.5, y: 2.5 })).toBe(true);
    run(c, 200);
    expect(c.movement.mode).toBe('path');
    scene.press('A', false); run(c, 50);
    scene.press('W'); run(c, 100);
    expect(c.movement.mode).toBe('input');
  });
  it('attack roots the character and releases it afterwards; death halts and ignores moveTo', async () => {
    const { scene, manifest } = await loaded();
    const c = make(scene, manifest);
    scene.press('D'); run(c, 600);
    expect(c.attack()).toBe(true);
    const x0 = c.world.x;
    run(c, 200);
    expect(c.animation.state).toBe('ATTACK');
    expect(c.movement.speed).toBe(0);
    expect(c.world.x - x0).toBeLessThan(0.3);
    run(c, 1200);
    expect(c.movement.rooted).toBe(false);
    expect(c.die()).toBe(true);
    expect(c.moveTo({ x: 5, y: 5 })).toBe(false);
    run(c, 200);
    expect(c.animation.state).toBe('DEATH');
    c.respawn({ x: 1.5, y: 1.5 });
    expect(c.animation.state).toBe('IDLE');
    expect(c.world).toEqual({ x: 1.5, y: 1.5 });
  });
  it('animation events are delivered and unsubscribed on destroy; destroy cleans up engine objects and keys', async () => {
    const { scene, manifest } = await loaded();
    const c = make(scene, manifest);
    const hits: string[] = [];
    c.on('frameEvent', (p) => hits.push(p.name));
    c.attack(); run(c, 600);
    expect(hits).toContain('hit');
    const sprite = c.sprite as unknown as FakeSprite;
    c.destroy(); c.destroy();
    expect(sprite.destroyed).toBe(true);
    expect(scene.keys.has('D')).toBe(false);
  });
  it('preview mode plays the requested animation/direction irrespective of input', async () => {
    const { scene, manifest } = await loaded();
    const c = make(scene, manifest);
    c.preview = { anim: 'attack', dir: 'NW' };
    scene.press('D'); run(c, 300);
    expect(c.last!.fullKey).toBe('attack/NW');
    expect(c.movement.mode).toBe('idle');
  });
  it('sprite depth follows ground position (front objects drawn later)', async () => {
    const { scene, manifest } = await loaded();
    const c = make(scene, manifest);
    const d0 = c.sprite.depth;
    c.movement.teleport({ x: 6, y: 6 }); c.update(0, 16);
    expect(c.sprite.depth).toBeGreaterThan(d0);
  });
});

describe('KeyboardInput / PointerInput / PhaserDepthManager', () => {
  it('projects screen-space keys to world space; world space passes through', () => {
    const scene = new FakeScene();
    const kb = new KeyboardInput(scene.asPhaser(), proj);
    scene.press('W');
    const w = kb.read();
    expect(w.active).toBe(true);
    expect(proj.worldDeltaToScreen(w.world).y).toBeLessThan(0); // up on screen
    const kb2 = new KeyboardInput(scene.asPhaser(), proj, { space: 'world' });
    expect(kb2.read().world).toEqual({ x: 0, y: -1 });
  });
  it('throws a clear error when the keyboard plugin is unavailable', () => {
    const scene = new FakeScene();
    (scene.input as { keyboard: unknown }).keyboard = null;
    expect(() => new KeyboardInput(scene.asPhaser(), proj)).toThrow(/keyboard is unavailable/);
  });
  it('pointer input converts clicks to world coordinates and detaches', () => {
    const scene = new FakeScene();
    const p = new PointerInput(scene.asPhaser(), proj);
    const got: Array<{ x: number; y: number }> = [];
    p.attach((w) => got.push(w));
    const target = proj.worldToScreen({ x: 4, y: 3 });
    scene.inputEmitter.emit('pointerdown', { worldX: target.x, worldY: target.y, leftButtonDown: () => true, rightButtonDown: () => false });
    scene.inputEmitter.emit('pointerdown', { worldX: 0, worldY: 0, leftButtonDown: () => false, rightButtonDown: () => true });
    expect(got.length).toBe(1);
    expect(got[0]!.x).toBeCloseTo(4); expect(got[0]!.y).toBeCloseTo(3);
    p.detach();
    expect(scene.inputEmitter.count('pointerdown')).toBe(0);
  });
  it('depth manager applies depths in painter order and supports moving objects', () => {
    const dm = new PhaserDepthManager(proj);
    const a = new FakeSprite('a'), b = new FakeSprite('b');
    let bPos = { x: 1, y: 1 };
    dm.track('a', a as never, { x: 3, y: 3 });
    dm.track('b', b as never, () => bPos);
    expect(dm.update()).toEqual(['b', 'a']);
    bPos = { x: 9, y: 9 };
    expect(dm.update()).toEqual(['a', 'b']);
    expect(b.depth).toBeGreaterThan(a.depth);
    dm.untrack('a');
    expect(dm.update()).toEqual(['b']);
  });
});

describe('manifest parsing', () => {
  it('the shipped example manifest is valid', () => {
    expect(parseManifest(manifestJson).animations.walk!.frames).toBe(8);
  });
});
