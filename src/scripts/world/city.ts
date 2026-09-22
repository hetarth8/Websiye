/**
 * The city: one deterministic world that every canvas on the site looks into.
 *
 * It is laid out along a single main road as a sequence of districts, repeated
 * end to end so the road never runs out:
 *
 *   resort → residential → skyline → industrial → highway → resort → …
 *
 * Each canvas is ANCHORED to the district that matches what its section is
 * about (the home hero to the skyline, the "we own the ground" band to the
 * industrial estate, a resort-heavy welcome wing, a division page to its own
 * trade) and scrolling drives the camera along the road from there. Because
 * every view reads the same generator, walking from page to page is walking
 * through one city rather than past a series of separate drawings.
 *
 * Everything is a pure function of position: the same lot is the same building
 * on every visit, on every device. Objects are built on first sight and cached;
 * the cache is pruned as the camera moves on.
 */
import { Builder, hashInts, rng } from './geometry';
import { bungalow, midrise, modernVilla, park, resort, villa } from './living';
import type { Lot } from './lot';
import type { DistrictId, Obj } from './types';
import {
  construction,
  mall,
  office,
  petrol,
  shed,
  shops,
  showroom,
  silos,
  tower,
  towerStep,
  towerTaper,
  towerTwin,
  warehouse,
} from './work';

/** Half the carriageway: four 1.7 m lanes. */
export const ROAD_HALF = 3.4;
/** Footpath beyond the kerb. */
export const WALK = 1.8;
/** Where the first row of plots begins. */
export const LOT_START = ROAD_HALF + WALK + 0.4;
/** Width of a cross street, reserved at the start of every district. */
export const CROSS = 7;

type Kind =
  | 'villa'
  | 'modernVilla'
  | 'bungalow'
  | 'midrise'
  | 'resort'
  | 'park'
  | 'shops'
  | 'showroom'
  | 'mall'
  | 'office'
  | 'tower'
  | 'towerStep'
  | 'towerTwin'
  | 'towerTaper'
  | 'construction'
  | 'shed'
  | 'warehouse'
  | 'logistics'
  | 'silos'
  | 'petrol';

const MAKERS: Record<Kind, (l: Lot) => Obj> = {
  villa,
  modernVilla,
  bungalow,
  midrise,
  resort,
  park,
  shops,
  showroom,
  mall,
  office,
  tower,
  towerStep,
  towerTwin,
  towerTaper,
  construction,
  shed,
  warehouse: (l) => warehouse(l),
  logistics: (l) => warehouse(l, true),
  silos,
  petrol,
};

interface Row {
  /** Offset of the row's road edge beyond LOT_START. */
  x: number;
  depth: number;
  pitch: number;
  mix: ReadonlyArray<readonly [Kind, number]>;
}

interface District {
  id: DistrictId;
  len: number;
  left: readonly Row[];
  right: readonly Row[];
  /** A flyover crosses this district at this fraction of its length. */
  flyover?: number;
}

const HOMES: Row = { x: 0, depth: 13, pitch: 11.5, mix: [['villa', 3], ['modernVilla', 3], ['bungalow', 2]] };
const HOMES_BACK: Row = { x: 14.2, depth: 13, pitch: 12, mix: [['villa', 2], ['modernVilla', 2], ['bungalow', 1], ['park', 1]] };
const FLATS: Row = { x: 28.8, depth: 14, pitch: 17, mix: [['midrise', 4], ['construction', 1], ['park', 1]] };

