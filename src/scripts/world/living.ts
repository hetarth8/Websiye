/**
 * Where people live and stay: villas, bungalows, apartment blocks, the resort,
 * and the park.
 *
 * The rule for this file is that every type must be recognisable from its
 * SILHOUETTE alone, before any detail is drawn — because at a distance the
 * detail is culled and the silhouette is all that is left. So the villa has a
 * pitched roof and a compound wall, the bungalow a hipped roof and a veranda,
 * the modern villa a cantilevered upper floor, the apartment block a stack of
 * balcony slabs. None of them can be mistaken for a box.
 */
import { Builder, rng } from './geometry';
import {
  across,
  atDist,
  compoundWall,
  frontX,
  garden,
  lotDepth,
  lotLen,
  lotMidZ,
  parkedCar,
  projecting,
  roadFace,
  type Lot,
} from './lot';
import type { Obj } from './types';

/** Railing along an edge at constant x: a top rail and balusters. */
function railX(x: number, y: number, z0: number, z1: number, step = 0.45, h = 0.95): number[] {
  const s = [x, y + h, z0, x, y + h, z1];
  for (let z = z0; z <= z1 + 1e-3; z += step) s.push(x, y, z, x, y + h, z);
  return s;
}

/** Two-storey villa: pitched tiled roof, balcony, compound wall, driveway. */
export function villa(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const zc = lotMidZ(lot);
  const pz0 = lot.z0 + 0.3;
  const pz1 = lot.z1 - 0.3;

  b.rect(lot.x0 + 0.3, pz0, lot.x1 - 0.3, pz1, 'lawn');
  const [dx0, dx1] = across(lot, 0.3, 3.7);
  b.rect(dx0, zc - 1.25, dx1, zc + 1.25, 'path');
  compoundWall(b, lot.x0 + 0.3, lot.x1 - 0.3, pz0, pz1, s);

  const w = Math.min(7.2, depth - 5.4);
  const L = Math.min(8.4, lotLen(lot) - 3.6);
  const [hx0, hx1] = across(lot, 3.7, 3.7 + w);
  const hz0 = zc - L / 2;
  const hz1 = zc + L / 2;
  const fh = 2.95;
  const H = fh * 2;

  const body = b.box(hx0, hx1, 0, H, hz0, hz1, 'wall', null);
  b.grid(roadFace(body, s), 'x', frontX(hx0, hx1, s), hz0, hz1, 0.25, H - 0.2, 3, 2, 0.22, 0.24);
  b.grid(body.nz, 'z', hz0, hx0, hx1, 0.25, H - 0.2, 2, 2, 0.26, 0.24);
  b.grid(body.pz, 'z', hz1, hx0, hx1, 0.25, H - 0.2, 2, 2, 0.26, 0.24);

  // The first-floor balcony over the entrance.
  const [bx0, bx1] = projecting(hx0, hx1, s, 1.35);
  const bz0 = hz0 + L * 0.18;
  const bz1 = hz1 - L * 0.18;
  const bal = b.box(bx0, bx1, fh - 0.06, fh + 0.16, bz0, bz1, 'slab', 'slab');
  b.lines(roadFace(bal, s), railX(s > 0 ? bx0 : bx1, fh + 0.16, bz0, bz1));

  b.gable(hx0, hx1, hz0, hz1, H, 2.25, r() > 0.45 ? 'z' : 'x', 'tile', 0.48);

  garden(b, [[atDist(lot, depth - 1.6), pz0 + 1.4], [atDist(lot, depth - 1.6), pz1 - 1.4], [atDist(lot, 1.7), pz0 + 1.5]], lot.seed);
  // A clipped hedge along the inside of the front wall, either side of the gate.
  for (let k = 0; k < 4; k += 1) {
    const z = k < 2 ? pz0 + 0.9 + k * 1.1 : pz1 - 0.9 - (k - 2) * 1.1;
    b.bill('shrub', atDist(lot, 0.9), z, 0.5, 0.5, lot.seed + k);
  }
  if (r() > 0.4) parkedCar(b, atDist(lot, 2.0), zc, 'x');
  b.shadow(hx0, hz0, hx1, hz1, H + 2.25);
  return b.build();
}

