import { describe, it, expect } from 'vitest';
import { IsometricAnimationController, AnimationRegistry, type FrameOutput } from '../../src/core/index.js';
import { humanoidRegistry, makeDef } from './helpers.js';

function mk(reg = humanoidRegistry()) { return new IsometricAnimationController({ registry: reg, initialDirection: 'S' }); }
function tick(c: IsometricAnimationController, ms: number, step = 16): FrameOutput {
  let out!: FrameOutput;
  for (let t = 0; t < ms; t += step) out = c.update(step);
  return out;
}

describe('IsometricAnimationController', () => {
  it('starts idle and loops idle frames', () => {
    const c = mk();
    const o = tick(c, 100);
    expect(o.state).toBe('IDLE'); expect(o.animKey).toBe('idle'); expect(o.fullKey).toBe('idle/S');
  });
  it('idle → start_walk → walk → stop_walk → idle', () => {
    const c = mk();
    const seen: string[] = [];
    c.on('stateChange', (p) => seen.push(`${p.from}>${p.to}`));
    c.setMotion({ screenSpeed: 80, direction: 'E' });
    tick(c, 600);
    expect(c.state).toBe('WALK');
    c.setMotion({ screenSpeed: 0 });
    tick(c, 40);
    expect(c.state).toBe('STOP_WALK');
    tick(c, 600);
    expect(c.state).toBe('IDLE');
    expect(seen).toEqual(['IDLE>START_WALK', 'START_WALK>WALK', 'WALK>STOP_WALK', 'STOP_WALK>IDLE']);
    expect(c.facing).toBe('E');
  });
  it('goes straight idle→walk when no start_walk animation exists, and walk→idle without stop_walk', () => {
    const r = new AnimationRegistry();
    r.registerAll([makeDef('idle', 4, 4, true), makeDef('walk', 8, 10, true)]);
    const c = mk(r);
    c.setMotion({ screenSpeed: 50, direction: 'W' }); tick(c, 40);
    expect(c.state).toBe('WALK');
    c.setMotion({ screenSpeed: 0 }); tick(c, 40);
    expect(c.state).toBe('IDLE');
  });
  it('playback rate follows ground speed (foot sync)', () => {
    const c = mk();
    c.setMotion({ screenSpeed: 80, direction: 'E' }); tick(c, 600);
    expect(tick(c, 16).rate).toBeCloseTo(1, 3);
    c.setMotion({ screenSpeed: 120, direction: 'E' });
    expect(tick(c, 16).rate).toBeCloseTo(1.5, 3);
  });
  it('reports the new state\'s rate on the tick a one-shot hands over to walk', () => {
    const c = mk();
    c.setMotion({ screenSpeed: 120, direction: 'E' });
    let firstWalk: FrameOutput | undefined;
    for (let t = 0; t < 600 && !firstWalk; t += 16) { const o = c.update(16); if (o.state === 'WALK') firstWalk = o; }
    expect(firstWalk!.rate).toBeCloseTo(1.5, 3);
  });
  it('flags clamped sync when moving too fast for the walk cycle', () => {
    const c = mk();
    c.setMotion({ screenSpeed: 300, direction: 'E' }); tick(c, 600);
    expect(tick(c, 16).syncClamped).toBe(true);
  });
  it('switching direction mid-walk keeps the frame phase (no restart stutter)', () => {
    const c = mk();
    c.setMotion({ screenSpeed: 80, direction: 'E' }); tick(c, 700);
    const before = tick(c, 16);
    c.setMotion({ screenSpeed: 80, direction: 'SE' });
    const after = c.update(16);
    expect(after.direction).toBe('SE');
    expect(Math.abs(after.frameIndex - before.frameIndex) % 8).toBeLessThanOrEqual(1);
  });
  it('walk ↔ run preserves cycle phase', () => {
    const c = mk();
    c.setMotion({ screenSpeed: 80, direction: 'E' }); tick(c, 700);
    const a = tick(c, 16);
    c.setMotion({ screenSpeed: 120, direction: 'E', running: true });
    const b = c.update(16);
    expect(b.animKey).toBe('run');
    expect(Math.abs(a.frameIndex - b.frameIndex)).toBeLessThanOrEqual(1);
  });
  it('attack locks direction, blocks locomotion, fires its event, then returns to idle', () => {
    const c = mk();
    const events: string[] = [];
    c.on('frameEvent', (p) => events.push(p.name));
    c.face('N');
    expect(c.requestAction('ATTACK')).toBe(true);
    c.setMotion({ screenSpeed: 80, direction: 'S' });
    c.face('S');
    const o = tick(c, 100);
    expect(o.state).toBe('ATTACK'); expect(o.direction).toBe('N');
    tick(c, 1000);
    expect(events).toContain('hit');
    expect(c.state).toBe('WALK'); // still holding movement input
    c.setMotion({ screenSpeed: 0 });
    tick(c, 700);
    expect(c.state).toBe('IDLE');
  });
  it('emits footstep events from walk frames', () => {
    const c = mk();
    let n = 0;
    c.on('frameEvent', (p) => { if (p.name === 'footstep') n++; });
    c.setMotion({ screenSpeed: 80, direction: 'E' });
    tick(c, 2000);
    expect(n).toBeGreaterThanOrEqual(4);
  });
  it('hit interrupts an attack; death holds and cannot be interrupted', () => {
    const c = mk();
    c.requestAction('ATTACK');
    expect(c.requestAction('HIT')).toBe(true);
    tick(c, 1000);
    expect(c.state).toBe('IDLE');
    let done = 0;
    c.on('actionComplete', (p) => { if (p.state === 'DEATH') done++; });
    expect(c.die()).toBe(true);
    tick(c, 2000);
    const o = tick(c, 16);
    expect(o.state).toBe('DEATH'); expect(o.frameIndex).toBe(4); expect(done).toBe(1);
    c.setMotion({ screenSpeed: 80, direction: 'E' });
    expect(tick(c, 100).state).toBe('DEATH');
    expect(c.requestAction('ATTACK')).toBe(false);
    c.respawn();
    expect(c.state).toBe('IDLE');
  });
  it('reports missing animations instead of getting stuck', () => {
    const r = new AnimationRegistry();
    r.registerAll([makeDef('idle', 4, 4, true), makeDef('walk', 8, 10, true)]);
    const c = mk(r);
    let missing = 0;
    c.on('missingAnimation', () => missing++);
    expect(c.requestAction('CAST')).toBe(false);
    expect(missing).toBe(1);
    expect(c.state).toBe('IDLE');
  });
  it('falls back to a mirrored direction when only one side exists', () => {
    const r = new AnimationRegistry();
    r.registerAll([makeDef('idle', 2, 2, true, { directions: ['S', 'SE', 'E', 'NE', 'N'] })]);
    const o = r.resolve('idle', 'W')!;
    expect(o.direction).toBe('E'); expect(o.flipX).toBe(true);
    expect(r.resolve('idle', 'SW')!.flipX).toBe(true);
  });
  it('plays a TURN animation for 135°+ turns at rest, then faces the new way', () => {
    const c = mk();
    c.setMotion({ screenSpeed: 0, direction: 'N' });
    tick(c, 16);
    expect(c.state).toBe('TURN');
    expect(c.facing).toBe('S');
    tick(c, 400);
    expect(c.state).toBe('IDLE'); expect(c.facing).toBe('N');
  });
  it('small turns at rest are immediate', () => {
    const c = mk();
    c.setMotion({ screenSpeed: 0, direction: 'SE' });
    tick(c, 16);
    expect(c.state).toBe('IDLE'); expect(c.facing).toBe('SE');
  });
  it('variable frame durations are honoured', () => {
    const r = new AnimationRegistry();
    r.registerAll([makeDef('idle', 2, 10, true, { frameDurations: [3, 1] })]);
    const c = mk(r);
    expect(tick(c, 250).frameIndex).toBe(0); // frame 0 lasts 300ms
    expect(tick(c, 100).frameIndex).toBe(1);
  });
});
