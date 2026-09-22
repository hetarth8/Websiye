/**
 * Where the city works: shops, showrooms, the mall, offices, the high-rises,
 * the building sites, and the industrial estate.
 *
 * Same rule as living.ts — each type must read from its silhouette. The shop
 * row is low with a canopy and a line of signboards; the showroom is a single
 * glass box; the podium tower is a wide base with a slim shaft; the stepped
 * tower sets back twice; the twin towers share a sky-bridge; the tapered tower
 * narrows as it rises; the building site is open slabs under a crane; the PEB
 * shed is long and low under a shallow pitch with roller shutters on its side.
 */
import { Builder, rng, type BoxFaces } from './geometry';
import {
  across,
  atDist,
  frontX,
  garden,
  lotDepth,
  lotLen,
  lotMidZ,
  parkedCar,
  projecting,
  roadFace,
  truck,
  type Lot,
} from './lot';
import type { Obj } from './types';

const FLOOR = 3.3;
const MULLION = 1.45;

/** Curtain wall: floor lines and mullions on all four sides of a glass volume. */
function curtain(b: Builder, f: BoxFaces, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number): void {
  b.floors(f.nz, 'z', z0, x0, x1, y0, y1, FLOOR);
  b.mullions(f.nz, 'z', z0, x0, x1, y0, y1, MULLION);
  b.floors(f.pz, 'z', z1, x0, x1, y0, y1, FLOOR);
  b.mullions(f.pz, 'z', z1, x0, x1, y0, y1, MULLION);
  b.floors(f.nx, 'x', x0, z0, z1, y0, y1, FLOOR);
  b.mullions(f.nx, 'x', x0, z0, z1, y0, y1, MULLION);
  b.floors(f.px, 'x', x1, z0, z1, y0, y1, FLOOR);
  b.mullions(f.px, 'x', x1, z0, z1, y0, y1, MULLION);
}

/** Lit rooms for after dark, on the two faces a street-level viewer can see. */
function nightRooms(b: Builder, f: BoxFaces, s: 1 | -1, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number): void {
  const rows = Math.max(1, Math.round((y1 - y0) / FLOOR));
  const road = roadFace(f, s);
  b.grid(road, 'x', frontX(x0, x1, s), z0, z1, y0, y1, Math.max(2, Math.round((z1 - z0) / MULLION)), rows, 0.1, 0.18, 0.5);
  road.paneNightOnly = true;
  b.grid(f.nz, 'z', z0, x0, x1, y0, y1, Math.max(2, Math.round((x1 - x0) / MULLION)), rows, 0.1, 0.18, 0.5);
  f.nz.paneNightOnly = true;
}

/**
 * A crown on a tower roof: a plant-room box and an aircraft-warning beacon —
 * or, on about a third of them, a helipad: the circle and the H painted on the
 * roof, which is what makes a tower top read as a real one from above.
 */
function crown(b: Builder, x0: number, x1: number, z0: number, z1: number, y: number, seed: number, spire = 3.5): void {
  const i = Math.min(0.8, (x1 - x0) * 0.15);
  const top = b.box(x0 + i, x1 - i, y, y + 2.6, z0 + i, z1 - i, 'metal', 'roof');
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  if (seed % 3 === 0 && top.top && x1 - x0 > 5) {
    const r = Math.min(x1 - x0, z1 - z0) * 0.3;
    const yy = y + 2.62;
    const ring: number[] = [];
    for (let k = 0; k < 16; k += 1) {
      const a0 = (k / 16) * Math.PI * 2;
      const a1 = ((k + 1) / 16) * Math.PI * 2;
      ring.push(cx + Math.cos(a0) * r, yy, cz + Math.sin(a0) * r, cx + Math.cos(a1) * r, yy, cz + Math.sin(a1) * r);
    }
    const h = r * 0.45;
    ring.push(cx - h * 0.5, yy, cz - h, cx - h * 0.5, yy, cz + h, cx + h * 0.5, yy, cz - h, cx + h * 0.5, yy, cz + h, cx - h * 0.5, yy, cz, cx + h * 0.5, yy, cz);
    b.lines(top.top, ring);
    return;
  }
  b.bill('beacon', cx, cz, 0.3, spire, seed, y + 2.6);
}

/**
 * What actually sits on a flat Indian commercial roof: a parapet, air-handling
 * units and, on about half of them, a solar array. Seen from the aerial camera
 * these roofs are the largest surfaces in shot, and left blank they read as
 * white slabs.
 */
