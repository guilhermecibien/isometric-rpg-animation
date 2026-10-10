import { AnimationRegistry, DIRECTIONS_8, type AnimationDefinition, type Direction8, type Vec2 } from '../../src/core/index.js';

export function dirsAll(): Direction8[] { return [...DIRECTIONS_8]; }

export function makeDef(key: string, frames: number, fps: number, loop: boolean, extra: Partial<AnimationDefinition> = {}): AnimationDefinition {
  return { key, frames, fps, loop, directions: dirsAll(), ...extra };
}

/** Walk cycle travelling `px` screen pixels per loop in every direction (S: down etc.). */
export function travel(px: number): Partial<Record<Direction8, Vec2>> {
  const out: Partial<Record<Direction8, Vec2>> = {};
  const v: Record<Direction8, Vec2> = {
    S: { x: 0, y: 1 }, SW: { x: -0.7071, y: 0.7071 }, W: { x: -1, y: 0 }, NW: { x: -0.7071, y: -0.7071 },
    N: { x: 0, y: -1 }, NE: { x: 0.7071, y: -0.7071 }, E: { x: 1, y: 0 }, SE: { x: 0.7071, y: 0.7071 },
  };
  for (const d of dirsAll()) out[d] = { x: v[d].x * px, y: v[d].y * px };
  return out;
}

export function humanoidRegistry(): AnimationRegistry {
  const r = new AnimationRegistry({ profile: 'humanoid' });
  r.registerAll([
    makeDef('idle', 4, 4, true),
    makeDef('walk', 8, 10, true, { cycleTravel: travel(64), events: [{ frame: 0, name: 'footstep' }, { frame: 4, name: 'footstep' }] }),
    makeDef('run', 8, 14, true, { cycleTravel: travel(120) }),
    makeDef('start_walk', 3, 12, false),
    makeDef('stop_walk', 3, 12, false),
    makeDef('turn', 3, 12, false),
    makeDef('attack', 6, 12, false, { events: [{ frame: 3, name: 'hit' }] }),
    makeDef('hit', 3, 12, false),
    makeDef('death', 5, 10, false),
  ]);
  return r;
}
