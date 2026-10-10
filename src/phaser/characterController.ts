import type Phaser from 'phaser';
import {
  DirectionResolver, FootAnchorController, IsometricAnimationController, MovementController, silentLogger,
  type AnimationEventName, type AnimationEventPayload, type CollisionAdapter, type FrameOutput, type IsoProjection,
  type Logger, type MovementOptions, type PathfindingAdapter, type StateId, type Vec2,
} from '../core/index.js';
import { buildRegistry, type CharacterManifest } from '../pipeline/manifest.js';
import { KeyboardInput, type KeyboardInputOptions } from './input.js';

export type SyncMode = 'synced' | 'naive';

export interface CharacterControllerOptions {
  scene: Phaser.Scene;
  manifest: CharacterManifest;
  projection: IsoProjection;
  start: Vec2;
  movement: Omit<MovementOptions, 'collision' | 'pathfinding'>;
  collision?: CollisionAdapter;
  pathfinding?: PathfindingAdapter;
  keyboard?: boolean | KeyboardInputOptions;
  /** Round the sprite position to whole pixels (avoids sub-pixel shimmer). Default true. */
  pixelSnap?: boolean;
  /** `naive` reproduces the legacy behaviour (no foot sync, no acceleration) for A/B comparison. */
  syncMode?: SyncMode;
  logger?: Logger;
  depthLayer?: number;
}

/**
 * Glue between the engine-agnostic core and a Phaser sprite. It owns: the sprite, its
 * shadow, movement, direction resolution, the animation controller and foot anchoring.
 * Call `update(time, delta)` from the scene's update(); call `destroy()` on shutdown.
 */
export class IsometricCharacterController {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Ellipse;
  readonly movement: MovementController;
  readonly animation: IsometricAnimationController;
  readonly resolver: DirectionResolver;
  readonly anchor: FootAnchorController;
  readonly manifest: CharacterManifest;
  syncMode: SyncMode;
  /** Playback speed multiplier for demos/slow-motion. */
  timeScale = 1;
  last?: FrameOutput;

  private readonly scene: Phaser.Scene;
  private readonly projection: IsoProjection;
  private readonly keyboard?: KeyboardInput;
  private readonly depthLayer: number;
  private readonly pixelSnap: boolean;
  private readonly log: Logger;
  private readonly offs: Array<() => void> = [];
  private destroyed = false;
  /** Signature of the keys held when a click-move started (they must not cancel it). */
  private heldAtClick = '';
  /** Debug/demo hook: freeze logic and play a specific animation. */
  preview?: { anim: string; dir: import('../core/types.js').Direction8 };

  constructor(o: CharacterControllerOptions) {
    this.scene = o.scene;
    this.projection = o.projection;
    this.manifest = o.manifest;
    this.log = o.logger ?? silentLogger;
    this.syncMode = o.syncMode ?? 'synced';
    this.depthLayer = o.depthLayer ?? 0;
    this.pixelSnap = o.pixelSnap ?? true;

    const registry = buildRegistry(o.manifest, this.log);
    this.animation = new IsometricAnimationController({ registry, logger: this.log });
    this.resolver = new DirectionResolver({ projection: o.projection });
    this.anchor = new FootAnchorController({ pivot: o.manifest.pivot }, this.pixelSnap);
    this.movement = new MovementController(o.start, { ...o.movement, collision: o.collision, pathfinding: o.pathfinding });

    const idle = registry.keyForState('IDLE') ?? Object.keys(o.manifest.animations)[0] ?? 'idle';
    const first = registry.resolve(idle, 'S');
    const frameName = first ? `${first.fullKey}/0` : undefined;
    this.sprite = o.scene.add.sprite(0, 0, o.manifest.id, frameName);
    const origin = this.anchor.originFor({ x: o.manifest.frame.width, y: o.manifest.frame.height });
    this.sprite.setOrigin(origin.x, origin.y);
    const sh = o.manifest.shadow ?? { rx: o.manifest.frame.width * 0.22, ry: o.manifest.frame.width * 0.11 };
    this.shadow = o.scene.add.ellipse(0, 0, sh.rx * 2, sh.ry * 2, 0x000000, 0.28);

    if (o.keyboard) this.keyboard = new KeyboardInput(o.scene, o.projection, typeof o.keyboard === 'object' ? o.keyboard : {});
    this.movement.on('blocked', () => this.log.info('path blocked'));
    this.update(0, 0);
  }

  // ---- commands ----------------------------------------------------------
  on(ev: AnimationEventName, cb: (p: AnimationEventPayload) => void): void {
    this.offs.push(this.animation.on(ev, cb));
  }

  /** Click-to-move. Uses the pathfinding adapter if provided. Returns false if unreachable. */
  moveTo(world: Vec2, run = false): boolean {
    if (this.animation.state === 'DEATH') return false;
    const ok = this.movement.moveTo(world, run);
    if (ok && this.keyboard) {
      const k = this.keyboard.read();
      this.heldAtClick = k.active ? `${k.world.x.toFixed(3)},${k.world.y.toFixed(3)}` : '';
    }
    return ok;
  }

  attack(direction?: import('../core/types.js').Direction8): boolean { return this.act('ATTACK', direction); }
  cast(direction?: import('../core/types.js').Direction8): boolean { return this.act('CAST', direction); }
  hit(): boolean { return this.act('HIT'); }