function roofKit(b: Builder, top: BoxFaces['top'], x0: number, x1: number, z0: number, z1: number, y: number, seed: number): void {
  if (!top) return;
  const r = rng(seed ^ 0x5eed);
  const i = 0.32;
  b.lines(top, [
    x0 + i, y + 0.02, z0 + i, x1 - i, y + 0.02, z0 + i,
    x1 - i, y + 0.02, z0 + i, x1 - i, y + 0.02, z1 - i,
    x1 - i, y + 0.02, z1 - i, x0 + i, y + 0.02, z1 - i,
    x0 + i, y + 0.02, z1 - i, x0 + i, y + 0.02, z0 + i,
  ]);
  const w = x1 - x0;
  const l = z1 - z0;
  if (w < 3 || l < 3) return;
  const units = 2 + Math.floor(r() * 2);
  for (let k = 0; k < units; k += 1) {
    const ux = x0 + 1 + r() * Math.max(0.1, w - 3.2);
    const uz = z0 + 1 + r() * Math.max(0.1, l - 3.4);
    b.box(ux, ux + 1.2, y, y + 0.8, uz, uz + 1.4, 'metal', 'roof');
  }
  if (r() > 0.45 && w > 5 && l > 5) {
    const q: number[] = [];
    const rows = Math.max(1, Math.floor((w - 2) / 1.5));
    for (let k = 0; k < rows; k += 1) {
      const xa = x0 + 1 + k * 1.5;
      const za = z0 + l * 0.52;
      const zb = z1 - 1;
      q.push(xa, y + 0.05, za, xa + 1.15, y + 0.05, za, xa + 1.15, y + 0.05, zb, xa, y + 0.05, zb);
    }
    b.panes(top, q, 0);
  }
}

/** A lit sign: an accent or violet board with light "lettering" bars on it. */
function signboard(b: Builder, f: BoxFaces, s: 1 | -1, fx: number, z0: number, z1: number, y0: number, y1: number): void {
  const face = roadFace(f, s);
  const bars: number[] = [];
  const pad = (z1 - z0) * 0.14;
  const yl = y0 + (y1 - y0) * 0.36;
  const yh = y0 + (y1 - y0) * 0.64;
  bars.push(fx, yl, z0 + pad, fx, yl, z1 - pad, fx, yh, z1 - pad, fx, yh, z0 + pad);
  b.panes(face, bars, 1);
}

// ---------------------------------------------------------------------------
// Commercial
// ---------------------------------------------------------------------------

/** A row of shops: glass storefronts, a canopy, a line of signboards, parking in front. */
export function shops(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const z0 = lot.z0 + 0.6;
  const z1 = lot.z1 - 0.6;
  const L = z1 - z0;
  const twoStorey = r() > 0.45;
  const H = twoStorey ? 7.6 : 4.4;

  // Parking between the footpath and the shopfronts.
  const [kx0, kx1] = across(lot, 0.4, 6.6);
  const stalls: number[] = [];
  for (let z = z0; z <= z1 + 1e-3; z += 2.6) stalls.push(kx0 + 0.6, z, kx1 - 0.6, z);
  b.rect(kx0, z0, kx1, z1, 'parking', stalls);

  const [hx0, hx1] = across(lot, 7, Math.min(depth - 0.6, 15));
  const fx = frontX(hx0, hx1, s);
  const body = b.box(hx0, hx1, 0, H, z0, z1, 'wall', 'roof');
  const bays = Math.max(2, Math.round(L / 4.4));
  // Shopfronts: near-full-height glass per bay.
  b.grid(roadFace(body, s), 'x', fx, z0, z1, 0.2, 2.95, bays, 1, 0.07, 0.02, 0.9);
  if (twoStorey) b.grid(roadFace(body, s), 'x', fx, z0, z1, 4.7, 7.1, bays * 2, 1, 0.16, 0.14);
  b.grid(body.nz, 'z', z0, hx0, hx1, 0.3, 2.9, 2, 1, 0.12, 0.05, 0.9);

  // The continuous canopy over the pavement.
  const [cx0, cx1] = projecting(hx0, hx1, s, 1.5);
  b.box(cx0, cx1, 3.05, 3.28, z0, z1, 'slab', 'roof');

  // One signboard per shop, alternating bronze and champagne.
  const bw = L / bays;
  const [sx0, sx1] = projecting(hx0, hx1, s, 0.16);
  const sfx = s > 0 ? sx0 : sx1;
  for (let k = 0; k < bays; k += 1) {
    const za = z0 + k * bw + 0.25;
    const zb = z0 + (k + 1) * bw - 0.25;
    const board = b.box(sx0, sx1, 3.45, 4.2, za, zb, (k + lot.seed) % 2 ? 'sign' : 'accent', 'slab');
    signboard(b, board, s, sfx, za, zb, 3.45, 4.2);
  }

  roofKit(b, body.top, hx0, hx1, z0, z1, H, lot.seed);

  const cars = 2 + Math.floor(r() * 3);
  for (let k = 0; k < cars; k += 1) {
    const slot = Math.floor(r() * Math.max(1, Math.floor(L / 2.6)));
    parkedCar(b, atDist(lot, 3.6), z0 + 1.3 + slot * 2.6, 'x');
  }
  b.bill('lamp', atDist(lot, 0.8), z0 + L * 0.5, 0, 4.2, lot.seed);
  b.shadow(hx0, z0, hx1, z1, H);
  return b.build();
}

