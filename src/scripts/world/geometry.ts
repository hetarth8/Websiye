/**
 * Geometry construction: the vocabulary every building is written in.
 *
 * A building is a handful of convex PARTS (a box, a roof, a balcony slab), each
 * a list of planar FACES. Facade detail — glazing, mullions, floor lines,
 * railings, shutter slats — is attached to the face it sits on, so it is culled
 * with that face: the back of a tower costs nothing because its windows are
 * never even projected.
 *
 * Draw order inside a part is array order. That is what lets a shutter or a
 * signboard be added as a coplanar face AFTER the wall it sits on and reliably
 * paint over it, without a depth buffer.
 */
import type { Bill, BillKind, Decal, Face, GroundKind, Material, Obj, Part } from './types';

// ---------------------------------------------------------------------------
// Light and randomness
// ---------------------------------------------------------------------------

/** Direction TO the sun: high, from the front-left. Fixed, so shading is baked. */
const SUN = (() => {
  const v = [-0.5, 0.78, -0.38];
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return v.map((c) => c / l) as [number, number, number];
})();

/** Sun shading for a face normal, as one of the eight tones a theme defines. */
export function shadeLevel(nx: number, ny: number, nz: number): number {
  const s = nx * SUN[0] + ny * SUN[1] + nz * SUN[2];
  const b = Math.min(1, Math.max(0, 0.35 + 0.65 * s));
  return Math.round(b * 7);
}