/** Contemporary villa: glass ground floor, cantilevered upper volume, lap pool. */
export function modernVilla(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const zc = lotMidZ(lot);
  const pz0 = lot.z0 + 0.3;
  const pz1 = lot.z1 - 0.3;

  b.rect(lot.x0 + 0.3, pz0, lot.x1 - 0.3, pz1, 'lawn');
  const [dx0, dx1] = across(lot, 0.3, 3.5);
  b.rect(dx0, zc - 1.3, dx1, zc + 1.3, 'path');
  compoundWall(b, lot.x0 + 0.3, lot.x1 - 0.3, pz0, pz1, s);

  const w = Math.min(7.4, depth - 5.6);
  const L = Math.min(9.2, lotLen(lot) - 3.4);
  const [gx0, gx1] = across(lot, 3.5, 3.5 + w);
  const hz0 = zc - L / 2;
  const hz1 = zc + L / 2;

  const ground = b.box(gx0, gx1, 0, 3.1, hz0, hz1, 'wall', 'roof');
  // Floor-to-ceiling glazing: tall panes, almost no margin.
  b.grid(roadFace(ground, s), 'x', frontX(gx0, gx1, s), hz0 + 0.35, hz1 - 0.35, 0.12, 2.95, 4, 1, 0.05, 0.02, 0.8);
  b.grid(ground.nz, 'z', hz0, gx0 + 0.35, gx1 - 0.35, 0.12, 2.95, 2, 1, 0.06, 0.02, 0.8);

  // The upper volume overhangs the entrance by 1.8 m — the defining gesture.
  const [ux0, ux1] = across(lot, 3.5 - 1.8, 3.5 + w * 0.82);
  const flip = r() > 0.5;
  const uz0 = flip ? hz1 - L * 0.66 : hz0;
  const uz1 = uz0 + L * 0.66;
  const upper = b.box(ux0, ux1, 3.1, 6.2, uz0, uz1, 'wall', 'roof');
  const ufx = frontX(ux0, ux1, s);
  b.grid(roadFace(upper, s), 'x', ufx, uz0, uz1, 3.55, 5.75, 1, 1, 0.05, 0.06, 0.7);
  b.mullions(roadFace(upper, s), 'x', ufx, uz0, uz1, 3.45, 5.85, 0.62);
  b.grid(upper.nz, 'z', uz0, ux0, ux1, 3.55, 5.75, 1, 1, 0.08, 0.06, 0.7);

  // A lap pool along the back of the plot.
  const [px0, px1] = across(lot, 3.5 + w + 0.9, depth - 0.9);
  if (px1 - px0 > 1.4) {
    b.rect(px0 - 0.5, hz0 - 0.2, px1 + 0.5, hz1 + 0.2, 'deck');
    b.rect(px0, hz0 + 0.4, px1, hz1 - 0.4, 'water');
  }

  garden(b, [[atDist(lot, 1.6), pz1 - 1.4], [atDist(lot, depth - 1.4), pz0 + 1.3]], lot.seed ^ 0x55);
  if (r() > 0.35) parkedCar(b, atDist(lot, 1.9), zc, 'x');
  b.shadow(gx0, hz0, gx1, hz1, 3.1);
  b.shadow(ux0, uz0, ux1, uz1, 6.2);
  return b.build();
}

/** Single-storey bungalow: hipped roof and a deep veranda on posts. */
export function bungalow(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const zc = lotMidZ(lot);
  const pz0 = lot.z0 + 0.3;
  const pz1 = lot.z1 - 0.3;

  b.rect(lot.x0 + 0.3, pz0, lot.x1 - 0.3, pz1, 'lawn');
  const [dx0, dx1] = across(lot, 0.3, 4.2);
  b.rect(dx0, zc - 0.9, dx1, zc + 0.9, 'path');
  compoundWall(b, lot.x0 + 0.3, lot.x1 - 0.3, pz0, pz1, s, 2.2);

  const w = Math.min(6.6, depth - 6);
  const L = Math.min(10.4, lotLen(lot) - 2.8);
  const [hx0, hx1] = across(lot, 4.2, 4.2 + w);
  const hz0 = zc - L / 2;
  const hz1 = zc + L / 2;

  const body = b.box(hx0, hx1, 0, 3.3, hz0, hz1, 'wall', null);
  b.grid(roadFace(body, s), 'x', frontX(hx0, hx1, s), hz0 + 0.4, hz1 - 0.4, 0.55, 2.7, 4, 1, 0.24, 0.1);
  b.grid(body.nz, 'z', hz0, hx0, hx1, 0.55, 2.7, 2, 1, 0.26, 0.1);

  // Veranda: a deep canopy on slim posts along the street front.
  const [vx0, vx1] = projecting(hx0, hx1, s, 2.1);
  const outer = s > 0 ? vx0 : vx1;
  b.beginGroup();
  for (const z of [hz0 + 0.5, zc, hz1 - 0.5]) b.box(outer - 0.11, outer + 0.11, 0, 2.85, z - 0.11, z + 0.11, 'wall', null);
  b.endGroup();
  b.box(vx0, vx1, 2.85, 3.05, hz0 + 0.2, hz1 - 0.2, 'slab', 'roof');

  b.hip(hx0, hx1, hz0, hz1, 3.3, 1.95, 'tile', 0.5);

  garden(b, [[atDist(lot, 1.5), pz0 + 1.4], [atDist(lot, 1.5), pz1 - 1.4], [atDist(lot, depth - 1.5), zc]], lot.seed ^ 0x33);
  if (r() > 0.55) parkedCar(b, atDist(lot, 2.1), zc - 2.2, 'x');
  b.shadow(hx0, hz0, hx1, hz1, 5.2);
  return b.build();
}

