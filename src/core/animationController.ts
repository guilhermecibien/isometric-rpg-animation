import type { Direction8, Logger } from './types.js';
import { silentLogger } from './types.js';
import { AnimationStateMachine, type StateId, type StateTable } from './stateMachine.js';
import { AnimationRegistry, type ResolvedAnimation } from './animationRegistry.js';
import { DirectionResolver } from './directions.js';
import { syncRate, type PlaybackRange } from './footSync.js';

export interface MotionInput {
  /** Current ground speed on screen in px/s. */
  screenSpeed: number;
  /** Desired facing from movement (undefined keeps the last one). */
  direction?: Direction8;
  running?: boolean;
}

export interface FrameOutput {
  state: StateId;
  animKey: string;
  fullKey: string;
  direction: Direction8;
  frameIndex: number;
  flipX: boolean;
  /** Playback rate applied this tick (1 = nominal fps). */
  rate: number;
  /** True when ground speed fell outside the sync range (foot sliding likely). */
  syncClamped: boolean;
}

export type AnimationEventName = 'frameEvent' | 'stateChange' | 'actionComplete' | 'missingAnimation';
export interface AnimationEventPayload {
  name: string;
  animKey?: string;
  frame?: number;
  from?: StateId;
  to?: StateId;
  state?: StateId;
}

export interface AnimationControllerOptions {
  registry: AnimationRegistry;
  states?: StateTable;
  initialDirection?: Direction8;
  syncRange?: PlaybackRange;
  /** Ground speed (px/s) below which the character counts as standing. */
  moveThreshold?: number;
  /** Minimum direction change (45° steps) at rest that triggers a TURN animation. */
  turnMinSteps?: number;
  logger?: Logger;
}

const ACTION_STATES: StateId[] = ['ATTACK', 'CAST', 'HIT', 'DEATH'];

/**
 * Engine-agnostic animation driver: chooses animation + direction + frame + playback
 * rate each tick from the character's motion and action requests.
 */
export class IsometricAnimationController {
  readonly sm: AnimationStateMachine;
  readonly registry: AnimationRegistry;
  private readonly log: Logger;
  private readonly range?: PlaybackRange;
  private readonly moveThreshold: number;
  private readonly turnMinSteps: number;

  private direction: Direction8;
  private turnTarget?: Direction8;
  private animKey = 'idle';
  private frameIndex = 0;
  private frameTime = 0; // seconds into the current frame (rate-scaled)
  private lastRate = 1;
  private syncClamped = false;
  private actionAnim?: string;
  private deathDone = false;
  private listeners = new Map<AnimationEventName, Array<(p: AnimationEventPayload) => void>>();
  private motion: MotionInput = { screenSpeed: 0 };
  /** When false, walk/run always play at nominal fps (legacy behaviour). */
  syncEnabled = true;

  constructor(opts: AnimationControllerOptions) {
    this.registry = opts.registry;
    this.log = opts.logger ?? silentLogger;
    this.range = opts.syncRange;
    this.moveThreshold = opts.moveThreshold ?? 4;
    this.turnMinSteps = opts.turnMinSteps ?? 3;
    this.direction = opts.initialDirection ?? 'S';
    this.sm = new AnimationStateMachine({
      states: opts.states,
      onTransition: (t) => this.emit('stateChange', { name: 'stateChange', from: t.from, to: t.to }),
    });
    this.enterAnimation(this.registry.keyForState('IDLE') ?? 'idle');
  }

  on(ev: AnimationEventName, cb: (p: AnimationEventPayload) => void): () => void {
    const l = this.listeners.get(ev) ?? [];
    l.push(cb);
    this.listeners.set(ev, l);
    return () => this.listeners.set(ev, (this.listeners.get(ev) ?? []).filter((f) => f !== cb));
  }

  private emit(ev: AnimationEventName, p: AnimationEventPayload): void {
    for (const cb of this.listeners.get(ev) ?? []) cb(p);
  }

  get state(): StateId { return this.sm.state; }
  get facing(): Direction8 { return this.direction; }

  /** Set the facing explicitly (ignored while an action locks the direction). */
  face(d: Direction8): void {
    if (this.isActionState()) return;
    this.direction = d;
  }