/** A car showroom: one tall glass box, a roof sign, an entrance canopy. */
export function showroom(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const z0 = lot.z0 + 0.8;
  const z1 = lot.z1 - 0.8;
  const H = 7.2 + r() * 1.6;

  const [kx0, kx1] = across(lot, 0.4, 5.2);
  b.rect(kx0, z0, kx1, z1, 'walk');
  const [hx0, hx1] = across(lot, 5.4, Math.min(depth - 0.6, 14));
  const fx = frontX(hx0, hx1, s);
  const box = b.box(hx0, hx1, 0, H, z0, z1, 'glass', 'roof');
  b.mullions(roadFace(box, s), 'x', fx, z0, z1, 0, H, 1.8);
  b.floors(roadFace(box, s), 'x', fx, z0, z1, 0, H, 4.2);
  b.mullions(box.nz, 'z', z0, hx0, hx1, 0, H, 1.8);
  b.floors(box.nz, 'z', z0, hx0, hx1, 0, H, 4.2);
  nightRooms(b, box, s, hx0, hx1, z0, z1, 0.3, H - 0.3);

  // Roof sign standing on the street edge of the roof.
  const [rx0, rx1] = across(lot, 5.6, 6.0);
  const zs0 = z0 + (z1 - z0) * 0.25;
  const zs1 = z1 - (z1 - z0) * 0.25;
  const sign = b.box(rx0, rx1, H, H + 1.5, zs0, zs1, 'accent', 'slab');
  signboard(b, sign, s, frontX(rx0, rx1, s), zs0, zs1, H, H + 1.5);

  const [cx0, cx1] = projecting(hx0, hx1, s, 2.6);
  b.box(cx0, cx1, 3.9, 4.15, (z0 + z1) / 2 - 2.4, (z0 + z1) / 2 + 2.4, 'slab', 'roof');
  roofKit(b, box.top, hx0, hx1, z0, z1, H, lot.seed);
  parkedCar(b, atDist(lot, 2.6), z0 + 2, 'z');
  if (r() > 0.4) parkedCar(b, atDist(lot, 2.6), z1 - 2, 'z');
  b.shadow(hx0, z0, hx1, z1, H + 1.5);
  return b.build();
}

/** The mall: a large block, a taller glass atrium, a signage band, a car park. */
export function mall(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const z0 = lot.z0 + 0.6;
  const z1 = lot.z1 - 0.6;
  const zc = lotMidZ(lot);
  const H = 11.5;

  const [kx0, kx1] = across(lot, 0.4, 7.2);
  const stalls: number[] = [];
  for (let z = z0; z <= z1 + 1e-3; z += 2.6) stalls.push(kx0 + 0.5, z, kx1 - 0.5, z);
  b.rect(kx0, z0, kx1, z1, 'parking', stalls);

  const [hx0, hx1] = across(lot, 9.4, Math.min(depth - 0.4, 22));
  const body = b.box(hx0, hx1, 0, H, z0, z1, 'wall', 'roof');
  const fx = frontX(hx0, hx1, s);
  b.grid(roadFace(body, s), 'x', fx, z0, z1, 0.3, 3.6, Math.round((z1 - z0) / 3), 1, 0.06, 0.04, 0.9);
  b.grid(body.nz, 'z', z0, hx0, hx1, 0.3, 3.6, Math.round((hx1 - hx0) / 3), 1, 0.06, 0.04, 0.9);

  // Signage band across the upper facade.
  const [bx0, bx1] = projecting(hx0, hx1, s, 0.18);
  const band = b.box(bx0, bx1, 7.6, 9.2, z0 + (z1 - z0) * 0.12, zc - 3.6, 'accent', 'slab');
  signboard(b, band, s, s > 0 ? bx0 : bx1, z0 + (z1 - z0) * 0.12, zc - 3.6, 7.6, 9.2);

  // The atrium: taller, all glass, pushed out toward the street.
  const [ax0, ax1] = across(lot, 7.2, 13);
  const atrium = b.box(ax0, ax1, 0, H + 3.2, zc - 3.4, zc + 3.4, 'glass', 'roof');
  const afx = frontX(ax0, ax1, s);
  b.mullions(roadFace(atrium, s), 'x', afx, zc - 3.4, zc + 3.4, 0, H + 3.2, 1.4);
  b.floors(roadFace(atrium, s), 'x', afx, zc - 3.4, zc + 3.4, 0, H + 3.2, 4.4);
  b.mullions(atrium.nz, 'z', zc - 3.4, ax0, ax1, 0, H + 3.2, 1.4);
  nightRooms(b, atrium, s, ax0, ax1, zc - 3.4, zc + 3.4, 0.3, H + 2.8);

  roofKit(b, body.top, hx0, hx1, z0, z1, H, lot.seed);
  for (let k = 0; k < 5; k += 1) parkedCar(b, atDist(lot, 3.8), z0 + 1.3 + k * 5.2, 'x');
  b.bill('lamp', atDist(lot, 3.8), zc, 0, 4.4, lot.seed);
  b.shadow(hx0, z0, hx1, z1, H);
  b.shadow(ax0, zc - 3.4, ax1, zc + 3.4, H + 3.2);
  return b.build();
}