/** Deterministic 32-bit hash of integers: the same lot is the same building forever. */
export function hashInts(...n: number[]): number {
  let h = 0x811c9dc5;
  for (const v of n) {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and good enough for choosing window lights. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Newell's method: a robust normal for any planar polygon. */
function newell(p: number[]): [number, number, number] {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = p.length / 3;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const x1 = p[i * 3]!;
    const y1 = p[i * 3 + 1]!;
    const z1 = p[i * 3 + 2]!;
    const x2 = p[j * 3]!;
    const y2 = p[j * 3 + 1]!;
    const z2 = p[j * 3 + 2]!;
    nx += (y1 - y2) * (z1 + z2);
    ny += (z1 - z2) * (x1 + x2);
    nz += (x1 - x2) * (y1 + y2);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/** A face while it is still being decorated. */
interface Draft extends Face {
  _panes?: number[];
  _vars?: number[];
  _lines?: number[];
}

export interface BoxFaces {
  /** Faces by the direction their normal points. */
  nz: Draft;
  pz: Draft;
  nx: Draft;
  px: Draft;
  top: Draft | null;
  part: Part;
}

export class Builder {
  private readonly parts: Part[] = [];
  private readonly bills: Bill[] = [];
  private readonly decals: Decal[] = [];
  private readonly shadowList: number[] = [];
  private readonly drafts: Draft[] = [];
  private readonly partSegs = new Map<Part, number[]>();
  private group: Part | null = null;
  /** Seeds per-pane lighting so a building's windows stay lit the same way. */
  private paneSeed: () => number;

  constructor(seed: number) {
    this.paneSeed = rng(seed ^ 0x9e3779b9);
  }

  face(pts: number[], mat: Material, n?: readonly [number, number, number], hint?: readonly [number, number, number]): Draft {
    let [nx, ny, nz] = n ?? newell(pts);
    if (!n && hint) {
      // Orient outward: the normal must point away from the part's interior.
      const cx = pts.filter((_, i) => i % 3 === 0).reduce((a, b) => a + b, 0) / (pts.length / 3);
      const cy = pts.filter((_, i) => i % 3 === 1).reduce((a, b) => a + b, 0) / (pts.length / 3);
      const cz = pts.filter((_, i) => i % 3 === 2).reduce((a, b) => a + b, 0) / (pts.length / 3);
      if (nx * (cx - hint[0]) + ny * (cy - hint[1]) + nz * (cz - hint[2]) < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
    }
    const f: Draft = { p: new Float32Array(pts), nx, ny, nz, mat, level: shadeLevel(nx, ny, nz) };
    this.drafts.push(f);
    return f;
  }

  /** Faces added between begin/end share one part: one sort key, one outline stroke. */
  beginGroup(): void {
    this.group = {
      faces: [],
      y0: Infinity,
      y1: -Infinity,
      cx: 0,
      cz: 0,
      bx0: Infinity,
      bx1: -Infinity,
      bz0: Infinity,
      bz1: -Infinity,
    };
  }

  endGroup(): Part | null {
    const g = this.group;
    this.group = null;
    if (!g || !g.faces.length) return null;
    g.cx = (g.bx0 + g.bx1) / 2;
    g.cz = (g.bz0 + g.bz1) / 2;
    this.parts.push(g);
    return g;
  }

  private addPart(faces: Draft[], y0: number, y1: number, cx: number, cz: number): Part {
    let bx0 = Infinity;
    let bx1 = -Infinity;
    let bz0 = Infinity;
    let bz1 = -Infinity;
    for (const f of faces) {
      for (let i = 0; i < f.p.length; i += 3) {
        const x = f.p[i]!;
        const z = f.p[i + 2]!;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (z < bz0) bz0 = z;
        if (z > bz1) bz1 = z;
      }
    }
    if (this.group) {
      const g = this.group;
      g.faces.push(...faces);
      g.y0 = Math.min(g.y0, y0);
      g.y1 = Math.max(g.y1, y1);
      g.bx0 = Math.min(g.bx0, bx0);
      g.bx1 = Math.max(g.bx1, bx1);
      g.bz0 = Math.min(g.bz0, bz0);
      g.bz1 = Math.max(g.bz1, bz1);
      return g;
    }
    const part: Part = { faces, y0, y1, cx, cz, bx0, bx1, bz0, bz1 };
    this.parts.push(part);
    return part;
  }

  /** An axis-aligned box. `top` null leaves it open for a roof to sit on. */
  box(
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    mat: Material,
    top: Material | null = 'roof',
  ): BoxFaces {
    const nz = this.face([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0], mat, [0, 0, -1]);
    const pz = this.face([x1, y0, z1, x0, y0, z1, x0, y1, z1, x1, y1, z1], mat, [0, 0, 1]);
    const nx = this.face([x0, y0, z1, x0, y0, z0, x0, y1, z0, x0, y1, z1], mat, [-1, 0, 0]);
    const px = this.face([x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0], mat, [1, 0, 0]);
    const faces: Draft[] = [nz, pz, nx, px];
    let tp: Draft | null = null;
    if (top) {
      tp = this.face([x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1], top, [0, 1, 0]);
      faces.push(tp);
    }
    const part = this.addPart(faces, y0, y1, (x0 + x1) / 2, (z0 + z1) / 2);
    return { nz, pz, nx, px, top: tp, part };
  }

  /**
   * A pitched roof on the rectangle x0..x1 × z0..z1 at height y.
   * `axis` is the direction the ridge runs. Eaves overhang by `ov`.
   */
  gable(x0: number, x1: number, z0: number, z1: number, y: number, rh: number, axis: 'x' | 'z', mat: Material, ov = 0.35): Draft[] {
    const hint: [number, number, number] = [(x0 + x1) / 2, y + rh * 0.3, (z0 + z1) / 2];
    const a0 = x0 - ov;
    const a1 = x1 + ov;
    const b0 = z0 - ov;
    const b1 = z1 + ov;
    let faces: Draft[];
    if (axis === 'z') {
      const xm = (x0 + x1) / 2;
      faces = [
        this.face([a0, y, b0, xm, y + rh, b0, xm, y + rh, b1, a0, y, b1], mat, undefined, hint),
        this.face([a1, y, b0, a1, y, b1, xm, y + rh, b1, xm, y + rh, b0], mat, undefined, hint),
        this.face([x0, y, z0, x1, y, z0, xm, y + rh, z0], 'wall', [0, 0, -1]),
        this.face([x1, y, z1, x0, y, z1, xm, y + rh, z1], 'wall', [0, 0, 1]),
      ];
    } else {
      const zm = (z0 + z1) / 2;
      faces = [
        this.face([a0, y, b0, a1, y, b0, a1, y + rh, zm, a0, y + rh, zm], mat, undefined, hint),
        this.face([a1, y, b1, a0, y, b1, a0, y + rh, zm, a1, y + rh, zm], mat, undefined, hint),
        this.face([x0, y, z1, x0, y, z0, x0, y + rh, zm], 'wall', [-1, 0, 0]),
        this.face([x1, y, z0, x1, y, z1, x1, y + rh, zm], 'wall', [1, 0, 0]),
      ];
    }
    this.addPart(faces, y, y + rh, (x0 + x1) / 2, (z0 + z1) / 2);
    return faces;
  }

  /** A hipped roof: four slopes meeting at a ridge (a point when square). */
  hip(x0: number, x1: number, z0: number, z1: number, y: number, rh: number, mat: Material, ov = 0.3): Draft[] {
    const a0 = x0 - ov;
    const a1 = x1 + ov;
    const b0 = z0 - ov;
    const b1 = z1 + ov;
    const w = a1 - a0;
    const d = b1 - b0;
    const cx = (a0 + a1) / 2;
    const cz = (b0 + b1) / 2;
    const top = y + rh;
    // The ridge runs along the longer side and is shortened by the shorter one.
    const rx = w > d ? (w - d) / 2 : 0;
    const rz = d > w ? (d - w) / 2 : 0;
    const hint: [number, number, number] = [cx, y + rh * 0.3, cz];
    const faces = [
      this.face([a0, y, b0, a1, y, b0, cx + rx, top, cz - rz, cx - rx, top, cz - rz], mat, undefined, hint),
      this.face([a1, y, b1, a0, y, b1, cx - rx, top, cz + rz, cx + rx, top, cz + rz], mat, undefined, hint),
      this.face([a0, y, b1, a0, y, b0, cx - rx, top, cz - rz, cx - rx, top, cz + rz], mat, undefined, hint),
      this.face([a1, y, b0, a1, y, b1, cx + rx, top, cz + rz, cx + rx, top, cz - rz], mat, undefined, hint),
    ];
    this.addPart(faces, y, top, cx, cz);
    return faces;
  }

  /** A box whose top is shrunk by `taper` (0..1) around its centre: a tapering tower. */
  frustum(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, taper: number, mat: Material): BoxFaces {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const k = 1 - taper;
    const u0 = cx + (x0 - cx) * k;
    const u1 = cx + (x1 - cx) * k;
    const v0 = cz + (z0 - cz) * k;
    const v1 = cz + (z1 - cz) * k;
    const hint: [number, number, number] = [cx, (y0 + y1) / 2, cz];
    const nz = this.face([x0, y0, z0, x1, y0, z0, u1, y1, v0, u0, y1, v0], mat, undefined, hint);
    const pz = this.face([x1, y0, z1, x0, y0, z1, u0, y1, v1, u1, y1, v1], mat, undefined, hint);
    const nx = this.face([x0, y0, z1, x0, y0, z0, u0, y1, v0, u0, y1, v1], mat, undefined, hint);
    const px = this.face([x1, y0, z0, x1, y0, z1, u1, y1, v1, u1, y1, v0], mat, undefined, hint);
    const tp = this.face([u0, y1, v0, u1, y1, v0, u1, y1, v1, u0, y1, v1], 'roof', [0, 1, 0]);
    const part = this.addPart([nz, pz, nx, px, tp], y0, y1, cx, cz);
    return { nz, pz, nx, px, top: tp, part };
  }

  /** A coplanar panel (shutter, signboard) laid over a face; drawn after it. */
  panel(on: Draft, pts: number[], mat: Material): Draft {
    const f = this.face(pts, mat, [on.nx, on.ny, on.nz]);
    const owner = this.parts.find((p) => p.faces.includes(on)) ?? this.group;
    owner?.faces.push(f);
    return f;
  }

  // --- facade detail -------------------------------------------------------

  /** Raw panes (12 floats per quad). `lit` biases the night lighting of this batch. */
  panes(face: Draft, quads: number[], lit = 0.55): void {
    (face._panes ??= []).push(...quads);
    const vars = (face._vars ??= []);
    for (let i = 0; i < quads.length / 12; i += 1) {
      const r = this.paneSeed();
      vars.push(r > lit ? 0 : r < lit * 0.22 ? 2 : r < lit * 0.5 ? 3 : 1);
    }
  }

  /**
   * A grid of window panes on an axis-aligned vertical face.
   * axis 'z' → the face lies at z = c and spans x a0..a1;
   * axis 'x' → the face lies at x = c and spans z a0..a1.
   */
  grid(face: Draft, axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, y1: number, cols: number, rows: number, mx = 0.18, my = 0.22, lit = 0.55): void {
    if (cols < 1 || rows < 1) return;
    const cw = (a1 - a0) / cols;
    const rh = (y1 - y0) / rows;
    const q: number[] = [];
    for (let r = 0; r < rows; r += 1) {
      const ya = y0 + r * rh + rh * my;
      const yb = y0 + (r + 1) * rh - rh * my;
      for (let k = 0; k < cols; k += 1) {
        const aa = a0 + k * cw + cw * mx;
        const ab = a0 + (k + 1) * cw - cw * mx;
        if (axis === 'z') q.push(aa, ya, c, ab, ya, c, ab, yb, c, aa, yb, c);
        else q.push(c, ya, aa, c, ya, ab, c, yb, ab, c, yb, aa);
      }
    }
    this.panes(face, q, lit);
  }

  /** Detail segments on a face (6 floats each). */
  lines(face: Draft, segs: number[]): void {
    (face._lines ??= []).push(...segs);
  }

  /** Horizontal lines every `step` up an axis-aligned face: floor slabs. */
  floors(face: Draft, axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, y1: number, step: number): void {
    const s: number[] = [];
    for (let y = y0 + step; y < y1 - step * 0.4; y += step) {
      if (axis === 'z') s.push(a0, y, c, a1, y, c);
      else s.push(c, y, a0, c, y, a1);
    }
    this.lines(face, s);
  }

  /** Vertical lines every `step` across an axis-aligned face: mullions, portal frames. */
  mullions(face: Draft, axis: 'x' | 'z', c: number, a0: number, a1: number, y0: number, y1: number, step: number): void {
    const s: number[] = [];
    const n = Math.max(1, Math.round((a1 - a0) / step));
    for (let k = 1; k < n; k += 1) {
      const a = a0 + ((a1 - a0) * k) / n;
      if (axis === 'z') s.push(a, y0, c, a, y1, c);
      else s.push(c, y0, a, c, y1, a);
    }
    this.lines(face, s);
  }

  /** Lines that belong to a part rather than a face — always drawn (frames, masts). */
  partLines(part: Part, segs: number[]): void {
    const arr = this.partSegs.get(part) ?? [];
    arr.push(...segs);
    this.partSegs.set(part, arr);
  }

  // --- the ground and the sprites ------------------------------------------

  bill(k: BillKind, x: number, z: number, s: number, h: number, seed: number, y = 0): void {
    this.bills.push({ k, x, y, z, s, h, seed });
  }

  decal(xz: number[], g: GroundKind, lines?: number[]): void {
    this.decals.push({ p: new Float32Array(xz), g, lines: lines?.length ? new Float32Array(lines) : undefined });
  }

  rect(x0: number, z0: number, x1: number, z1: number, g: GroundKind, lines?: number[]): void {
    this.decal([x0, z0, x1, z0, x1, z1, x0, z1], g, lines);
  }

  shadow(x0: number, z0: number, x1: number, z1: number, h: number): void {
    this.shadowList.push(x0, z0, x1, z1, h);
  }

  /** Freeze into typed arrays and compute the bounds the renderer culls with. */
  build(): Obj {
    for (const f of this.drafts) {
      if (f._panes?.length) {
        f.panes = new Float32Array(f._panes);
        f.paneVar = new Uint8Array(f._vars ?? []);
      }
      if (f._lines?.length) f.lines = new Float32Array(f._lines);
      delete f._panes;
      delete f._vars;
      delete f._lines;
    }
    for (const [part, segs] of this.partSegs) part.lines = new Float32Array(segs);

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let h = 0;
    const take = (x: number, z: number, y = 0) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      if (y > h) h = y;
    };
    for (const part of this.parts) {
      for (const f of part.faces) for (let i = 0; i < f.p.length; i += 3) take(f.p[i]!, f.p[i + 2]!, f.p[i + 1]!);
    }
    for (const b of this.bills) take(b.x, b.z, b.y + b.h + b.s);
    for (const d of this.decals) for (let i = 0; i < d.p.length; i += 2) take(d.p[i]!, d.p[i + 1]!);
    if (!Number.isFinite(minX)) {
      minX = maxX = minZ = maxZ = 0;
    }
    return {
      parts: this.parts,
      bills: this.bills,
      decals: this.decals,
      shadows: new Float32Array(this.shadowList),
      cx: (minX + maxX) / 2,
      cz: (minZ + maxZ) / 2,
      r: Math.hypot(maxX - minX, maxZ - minZ) / 2,
      h,
    };
  }
}
