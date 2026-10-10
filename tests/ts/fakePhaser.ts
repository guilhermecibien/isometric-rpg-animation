/** Minimal structural fakes of the Phaser 3 APIs the adapter uses (verified against phaser@3.90 typings via tsc). */
import type Phaser from 'phaser';

type Cb = (...a: unknown[]) => void;

export class Emitter {
  private m = new Map<string, Cb[]>();
  on(e: string, f: Cb) { (this.m.get(e) ?? this.m.set(e, []).get(e)!).push(f); return this; }
  once(e: string, f: Cb) { const w: Cb = (...a) => { this.off(e, w); f(...a); }; return this.on(e, w); }
  off(e: string, f?: Cb) { this.m.set(e, (this.m.get(e) ?? []).filter((x) => x !== f)); return this; }
  emit(e: string, ...a: unknown[]) { for (const f of [...(this.m.get(e) ?? [])]) f(...a); }
  count(e: string) { return (this.m.get(e) ?? []).length; }
}

export class FakeSprite {
  x = 0; y = 0; depth = 0; flipX = false; destroyed = false;
  originX = 0.5; originY = 0.5;
  frame: { name: string };
  constructor(public texture: string, frame?: string) { this.frame = { name: frame ?? '__BASE' }; }
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setOrigin(x: number, y: number) { this.originX = x; this.originY = y; return this; }
  setFrame(f: string) { this.frame = { name: f }; return this; }
  setFlipX(v: boolean) { this.flipX = v; return this; }
  setDepth(d: number) { this.depth = d; return this; }
  destroy() { this.destroyed = true; }
}

export class FakeEllipse extends FakeSprite {
  constructor() { super('ellipse'); }
}

export class FakeKey { isDown = false; }

export interface FakeFiles { [url: string]: unknown }

export class FakeLoader extends Emitter {
  queue: Array<{ type: string; key: string; urls: string[] }> = [];
  constructor(private scene: FakeScene, private files: FakeFiles) { super(); }
  json(key: string, url: string) { this.queue.push({ type: 'json', key, urls: [url] }); }
  atlas(key: string, img: string, data: string) { this.queue.push({ type: 'atlas', key, urls: [img, data] }); }
  start() {
    const q = this.queue; this.queue = [];
    queueMicrotask(() => {
      for (const f of q) {
        const missing = f.urls.find((u) => !(u in this.files));
        if (missing) { this.emit('loaderror', { src: missing, key: f.key }); continue; }
        if (f.type === 'json') this.scene.cache.store.set(f.key, this.files[f.urls[0] as string]);
        else this.scene.textures.add(f.key, (this.files[f.urls[1] as string] as { frames: Array<{ filename: string }> }).frames.map((x) => x.filename));
      }
      this.emit('complete');
    });
  }
}

export class FakeScene {
  cache = { store: new Map<string, unknown>(), json: { get: (k: string) => this.cache.store.get(k), exists: (k: string) => this.cache.store.has(k) } };
  textures = {
    t: new Map<string, string[]>(),
    add: (k: string, frames: string[]) => { this.textures.t.set(k, frames); },
    exists: (k: string) => this.textures.t.has(k),
    get: (k: string) => ({ getFrameNames: () => this.textures.t.get(k) ?? [] }),
    getFrame: (k: string, f: string) => (this.textures.t.get(k)?.includes(f) ? { name: f } : null),
  };
  anims = {
    created: new Map<string, { frames: unknown[]; frameRate: number; repeat: number }>(),
    exists: (k: string) => this.anims.created.has(k),
    create: (cfg: { key: string; frames: unknown[]; frameRate: number; repeat: number }) => { this.anims.created.set(cfg.key, cfg); return cfg; },
  };
  load: FakeLoader;
  sprites: FakeSprite[] = [];
  keys = new Map<string, FakeKey>();
  inputEmitter = new Emitter();
  add = {
    sprite: (_x: number, _y: number, tex: string, frame?: string) => { const s = new FakeSprite(tex, frame); this.sprites.push(s); return s; },
    ellipse: () => { const e = new FakeEllipse(); this.sprites.push(e); return e; },
  };
  input = {
    keyboard: {
      addKeys: (names: string) => { const o: Record<string, FakeKey> = {}; for (const n of names.split(',')) o[n] = this.keys.get(n) ?? this.keys.set(n, new FakeKey()).get(n)!; return o; },
      removeKey: (k: FakeKey) => { for (const [n, v] of this.keys) if (v === k) this.keys.delete(n); },
    },
    on: (e: string, f: Cb) => this.inputEmitter.on(e, f),
    off: (e: string, f: Cb) => this.inputEmitter.off(e, f),
  };
  constructor(files: FakeFiles = {}) { this.load = new FakeLoader(this, files); }
  press(name: string, down = true) { (this.keys.get(name) ?? this.keys.set(name, new FakeKey()).get(name)!).isDown = down; }
  asPhaser(): Phaser.Scene { return this as unknown as Phaser.Scene; }
}
