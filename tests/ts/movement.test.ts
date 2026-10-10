import { describe, it, expect } from 'vitest';
import { MovementController, type CollisionAdapter } from '../../src/core/index.js';

const opts = { walkSpeed: 2, runSpeed: 4, acceleration: 20, deceleration: 30 };
function run(m: MovementController, ms: number, step = 16) { for (let t = 0; t < ms; t += step) m.update(step); }

describe('MovementController', () => {
  it('accelerates gradually and reaches walk speed', () => {
    const m = new MovementController({ x: 0, y: 0 }, opts);
    m.setInput({ x: 1, y: 0 });
    m.update(16);
    expect(m.speed).toBeGreaterThan(0);
    expect(m.speed).toBeLessThan(2);
    run(m, 400);
    expect(m.speed).toBeCloseTo(2, 5);
  });
  it('run input uses run speed; diagonal input is normalised', () => {
    const m = new MovementController({ x: 0, y: 0 }, opts);
    m.setInput({ x: 5, y: 5 }, true);
    run(m, 600);
    expect(m.speed).toBeCloseTo(4, 5);
  });
  it('decelerates smoothly instead of stopping dead', () => {
    const m = new MovementController({ x: 0, y: 0 }, opts);
    m.setInput({ x: 1, y: 0 }); run(m, 400);
    m.setInput({ x: 0, y: 0 });
    m.update(16);
    expect(m.speed).toBeGreaterThan(0);
    run(m, 400);
    expect(m.speed).toBe(0);
  });
  it('follows a path and stops on the last waypoint', () => {
    const m = new MovementController({ x: 0, y: 0 }, opts);
    let arrived = 0;
    m.on('arrived', () => arrived++);
    m.followPath([{ x: 2, y: 0 }, { x: 2, y: 2 }]);
    run(m, 5000);
    expect(arrived).toBe(1);
    expect(m.mode).toBe('idle');
    expect(Math.hypot(m.position.x - 2, m.position.y - 2)).toBeLessThan(0.1);
    expect(m.speed).toBe(0);
  });
  it('mixed mode: keyboard input cancels a click path, and a click overrides the keyboard', () => {
    const m = new MovementController({ x: 0, y: 0 }, opts);
    let cancelled = 0;
    m.on('cancelled', () => cancelled++);
    m.followPath([{ x: 10, y: 0 }]);
    expect(m.mode).toBe('path');
    m.setInput({ x: 0, y: 1 });
    expect(m.mode).toBe('input');
    expect(cancelled).toBe(1);
    expect(m.remainingPath.length).toBe(0);
    m.followPath([{ x: 5, y: 5 }]);
    expect(m.mode).toBe('path');
    run(m, 200);
    expect(m.position.x).toBeGreaterThan(0); // moved toward the click target, not straight down
  });
  it('cancel() decays velocity gradually', () => {
    const m = new MovementController({ x: 0, y: 0 }, opts);
    m.followPath([{ x: 20, y: 0 }]); run(m, 500);
    m.cancel();
    expect(m.mode).toBe('idle');
    expect(m.speed).toBeGreaterThan(0);
    run(m, 300);
    expect(m.speed).toBe(0);
  });
  it('halt() stops immediately', () => {
    const m = new MovementController({ x: 0, y: 0 }, opts);
    m.setInput({ x: 1, y: 0 }); run(m, 300);
    m.halt();
    expect(m.speed).toBe(0);
  });
  it('slides along walls', () => {
    const wall: CollisionAdapter = { isWalkable: (x) => x < 1 };
    const m = new MovementController({ x: 0, y: 0 }, { ...opts, collision: wall, bodyRadius: 0 });
    m.setInput({ x: 1, y: 1 });
    run(m, 1000);
    expect(m.position.x).toBeLessThan(1);
    expect(m.position.y).toBeGreaterThan(1);
  });
  it('aborts a path blocked by an obstacle and reports it', () => {
    const wall: CollisionAdapter = { isWalkable: (x) => x < 1 };
    const m = new MovementController({ x: 0, y: 0 }, { ...opts, collision: wall, bodyRadius: 0 });
    let blocked = 0;
    m.on('blocked', () => blocked++);
    m.followPath([{ x: 5, y: 0 }]);
    run(m, 3000);
    expect(blocked).toBe(1);
    expect(m.mode).toBe('idle');
  });
  it('moveTo uses the pathfinding adapter and fails cleanly when unreachable', () => {
    const m = new MovementController({ x: 0, y: 0 }, { ...opts, pathfinding: { findPath: (_f, t) => (t.x > 100 ? null : [{ x: 1, y: 0 }, t]) } });
    expect(m.moveTo({ x: 500, y: 0 })).toBe(false);
    expect(m.mode).toBe('idle');
    expect(m.moveTo({ x: 3, y: 0 })).toBe(true);
    expect(m.remainingPath.length).toBe(2);
  });
  it('rooted characters do not move (attack lock)', () => {
    const m = new MovementController({ x: 0, y: 0 }, opts);
    m.rooted = true; m.setInput({ x: 1, y: 0 });
    run(m, 300);
    expect(m.position.x).toBe(0);
  });
  it('turn rate limits sudden reversals into an arc (no instant flip)', () => {
    const m = new MovementController({ x: 0, y: 0 }, { ...opts, turnRate: Math.PI });
    m.setInput({ x: 1, y: 0 }); run(m, 500);
    m.setInput({ x: -1, y: 0 });
    m.update(16);
    expect(m.velocity.x).toBeGreaterThan(0); // still moving forward-ish, not flipped
  });
  it('clamps huge frame hitches', () => {
    const m = new MovementController({ x: 0, y: 0 }, opts);
    m.setInput({ x: 1, y: 0 });
    m.update(10_000);
    expect(m.position.x).toBeLessThan(0.3);
  });
});
