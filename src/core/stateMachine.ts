export type StateId = 'IDLE' | 'START_WALK' | 'WALK' | 'RUN' | 'STOP_WALK' | 'TURN' | 'ATTACK' | 'CAST' | 'HIT' | 'DEATH' | (string & {});

export interface StateConfig {
  /** Higher priority states cannot be interrupted by lower ones. */
  priority: number;
  /** One-shot states finish by themselves (via complete()) and then go to `next`. */
  oneShot?: boolean;
  /** State entered when a one-shot finishes. Default IDLE. */
  next?: StateId;
  /** If true, a request for this state while already in it restarts it. */
  restartable?: boolean;
  /** Explicit allow-list; when omitted, any state of <= priority... see canTransition. */
  allowFrom?: StateId[];
  /** Whether higher-priority requests may interrupt this state mid-way. Default true. */
  interruptible?: boolean;
  /** Max time (ms) before the state is force-completed (watchdog for missing/endless anims). */
  timeoutMs?: number;
}

export type StateTable = Record<string, StateConfig>;

export const DEFAULT_STATES: StateTable = {
  IDLE: { priority: 0 },
  START_WALK: { priority: 1, oneShot: true, next: 'WALK' },
  WALK: { priority: 1 },
  RUN: { priority: 1 },
  STOP_WALK: { priority: 1, oneShot: true, next: 'IDLE' },
  TURN: { priority: 1, oneShot: true, next: 'IDLE' },
  ATTACK: { priority: 3, oneShot: true, next: 'IDLE', interruptible: true },
  CAST: { priority: 3, oneShot: true, next: 'IDLE', interruptible: true },
  HIT: { priority: 4, oneShot: true, next: 'IDLE', restartable: true },
  DEATH: { priority: 10, oneShot: true, interruptible: false, next: 'DEATH' },
};

export interface TransitionInfo {
  from: StateId;
  to: StateId;
  reason: 'request' | 'complete' | 'timeout' | 'forced';
}

export type RequestOutcome = 'accepted' | 'rejected' | 'ignored';

export interface StateMachineOptions {
  states?: StateTable;
  initial?: StateId;
  /** Allowed transitions; when set it overrides the priority rule for non-higher requests. */
  transitions?: Record<string, StateId[]>;
  onTransition?: (t: TransitionInfo) => void;
}

/**
 * Engine-agnostic animation state machine. Rules:
 *  - A request is accepted when the target has strictly higher priority than the
 *    current (interrupt) OR when the current state is not one-shot and the
 *    transition is permitted (e.g. IDLE→WALK, WALK→IDLE).
 *  - Locked states (interruptible=false) reject everything except forced changes.
 *  - Finishing a one-shot goes to its `next`, falling back to IDLE.
 */
export class AnimationStateMachine {
  private readonly states: StateTable;
  private readonly transitions?: Record<string, StateId[]>;
  private readonly onTransition?: (t: TransitionInfo) => void;
  private _state: StateId;
  private _elapsed = 0;
  /** Request made during an uninterruptible/one-shot state, applied once it completes. */
  private queued?: StateId;

  constructor(opts: StateMachineOptions = {}) {
    this.states = { ...DEFAULT_STATES, ...(opts.states ?? {}) };
    this.transitions = opts.transitions;
    this.onTransition = opts.onTransition;
    this._state = opts.initial ?? 'IDLE';
    if (!this.states[this._state]) throw new Error(`Unknown initial state ${this._state}`);
  }

  get state(): StateId { return this._state; }
  get elapsedMs(): number { return this._elapsed; }
  get isDead(): boolean { return this._state === 'DEATH'; }
  get queuedState(): StateId | undefined { return this.queued; }

  config(state: StateId): StateConfig {
    const c = this.states[state];
    if (!c) throw new Error(`Unknown state ${state}`);
    return c;
  }

  canTransition(to: StateId): boolean {
    const cur = this.config(this._state);
    const next = this.states[to];
    if (!next) return false;
    if (to === this._state) return !!next.restartable;
    if (this._state === 'DEATH') return false;
    if (cur.interruptible === false) return false;
    if (next.allowFrom && !next.allowFrom.includes(this._state)) return false;
    if (next.priority > cur.priority) return true;
    if (cur.oneShot) return false;
    if (this.transitions) return (this.transitions[this._state] ?? []).includes(to);
    return next.priority >= cur.priority || to === 'IDLE';
  }

  /** Ask for a state. `queue` keeps a rejected request to run after the current one-shot ends. */
  request(to: StateId, opts: { queue?: boolean } = {}): RequestOutcome {
    if (!this.states[to]) return 'rejected';
    if (to === this._state && !this.config(to).restartable) return 'ignored';
    if (this.canTransition(to)) {
      this.enter(to, 'request');
      return 'accepted';
    }
    if (opts.queue && this.config(this._state).oneShot && this._state !== 'DEATH') this.queued = to;
    return 'rejected';
  }

  /** Called when the current one-shot animation finished playing. */
  complete(): void {
    const cur = this.config(this._state);
    if (!cur.oneShot) return;
    const next = this.queued ?? cur.next ?? 'IDLE';
    this.queued = undefined;
    if (next === this._state) return; // e.g. DEATH stays DEATH
    this.enter(next, 'complete');
  }

  /** Unconditional change (cutscenes, respawn). */
  force(to: StateId): void {
    if (!this.states[to]) throw new Error(`Unknown state ${to}`);
    this.queued = undefined;
    this.enter(to, 'forced');
  }

  update(dtMs: number): void {
    this._elapsed += dtMs;
    const t = this.config(this._state).timeoutMs;
    if (t !== undefined && this._elapsed >= t) {
      const cur = this.config(this._state);
      if (cur.oneShot) {
        const next = this.queued ?? cur.next ?? 'IDLE';
        this.queued = undefined;
        if (next !== this._state) this.enter(next, 'timeout');
      }
    }
  }

  private enter(to: StateId, reason: TransitionInfo['reason']): void {
    const from = this._state;
    this._state = to;
    this._elapsed = 0;
    this.onTransition?.({ from, to, reason });
  }
}