/** Apartment block: 5-8 floors, a balcony slab on every floor, services on the roof. */
export function midrise(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const zc = lotMidZ(lot);
  const floors = 5 + Math.floor(r() * 4);
  const fh = 3.05;
  const H = floors * fh;

  const w = Math.min(11, depth - 3.2);
  const L = Math.min(15.5, lotLen(lot) - 2.2);
  const [hx0, hx1] = across(lot, 2.4, 2.4 + w);
  const hz0 = zc - L / 2;
  const hz1 = zc + L / 2;
  const fx = frontX(hx0, hx1, s);

  b.rect(lot.x0 + 0.3, lot.z0 + 0.3, lot.x1 - 0.3, lot.z1 - 0.3, 'yard');
  const body = b.box(hx0, hx1, 0, H, hz0, hz1, 'wall', 'roof');
  b.grid(roadFace(body, s), 'x', fx, hz0 + 0.3, hz1 - 0.3, 0.3, H - 0.25, Math.max(3, Math.round(L / 2.3)), floors, 0.2, 0.27);
  b.grid(body.nz, 'z', hz0, hx0 + 0.3, hx1 - 0.3, 0.3, H - 0.25, Math.max(2, Math.round(w / 2.3)), floors, 0.2, 0.27);
  b.grid(body.pz, 'z', hz1, hx0 + 0.3, hx1 - 0.3, 0.3, H - 0.25, Math.max(2, Math.round(w / 2.3)), floors, 0.2, 0.27);

  // A continuous balcony slab on every upper floor, each with its railing.
  const [bx0, bx1] = projecting(hx0, hx1, s, 1.05);
  const bz0 = hz0 + L * 0.1;
  const bz1 = hz1 - L * 0.1;
  const outer = s > 0 ? bx0 : bx1;
  b.beginGroup();
  for (let k = 1; k < floors; k += 1) {
    const y = k * fh;
    const slab = b.box(bx0, bx1, y - 0.05, y + 0.15, bz0, bz1, 'slab', 'slab');
    b.lines(roadFace(slab, s), railX(outer, y + 0.15, bz0, bz1, 1.1));
  }
  b.endGroup();

  // Roof: parapet line, water tank and the stair headroom — every Indian roof has both.
  if (body.top) {
    const i = 0.3;
    b.lines(body.top, [
      hx0 + i, H + 0.02, hz0 + i, hx1 - i, H + 0.02, hz0 + i,
      hx1 - i, H + 0.02, hz0 + i, hx1 - i, H + 0.02, hz1 - i,
      hx1 - i, H + 0.02, hz1 - i, hx0 + i, H + 0.02, hz1 - i,
      hx0 + i, H + 0.02, hz1 - i, hx0 + i, H + 0.02, hz0 + i,
    ]);
  }
  const [tx0, tx1] = across(lot, 2.4 + w - 3.2, 2.4 + w - 1.4);
  b.box(tx0, tx1, H, H + 1.7, hz1 - 3.2, hz1 - 1.5, 'metal', 'roof');
  const [sx0, sx1] = across(lot, 2.4 + w * 0.35, 2.4 + w * 0.35 + 2.3);
  b.box(sx0, sx1, H, H + 2.6, hz0 + 1.6, hz0 + 4.2, 'wall', 'roof');

  garden(b, [[atDist(lot, 1.1), hz0 - 0.2], [atDist(lot, 1.1), hz1 + 0.2]], lot.seed ^ 0x71);
  b.shadow(hx0, hz0, hx1, hz1, H);
  return b.build();
}

/**
 * The resort: a terraced main block behind a pool, cottages round the gardens,
 * a cabana, loungers, palms and winding paths. It takes a whole 40 m lot, and
 * the city places it on the left-hand side of the road.
 */
