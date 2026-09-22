/**
 * A plot of land beside the road, and the fixtures many buildings share.
 *
 * Every generator is written in terms of distance FROM THE ROAD rather than raw
 * x, because the same villa has to stand on either side of the street facing
 * the traffic. `side` flips the geometry; the building code never needs to know
 * which side it is on.
 */
import type { BoxFaces, Builder } from './geometry';

export interface Lot {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** 1 = right-hand side of the road (x > 0), -1 = left-hand side. */
  side: 1 | -1;
  seed: number;
}

export const lotLen = (l: Lot): number => l.z1 - l.z0;
export const lotDepth = (l: Lot): number => l.x1 - l.x0;
export const lotMidZ = (l: Lot): number => (l.z0 + l.z1) / 2;

/** x-range [min, max] for distances d0..d1 measured from the lot's road edge. */
export function across(l: Lot, d0: number, d1: number): [number, number] {
  return l.side > 0 ? [l.x0 + d0, l.x0 + d1] : [l.x1 - d1, l.x1 - d0];
}

/** x at distance d from the road edge. */
export function atDist(l: Lot, d: number): number {
  return l.side > 0 ? l.x0 + d : l.x1 - d;
}

/** The x of the road-facing plane of a volume spanning x0..x1. */
export function frontX(x0: number, x1: number, side: 1 | -1): number {
  return side > 0 ? x0 : x1;
}

/** The face of a box that looks at the street. */
export function roadFace(f: BoxFaces, side: 1 | -1) {
  return side > 0 ? f.nx : f.px;
}

/** A thin slab projecting `out` from the road face of a volume spanning x0..x1. */
export function projecting(x0: number, x1: number, side: 1 | -1, out: number): [number, number] {
  return side > 0 ? [x0 - out, x0] : [x1, x1 + out];
}

/**
 * The compound wall round a residential plot, with a gate gap facing the road.
 *
 * Four parts, not one: the back wall stands BEHIND the house and the front wall
 * IN FRONT of it, so they need separate places in the painter's order. As a
 * single group the back wall was drawn across the face of the house.
 */
export function compoundWall(b: Builder, x0: number, x1: number, z0: number, z1: number, side: 1 | -1, gate = 2.8): void {
  const t = 0.22;
  const h = 1.15;
  const zm = (z0 + z1) / 2;
  const [fa, fb] = side > 0 ? [x0, x0 + t] : [x1 - t, x1];
  const [ba, bb] = side > 0 ? [x1 - t, x1] : [x0, x0 + t];
  b.box(ba, bb, 0, h, z0, z1, 'wall', 'slab');
  b.box(x0, x1, 0, h, z0, z0 + t, 'wall', 'slab');
  b.box(x0, x1, 0, h, z1 - t, z1, 'wall', 'slab');
  b.beginGroup();
  b.box(fa, fb, 0, h, z0, zm - gate / 2, 'wall', 'slab');
  b.box(fa, fb, 0, h, zm + gate / 2, z1, 'wall', 'slab');
  // Gate pillars stand a little proud of the wall, as they do.
  b.box(fa - 0.08, fb + 0.08, 0, 1.55, zm - gate / 2 - 0.34, zm - gate / 2, 'wall', 'slab');
  b.box(fa - 0.08, fb + 0.08, 0, 1.55, zm + gate / 2, zm + gate / 2 + 0.34, 'wall', 'slab');
  b.endGroup();
}

/** A parked car. `axis` is the direction its length runs. */
export function parkedCar(b: Builder, x: number, z: number, axis: 'x' | 'z'): void {
  const L = 2.15;
  const W = 0.96;
  const [hx, hz] = axis === 'x' ? [L / 2, W / 2] : [W / 2, L / 2];
  const [cx, cz] = axis === 'x' ? [hx * 0.52, hz * 0.9] : [hx * 0.9, hz * 0.52];
  b.beginGroup();
  b.box(x - hx, x + hx, 0.14, 0.66, z - hz, z + hz, 'car', 'car');
  b.box(x - cx, x + cx, 0.66, 1.1, z - cz, z + cz, 'glass', 'car');
  b.endGroup();
}

/**
 * A lorry backed up to a dock: trailer and cab as separate parts so the painter
 * orders them correctly from any angle. `dir` is which way the cab faces.
 */
export function truck(b: Builder, x: number, z: number, axis: 'x' | 'z', dir: 1 | -1): void {
  const trailer = 6.4;
  const cab = 2.0;
  const w = 1.15;
  if (axis === 'x') {
    const tx0 = dir > 0 ? x : x - trailer;
    const tx1 = tx0 + trailer;
    b.box(tx0, tx1, 0.85, 3.4, z - w, z + w, 'metal', 'roof');
    const cx0 = dir > 0 ? tx1 + 0.25 : tx0 - 0.25 - cab;
    const cabBox = b.box(cx0, cx0 + cab, 0.5, 3.0, z - w * 0.95, z + w * 0.95, 'accent', 'roof');
    const face = dir > 0 ? cabBox.px : cabBox.nx;
    const fx = dir > 0 ? cx0 + cab : cx0;
    b.grid(face, 'x', fx, z - w * 0.8, z + w * 0.8, 1.7, 2.7, 1, 1, 0.06, 0.08, 0);
  } else {
    const tz0 = dir > 0 ? z : z - trailer;
    const tz1 = tz0 + trailer;
    b.box(x - w, x + w, 0.85, 3.4, tz0, tz1, 'metal', 'roof');
    const cz0 = dir > 0 ? tz1 + 0.25 : tz0 - 0.25 - cab;
    b.box(x - w * 0.95, x + w * 0.95, 0.5, 3.0, cz0, cz0 + cab, 'accent', 'roof');
  }
}

/** A few garden trees of mixed species, scattered by the lot's seed. */
export function garden(b: Builder, pts: Array<[number, number]>, seed: number, palms = false): void {
  pts.forEach(([x, z], i) => {
    const r = ((seed >>> (i * 3)) & 7) / 7;
    if (palms) b.bill('palm', x, z, 1.6 + r * 0.6, 4.2 + r * 1.6, seed + i);
    else if (r > 0.72) b.bill('conifer', x, z, 0.9 + r * 0.3, 3.4 + r, seed + i);
    else b.bill('tree', x, z, 1.05 + r * 0.55, 2.6 + r * 0.9, seed + i);
  });
}