/** Low-rise office: ribbon windows, a porte-cochère canopy, rooftop plant. */
export function office(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const zc = lotMidZ(lot);
  const floors = 3 + Math.floor(r() * 2);
  const H = floors * 3.6;
  const w = Math.min(depth - 3.4, 12);
  const L = Math.min(lotLen(lot) - 2.2, 16);
  const [hx0, hx1] = across(lot, 2.6, 2.6 + w);
  const z0 = zc - L / 2;
  const z1 = zc + L / 2;
  const fx = frontX(hx0, hx1, s);

  b.rect(lot.x0 + 0.3, lot.z0 + 0.3, lot.x1 - 0.3, lot.z1 - 0.3, 'walk');
  const body = b.box(hx0, hx1, 0, H, z0, z1, 'wall', 'roof');
  b.grid(roadFace(body, s), 'x', fx, z0 + 0.3, z1 - 0.3, 0.3, H - 0.3, 1, floors, 0.01, 0.3, 0.6);
  b.mullions(roadFace(body, s), 'x', fx, z0, z1, 0, H, 1.6);
  b.grid(body.nz, 'z', z0, hx0 + 0.3, hx1 - 0.3, 0.3, H - 0.3, 1, floors, 0.01, 0.3, 0.6);
  b.grid(body.pz, 'z', z1, hx0 + 0.3, hx1 - 0.3, 0.3, H - 0.3, 1, floors, 0.01, 0.3, 0.6);

  const [cx0, cx1] = projecting(hx0, hx1, s, 2.4);
  b.box(cx0, cx1, 3.3, 3.55, zc - 2.4, zc + 2.4, 'slab', 'roof');
  roofKit(b, body.top, hx0, hx1, z0, z1, H, lot.seed);

  garden(b, [[atDist(lot, 1.2), z0 + 0.8], [atDist(lot, 1.2), z1 - 0.8]], lot.seed);
  b.shadow(hx0, z0, hx1, z1, H);
  return b.build();
}

// ---------------------------------------------------------------------------
// High-rise
// ---------------------------------------------------------------------------

/** The podium tower: a two-storey base, a glass shaft, a crown and a beacon. */
export function tower(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const zc = lotMidZ(lot);
  const pw = Math.min(depth - 1.2, 13);
  const pl = Math.min(lotLen(lot) - 1.6, 13);
  const [px0, px1] = across(lot, 0.8, 0.8 + pw);
  const pz0 = zc - pl / 2;
  const pz1 = zc + pl / 2;

  b.rect(lot.x0 + 0.2, lot.z0 + 0.2, lot.x1 - 0.2, lot.z1 - 0.2, 'walk');
  const podium = b.box(px0, px1, 0, 5.6, pz0, pz1, 'wall', 'roof');
  b.grid(roadFace(podium, s), 'x', frontX(px0, px1, s), pz0 + 0.3, pz1 - 0.3, 0.3, 5.3, Math.round(pl / 2.1), 2, 0.05, 0.14, 0.8);
  b.grid(podium.nz, 'z', pz0, px0 + 0.3, px1 - 0.3, 0.3, 5.3, Math.round(pw / 2.1), 2, 0.05, 0.14, 0.8);

  // Plant on the podium roof, clear of the shaft.
  roofKit(b, podium.top, px0, px1, pz0, pz0 + pl * 0.2, 5.6, lot.seed);
  const cx = (px0 + px1) / 2;
  const tw = pw * 0.62;
  const tl = pl * 0.62;
  const tx0 = cx - tw / 2;
  const tx1 = cx + tw / 2;
  const tz0 = zc - tl / 2;
  const tz1 = zc + tl / 2;
  const th = 28 + r() * 26;
  const shaft = b.box(tx0, tx1, 5.6, th, tz0, tz1, 'glass', 'roof');
  curtain(b, shaft, tx0, tx1, tz0, tz1, 5.6, th);
  nightRooms(b, shaft, s, tx0, tx1, tz0, tz1, 5.8, th - 0.3);

  // A full-height accent fin on the street corner of the shaft.
  if (r() > 0.4) {
    const fx0 = s > 0 ? tx0 - 0.28 : tx1 - 0.3;
    b.box(fx0, fx0 + 0.58, 5.6, th + 1.6, tz0 - 0.32, tz0 + 0.05, 'accent', 'accent');
  }
  crown(b, tx0, tx1, tz0, tz1, th, lot.seed, 3 + r() * 3);
  b.shadow(px0, pz0, px1, pz1, 5.6);
  b.shadow(tx0, tz0, tx1, tz1, th);
  return b.build();
}

/** Three tiers, each set back from the one below — the classic skyscraper profile. */
export function towerStep(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const zc = lotMidZ(lot);
  const w0 = Math.min(depth - 1.6, 11.5);
  const l0 = Math.min(lotLen(lot) - 2, 11.5);
  const cx = atDist(lot, 1 + w0 / 2);
  const th = 34 + r() * 24;
  const tiers = [
    { k: 1, y0: 0, y1: th * 0.46 },
    { k: 0.78, y0: th * 0.46, y1: th * 0.76 },
    { k: 0.56, y0: th * 0.76, y1: th },
  ];

  b.rect(lot.x0 + 0.2, lot.z0 + 0.2, lot.x1 - 0.2, lot.z1 - 0.2, 'walk');
  let top: [number, number, number, number] = [0, 0, 0, 0];
  for (const t of tiers) {
    const x0 = cx - (w0 * t.k) / 2;
    const x1 = cx + (w0 * t.k) / 2;
    const z0 = zc - (l0 * t.k) / 2;
    const z1 = zc + (l0 * t.k) / 2;
    const f = b.box(x0, x1, t.y0, t.y1, z0, z1, 'glass', 'roof');
    curtain(b, f, x0, x1, z0, z1, t.y0, t.y1);
    nightRooms(b, f, s, x0, x1, z0, z1, t.y0 + 0.2, t.y1 - 0.3);
    b.shadow(x0, z0, x1, z1, t.y1);
    top = [x0, x1, z0, z1];
  }
  crown(b, top[0], top[1], top[2], top[3], th, lot.seed, 5);
  return b.build();
}

