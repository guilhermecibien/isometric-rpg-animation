import { describe, it, expect } from 'vitest';
import { DirectionResolver, IsoProjection, DIRECTIONS_8 } from '../../src/core/index.js';

const proj = new IsoProjection({ tileWidth: 64, tileHeight: 32 });
const r = new DirectionResolver({ projection: proj });

describe('DirectionResolver', () => {
  it('does NOT equate cartesian +x with East: +x goes down-right (SE) on screen', () => {
    expect(r.fromWorldVector({ x: 1, y: 0 })).toBe('SE');
    expect(r.fromWorldVector({ x: 0, y: 1 })).toBe('SW');
    expect(r.fromWorldVector({ x: -1, y: 0 })).toBe('NW');
    expect(r.fromWorldVector({ x: 0, y: -1 })).toBe('NE');
  });
  it('screen axes of the grid map to cardinal screen directions', () => {
    expect(r.fromWorldVector({ x: 1, y: 1 })).toBe('S');
    expect(r.fromWorldVector({ x: -1, y: -1 })).toBe('N');
    expect(r.fromWorldVector({ x: 1, y: -1 })).toBe('E');
    expect(r.fromWorldVector({ x: -1, y: 1 })).toBe('W');
  });
  it('respects camera rotation', () => {
    const rr = new DirectionResolver({ projection: new IsoProjection({ tileWidth: 64, tileHeight: 32, cameraRotation: 2 }) });
    expect(rr.fromWorldVector({ x: 1, y: 0 })).toBe('NW');
  });
  it('keeps the previous direction on zero movement', () => {
    expect(r.fromWorldVector({ x: 0, y: 0 }, 'W')).toBe('W');
  });
  it('hysteresis avoids flicker near a boundary', () => {
    const wobble = [{ x: 1, y: 0.62 }, { x: 1, y: 0.55 }, { x: 1, y: 0.62 }, { x: 1, y: 0.5 }];
    const plain = new DirectionResolver({ projection: proj, hysteresis: 0 });
    let prev = r.fromWorldVector(wobble[0]!);
    let changes = 0;
    for (const v of wobble) { const d = r.fromWorldVector(v, prev); if (d !== prev) changes++; prev = d; }
    let prev2 = plain.fromWorldVector(wobble[0]!);
    let changes2 = 0;
    for (const v of wobble) { const d = plain.fromWorldVector(v, prev2); if (d !== prev2) changes2++; prev2 = d; }
    expect(changes).toBeLessThanOrEqual(changes2);
  });
  it('maps to sprite convention', () => {
    const rr = new DirectionResolver({ projection: proj, spriteConvention: { S: 'N', N: 'S' } });
    expect(rr.toSpriteDirection('S')).toBe('N');
    expect(rr.toSpriteDirection('E')).toBe('E');
  });
  it('reduces to 4 directions', () => {
    expect(DirectionResolver.reduceTo4('SE')).toBe('S');
    expect(DirectionResolver.reduceTo4('SE', true)).toBe('E');
    expect(DirectionResolver.reduceTo4('W')).toBe('W');
  });
  it('turn steps take the shortest way around', () => {
    expect(DirectionResolver.turnSteps('S', 'N')).toBe(4);
    expect(Math.abs(DirectionResolver.turnSteps('S', 'SE'))).toBe(1);
    expect(DirectionResolver.rotate('S', 8)).toBe('S');
  });
  it('every direction round-trips through its screen vector', () => {
    for (const d of DIRECTIONS_8) expect(DirectionResolver.fromScreenVector(DirectionResolver.screenVectorOf(d))).toBe(d);
  });
});
