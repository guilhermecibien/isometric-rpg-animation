import { describe, it, expect } from 'vitest';
import { IsoProjection, type CameraRotation } from '../../src/core/index.js';

describe('IsoProjection', () => {
  const base = { tileWidth: 64, tileHeight: 32 };
  it('projects the axes to the classic 2:1 diamond', () => {
    const p = new IsoProjection(base);
    expect(p.worldToScreen({ x: 1, y: 0 })).toEqual({ x: 32, y: 16 });
    expect(p.worldToScreen({ x: 0, y: 1 })).toEqual({ x: -32, y: 16 });
    expect(p.worldToScreen({ x: 1, y: 1 })).toEqual({ x: 0, y: 32 });
  });
  it('lifts by height without changing x', () => {
    const p = new IsoProjection({ ...base, heightScale: 10 });
    expect(p.worldToScreen({ x: 0, y: 0 }, 2)).toEqual({ x: 0, y: -20 });
  });
  for (const rot of [0, 1, 2, 3] as CameraRotation[]) {
    it(`round-trips screen↔world with camera rotation ${rot}`, () => {
      const p = new IsoProjection({ ...base, cameraRotation: rot, origin: { x: 400, y: 100 }, cellSize: 2 });
      for (const w of [{ x: 3.3, y: -1.2 }, { x: 0, y: 0 }, { x: -7, y: 9.5 }]) {
        const back = p.screenToWorld(p.worldToScreen(w, 1.5), 1.5);
        expect(back.x).toBeCloseTo(w.x, 9);
        expect(back.y).toBeCloseTo(w.y, 9);
      }
    });
  }
  it('rotating the camera rotates which world axis points where', () => {
    const p0 = new IsoProjection(base);
    const p1 = new IsoProjection({ ...base, cameraRotation: 1 });
    const a = p0.worldDeltaToScreen({ x: 1, y: 0 });
    const b = p1.worldDeltaToScreen({ x: 0, y: -1 });
    expect(b.x).toBeCloseTo(a.x); expect(b.y).toBeCloseTo(a.y);
  });
  it('maps grid cells by floor and cell centres', () => {
    const p = new IsoProjection({ ...base, cellSize: 2 });
    expect(p.worldToGrid({ x: 3.9, y: -0.1 })).toEqual({ x: 1, y: -1 });
    expect(p.gridToWorld({ x: 1, y: 1 })).toEqual({ x: 3, y: 3 });
    expect(p.screenToGrid(p.gridToScreen({ x: 4, y: 7 }))).toEqual({ x: 4, y: 7 });
  });
  it('screenDeltaToWorld inverts worldDeltaToScreen', () => {
    const p = new IsoProjection({ ...base, cameraRotation: 3 });
    const w = p.screenDeltaToWorld(p.worldDeltaToScreen({ x: 2, y: -3 }));
    expect(w.x).toBeCloseTo(2); expect(w.y).toBeCloseTo(-3);
  });
  it('orders depth by ground-plane position, layer overrides', () => {
    const p = new IsoProjection(base);
    expect(p.depthOf({ x: 2, y: 2 })).toBeGreaterThan(p.depthOf({ x: 1, y: 1 }));
    expect(p.depthOf({ x: 0, y: 0 }, { layer: 1 })).toBeGreaterThan(p.depthOf({ x: 50, y: 50 }));
  });
  it('rejects invalid tile sizes', () => {
    expect(() => new IsoProjection({ tileWidth: 0, tileHeight: 1 })).toThrow(RangeError);
  });
});
