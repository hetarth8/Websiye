/**
 * The city renderer must always finish a frame, quickly, for every view the
 * site uses — including awkward canvas shapes (a very tall section backdrop, a
 * thin strip, a phone) and camera positions far down the road.
 *
 * This exists because a non-terminating loop in a requestAnimationFrame
 * callback does not throw: it freezes the visitor's tab. The renderer's loops
 * are bounded by the visible road window, which is derived from canvas size,
 * focal length and camera position — so those are exactly what is varied here.
 */
import { describe, expect, it } from 'vitest';

import { WorldRenderer, type ViewConfig } from '../../src/scripts/world/renderer';
import { DAY, NIGHT } from '../../src/scripts/world/themes';
import type { DistrictId } from '../../src/scripts/world/types';

/** A 2D context that records how much drawing was asked of it and does nothing. */
function stubContext() {
  const counts = { fill: 0, stroke: 0, fillRect: 0 };
  const gradient = { addColorStop: () => {} };
  const ctx = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === 'fill') return () => counts.fill++;
        if (prop === 'stroke') return () => counts.stroke++;
        if (prop === 'fillRect') return () => counts.fillRect++;
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
        return () => {};
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, counts };
}

const BASE: Omit<ViewConfig, 'kind' | 'district'> = {
  theme: DAY,
  bias: -6,
  span: 60,
  drift: 0,
  camH: 22,
  camX: 0,
  vpX: 0.5,
  horizonY: 0.26,
  focal: 0.95,
  far: 170,
  cullLeft: 0,
  cullRight: 1,
  buildings: true,
  traffic: true,
  strength: 1,
};

const VIEWS: Array<{ name: string; view: ViewConfig; sizes: Array<[number, number]> }> = [
  { name: 'hero', view: { ...BASE, kind: 'forward', district: 'skyline', vpX: 0.74, cullLeft: 0.42 }, sizes: [[1781, 1035], [563, 1202]] },
  { name: 'band (night)', view: { ...BASE, kind: 'forward', district: 'industrial', theme: NIGHT }, sizes: [[1781, 700]] },
  { name: 'backdrop (tall section)', view: { ...BASE, kind: 'forward', district: 'highway', horizonY: 0.22, strength: 0.62 }, sizes: [[1440, 941], [1440, 3200], [375, 2400]] },
  { name: 'strip (side view)', view: { ...BASE, kind: 'side', district: 'resort', camH: 6, camX: 12, horizonY: 0.6, focal: 0.85, far: 72 }, sizes: [[1781, 338], [375, 150], [2560, 200]] },
  { name: 'opening', view: { ...BASE, kind: 'forward', district: 'resort', camH: 31, horizonY: 0.33, focal: 0.72, far: 175 }, sizes: [[2520, 1575], [563, 1218]] },
];

const DISTRICTS: DistrictId[] = ['resort', 'residential', 'skyline', 'industrial', 'highway'];

describe('WorldRenderer', () => {
  for (const { name, view, sizes } of VIEWS) {
    for (const [w, h] of sizes) {
      it(`finishes a frame quickly: ${name} at ${w}x${h}`, () => {
        const { ctx, counts } = stubContext();
        const r = new WorldRenderer(ctx, view);
        // Far down the road too: the world repeats, and nothing may drift with distance.
        for (const camZ of [0, 250, 1234.5, 20_000]) {
          const t0 = performance.now();
          r.render({ w, h, dpr: 1, camZ, t: 3.3, yaw: 0.02, pitchPx: 0, alpha: 1 });
          const ms = performance.now() - t0;
          // Generous: this is a hang/runaway guard, not a benchmark. The first
          // frame also builds and caches every lot in view.
          expect(ms).toBeLessThan(400);
        }
        expect(counts.fill + counts.stroke).toBeGreaterThan(0);
      });
    }
  }

  it('draws something in every district', () => {
    for (const district of DISTRICTS) {
      const { ctx, counts } = stubContext();
      const r = new WorldRenderer(ctx, { ...BASE, kind: 'forward', district });
      r.render({ w: 1440, h: 900, dpr: 1, camZ: 0, t: 1, yaw: 0, pitchPx: 0, alpha: 1 });
      expect(counts.fill, district).toBeGreaterThan(50);
    }
  });

  it('survives a surge: a wide lens and a camera far along', () => {
    const { ctx } = stubContext();
    const r = new WorldRenderer(ctx, { ...BASE, kind: 'forward', district: 'skyline' });
    const t0 = performance.now();
    for (let i = 0; i < 20; i += 1) {
      r.render({ w: 1440, h: 900, dpr: 1, camZ: 300 + i * 40, t: i / 30, yaw: 0, pitchPx: 0, alpha: 1, focalScale: 0.84 });
    }
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('tolerates a degenerate canvas without hanging', () => {
    const { ctx } = stubContext();
    const r = new WorldRenderer(ctx, { ...BASE, kind: 'side', district: 'resort', camX: 12, focal: 0.85, far: 72 });
    // A side view's road window widens as the canvas gets shorter. A canvas
    // collapsed by a transient layout must neither hang nor build the world.
    for (const h of [1, 7, 9, 20]) {
      const t0 = performance.now();
      r.render({ w: 2560, h, dpr: 1, camZ: 50, t: 0, yaw: 0, pitchPx: 0, alpha: 1 });
      expect(performance.now() - t0, `height ${h}`).toBeLessThan(400);
    }
  });
});