  setMotion(m: MotionInput): void { this.motion = m; }

  /**
   * Request an action (ATTACK, CAST, HIT…). Missing animations are reported and the
   * request is rejected rather than leaving the character stuck.
   */
  requestAction(state: StateId, opts: { queue?: boolean; direction?: Direction8; animKey?: string } = {}): boolean {
    const key = opts.animKey && this.registry.has(opts.animKey) ? opts.animKey : this.registry.keyForState(state);
    if (!key) {
      this.emit('missingAnimation', { name: 'missingAnimation', state });
      return false;
    }
    if (opts.direction && !this.isActionState()) this.direction = opts.direction;
    const outcome = this.sm.request(state, { queue: opts.queue });
    if (outcome !== 'accepted') return false;
    this.turnTarget = undefined;
    this.actionAnim = key;
    this.enterAnimation(key, 0);
    return true;
  }

  /** Kill: death plays once and holds the last frame. */
  die(): boolean { return this.requestAction('DEATH'); }

  /** Respawn: back to idle (optionally through a spawn animation). */
  respawn(): void {
    this.deathDone = false;
    this.actionAnim = undefined;
    this.sm.force('IDLE');
    this.enterAnimation(this.registry.keyForState('IDLE') ?? 'idle');
  }

  private isActionState(): boolean { return ACTION_STATES.includes(this.sm.state); }

  update(dtMs: number): FrameOutput {
    const dt = dtMs / 1000;
    this.sm.update(dtMs);
    if (!this.isActionState()) this.updateLocomotion();
    const rate = this.computeRate();
    this.advance(dt * rate);
    return this.output(rate);
  }

  // ---- locomotion -------------------------------------------------------
  private updateLocomotion(): void {
    const m = this.motion;
    const moving = m.screenSpeed > this.moveThreshold;
    const st = this.sm.state;
    const wantKey = m.running ? 'RUN' : 'WALK';

    if (moving && m.direction && m.direction !== this.direction) {
      this.direction = m.direction;
      this.turnTarget = undefined;
    }

    if (moving) {
      this.turnTarget = undefined;
      if (st === 'IDLE' || st === 'STOP_WALK' || st === 'TURN') {
        const start = st === 'IDLE' && this.registry.keyForState('START_WALK');
        if (start) { this.sm.force('START_WALK'); this.enterAnimation(start, 0); }
        else this.goLocomotion(wantKey, 0);
      } else if ((st === 'WALK' || st === 'RUN') && st !== wantKey) {
        this.goLocomotion(wantKey, 'keep'); // keep phase across walk↔run
      } else if (st === 'WALK' || st === 'RUN') {
        const k = this.registry.keyForState(st);
        if (k && k !== this.animKey) this.enterAnimation(k, 'keep');
      }
      return;
    }

    // not moving
    if (st === 'WALK' || st === 'RUN') {
      const stop = this.registry.keyForState('STOP_WALK');
      if (stop) { this.sm.force('STOP_WALK'); this.enterAnimation(stop, 0); }
      else { this.sm.force('IDLE'); this.enterAnimation(this.registry.keyForState('IDLE') ?? 'idle', 0); }
    } else if (st === 'START_WALK') {
      this.sm.force('IDLE');
      this.enterAnimation(this.registry.keyForState('IDLE') ?? 'idle', 0);
    } else if (st === 'IDLE') {
      this.maybeTurn();
    }
  }

  private maybeTurn(): void {
    const want = this.motion.direction;
    if (!want || want === this.direction) return;
    const steps = Math.abs(DirectionResolver.turnSteps(this.direction, want));
    const turnKey = this.registry.keyForState('TURN');
    if (turnKey && steps >= this.turnMinSteps) {
      this.turnTarget = want;
      this.sm.force('TURN');
      this.enterAnimation(turnKey, 0);
    } else {
      this.direction = want;
    }
  }

  private goLocomotion(state: 'WALK' | 'RUN', phase: number | 'keep'): void {
    const key = this.registry.keyForState(state);
    this.sm.force(state);
    if (key) this.enterAnimation(key, phase);
  }