const DISTRICTS: readonly District[] = [
  {
    id: 'resort',
    len: 124,
    // The resort is on the LEFT-hand side of the road, as asked for. Across the
    // road the plots rise from villas to apartments to towers, so a view down
    // this stretch shows leisure on one side and a growing city on the other.
    left: [{ x: 0, depth: 31, pitch: 40, mix: [['resort', 1]] }],
    right: [
      HOMES,
      { x: 14.2, depth: 14, pitch: 17, mix: [['midrise', 3], ['towerStep', 1]] },
      { x: 30, depth: 13, pitch: 17, mix: [['tower', 2], ['towerTaper', 1], ['construction', 1]] },
    ],
  },
  {
    id: 'residential',
    len: 124,
    left: [HOMES, HOMES_BACK, FLATS],
    right: [HOMES, HOMES_BACK, FLATS],
  },
  {
    id: 'skyline',
    len: 152,
    left: [
      { x: 0, depth: 15, pitch: 17, mix: [['shops', 4], ['showroom', 2], ['office', 1]] },
      { x: 16.6, depth: 13, pitch: 15, mix: [['tower', 3], ['towerStep', 2], ['construction', 2], ['midrise', 1]] },
      { x: 31, depth: 13, pitch: 17, mix: [['towerTaper', 2], ['towerTwin', 2], ['tower', 2]] },
    ],
    right: [
      { x: 0, depth: 15, pitch: 17, mix: [['shops', 3], ['showroom', 2], ['office', 2]] },
      { x: 16.6, depth: 13, pitch: 15, mix: [['tower', 3], ['towerTwin', 2], ['construction', 2], ['towerStep', 1]] },
      { x: 31, depth: 13, pitch: 17, mix: [['towerStep', 2], ['towerTaper', 2], ['tower', 2]] },
    ],
  },
  {
    id: 'industrial',
    len: 132,
    left: [
      { x: 0, depth: 24, pitch: 24, mix: [['shed', 3], ['warehouse', 2], ['silos', 1]] },
      { x: 25.5, depth: 24, pitch: 28, mix: [['warehouse', 2], ['shed', 2], ['silos', 1]] },
    ],
    right: [
      { x: 0, depth: 24, pitch: 24, mix: [['shed', 3], ['silos', 1], ['warehouse', 2]] },
      { x: 25.5, depth: 24, pitch: 28, mix: [['shed', 2], ['warehouse', 2]] },
    ],
  },
  {
    id: 'highway',
    len: 112,
    flyover: 0.56,
    // Low and wide along the carriageway — the highway's own trade — with the
    // city rising behind it: offices, then a row of towers. Without that back
    // row a view down the highway was two-thirds empty sky.
    left: [
      { x: 0, depth: 24, pitch: 26, mix: [['petrol', 1], ['mall', 2], ['logistics', 2]] },
      { x: 25.5, depth: 17, pitch: 22, mix: [['office', 2], ['midrise', 1], ['towerStep', 1], ['warehouse', 1]] },
      { x: 44, depth: 13, pitch: 18, mix: [['tower', 2], ['towerTaper', 1], ['towerTwin', 1], ['construction', 1]] },
    ],
    right: [
      { x: 0, depth: 24, pitch: 26, mix: [['logistics', 2], ['mall', 1], ['office', 1], ['petrol', 1]] },
      { x: 25.5, depth: 17, pitch: 22, mix: [['office', 2], ['warehouse', 1], ['towerStep', 1]] },
      { x: 44, depth: 13, pitch: 18, mix: [['tower', 2], ['towerStep', 1], ['towerTaper', 1]] },
    ],
  },
];

export const PERIOD = DISTRICTS.reduce((sum, d) => sum + d.len, 0);

const STARTS: number[] = (() => {
  const out: number[] = [];
  let z = 0;
  for (const d of DISTRICTS) {
    out.push(z);
    z += d.len;
  }
  return out;
})();

/** Where a district begins in the first cycle of the road. */
export function districtStart(id: DistrictId): number {
  const i = DISTRICTS.findIndex((d) => d.id === id);
  return STARTS[Math.max(0, i)]!;
}

export function districtLength(id: DistrictId): number {
  return DISTRICTS.find((d) => d.id === id)?.len ?? 120;
}

function pick(mix: Row['mix'], seed: number): Kind {
  const total = mix.reduce((s, [, w]) => s + w, 0);
  let t = (seed % 10_000) / 10_000 * total;
  for (const [k, w] of mix) {
    t -= w;
    if (t < 0) return k;
  }
  return mix[0]![0];
}

/** One visible occurrence of a district: which one, which repeat, where it starts. */
interface Span {
  d: District;
  index: number;
  cycle: number;
  start: number;
}

function spansIn(zMin: number, zMax: number): Span[] {
  const out: Span[] = [];
  const c0 = Math.floor(zMin / PERIOD);
  const c1 = Math.floor(zMax / PERIOD);
  for (let c = c0; c <= c1; c += 1) {
    DISTRICTS.forEach((d, index) => {
      const start = c * PERIOD + STARTS[index]!;
      if (start + d.len >= zMin && start <= zMax) out.push({ d, index, cycle: c, start });
    });
  }
  return out;
}