/** Twin towers of unequal height on a shared podium, joined by a sky-bridge. */
export function towerTwin(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const zc = lotMidZ(lot);
  const pw = Math.min(depth - 1.2, 12.5);
  const pl = Math.min(lotLen(lot) - 1.2, 14);
  const [px0, px1] = across(lot, 0.8, 0.8 + pw);
  b.rect(lot.x0 + 0.2, lot.z0 + 0.2, lot.x1 - 0.2, lot.z1 - 0.2, 'walk');
  const podium = b.box(px0, px1, 0, 4.6, zc - pl / 2, zc + pl / 2, 'wall', 'roof');
  b.grid(roadFace(podium, s), 'x', frontX(px0, px1, s), zc - pl / 2 + 0.3, zc + pl / 2 - 0.3, 0.3, 4.3, Math.round(pl / 2.1), 1, 0.05, 0.1, 0.8);

  const cx = (px0 + px1) / 2;
  const w = pw * 0.5;
  const l = pl * 0.36;
  const h1 = 30 + r() * 12;
  const h2 = h1 + 6 + r() * 6;
  const zs = [zc - pl * 0.26, zc + pl * 0.26];
  const hs = [h1, h2];
  zs.forEach((z, i) => {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const f = b.box(x0, x1, 4.6, hs[i]!, z - l / 2, z + l / 2, 'glass', 'roof');
    curtain(b, f, x0, x1, z - l / 2, z + l / 2, 4.6, hs[i]!);
    nightRooms(b, f, s, x0, x1, z - l / 2, z + l / 2, 4.8, hs[i]! - 0.3);
    crown(b, x0, x1, z - l / 2, z + l / 2, hs[i]!, lot.seed + i, 3);
    b.shadow(x0, z - l / 2, x1, z + l / 2, hs[i]!);
  });

  // The sky-bridge, two-thirds of the way up the shorter tower.
  const by = h1 * 0.62;
  const bridge = b.box(cx - w * 0.3, cx + w * 0.3, by, by + 3.3, zs[0]! + l / 2, zs[1]! - l / 2, 'glass', 'roof');
  b.mullions(bridge.nz, 'z', zs[0]! + l / 2, cx - w * 0.3, cx + w * 0.3, by, by + 3.3, 1);
  b.mullions(roadFace(bridge, s), 'x', frontX(cx - w * 0.3, cx + w * 0.3, s), zs[0]! + l / 2, zs[1]! - l / 2, by, by + 3.3, 1.1);
  return b.build();
}

/** A tower that narrows as it rises, its floor lines and mullions following the taper. */
export function towerTaper(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const depth = lotDepth(lot);
  const zc = lotMidZ(lot);
  const w = Math.min(depth - 2, 11);
  const l = Math.min(lotLen(lot) - 2, 11);
  const cx = atDist(lot, 1.2 + w / 2);
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = zc - l / 2;
  const z1 = zc + l / 2;
  const th = 40 + r() * 18;
  const taper = 0.36;

  b.rect(lot.x0 + 0.2, lot.z0 + 0.2, lot.x1 - 0.2, lot.z1 - 0.2, 'walk');
  const f = b.frustum(x0, x1, z0, z1, 0, th, taper, 'glass');
  const k = 1 - taper;
  const at = (a0: number, a1: number, t: number, c: number) => {
    const s0 = c + (a0 - c) * (1 - (1 - k) * t);
    const s1 = c + (a1 - c) * (1 - (1 - k) * t);
    return [s0, s1] as const;
  };

  // Floor lines follow the taper face by face.
  const floorsNZ: number[] = [];
  const floorsPZ: number[] = [];
  const floorsNX: number[] = [];
  const floorsPX: number[] = [];
  for (let y = FLOOR; y < th - 1; y += FLOOR) {
    const t = y / th;
    const [xa, xb] = at(x0, x1, t, cx);
    const [za, zb] = at(z0, z1, t, zc);
    floorsNZ.push(xa, y, za, xb, y, za);
    floorsPZ.push(xa, y, zb, xb, y, zb);
    floorsNX.push(xa, y, za, xa, y, zb);
    floorsPX.push(xb, y, za, xb, y, zb);
  }
  // Mullions converge toward the crown.
  const mullNZ: number[] = [];
  const mullNX: number[] = [];
  const mullPX: number[] = [];
  const [ux0, ux1] = at(x0, x1, 1, cx);
  const [uz0, uz1] = at(z0, z1, 1, zc);
  const n = 7;
  for (let i = 1; i < n; i += 1) {
    const t = i / n;
    mullNZ.push(x0 + (x1 - x0) * t, 0, z0, ux0 + (ux1 - ux0) * t, th, uz0);
    mullNX.push(x0, 0, z0 + (z1 - z0) * t, ux0, th, uz0 + (uz1 - uz0) * t);
    mullPX.push(x1, 0, z0 + (z1 - z0) * t, ux1, th, uz0 + (uz1 - uz0) * t);
  }
  b.lines(f.nz, [...floorsNZ, ...mullNZ]);
  b.lines(f.pz, floorsPZ);
  b.lines(f.nx, [...floorsNX, ...mullNX]);
  b.lines(f.px, [...floorsPX, ...mullPX]);
  b.bill('beacon', cx, zc, 0.3, 7, lot.seed, th);
  b.shadow(x0, z0, x1, z1, th);
  return b.build();
}

