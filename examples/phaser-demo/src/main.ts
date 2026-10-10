import Phaser from 'phaser';
import { GridPathfinder, IsoProjection, consoleLogger, DIRECTIONS_8, type Direction8 } from '../../../src/index.js';
import {
  CharacterAssetLoader, DebugOverlay, IsometricCharacterController, PhaserDepthManager, PointerInput,
  registerPhaserAnimations, type DebugFlags, type SyncMode,
} from '../../../src/phaser/index.js';
import type { FrameOutput } from '../../../src/index.js';

const COLS = 14, ROWS = 14;
const TILE_W = 64, TILE_H = 32;
const BLOCKED: Array<[number, number, number]> = [[5, 4, 2], [6, 4, 2], [5, 5, 1], [9, 8, 3], [3, 9, 1], [10, 3, 1], [8, 11, 2], [11, 11, 1]];
const blockedSet = new Set(BLOCKED.map(([x, y]) => `${x},${y}`));
const isBlockedCell = (cx: number, cy: number) => blockedSet.has(`${cx},${cy}`);
const inBounds = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS;
const walkableCell = (cx: number, cy: number) => inBounds(cx, cy) && !isBlockedCell(cx, cy);

interface DemoApi {
  getState(): Record<string, unknown>;
  setSync(mode: SyncMode): void;
  worldToScreenPage(x: number, y: number): { x: number; y: number };
  ready: boolean;
}
declare global { interface Window { __demo?: DemoApi } }

class DemoScene extends Phaser.Scene {
  private projection!: IsoProjection;
  private hero!: IsometricCharacterController;
  private overlay!: DebugOverlay;
  private depth!: PhaserDepthManager;
  private pointer!: PointerInput;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private last?: FrameOutput;
  private fpsSmooth = 60;
  private footsteps = 0;

  constructor() { super('demo'); }

  create(): void {
    this.cameras.main.setBackgroundColor('#14181d');
    this.projection = new IsoProjection({ tileWidth: TILE_W, tileHeight: TILE_H, origin: { x: this.scale.width / 2, y: 110 } });
    this.drawFloor();
    this.depth = new PhaserDepthManager(this.projection);
    this.drawBlocks();

    new CharacterAssetLoader(this, consoleLogger).load({ id: 'hero', manifestUrl: 'characters/hero/character-manifest.json' })
      .then((manifest) => {
        registerPhaserAnimations(this, manifest);
        const pf = new GridPathfinder(walkableCell);
        this.hero = new IsometricCharacterController({
          scene: this,
          manifest,
          projection: this.projection,
          start: { x: 2.5, y: 2.5 },
          movement: { walkSpeed: 1.4, runSpeed: 3.3, acceleration: 14, deceleration: 18, turnRate: Math.PI * 4 },
          collision: { isWalkable: (x, y) => walkableCell(Math.floor(x), Math.floor(y)) },
          pathfinding: pf,
          keyboard: true,
          logger: consoleLogger,
        });
        this.hero.on('frameEvent', (p) => { if (p.name === 'footstep') this.footsteps++; });
        this.depth.track('hero', this.hero.sprite, () => this.hero.world);
        this.overlay = new DebugOverlay({ scene: this, projection: this.projection, gridSize: { cols: COLS, rows: ROWS }, isBlocked: isBlockedCell });
        this.pointer = new PointerInput(this, this.projection);
        this.pointer.attach((world) => {
          const c = this.projection.worldToGrid(world);
          if (!walkableCell(c.x, c.y)) return;
          this.hero.moveTo(world, this.keys.SHIFT?.isDown ?? false);
        });
        const kb = this.input.keyboard!;
        this.keys = kb.addKeys('SPACE,E,H,K,R,SHIFT') as Record<string, Phaser.Input.Keyboard.Key>;
        kb.on('keydown-SPACE', () => this.hero.attack());
        kb.on('keydown-E', () => this.hero.cast());
        kb.on('keydown-H', () => this.hero.hit());
        kb.on('keydown-K', () => this.hero.die());
        kb.on('keydown-R', () => this.hero.respawn({ x: 2.5, y: 2.5 }));
        this.bindUi(manifest.animations);
        window.__demo = {
          ready: true,
          getState: () => this.snapshot(),
          setSync: (m) => { this.hero.syncMode = m; },
          worldToScreenPage: (x, y) => this.toPage(x, y),
        };
        this.events.once('shutdown', () => this.shutdown());
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        document.getElementById('status')!.textContent = `Failed to load character:\n${msg}\n\nRun: npm run assets:demo`;
        console.error(e);
      });
  }

  private shutdown(): void {
    this.pointer?.detach();
    this.hero?.destroy();
    this.overlay?.destroy();
    this.depth?.destroy();
  }

  private toPage(wx: number, wy: number): { x: number; y: number } {
    const s = this.projection.worldToScreen({ x: wx, y: wy });
    const rect = this.game.canvas.getBoundingClientRect();
    const sx = rect.width / this.scale.width, sy = rect.height / this.scale.height;
    return { x: rect.left + s.x * sx, y: rect.top + s.y * sy };
  }