export function resort(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const L = lotLen(lot);
  const zc = lotMidZ(lot);

  b.rect(lot.x0 + 0.2, lot.z0 + 0.2, lot.x1 - 0.2, lot.z1 - 0.2, 'lawn');

  // --- the winding drive from the gate to the lobby --------------------------
  const gateZ = zc + L * 0.3;
  const pathL: number[] = [];
  const pathR: number[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i += 1) {
    const d = (i / steps) * 19;
    const z = gateZ - (i / steps) * L * 0.34 + Math.sin(i * 0.55) * 1.6;
    pathL.push(atDist(lot, d), z - 1.0);
    pathR.unshift(atDist(lot, d), z + 1.0);
  }
  b.decal([...pathL, ...pathR], 'path');

  // --- pool and deck ---------------------------------------------------------
  const [pX0, pX1] = across(lot, 7.5, 16.5);
  const pZ0 = zc - L * 0.3;
  const pZ1 = zc + L * 0.1;
  b.rect(pX0 - 1.6, pZ0 - 1.6, pX1 + 1.6, pZ1 + 1.6, 'deck');
  b.rect(pX0, pZ0, pX1, pZ1, 'water');
  // A shallow lagoon arm off the main pool.
  const [lX0, lX1] = across(lot, 9, 13.5);
  b.rect(lX0, pZ1, lX1, pZ1 + 3.4, 'water');

  // Loungers along the deck, one grouped part.
  const lx = atDist(lot, 6.6);
  b.beginGroup();
  for (let k = 0; k < 6; k += 1) {
    const z = pZ0 + 0.8 + k * ((pZ1 - pZ0 - 1.6) / 5);
    b.box(lx - 0.9, lx + 0.9, 0.12, 0.42, z - 0.3, z + 0.3, 'slab', 'slab');
  }
  b.endGroup();

  // Cabana: four posts under a slatted roof.
  const [cX0, cX1] = across(lot, 13.5, 17);
  const cz0 = pZ1 + 1.2;
  const cz1 = cz0 + 3.2;
  b.beginGroup();
  for (const x of [cX0, cX1]) for (const z of [cz0, cz1]) b.box(x - 0.1, x + 0.1, 0, 2.6, z - 0.1, z + 0.1, 'wall', null);
  b.endGroup();
  const cab = b.box(cX0 - 0.3, cX1 + 0.3, 2.6, 2.85, cz0 - 0.3, cz1 + 0.3, 'slab', 'roof');
  if (cab.top) {
    const slats: number[] = [];
    for (let x = cX0; x <= cX1; x += 0.45) slats.push(x, 2.86, cz0 - 0.3, x, 2.86, cz1 + 0.3);
    b.lines(cab.top, slats);
  }

  // --- the terraced main block ------------------------------------------------
  const mz0 = zc - L * 0.42;
  const mz1 = zc + L * 0.34;
  const tiers = [
    { d: 19, y0: 0, y1: 3.4 },
    { d: 20.9, y0: 3.4, y1: 6.8 },
    { d: 22.8, y0: 6.8, y1: 10.2 },
  ];
  const back = depth - 1.2;
  let last: [number, number] = [0, 0];
  tiers.forEach((t, i) => {
    const [x0, x1] = across(lot, t.d, back);
    const tb = b.box(x0, x1, t.y0, t.y1, mz0, mz1, 'wall', i < 2 ? 'roof' : null);
    const fx = frontX(x0, x1, s);
    // Sliding doors onto each terrace, and the terrace railing above them.
    b.grid(roadFace(tb, s), 'x', fx, mz0 + 0.4, mz1 - 0.4, t.y0 + 0.25, t.y1 - 0.35, Math.round((mz1 - mz0) / 2.3), 1, 0.1, 0.1, 0.75);
    if (i < 2) b.lines(roadFace(tb, s), railX(fx, t.y1, mz0 + 0.3, mz1 - 0.3, 0.9));
    b.grid(tb.nz, 'z', mz0, x0 + 0.3, x1 - 0.3, t.y0 + 0.25, t.y1 - 0.35, Math.max(2, Math.round((x1 - x0) / 2.4)), 1, 0.16, 0.12, 0.75);
    last = [x0, x1];
  });
  b.hip(last[0], last[1], mz0, mz1, 10.2, 2.3, 'tile', 0.55);

  // --- cottages scattered through the gardens -------------------------------
  const cottages: Array<[number, number]> = [
    [3.8, zc - L * 0.34],
    [3.8, zc - L * 0.08],
    [19.5, zc + L * 0.42],
    [24.5, zc + L * 0.42],
    [depth - 3.4, zc - L * 0.47],
  ];
  cottages.forEach(([d, z]) => {
    const [x0, x1] = across(lot, d - 1.6, d + 1.6);
    const cb = b.box(x0, x1, 0, 2.8, z - 1.6, z + 1.6, 'wall', null);
    b.grid(roadFace(cb, s), 'x', frontX(x0, x1, s), z - 1.4, z + 1.4, 0.2, 2.3, 2, 1, 0.18, 0.08, 0.8);
    b.grid(cb.nz, 'z', z - 1.6, x0, x1, 0.2, 2.3, 1, 1, 0.3, 0.08, 0.8);
    b.hip(x0, x1, z - 1.6, z + 1.6, 2.8, 1.7, 'tile', 0.42);
    b.rect(x0 - 0.8, z - 1.9, x1 + 0.8, z + 1.9, 'deck');
    b.shadow(x0, z - 1.6, x1, z + 1.6, 4.5);
  });

  // --- the gate: two pillars and a lintel carrying the resort's name board ----
  const g0 = atDist(lot, 0.35);
  const g1 = atDist(lot, 0.95);
  const [ga, gb] = g0 < g1 ? [g0, g1] : [g1, g0];
  b.box(ga, gb, 0, 3.4, gateZ - 2.1, gateZ - 1.5, 'wall', 'slab');
  b.box(ga, gb, 0, 3.4, gateZ + 1.5, gateZ + 2.1, 'wall', 'slab');
  const lintel = b.box(ga - 0.1, gb + 0.1, 3.4, 4.2, gateZ - 2.3, gateZ + 2.3, 'accent', 'slab');
  b.grid(roadFace(lintel, s), 'x', s > 0 ? ga - 0.1 : gb + 0.1, gateZ - 1.6, gateZ + 1.6, 3.55, 4.05, 1, 1, 0.05, 0.22, 1);

  // --- palms round the pool, along the drive and at the gate -----------------
  const palms: Array<[number, number]> = [];
  for (let k = 0; k < 5; k += 1) palms.push([atDist(lot, 5.4), pZ0 + k * ((pZ1 - pZ0) / 4)]);
  for (let k = 0; k < 4; k += 1) palms.push([atDist(lot, 18), pZ0 + 1 + k * ((pZ1 - pZ0) / 3)]);
  palms.push([atDist(lot, 1.8), gateZ - 3.4], [atDist(lot, 1.8), gateZ + 3.4], [atDist(lot, 10), zc + L * 0.4]);
  garden(b, palms, lot.seed ^ 0x1f, true);
  for (let k = 0; k < 6; k += 1) b.bill('shrub', atDist(lot, 2 + k * 2.6), gateZ - 2.6 - r() * 1.2, 0.55, 0.5, lot.seed + k);

  const [sx0, sx1] = across(lot, 19, back);
  b.shadow(sx0, mz0, sx1, mz1, 11);
  return b.build();
}