/**
 * A tower under construction: bare floor slabs, columns and starter bars
 * rising past the top slab, a hoarding on the street and a tower crane.
 */
export function construction(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const zc = lotMidZ(lot);
  const w = Math.min(depth - 3, 11.5);
  const l = Math.min(lotLen(lot) - 3, 12);
  const [x0, x1] = across(lot, 2.2, 2.2 + w);
  const z0 = zc - l / 2;
  const z1 = zc + l / 2;
  const floors = 7 + Math.floor(r() * 9);
  const fh = 3.2;
  const top = floors * fh;

  b.rect(lot.x0 + 0.2, lot.z0 + 0.2, lot.x1 - 0.2, lot.z1 - 0.2, 'yard');

  let ground: BoxFaces | null = null;
  for (let k = 0; k <= floors; k += 1) {
    const y = k * fh;
    const slab = b.box(x0, x1, y, y + 0.3, z0, z1, 'slab', 'slab');
    if (!ground) ground = slab;
  }
  // Columns on a grid, running up past the top slab as starter bars.
  if (ground) {
    const cols: number[] = [];
    const nx = 4;
    const nz = 4;
    for (let i = 0; i <= nx; i += 1) {
      for (let j = 0; j <= nz; j += 1) {
        if (i > 0 && i < nx && j > 0 && j < nz) continue;
        const x = x0 + ((x1 - x0) * i) / nx;
        const z = z0 + ((z1 - z0) * j) / nz;
        cols.push(x, 0, z, x, top + fh * 1.1, z);
      }
    }
    b.partLines(ground.part, cols);
  }

  // Site hoarding along the street, carrying the developer's board.
  const [hx0, hx1] = across(lot, 0.4, 0.62);
  const hoard = b.box(hx0, hx1, 0, 2.5, lot.z0 + 0.6, lot.z1 - 0.6, 'sign', 'slab');
  signboard(b, hoard, s, frontX(hx0, hx1, s), lot.z0 + 1.2, lot.z1 - 1.2, 0.4, 2.2);

  // Materials stacked in the yard.
  const [mx0, mx1] = across(lot, 0.9, 1.9);
  b.box(mx0, mx1, 0, 0.7, z0, z0 + 1.6, 'slab', 'slab');

  // The crane stands off the back corner, its jib clearing the top floor.
  b.bill('crane', atDist(lot, 2.2 + w + 0.9), z1 + 0.6, 17 + r() * 5, top + 12, lot.seed);
  b.shadow(x0, z0, x1, z1, top);
  return b.build();
}

// ---------------------------------------------------------------------------
// Industrial
// ---------------------------------------------------------------------------

/** Roller shutter: a panel over the wall, with its slats. */
function shutter(b: Builder, face: ReturnType<typeof roadFace>, axis: 'x' | 'z', c: number, a0: number, a1: number, h: number): void {
  const pts = axis === 'x' ? [c, 0, a0, c, 0, a1, c, h, a1, c, h, a0] : [a0, 0, c, a1, 0, c, a1, h, c, a0, h, c];
  const panel = b.panel(face, pts, 'shutter');
  const slats: number[] = [];
  for (let y = 0.3; y < h; y += 0.3) {
    if (axis === 'x') slats.push(c, y, a0, c, y, a1);
    else slats.push(a0, y, c, a1, y, c);
  }
  b.lines(panel, slats);
}