  // ---- playback ---------------------------------------------------------
  private currentDef() { return this.registry.get(this.animKey); }

  private enterAnimation(key: string, phase: number | 'keep' = 0): void {
    const prev = this.currentDef();
    const next = this.registry.get(key);
    if (!next) return;
    if (phase === 'keep' && prev) {
      const frac = (this.frameIndex + this.frameTime * prev.fps) / prev.frames;
      this.frameIndex = Math.min(next.frames - 1, Math.floor((frac % 1) * next.frames));
    } else {
      this.frameIndex = Math.min(next.frames - 1, Math.floor((phase === 'keep' ? 0 : phase) * next.frames));
    }
    this.frameTime = 0;
    this.animKey = key;
    this.fireFrameEvents(next, this.frameIndex);
  }

  private computeRate(): number {
    const def = this.currentDef();
    const st = this.sm.state;
    this.syncClamped = false;
    if (!this.syncEnabled || !def || (st !== 'WALK' && st !== 'RUN')) { this.lastRate = 1; return 1; }
    const res = syncRate(def, this.resolveDir(def.key), this.motion.screenSpeed, this.range);
    if (!res) { this.lastRate = 1; return 1; }
    this.syncClamped = res.clamped;
    this.lastRate = res.rate;
    return res.rate;
  }

  private resolveDir(key: string): Direction8 {
    return this.registry.resolve(key, this.direction)?.direction ?? this.direction;
  }

  private frameDuration(def: { fps: number; frameDurations?: number[] }, idx: number): number {
    return (def.frameDurations?.[idx] ?? 1) / def.fps;
  }

  private advance(dtScaled: number): void {
    const def = this.currentDef();
    if (!def) return;
    this.frameTime += dtScaled;
    let guard = 0;
    while (guard++ < 64) {
      const dur = this.frameDuration(def, this.frameIndex);
      if (this.frameTime < dur) break;
      this.frameTime -= dur;
      const last = this.frameIndex >= def.frames - 1;
      if (last && !def.loop) {
        this.frameTime = 0;
        this.finishOneShot(def.key);
        return;
      }
      this.frameIndex = last ? 0 : this.frameIndex + 1;
      this.fireFrameEvents(def, this.frameIndex);
    }
  }

  private finishOneShot(key: string): void {
    const st = this.sm.state;
    if (st === 'DEATH') {
      if (!this.deathDone) { this.deathDone = true; this.emit('actionComplete', { name: 'actionComplete', state: st, animKey: key }); }
      return;
    }
    if (!this.sm.config(st).oneShot) return;
    this.emit('actionComplete', { name: 'actionComplete', state: st, animKey: key });
    if (st === 'TURN' && this.turnTarget) { this.direction = this.turnTarget; this.turnTarget = undefined; }
    this.actionAnim = undefined;
    this.sm.complete();
    const ns = this.sm.state;
    const nk = this.registry.keyForState(ns) ?? this.registry.keyForState('IDLE') ?? 'idle';
    if (ACTION_STATES.includes(ns) || ns === 'START_WALK' || ns === 'STOP_WALK' || ns === 'TURN') this.actionAnim = nk;
    this.enterAnimation(nk, 0);
  }

  private fireFrameEvents(def: { key: string; events?: { frame: number; name: string }[] }, frame: number): void {
    for (const e of def.events ?? []) {
      if (e.frame === frame) this.emit('frameEvent', { name: e.name, animKey: def.key, frame });
    }
  }

  private output(rate: number): FrameOutput {
    const def = this.currentDef();
    const key = def?.key ?? this.animKey;
    const res: ResolvedAnimation | undefined = this.registry.resolve(key, this.direction);
    if (!res) this.log.warn(`Cannot resolve ${key}/${this.direction}`);
    return {
      state: this.sm.state,
      animKey: key,
      fullKey: res?.fullKey ?? `${key}/${this.direction}`,
      direction: res?.direction ?? this.direction,
      frameIndex: this.frameIndex,
      flipX: res?.flipX ?? false,
      rate,
      syncClamped: this.syncClamped,
    };
  }
}
