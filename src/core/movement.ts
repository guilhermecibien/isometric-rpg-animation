import type { Vec2 } from './types.js';

export interface CollisionAdapter {
  /** True if a body centred at world (x, y) may stand there. */
  isWalkable(x: number, y: number): boolean;
}

export interface PathfindingAdapter {
  /** World-space waypoints from `from` to `to` (excluding `from`), or null if unreachable. */
  findPath(from: Vec2, to: Vec2): Vec2[] | null;
}

export type MovementMode = 'idle' | 'input' | 'path';

export interface MovementOptions {
  walkSpeed: number;   // world units / s
  runSpeed: number;
  acceleration: number; // world units / s²
  deceleration: number;
  /** Max change of heading (rad/s) for path/keyboard steering; Infinity = instant. */
  turnRate?: number;
  arriveRadius?: number;
  collision?: CollisionAdapter;
  pathfinding?: PathfindingAdapter;
  /** Body probe radius used for collision sliding. */
  bodyRadius?: number;
}

export type MovementEvent = 'arrived' | 'blocked' | 'cancelled' | 'pathStarted';

/**
 * Engine-agnostic kinematic mover in WORLD space. Supports free input (keyboard)
 * and path following; the most recent command wins, so both modes coexist.
 */
export class MovementController {
  position: Vec2;
  velocity: Vec2 = { x: 0, y: 0 };
  mode: MovementMode = 'idle';
  running = false;
  /** When true, desired velocity is forced to zero (attack roots, stun…). */
  rooted = false;
  readonly opts: Required<Pick<MovementOptions, 'walkSpeed' | 'runSpeed' | 'acceleration' | 'deceleration' | 'arriveRadius' | 'bodyRadius'>> & MovementOptions;
  private path: Vec2[] = [];
  private inputDir: Vec2 = { x: 0, y: 0 };
  private listeners = new Map<MovementEvent, Array<() => void>>();
  /** Seconds spent fully blocked; used to abort path following. */
  private blockedFor = 0;

  constructor(start: Vec2, opts: MovementOptions) {
    this.position = { ...start };
    this.opts = { arriveRadius: 0.06, bodyRadius: 0.2, ...opts };
  }

  on(ev: MovementEvent, cb: () => void): () => void {
    const l = this.listeners.get(ev) ?? [];
    l.push(cb);
    this.listeners.set(ev, l);
    return () => this.listeners.set(ev, (this.listeners.get(ev) ?? []).filter((f) => f !== cb));
  }

  private emit(ev: MovementEvent): void {
    for (const cb of this.listeners.get(ev) ?? []) cb();
  }

  get speed(): number { return Math.hypot(this.velocity.x, this.velocity.y); }
  get remainingPath(): readonly Vec2[] { return this.path; }

  /** Free movement: world-space direction (will be normalised). Zero vector releases input. */
  setInput(dir: Vec2, run = false): void {
    const len = Math.hypot(dir.x, dir.y);
    this.running = run;
    if (len < 1e-6) {
      this.inputDir = { x: 0, y: 0 };
      if (this.mode === 'input') this.mode = 'idle';
      return;
    }
    this.inputDir = { x: dir.x / len, y: dir.y / len };
    if (this.mode === 'path') this.cancelPath('cancelled');
    this.mode = 'input';
  }

  followPath(waypoints: Vec2[], run = false): void {
    if (waypoints.length === 0) return;
    this.inputDir = { x: 0, y: 0 };
    this.path = waypoints.map((w) => ({ ...w }));
    this.running = run;
    this.mode = 'path';
    this.emit('pathStarted');
  }

  /** Pathfind with the adapter and follow the result. Returns false if unreachable. */
  moveTo(target: Vec2, run = false): boolean {
    const pf = this.opts.pathfinding;
    const wp = pf ? pf.findPath(this.position, target) : [target];
    if (!wp || wp.length === 0) return false;
    this.followPath(wp, run);
    return true;
  }

  /** Cancel movement; speed decays through normal deceleration (no teleport/pop). */
  cancel(): void {
    if (this.mode === 'path') this.cancelPath('cancelled');
    this.inputDir = { x: 0, y: 0 };
    this.mode = 'idle';
  }

  /** Hard stop (death, teleport). */
  halt(): void {
    this.cancel();
    this.velocity = { x: 0, y: 0 };
  }

  teleport(p: Vec2): void {
    this.position = { ...p };
    this.velocity = { x: 0, y: 0 };
    this.cancel();
  }

  private cancelPath(ev: MovementEvent): void {
    this.path = [];
    this.mode = 'idle';
    this.emit(ev);
  }