/** Street trees and lamps along both footpaths of one district. */
function street(span: Span): Obj {
  const b = new Builder(hashInts(span.cycle, span.index, 7));
  const z0 = span.start + CROSS + 1;
  const z1 = span.start + span.d.len - 1;
  const treeX = ROAD_HALF + WALK * 0.7;
  const lampX = ROAD_HALF + 0.35;
  // Industrial and highway verges carry lamps but few trees.
  const leafy = span.d.id === 'resort' || span.d.id === 'residential' || span.d.id === 'skyline';
  let k = 0;
  for (let z = z0 + 2; z < z1; z += 9, k += 1) {
    if (leafy || k % 3 === 0) {
      // Avenue trees are planted as a mixed row, not a repeated stamp.
      for (const [sx, dz, salt] of [[-1, 1.5, 1], [1, 6, 2]] as const) {
        const seed = hashInts(span.cycle, span.index, k, salt);
        const v = (seed % 1000) / 1000;
        const kind = span.d.id === 'resort' ? 'palm' : v > 0.7 ? 'conifer' : 'tree';
        const size = kind === 'palm' ? 1.4 + v * 0.4 : kind === 'conifer' ? 0.85 + v * 0.3 : 0.9 + v * 0.55;
        const height = kind === 'palm' ? 4.2 + v * 1.4 : kind === 'conifer' ? 3.6 + v : 2.6 + v * 1.1;
        b.bill(kind, sx * treeX, z + dz + (v - 0.5) * 1.6, size, height, seed);
      }
    }
    if (k % 2 === 0) {
      b.bill('lamp', -lampX, z + 4, 0, 4.6, k);
      b.bill('lamp', lampX, z + 4, 0, 4.6, k + 1);
    }
  }
  return b.build();
}

/**
 * The flyover, built as separate spans along its length. As ONE object it had a
 * single sort key at the road's centre, so a building standing just in front of
 * it off to one side was painted over by the deck. Per-span objects each sort
 * against the buildings they actually overlap.
 */
function flyoverSpans(span: Span): Obj[] {
  const out: Obj[] = [];
  if (span.d.flyover === undefined) return out;
  const zc = span.start + span.d.len * span.d.flyover;
  const halfDeck = 4.2;
  const step = 12;
  for (let x = -72; x < 72; x += step) {
    const b = new Builder(hashInts(span.cycle, x, 99));
    const deck = b.box(x, x + step, 6.2, 7.05, zc - halfDeck, zc + halfDeck, 'slab', 'roof');
    // Crash barriers along both edges and the deck's lane line.
    b.lines(deck.nz, [x, 7.05, zc - halfDeck, x + step, 7.05, zc - halfDeck, x, 7.9, zc - halfDeck, x + step, 7.9, zc - halfDeck]);
    if (deck.top) b.lines(deck.top, [x, 7.07, zc, x + step, 7.07, zc]);
    // A pier at every span joint, clear of the carriageway below.
    if (Math.abs(x) > ROAD_HALF + 1.5) b.box(x - 0.7, x + 0.7, 0, 6.2, zc - 1.6, zc + 1.6, 'wall', null);
    if (((x / step) | 0) % 2 === 0) b.bill('lamp', x + step / 2, zc - halfDeck + 0.3, 0, 3.2, x, 7.05);
    b.shadow(x, zc - halfDeck, x + step, zc + halfDeck, 1.2);
    out.push(b.build());
  }
  return out;
}

/** Cross-street and crossing markings, generated once per district. */
function crossing(span: Span): Obj {
  const b = new Builder(hashInts(span.cycle, span.index, 3));
  const z0 = span.start;
  const z1 = span.start + CROSS;
  b.rect(-80, z0, 80, z1, 'asphalt', [-80, (z0 + z1) / 2, -ROAD_HALF - 0.4, (z0 + z1) / 2, ROAD_HALF + 0.4, (z0 + z1) / 2, 80, (z0 + z1) / 2]);
  // Zebra crossing on the main road just short of the junction.
  for (let x = -ROAD_HALF + 0.2; x < ROAD_HALF - 0.2; x += 0.85) b.rect(x, z0 - 3, x + 0.45, z0 - 0.8, 'marking');
  // …and on the side street on both corners.
  for (const side of [-1, 1]) {
    const xa = side * (ROAD_HALF + WALK + 0.6);
    for (let z = z0 + 0.4; z < z1 - 0.4; z += 0.85) b.rect(xa, z, xa + side * 2.2, z + 0.45, 'marking');
  }
  // Traffic signals on the corners.
  b.bill('lamp', -ROAD_HALF - 0.6, z0 - 0.6, 0, 4, 11);
  b.bill('lamp', ROAD_HALF + 0.6, z1 + 0.6, 0, 4, 12);
  return b.build();
}

