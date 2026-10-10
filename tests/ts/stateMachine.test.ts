import { describe, it, expect } from 'vitest';
import { AnimationStateMachine } from '../../src/core/index.js';

describe('AnimationStateMachine', () => {
  it('walks and returns to idle', () => {
    const sm = new AnimationStateMachine();
    expect(sm.request('WALK')).toBe('accepted');
    expect(sm.request('IDLE')).toBe('accepted');
  });
  it('ignores redundant requests', () => {
    const sm = new AnimationStateMachine();
    expect(sm.request('IDLE')).toBe('ignored');
  });
  it('attack interrupts walk; walk cannot interrupt attack', () => {
    const sm = new AnimationStateMachine();
    sm.request('WALK');
    expect(sm.request('ATTACK')).toBe('accepted');
    expect(sm.request('WALK')).toBe('rejected');
    expect(sm.request('IDLE')).toBe('rejected');
  });
  it('hit interrupts attack, then recovers to idle', () => {
    const sm = new AnimationStateMachine();
    sm.request('ATTACK');
    expect(sm.request('HIT')).toBe('accepted');
    sm.complete();
    expect(sm.state).toBe('IDLE');
  });
  it('hit is restartable', () => {
    const sm = new AnimationStateMachine();
    sm.request('HIT');
    expect(sm.request('HIT')).toBe('accepted');
  });
  it('queues a request and applies it when the action finishes', () => {
    const sm = new AnimationStateMachine();
    sm.request('ATTACK');
    expect(sm.request('CAST', { queue: true })).toBe('rejected');
    expect(sm.queuedState).toBe('CAST');
    sm.complete();
    expect(sm.state).toBe('CAST');
  });
  it('death is terminal and uninterruptible', () => {
    const sm = new AnimationStateMachine();
    sm.request('ATTACK');
    expect(sm.request('DEATH')).toBe('accepted');
    for (const s of ['IDLE', 'WALK', 'ATTACK', 'HIT']) expect(sm.request(s)).toBe('rejected');
    sm.complete();
    expect(sm.state).toBe('DEATH');
    sm.force('IDLE');
    expect(sm.state).toBe('IDLE');
  });
  it('unknown states are rejected, force throws', () => {
    const sm = new AnimationStateMachine();
    expect(sm.request('FLY')).toBe('rejected');
    expect(() => sm.force('FLY')).toThrow();
    expect(() => new AnimationStateMachine({ initial: 'NOPE' })).toThrow();
  });
  it('timeout watchdog completes stuck one-shots', () => {
    const sm = new AnimationStateMachine({ states: { ATTACK: { priority: 3, oneShot: true, next: 'IDLE', timeoutMs: 500 } } });
    sm.request('ATTACK');
    sm.update(499);
    expect(sm.state).toBe('ATTACK');
    sm.update(2);
    expect(sm.state).toBe('IDLE');
  });
  it('supports custom states and transition tables', () => {
    const log: string[] = [];
    const sm = new AnimationStateMachine({
      states: { DASH: { priority: 1, oneShot: true } },
      onTransition: (t) => log.push(`${t.from}>${t.to}:${t.reason}`),
    });
    sm.request('DASH');
    sm.complete();
    expect(log).toEqual(['IDLE>DASH:request', 'DASH>IDLE:complete']);
  });
});