  private drawFloor(): void {
    const g = this.add.graphics().setDepth(-1e9);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const pts = [
        this.projection.worldToScreen({ x, y }), this.projection.worldToScreen({ x: x + 1, y }),
        this.projection.worldToScreen({ x: x + 1, y: y + 1 }), this.projection.worldToScreen({ x, y: y + 1 }),
      ];
      g.fillStyle((x + y) % 2 ? 0x3d5a47 : 0x456650, 1);
      g.fillPoints(pts, true);
    }
  }

  private drawBlocks(): void {
    for (const [cx, cy, h] of BLOCKED) {
      const g = this.add.graphics();
      const z = h * 0.8;
      const p = (x: number, y: number, zz: number) => this.projection.worldToScreen({ x, y }, zz);
      const top = [p(cx, cy, z), p(cx + 1, cy, z), p(cx + 1, cy + 1, z), p(cx, cy + 1, z)];
      const right = [p(cx + 1, cy, z), p(cx + 1, cy + 1, z), p(cx + 1, cy + 1, 0), p(cx + 1, cy, 0)];
      const left = [p(cx, cy + 1, z), p(cx + 1, cy + 1, z), p(cx + 1, cy + 1, 0), p(cx, cy + 1, 0)];
      g.fillStyle(0x8a7a66, 1); g.fillPoints(left, true);
      g.fillStyle(0x6e604f, 1); g.fillPoints(right, true);
      g.fillStyle(0xb09c82, 1); g.fillPoints(top, true);
      g.lineStyle(1, 0x2a2118, 0.8); g.strokePoints(top, true);
      // sort by the front-most ground point of the block so characters behind it are hidden
      this.depth.track(`block:${cx},${cy}`, g, { x: cx + 0.5, y: cy + 0.5 });
    }
  }

  private bindUi(anims: Record<string, { directions: string[] }>): void {
    const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    const animSel = $<HTMLSelectElement>('anim'), dirSel = $<HTMLSelectElement>('dir');
    animSel.innerHTML = Object.keys(anims).map((k) => `<option>${k}</option>`).join('');
    dirSel.innerHTML = DIRECTIONS_8.map((d) => `<option>${d}</option>`).join('');
    const apply = () => { if (this.hero.preview) this.hero.preview = { anim: animSel.value, dir: dirSel.value as Direction8 }; };
    animSel.onchange = apply; dirSel.onchange = apply;
    $('preview-on').onclick = () => { this.hero.movement.halt(); this.hero.preview = { anim: animSel.value, dir: dirSel.value as Direction8 }; };
    $('preview-off').onclick = () => { this.hero.preview = undefined; };
    const setSync = (m: SyncMode) => {
      this.hero.syncMode = m;
      $('sync-synced').setAttribute('aria-pressed', String(m === 'synced'));
      $('sync-naive').setAttribute('aria-pressed', String(m === 'naive'));
    };
    $('sync-synced').onclick = () => setSync('synced');
    $('sync-naive').onclick = () => setSync('naive');
    const ts = $<HTMLInputElement>('timescale');
    ts.oninput = () => { this.hero.timeScale = Number(ts.value); $('ts-val').textContent = Number(ts.value).toFixed(2); };
    const ws = $<HTMLInputElement>('walkspeed');
    ws.oninput = () => {
      const v = Number(ws.value);
      this.hero.movement.opts.walkSpeed = v;
      this.hero.movement.opts.runSpeed = v * 2.4;
      $('ws-val').textContent = v.toFixed(1);
    };
    const flags = $('debug-flags');
    (Object.keys(this.overlay.flags) as Array<keyof DebugFlags>).forEach((k) => {
      const l = document.createElement('label');
      const c = document.createElement('input');
      c.type = 'checkbox'; c.checked = this.overlay.flags[k]; c.id = `dbg-${k}`;
      c.onchange = () => { this.overlay.flags[k] = c.checked; };
      l.append(c, k);
      flags.append(l);
    });
  }

  private snapshot(): Record<string, unknown> {
    const o = this.last;
    return {
      state: o?.state, anim: o?.animKey, direction: o?.direction, frame: o?.frameIndex, rate: o?.rate, syncClamped: o?.syncClamped,
      flipX: o?.flipX, world: { ...this.hero.world }, speed: this.hero.movement.speed, mode: this.hero.movement.mode,
      path: this.hero.movement.remainingPath.length, syncMode: this.hero.syncMode, footsteps: this.footsteps,
      preview: !!this.hero.preview, fps: this.fpsSmooth, depth: this.hero.sprite.depth,
    };
  }

  override update(time: number, delta: number): void {
    if (!this.hero) return;
    this.last = this.hero.update(time, delta);
    this.depth.update();
    this.fpsSmooth = this.fpsSmooth * 0.9 + (1000 / Math.max(1, delta)) * 0.1;
    this.overlay.draw(this.hero, this.fpsSmooth);
    const o = this.last;
    document.getElementById('status')!.textContent =
      `state  ${o.state}\nanim   ${o.animKey}/${o.direction}${o.flipX ? ' (flip)' : ''}\nframe  ${o.frameIndex}\nrate   ${o.rate.toFixed(2)}${o.syncClamped ? ' CLAMPED' : ''}\nspeed  ${this.hero.movement.speed.toFixed(2)} u/s\nfps    ${this.fpsSmooth.toFixed(0)}`;
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1000,
  height: 640,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  pixelArt: false,
  scene: [DemoScene],
});
