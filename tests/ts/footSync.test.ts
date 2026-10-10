import { describe, it, expect } from 'vitest';
import { syncRate, nominalGroundSpeed, measureFootSlide, type FootMarker } from '../../src/core/index.js';
import { makeDef, travel } from './helpers.js';

describe('footSync', () => {
  const walk = makeDef('walk', 8, 10, true, { cycleTravel: travel(64) }); // 64px per 0.8s = 80px/s
  it('computes nominal ground speed from stride and fps', () => {
    expect(nominalGroundSpeed(walk, 'E')).toBeCloseTo(80);
  });
  it('rate 1 at nominal speed, scales proportionally', () => {
    expect(syncRate(walk, 'E', 80)!.rate).toBeCloseTo(1);
    expect(syncRate(walk, 'E', 120)!.rate).toBeCloseTo(1.5);
    expect(syncRate(walk, 'E', 60)!.rate).toBeCloseTo(0.75);
  });
  it('clamps outside the usable range and flags it', () => {
    const hi = syncRate(walk, 'E', 400)!;
    expect(hi.rate).toBe(1.6); expect(hi.clamped).toBe(true);
    const lo = syncRate(walk, 'E', 5)!;
    expect(lo.rate).toBe(0.6); expect(lo.clamped).toBe(true);
  });
  it('returns undefined for in-place animations', () => {
    expect(syncRate(makeDef('idle', 4, 4, true), 'E', 80)).toBeUndefined();
  });
  it('measures zero slide for ideal planted feet and large slide for static feet', () => {
    const n = 4; const travelX = 40; // body moves +40px per loop → 10px per frame
    const ideal: FootMarker[][] = Array.from({ length: n }, (_, i) => [{ id: 'L', x: 20 - i * 10, y: 0, contact: true }]);
    expect(measureFootSlide(ideal, { x: travelX, y: 0 }, false).maxSlide).toBeCloseTo(0);
    const stuck: FootMarker[][] = Array.from({ length: n }, () => [{ id: 'L', x: 0, y: 0, contact: true }]);
    expect(measureFootSlide(stuck, { x: travelX, y: 0 }, false).meanSlide).toBeCloseTo(10);
  });
  it('ignores swing-phase feet', () => {
    const swing: FootMarker[][] = [[{ id: 'L', x: 0, y: 0, contact: false }], [{ id: 'L', x: 50, y: -8, contact: false }]];
    expect(measureFootSlide(swing, { x: 40, y: 0 }, false).samples).toBe(0);
  });
});