/** Pre-engineered steel shed: shallow pitch, portal frames, roller shutters, docks. */
export function shed(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const setback = 7.2;
  const W = Math.max(8, Math.min(16, depth - setback - 1));
  const [hx0, hx1] = across(lot, setback, setback + W);
  const hz0 = lot.z0 + 1.2;
  const hz1 = lot.z1 - 1.2;
  const H = 6.4 + r() * 1.3;
  const rh = W * 0.11;
  const fx = frontX(hx0, hx1, s);

  // Yard with the perimeter fence marked on it.
  const fence = [
    lot.x0 + 0.3, lot.z0 + 0.3, lot.x1 - 0.3, lot.z0 + 0.3,
    lot.x1 - 0.3, lot.z0 + 0.3, lot.x1 - 0.3, lot.z1 - 0.3,
    lot.x1 - 0.3, lot.z1 - 0.3, lot.x0 + 0.3, lot.z1 - 0.3,
    lot.x0 + 0.3, lot.z1 - 0.3, lot.x0 + 0.3, lot.z0 + 0.3,
  ];
  b.rect(lot.x0 + 0.3, lot.z0 + 0.3, lot.x1 - 0.3, lot.z1 - 0.3, 'yard', fence);

  const main = b.box(hx0, hx1, 0, H, hz0, hz1, 'metal', null);
  const road = roadFace(main, s);
  b.mullions(road, 'x', fx, hz0, hz1, 0, H, 4.6);
  b.lines(road, [fx, 3.9, hz0, fx, 3.9, hz1]);
  const n = Math.max(2, Math.floor((hz1 - hz0) / 8));
  for (let k = 0; k < n; k += 1) {
    const zm = hz0 + ((k + 0.5) * (hz1 - hz0)) / n;
    shutter(b, road, 'x', fx, zm - 1.7, zm + 1.7, 4.4);
  }
  // The gable end facing the approaching traffic gets a big shutter too.
  const xm = (hx0 + hx1) / 2;
  shutter(b, main.nz, 'z', hz0, xm - 2, xm + 2, 5);

  // The roof: shallow pitch, ridge along the length, sheeting lines down each slope.
  const roof = b.gable(hx0, hx1, hz0, hz1, H, rh, 'z', 'metal', 0.4);
  const sheetA: number[] = [];
  const sheetB: number[] = [];
  for (let z = hz0 - 0.4; z <= hz1 + 0.4; z += 1.15) {
    sheetA.push(hx0 - 0.4, H, z, xm, H + rh, z);
    sheetB.push(hx1 + 0.4, H, z, xm, H + rh, z);
  }
  if (roof[0]) b.lines(roof[0], sheetA);
  if (roof[1]) b.lines(roof[1], sheetB);

  // Dock: platform and canopy along the street side.
  const [dx0, dx1] = projecting(hx0, hx1, s, 1.9);
  b.box(dx0, dx1, 0, 1.05, hz0 + 0.8, hz1 - 0.8, 'slab', 'slab');
  b.box(dx0, dx1, 4.75, 4.95, hz0 + 0.8, hz1 - 0.8, 'slab', 'roof');

  truck(b, atDist(lot, 3.5), hz0 + 1.5, 'z', 1);
  if (r() > 0.45) truck(b, atDist(lot, 3.5), hz1 - 9.5, 'z', 1);

  if (r() > 0.55) {
    const [cx0, cx1] = across(lot, setback + W - 1.4, setback + W - 0.6);
    b.box(cx0, cx1, 0, H + 7, hz1 - 1.6, hz1 - 0.8, 'metal', 'roof');
    b.bill('beacon', (cx0 + cx1) / 2, hz1 - 1.2, 0.2, 1, lot.seed, H + 7);
  }
  b.shadow(hx0, hz0, hx1, hz1, H + rh);
  return b.build();
}

/** Warehouse / logistics hub: tall flat-roofed box, skylights, a row of docks, lorries. */
export function warehouse(lot: Lot, logistics = false): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const setback = 7.6;
  const W = Math.max(10, Math.min(20, depth - setback - 1));
  const [hx0, hx1] = across(lot, setback, setback + W);
  const hz0 = lot.z0 + 1;
  const hz1 = lot.z1 - 1;
  const H = 9 + r() * 2.2;
  const fx = frontX(hx0, hx1, s);

  b.rect(lot.x0 + 0.3, lot.z0 + 0.3, lot.x1 - 0.3, lot.z1 - 0.3, 'yard');
  const main = b.box(hx0, hx1, 0, H, hz0, hz1, 'metal', 'roof');
  const road = roadFace(main, s);
  const docks = Math.max(3, Math.floor((hz1 - hz0) / 4.3));
  for (let k = 0; k < docks; k += 1) {
    const zm = hz0 + ((k + 0.5) * (hz1 - hz0)) / docks;
    shutter(b, road, 'x', fx, zm - 1.4, zm + 1.4, 3.9);
  }
  b.mullions(main.nz, 'z', hz0, hx0, hx1, 0, H, 3.2);

  // Skylight strips across the roof.
  if (main.top) {
    const q: number[] = [];
    for (let x = hx0 + 1.8; x < hx1 - 1.2; x += 3.4) {
      q.push(x, H + 0.02, hz0 + 1.4, x + 1.1, H + 0.02, hz0 + 1.4, x + 1.1, H + 0.02, hz1 - 1.4, x, H + 0.02, hz1 - 1.4);
    }
    b.panes(main.top, q, 0.2);
  }

  // Company signage high on the street face.
  const [sx0, sx1] = projecting(hx0, hx1, s, 0.16);
  const za = hz0 + (hz1 - hz0) * 0.25;
  const zb = hz1 - (hz1 - hz0) * 0.25;
  const board = b.box(sx0, sx1, H - 2.4, H - 0.8, za, zb, 'accent', 'slab');
  signboard(b, board, s, s > 0 ? sx0 : sx1, za, zb, H - 2.4, H - 0.8);

  const [dx0, dx1] = projecting(hx0, hx1, s, 1.9);
  b.box(dx0, dx1, 0, 1.1, hz0 + 0.5, hz1 - 0.5, 'slab', 'slab');
  b.box(dx0, dx1, 4.5, 4.7, hz0 + 0.5, hz1 - 0.5, 'slab', 'roof');

  const lorries = logistics ? 3 : 1 + Math.floor(r() * 2);
  for (let k = 0; k < lorries; k += 1) truck(b, atDist(lot, 3.3), hz0 + 1 + k * 9.2, 'z', 1);
  b.shadow(hx0, hz0, hx1, hz1, H);
  return b.build();
}