/** A neighbourhood park: lawn, crossing paths, a pavilion, trees and benches. */
export function park(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const zc = lotMidZ(lot);
  const depth = lotDepth(lot);
  b.rect(lot.x0 + 0.4, lot.z0 + 0.4, lot.x1 - 0.4, lot.z1 - 0.4, 'lawn');
  const xm = atDist(lot, depth / 2);
  b.rect(lot.x0 + 0.4, zc - 0.7, lot.x1 - 0.4, zc + 0.7, 'path');
  b.rect(xm - 0.7, lot.z0 + 0.4, xm + 0.7, lot.z1 - 0.4, 'path');

  // Pavilion at the crossing.
  b.beginGroup();
  for (const dx of [-1.6, 1.6]) for (const dz of [-1.6, 1.6]) b.box(xm + dx - 0.1, xm + dx + 0.1, 0, 2.6, zc + dz - 0.1, zc + dz + 0.1, 'wall', null);
  b.endGroup();
  b.hip(xm - 1.9, xm + 1.9, zc - 1.9, zc + 1.9, 2.6, 1.5, 'tile', 0.2);

  const pts: Array<[number, number]> = [];
  for (let k = 0; k < 7; k += 1) {
    pts.push([lot.x0 + 1.2 + r() * (depth - 2.4), lot.z0 + 1.2 + r() * (lotLen(lot) - 2.4)]);
  }
  garden(b, pts.filter(([x, z]) => Math.abs(z - zc) > 1.6 && Math.abs(x - xm) > 1.6), lot.seed);
  return b.build();
}