  update(dtMs: number): void {
    const dt = Math.min(dtMs, 100) / 1000; // clamp big frame hitches
    if (dt <= 0) return;
    const maxSpeed = this.running ? this.opts.runSpeed : this.opts.walkSpeed;
    let desired: Vec2 = { x: 0, y: 0 };

    if (!this.rooted) {
      if (this.mode === 'input') {
        desired = { x: this.inputDir.x * maxSpeed, y: this.inputDir.y * maxSpeed };
      } else if (this.mode === 'path') {
        desired = this.pathDesired(maxSpeed, dt);
      }
    }

    // Steering limit: rotate current heading toward desired heading at turnRate.
    desired = this.limitTurn(desired, dt);

    const dvx = desired.x - this.velocity.x;
    const dvy = desired.y - this.velocity.y;
    const dv = Math.hypot(dvx, dvy);
    const speeding = Math.hypot(desired.x, desired.y) > 1e-6;
    const a = (speeding ? this.opts.acceleration : this.opts.deceleration) * dt;
    if (dv <= a || dv < 1e-9) this.velocity = desired;
    else this.velocity = { x: this.velocity.x + (dvx / dv) * a, y: this.velocity.y + (dvy / dv) * a };

    this.integrate(dt);
    if (this.mode === 'idle' && this.speed < 1e-4) this.velocity = { x: 0, y: 0 };
  }

  private pathDesired(maxSpeed: number, dt: number): Vec2 {
    let wp = this.path[0];
    while (wp) {
      const dx = wp.x - this.position.x;
      const dy = wp.y - this.position.y;
      const dist = Math.hypot(dx, dy);
      const isLast = this.path.length === 1;
      // Braking distance for the final waypoint so we stop ON it, not past it.
      const brake = isLast ? (this.speed * this.speed) / (2 * this.opts.deceleration) : 0;
      if (dist <= this.opts.arriveRadius || (isLast && dist < this.speed * dt)) {
        this.path.shift();
        if (this.path.length === 0) {
          this.mode = 'idle';
          this.emit('arrived');
          return { x: 0, y: 0 };
        }
        wp = this.path[0];
        continue;
      }
      let target = maxSpeed;
      if (isLast && dist <= brake + this.opts.arriveRadius) target = Math.max(maxSpeed * 0.15, Math.sqrt(2 * this.opts.deceleration * dist));
      target = Math.min(target, maxSpeed);
      return { x: (dx / dist) * target, y: (dy / dist) * target };
    }
    return { x: 0, y: 0 };
  }

  private limitTurn(desired: Vec2, dt: number): Vec2 {
    const rate = this.opts.turnRate;
    const sp = this.speed;
    const dl = Math.hypot(desired.x, desired.y);
    if (rate === undefined || !Number.isFinite(rate) || sp < 0.2 || dl < 1e-6) return desired;
    const cur = Math.atan2(this.velocity.y, this.velocity.x);
    const want = Math.atan2(desired.y, desired.x);
    let diff = want - cur;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const maxStep = rate * dt;
    if (Math.abs(diff) <= maxStep) return desired;
    // Sharp reversals: bleed speed so the turn happens as an arc, not a snap.
    const heading = cur + Math.sign(diff) * maxStep;
    const mag = dl * (Math.abs(diff) > Math.PI * 0.75 ? 0.5 : 1);
    return { x: Math.cos(heading) * mag, y: Math.sin(heading) * mag };
  }

  private walkable(x: number, y: number): boolean {
    const c = this.opts.collision;
    if (!c) return true;
    const r = this.opts.bodyRadius;
    return c.isWalkable(x, y) && c.isWalkable(x + r, y) && c.isWalkable(x - r, y) && c.isWalkable(x, y + r) && c.isWalkable(x, y - r);
  }

  /** Axis-separated integration gives wall sliding for free. */
  private integrate(dt: number): void {
    const nx = this.position.x + this.velocity.x * dt;
    const ny = this.position.y + this.velocity.y * dt;
    let { x, y } = this.position;
    if (this.walkable(nx, y)) x = nx; else this.velocity = { x: 0, y: this.velocity.y };
    if (this.walkable(x, ny)) y = ny; else this.velocity = { x: this.velocity.x, y: 0 };
    const advanced = x !== this.position.x || y !== this.position.y;
    const wanted = nx !== this.position.x || ny !== this.position.y;
    this.position = { x, y };
    if (wanted && !advanced) this.blockedFor += dt; else this.blockedFor = 0;
    if (this.mode === 'path' && this.blockedFor > 0.4) {
      this.blockedFor = 0;
      this.velocity = { x: 0, y: 0 };
      this.cancelPath('blocked');
    }
  }
}