/** A bank of silos with its bucket elevator, conveyor and control room. */
export function silos(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const r = rng(lot.seed);
  const s = lot.side;
  const depth = lotDepth(lot);
  const zc = lotMidZ(lot);
  b.rect(lot.x0 + 0.3, lot.z0 + 0.3, lot.x1 - 0.3, lot.z1 - 0.3, 'yard');

  const count = 3 + Math.floor(r() * 2);
  const h = 13 + r() * 4;
  const d = Math.min(depth - 6, 12);
  for (let k = 0; k < count; k += 1) {
    const z = lot.z0 + 3 + k * ((lotLen(lot) - 6) / Math.max(1, count - 1));
    b.bill('silo', atDist(lot, d), z, 2.05, h, lot.seed + k);
    b.shadow(atDist(lot, d) - 2, z - 2, atDist(lot, d) + 2, z + 2, h);
  }

  // Bucket elevator: a tall steel shaft with a truss conveyor running up to it.
  const [ex0, ex1] = across(lot, d - 4.2, d - 3.0);
  const elev = b.box(ex0, ex1, 0, h + 5, zc - 0.6, zc + 0.6, 'metal', 'roof');
  const ground = atDist(lot, 1.6);
  const topX = (ex0 + ex1) / 2;
  const truss: number[] = [ground, 0.8, zc - 0.4, topX, h + 4, zc - 0.4, ground, 0.8, zc + 0.4, topX, h + 4, zc + 0.4];
  for (let t = 0; t <= 1.001; t += 0.1) {
    const x = ground + (topX - ground) * t;
    const y = 0.8 + (h + 3.2) * t;
    truss.push(x, y, zc - 0.4, x, y, zc + 0.4);
  }
  b.partLines(elev.part, truss);
  b.bill('beacon', topX, zc, 0.2, 1, lot.seed, h + 5);

  const [cx0, cx1] = across(lot, 1.2, 5.6);
  const ctrl = b.box(cx0, cx1, 0, 3.6, lot.z0 + 1, lot.z0 + 5.4, 'wall', 'roof');
  b.grid(roadFace(ctrl, s), 'x', frontX(cx0, cx1, s), lot.z0 + 1.3, lot.z0 + 5.1, 0.9, 3, 2, 1, 0.16, 0.12);
  return b.build();
}

/** Fuel station: branded canopy on columns, pump islands, kiosk, price pylon. */
export function petrol(lot: Lot): Obj {
  const b = new Builder(lot.seed);
  const s = lot.side;
  const zc = lotMidZ(lot);
  const L = lotLen(lot);
  b.rect(lot.x0 + 0.2, lot.z0 + 0.2, lot.x1 - 0.2, lot.z1 - 0.2, 'asphalt');

  const [cx0, cx1] = across(lot, 2, 9.8);
  const cz0 = zc - L * 0.3;
  const cz1 = zc + L * 0.18;
  b.beginGroup();
  for (const x of [cx0 + 1.2, cx1 - 1.2]) for (const z of [cz0 + 1.2, cz1 - 1.2]) b.box(x - 0.18, x + 0.18, 0, 5, z - 0.18, z + 0.18, 'wall', null);
  b.endGroup();
  b.beginGroup();
  for (const z of [cz0 + 2.4, cz1 - 2.4]) {
    const [ix0, ix1] = across(lot, 5.3, 6.5);
    b.box(ix0, ix1, 0, 0.25, z - 1.8, z + 1.8, 'slab', 'slab');
    b.box(ix0 + 0.25, ix1 - 0.25, 0.25, 1.8, z - 0.4, z + 0.4, 'accent', 'accent');
  }
  b.endGroup();
  const canopy = b.box(cx0, cx1, 5, 5.75, cz0, cz1, 'accent', 'roof');
  signboard(b, canopy, s, frontX(cx0, cx1, s), cz0 + 1, cz1 - 1, 5.05, 5.7);

  const [kx0, kx1] = across(lot, 11, 16.5);
  const kiosk = b.box(kx0, kx1, 0, 3.4, zc + L * 0.22, zc + L * 0.44, 'wall', 'roof');
  b.grid(roadFace(kiosk, s), 'x', frontX(kx0, kx1, s), zc + L * 0.24, zc + L * 0.42, 0.2, 2.8, 3, 1, 0.06, 0.03, 0.9);

  const [yx0, yx1] = across(lot, 0.6, 1.1);
  const pylon = b.box(yx0, yx1, 0, 7.2, cz0 - 2.2, cz0 - 1.2, 'sign', 'slab');
  signboard(b, pylon, s, frontX(yx0, yx1, s), cz0 - 2.15, cz0 - 1.25, 4.4, 6.9);
  parkedCar(b, atDist(lot, 4.2), cz0 + 2.4, 'z');
  b.shadow(cx0, cz0, cx1, cz1, 5.75);
  return b.build();
}