export class City {
  private readonly cache = new Map<string, { obj: Obj; seen: number }>();
  private frame = 0;

  private get(key: string, make: () => Obj): Obj {
    const hit = this.cache.get(key);
    if (hit) {
      hit.seen = this.frame;
      return hit.obj;
    }
    const obj = make();
    this.cache.set(key, { obj, seen: this.frame });
    return obj;
  }

  /**
   * Everything that could be visible in the window zMin..zMax on the given
   * sides of the road. Culling to the actual frustum is the renderer's job;
   * this only avoids building lots nobody could possibly see.
   */
  objectsIn(zMin: number, zMax: number, sides: { left: boolean; right: boolean }, out: Obj[]): Obj[] {
    this.frame += 1;
    out.length = 0;

    for (const span of spansIn(zMin, zMax)) {
      const { d, index, cycle, start } = span;
      out.push(this.get(`x:${cycle}:${index}`, () => crossing(span)));
      out.push(this.get(`s:${cycle}:${index}`, () => street(span)));
      if (d.flyover !== undefined) {
        const zc = start + d.len * d.flyover;
        if (zc > zMin - 10 && zc < zMax + 10) {
          const spans = this.flyoverCache(`f:${cycle}:${index}`, span);
          for (const o of spans) out.push(o);
        }
      }

      const flyZ = d.flyover !== undefined ? start + d.len * d.flyover : null;
      for (const side of [-1, 1] as const) {
        if (side < 0 && !sides.left) continue;
        if (side > 0 && !sides.right) continue;
        const rows = side < 0 ? d.left : d.right;
        rows.forEach((row, ri) => {
          const first = start + CROSS + 1;
          const last = start + d.len - 1;
          const count = Math.max(1, Math.floor((last - first) / row.pitch));
          for (let i = 0; i < count; i += 1) {
            const z0 = first + i * row.pitch;
            const z1 = z0 + row.pitch - 1.4;
            if (z1 < zMin || z0 > zMax) continue;
            // Keep plots out from under the flyover.
            if (flyZ !== null && z1 > flyZ - 5.5 && z0 < flyZ + 5.5) continue;
            const seed = hashInts(cycle, index, side, ri, i);
            const xa = LOT_START + row.x;
            const lot: Lot = {
              x0: side > 0 ? xa : -xa - row.depth,
              x1: side > 0 ? xa + row.depth : -xa,
              z0,
              z1,
              side,
              seed,
            };
            const kind = pick(row.mix, seed);
            out.push(this.get(`l:${cycle}:${index}:${side}:${ri}:${i}`, () => MAKERS[kind](lot)));
          }
        });
      }
    }

    if (this.frame % 240 === 0) this.prune();
    return out;
  }

  /** Build a stretch of road ahead of need — in idle time, not on arrival. */
  warm(zMin: number, zMax: number): void {
    this.objectsIn(zMin, zMax, { left: true, right: true }, this.scratch);
    this.scratch.length = 0;
  }

  private readonly scratch: Obj[] = [];

  private readonly flyovers = new Map<string, { objs: Obj[]; seen: number }>();

  private flyoverCache(key: string, span: Span): Obj[] {
    const hit = this.flyovers.get(key);
    if (hit) {
      hit.seen = this.frame;
      return hit.objs;
    }
    const objs = flyoverSpans(span);
    this.flyovers.set(key, { objs, seen: this.frame });
    return objs;
  }

  /**
   * Forget what has not been looked at for a while — but only once the cache
   * is genuinely large. A whole cycle of the road is under 200 objects, and
   * evicting by call count (several scenes each calling every frame) threw
   * districts away within seconds, so every return to a section rebuilt its
   * buildings in the middle of a scroll. `frame` counts calls, so "a while"
   * is measured in calls here: 20,000 is minutes of browsing, not seconds.
   */
  private prune(): void {
    if (this.cache.size < 600 && this.flyovers.size < 40) return;
    const stale = this.frame - 20_000;
    for (const [k, v] of this.cache) if (v.seen < stale) this.cache.delete(k);
    for (const [k, v] of this.flyovers) if (v.seen < stale) this.flyovers.delete(k);
  }
}

/** Shared by every canvas on the page, so a lot seen twice is built once. */
export const city = new City();

/** Exposed for the renderer's moving traffic. */
export const trafficSeed = (i: number): number => rng(hashInts(i, 4242))();