  private act(state: StateId, dir?: import('../core/types.js').Direction8): boolean {
    const ok = this.animation.requestAction(state, { direction: dir });
    if (ok) this.movement.rooted = state !== 'HIT' ? true : this.movement.rooted;
    return ok;
  }

  die(): boolean {
    const ok = this.animation.die();
    if (ok) this.movement.halt();
    return ok;
  }

  respawn(at?: Vec2): void {
    if (at) this.movement.teleport(at);
    this.movement.rooted = false;
    this.animation.respawn();
  }

  get world(): Vec2 { return this.movement.position; }
  get screen(): Vec2 { return this.projection.worldToScreen(this.movement.position); }

  // ---- frame update -------------------------------------------------------
  update(_time: number, deltaMs: number): FrameOutput {
    const dt = deltaMs * this.timeScale;
    if (this.keyboard && !this.preview && this.animation.state !== 'DEATH') {
      const k = this.keyboard.read();
      const sig = k.active ? `${k.world.x.toFixed(3)},${k.world.y.toFixed(3)}` : '';
      if (!k.active) {
        this.heldAtClick = '';
        if (this.movement.mode === 'input') this.movement.setInput({ x: 0, y: 0 });
      } else if (this.movement.mode === 'path' && sig === this.heldAtClick) {
        // keys already held when the click happened do not cancel it; a new key press does
      } else {
        this.heldAtClick = '';
        this.movement.setInput(k.world, k.run);
      }
    }
    // Attacks root the character; release when back to a non-action state.
    const st = this.animation.state;
    if (this.movement.rooted && st !== 'ATTACK' && st !== 'CAST') this.movement.rooted = false;

    if (this.syncMode === 'naive') this.movement.velocity = this.naiveVelocity();
    this.movement.update(dt);

    const v = this.movement.velocity;
    const sv = this.projection.worldDeltaToScreen(v);
    const screenSpeed = Math.hypot(sv.x, sv.y);
    const dir = this.resolver.fromWorldVector(v, this.animation.facing);
    this.animation.setMotion({ screenSpeed, direction: screenSpeed > 1 ? dir : undefined, running: this.movement.running });
    if (screenSpeed > 1 && dir && st !== 'ATTACK' && st !== 'CAST' && st !== 'HIT' && st !== 'DEATH') this.animation.face(dir);

    let out: FrameOutput;
    if (this.preview) {
      out = this.previewFrame(dt);
    } else {
      this.animation.syncEnabled = this.syncMode === 'synced';
      out = this.animation.update(dt);
    }
    this.apply(out);
    this.last = out;
    return out;
  }

  /** Legacy-style movement: constant speed, instant start/stop (for A/B comparison). */
  private naiveVelocity(): Vec2 {
    const m = this.movement;
    if (m.mode === 'idle') return { x: 0, y: 0 };
    const target = m.mode === 'path' ? m.remainingPath[0] : undefined;
    const max = m.running ? m.opts.runSpeed : m.opts.walkSpeed;
    if (target) {
      const dx = target.x - m.position.x, dy = target.y - m.position.y, d = Math.hypot(dx, dy) || 1;
      return { x: (dx / d) * max, y: (dy / d) * max };
    }
    const v = m.velocity; const l = Math.hypot(v.x, v.y) || 1;
    return { x: (v.x / l) * max, y: (v.y / l) * max };
  }

  private previewState = { anim: '', dir: '', frame: 0, t: 0 };
  private previewFrame(dt: number): FrameOutput {
    const p = this.preview!;
    const reg = this.animation.registry;
    const res = reg.resolve(p.anim, p.dir);
    const def = res?.def;
    const s = this.previewState;
    if (s.anim !== p.anim || s.dir !== p.dir) { s.anim = p.anim; s.dir = p.dir; if (!def || s.frame >= def.frames) s.frame = 0; }
    if (def) {
      s.t += dt / 1000;
      const dur = 1 / def.fps;
      while (s.t >= dur) { s.t -= dur; s.frame = def.loop ? (s.frame + 1) % def.frames : Math.min(def.frames - 1, s.frame + 1); }
    }
    return {
      state: 'IDLE', animKey: p.anim, fullKey: res?.fullKey ?? `${p.anim}/${p.dir}`, direction: res?.direction ?? p.dir,
      frameIndex: s.frame, flipX: res?.flipX ?? false, rate: 1, syncClamped: false,
    };
  }

  private apply(out: FrameOutput): void {
    const ground = this.projection.worldToScreen(this.movement.position);
    const pos = this.anchor.spritePosition(ground);
    this.sprite.setPosition(pos.x, pos.y);
    const frame = `${out.fullKey}/${out.frameIndex}`;
    if (this.sprite.frame.name !== frame) {
      if (this.scene.textures.getFrame(this.manifest.id, frame)) this.sprite.setFrame(frame);
      else this.log.warn(`Missing atlas frame ${frame}`);
    }
    this.sprite.setFlipX(out.flipX);
    const sh = this.anchor.shadowPosition(ground);
    this.shadow.setPosition(sh.x, sh.y);
    const depth = this.projection.depthOf(this.movement.position, { layer: this.depthLayer });
    this.sprite.setDepth(depth + 0.5);
    this.shadow.setDepth(depth);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.offs.forEach((f) => f());
    this.offs.length = 0;
    this.keyboard?.destroy(this.scene);
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
