/**
 * The renderer: one camera looking into the shared city.
 *
 * Pipeline per frame:
 *
 *   1. haze at the vanishing point
 *   2. GROUND PASS — survey grid, the carriageway and footpaths, lane marks,
 *      every lot's ground finishes (lawns, parking, pools), then all shadows in
 *      one fill. Nothing on the ground can ever cover a building, so it is all
 *      drawn first and needs no sorting.
 *   3. PAINTER'S PASS — buildings, trees, lamps, cranes and traffic, sorted far
 *      to near. Within a building, parts are ordered by the stacked/adjacent
 *      rule (see orderParts) and back faces are culled, so front volumes hide
 *      back ones. That occlusion is the difference between an architectural
 *      model and a pile of transparent cubes.
 *
 * Canvas 2D, not WebGL: the site's CSP forbids anything not bundled, and a
 * scene built from a few hundred flat polygons is exactly what the 2D canvas
 * rasterises fastest. Everything below avoids allocating inside the frame.
 */
import { city, ROAD_HALF, WALK, districtStart } from './city';
import { FOG_STEPS } from './themes';
import type { Bill, DistrictId, Face, Obj, Part, Theme } from './types';

export type ViewKind = 'forward' | 'side';

export interface ViewConfig {
  /** 'forward' looks down the road; 'side' looks across it at the left-hand plots. */
  kind: ViewKind;
  theme: Theme;
  district: DistrictId;
  /** Where in the district the camera settles, in world units from its start. */
  bias: number;
  /** World units travelled while the canvas scrolls across the viewport. */
  span: number;
  /** Unprompted travel, world units per second (the welcome window never scrolls). */
  drift: number;
  camH: number;
  camX: number;
  vpX: number;
  horizonY: number;
  /** Focal length as a fraction of canvas height. */
  focal: number;
  far: number;
  /** Fractions of the width that a CSS mask hides completely; nothing is drawn there. */
  cullLeft: number;
  cullRight: number;
  buildings: boolean;
  traffic: boolean;
  /** Overall strength, multiplied into every alpha. */
  strength: number;
}

export interface FrameInput {
  w: number;
  h: number;
  dpr: number;
  camZ: number;
  t: number;
  yaw: number;
  pitchPx: number;
  alpha: number;
  /**
   * Where the scene must be kept clear — under every line of text and control,
   * and under the whole of every content surface — as pre-painted alpha masks
   * (see paintShield / paintSolids), each stamped out of the frame with a
   * single image draw. Painting the feathered rectangles themselves every frame
   * cost 8–16 ms on an integrated GPU; stamping a cached mask costs well under 1.
   */
  masks?: readonly MaskDraw[];
  /** Lens multiplier: below 1 widens the view — used for the sense of speed. */
  focalScale?: number;
  /** Raises the camera, in world units: the slow crane-up that scroll drives. */
  lift?: number;
  /** Replaces the theme's horizon glow: the light shifts as the page is read. */
  haze?: string;
}

/** One cached mask, drawn from its source rectangle onto the frame's. */
export interface MaskDraw {
  img: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Paint text clearings into a mask: eight concentric rings per rectangle, each
 * gentle, so the core under the glyphs clears to about 3% while the rings
 * further out clear less — the city thins away around a heading instead of
 * being cut out in a box. `k` is mask pixels per CSS pixel; rects are in mask px.
 */
export function paintShield(ctx: Ctx2D, rects: ArrayLike<number>, k: number): void {
  // 8px of full clearing past the glyphs, not 4: with the camera now always
  // gently moving, a darker facade could drift up to the edge of a line.
  const pad = 8 * k;
  const feather = 40 * k;
  const steps = 8;
  ctx.fillStyle = '#000';
  ctx.globalAlpha = 0.36;
  for (let i = 0; i < rects.length; i += 4) {
    const x = rects[i]!;
    const y = rects[i + 1]!;
    const w = rects[i + 2]!;
    const h = rects[i + 3]!;
    for (let s = 0; s < steps; s += 1) {
      const e = pad + (feather * s) / steps;
      ctx.fillRect(x - e, y - e, w + e * 2, h + e * 2);
    }
  }
  ctx.globalAlpha = 1;
}

/** Paint content surfaces into a mask: solid inside, then a 16px falloff. */
export function paintSolids(ctx: Ctx2D, rects: ArrayLike<number>, k: number): void {
  const feather = 16 * k;
  const steps = 4;
  ctx.fillStyle = '#000';
  for (let i = 0; i < rects.length; i += 4) {
    const x = rects[i]!;
    const y = rects[i + 1]!;
    const w = rects[i + 2]!;
    const h = rects[i + 3]!;
    ctx.globalAlpha = 1;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 0.3;
    for (let s = 1; s <= steps; s += 1) {
      const e = (feather * s) / steps;
      ctx.fillRect(x - e, y - e, w + e * 2, h + e * 2);
    }
  }
  ctx.globalAlpha = 1;
}

/** How far a shield reaches past its rectangle, in CSS px (pad + feather). */
export const SHIELD_REACH = 48;

/** A scratch bitmap: offscreen where the browser has one, else a detached canvas. */
export function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const NEAR = 0.6;
const MAX_VERTS = 96;
/** Distance over which new buildings rise out of the ground at the horizon. */
const RISE = 26;
/** Shadow offset per unit of height: the sun is high and to the front-left. */
const SHADOW_X = 0.64;
const SHADOW_Z = 0.49;
/** Lanes: India drives on the left, so the left-hand lanes run away from us. */
const LANES = [-2.55, -0.85, 0.85, 2.55];
const TRAFFIC = 32;
/** Widest stretch of road a side view will consider either side of the camera. */
const MAX_SIDE_HALF = 320;

/**
 * Every layer of the drawing, switchable — so the cost of each can be measured
 * (terrain.ts, `?worldbench`) and so a weaker device can be spared the costly
 * ones by the quality governor without touching the geometry.
 */
export const LAYERS = {
  haze: true,
  ground: true,
  decals: true,
  buildings: true,
  sheen: true,
  panes: true,
  lines: true,
  edges: true,
  bills: true,
  traffic: true,
  solids: true,
  shield: true,
  /** Sky reflection on large glass faces. */
  glaze: true,
};

interface Item {
  d: number;
  obj: Obj | null;
  bill: Bill | null;
  car: number;
  ys: number;
  /** Fade-out at the very limit of the view, 1 = none. */
  fog: number;
  /** Distance tint, 0 (close) .. FOG_STEPS - 1 — see Theme.fogMat. */
  mix: number;
}

/** Where a view's camera sits before any scrolling. */
export function anchorZ(view: ViewConfig): number {
  return districtStart(view.district) + view.bias;
}

export class WorldRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  readonly view: ViewConfig;
  private readonly objs: Obj[] = [];
  private readonly items: Item[] = [];
  private count = 0;

  // Camera.
  private cx = 0;
  private cy = 0;
  private cz = 0;
  private fx = 0;
  private fz = 1;
  private rx = 1;
  private rz = 0;
  private f = 1;
  private ox = 0;
  private oy = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private t = 0;
  private alpha = 1;
  private cullL = 0;
  private cullR = 0;

  // Scratch buffers, sized once.
  private readonly cam = new Float32Array(MAX_VERTS * 3);
  private readonly clipped = new Float32Array(MAX_VERTS * 6);
  private readonly scr = new Float32Array(MAX_VERTS * 4);
  private readonly ground = new Float32Array(MAX_VERTS * 3);
  private readonly edges = new Float32Array(24_000);
  private edgeN = 0;
  private readonly segs = new Float32Array(40_000);
  private segN = 0;
  private readonly order = new Int16Array(512);
  private sx0 = 0;
  private sy0 = 0;
  private sx1 = 0;
  private sy1 = 0;
  private px = 0;
  private py = 0;

  /**
   * Drawing on the CPU (the worker). Its scratch bitmaps must then be CPU ones
   * too: a GPU-backed haze or mask stamped into a CPU frame is read back from
   * the GPU on every single frame — measured at 9% of an integrated chip.
   */
  software = false;

  constructor(ctx: CanvasRenderingContext2D, view: ViewConfig) {
    this.ctx = ctx;
    this.view = view;
  }

  // -------------------------------------------------------------------------
  // Projection
  // -------------------------------------------------------------------------

  private setCamera(input: FrameInput): void {
    const v = this.view;
    const a = (v.kind === 'side' ? -Math.PI / 2 : 0) + input.yaw;
    this.fx = Math.sin(a);
    this.fz = Math.cos(a);
    this.rx = Math.cos(a);
    this.rz = -Math.sin(a);
    this.cx = v.camX;
    this.cy = v.camH + (input.lift ?? 0);
    this.cz = input.camZ;
    this.w = input.w;
    this.h = input.h;
    this.dpr = input.dpr;
    this.t = input.t;
    // Solid, whatever the scene's strength: a backdrop drawn at 62% alpha face
    // by face showed every building through the one in front of it. How faint
    // the city sits behind a section is the canvas's CSS opacity instead.
    this.alpha = input.alpha;
    this.f = v.focal * input.h * (input.focalScale ?? 1);
    this.ox = v.vpX * input.w;
    this.oy = v.horizonY * input.h + input.pitchPx;
    const margin = 24 * input.dpr;
    this.cullL = v.cullLeft * input.w - margin;
    this.cullR = v.cullRight * input.w + margin;
  }

  /** Camera-space depth of a world point (no projection). */
  private depth(x: number, z: number): number {
    return (x - this.cx) * this.fx + (z - this.cz) * this.fz;
  }

  /** Project one point; false if it is behind the near plane. Result in px/py. */
  private point(x: number, y: number, z: number): boolean {
    const dx = x - this.cx;
    const dz = z - this.cz;
    const d = dx * this.fx + dz * this.fz;
    if (d < NEAR) return false;
    this.px = this.ox + (this.f * (dx * this.rx + dz * this.rz)) / d;
    this.py = this.oy - (this.f * (y - this.cy)) / d;
    return true;
  }

  /**
   * Project a polygon into `scr`, clipping against the near plane
   * (Sutherland–Hodgman). Returns the vertex count; 0 if wholly behind.
   * Without the clip, a large facade reaching past the camera would lose a
   * corner and fold across the screen.
   */
  private poly(p: ArrayLike<number>, n: number, ys: number): number {
    const cam = this.cam;
    let behind = 0;
    for (let i = 0; i < n; i += 1) {
      const dx = p[i * 3]! - this.cx;
      const dy = p[i * 3 + 1]! * ys - this.cy;
      const dz = p[i * 3 + 2]! - this.cz;
      const d = dx * this.fx + dz * this.fz;
      cam[i * 3] = dx * this.rx + dz * this.rz;
      cam[i * 3 + 1] = dy;
      cam[i * 3 + 2] = d;
      if (d < NEAR) behind += 1;
    }
    if (behind === n) return 0;

    let src: Float32Array = cam;
    let m = n;
    if (behind > 0) {
      const out = this.clipped;
      let k = 0;
      for (let i = 0; i < n; i += 1) {
        const j = (i + 1) % n;
        const az = cam[i * 3 + 2]!;
        const bz = cam[j * 3 + 2]!;
        const aIn = az >= NEAR;
        if (aIn) {
          out[k * 3] = cam[i * 3]!;
          out[k * 3 + 1] = cam[i * 3 + 1]!;
          out[k * 3 + 2] = az;
          k += 1;
        }
        if (aIn !== bz >= NEAR) {
          const t = (NEAR - az) / (bz - az);
          out[k * 3] = cam[i * 3]! + (cam[j * 3]! - cam[i * 3]!) * t;
          out[k * 3 + 1] = cam[i * 3 + 1]! + (cam[j * 3 + 1]! - cam[i * 3 + 1]!) * t;
          out[k * 3 + 2] = NEAR;
          k += 1;
        }
      }
      src = out;
      m = k;
    }

    const f = this.f;
    for (let i = 0; i < m; i += 1) {
      const d = src[i * 3 + 2]!;
      this.scr[i * 2] = this.ox + (f * src[i * 3]!) / d;
      this.scr[i * 2 + 1] = this.oy - (f * src[i * 3 + 1]!) / d;
    }
    return m;
  }

  /** A ground polygon given as x,z pairs. */
  private groundPoly(xz: ArrayLike<number>, n: number): number {
    const g = this.ground;
    for (let i = 0; i < n; i += 1) {
      g[i * 3] = xz[i * 2]!;
      g[i * 3 + 1] = 0;
      g[i * 3 + 2] = xz[i * 2 + 1]!;
    }
    return this.poly(g, n, 1);
  }

  /** A segment, clipped. Result in sx0..sy1. */
  private segment(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    let d0 = this.depth(x0, z0);
    let d1 = this.depth(x1, z1);
    if (d0 < NEAR && d1 < NEAR) return false;
    if (d0 < NEAR) {
      const t = (NEAR - d0) / (d1 - d0);
      x0 += (x1 - x0) * t;
      y0 += (y1 - y0) * t;
      z0 += (z1 - z0) * t;
      d0 = NEAR;
    } else if (d1 < NEAR) {
      const t = (NEAR - d1) / (d0 - d1);
      x1 += (x0 - x1) * t;
      y1 += (y0 - y1) * t;
      z1 += (z0 - z1) * t;
      d1 = NEAR;
    }
    const f = this.f;
    this.sx0 = this.ox + (f * ((x0 - this.cx) * this.rx + (z0 - this.cz) * this.rz)) / d0;
    this.sy0 = this.oy - (f * (y0 - this.cy)) / d0;
    this.sx1 = this.ox + (f * ((x1 - this.cx) * this.rx + (z1 - this.cz) * this.rz)) / d1;
    this.sy1 = this.oy - (f * (y1 - this.cy)) / d1;
    return true;
  }

  private tracePoly(m: number): void {
    const s = this.scr;
    this.ctx.moveTo(s[0]!, s[1]!);
    for (let i = 1; i < m; i += 1) this.ctx.lineTo(s[i * 2]!, s[i * 2 + 1]!);
    this.ctx.closePath();
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  render(input: FrameInput): void {
    const { ctx, view } = this;
    this.setCamera(input);
    ctx.clearRect(0, 0, input.w, input.h);
    // Nothing legible fits in a sliver, and a side view's road window grows as
    // the canvas gets shorter — so a transiently collapsed canvas draws nothing.
    if (input.w < 8 || input.h < 8) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // The window of road that can possibly be in shot.
    let zMin: number;
    let zMax: number;
    if (view.kind === 'forward') {
      zMin = this.cz - 4;
      zMax = this.cz + view.far;
    } else {
      // Capped: the window widens as the canvas gets shorter, and an uncapped
      // one on a very thin canvas spans dozens of districts.
      const half = Math.min((view.far * (input.w * 0.5)) / this.f + 12, MAX_SIDE_HALF);
      zMin = this.cz - half;
      zMax = this.cz + half;
    }

    if (LAYERS.haze) this.haze(input.haze);
    if (LAYERS.ground) this.groundPass(zMin, zMax);

    if (view.buildings && LAYERS.buildings) {
      city.objectsIn(zMin, zMax, { left: true, right: view.kind === 'forward' }, this.objs);
      this.collect();
      if (LAYERS.decals) this.decalsAndShadows();
      this.sortItems();
      for (let i = 0; i < this.count; i += 1) this.drawItem(this.items[i]!);
    }
    if (LAYERS.shield && input.masks?.length) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      for (const m of input.masks) {
        if (m.sw < 1 || m.sh < 1 || m.dw < 1 || m.dh < 1) continue;
        ctx.drawImage(m.img, m.sx, m.sy, m.sw, m.sh, m.dx, m.dy, m.dw, m.dh);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The horizon glow, painted once into a small bitmap and stretched into
   * place: a full radial-gradient fill over most of the frame cost 5–14 ms a
   * frame on an integrated GPU, and a soft glow loses nothing at a quarter of
   * the resolution.
   */
  private hazeCache: { canvas: HTMLCanvasElement | OffscreenCanvas; colour: string } | null = null;

  private haze(colour?: string): void {
    if (this.view.kind !== 'forward') return;
    const { ctx } = this;
    const c = colour ?? this.view.theme.haze;
    const SIZE = 128;
    if (!this.hazeCache || this.hazeCache.colour !== c) {
      const canvas = makeCanvas(SIZE, SIZE);
      const g2 = canvas?.getContext('2d', { willReadFrequently: this.software }) as Ctx2D | null | undefined;
      if (!canvas || !g2) return;
      const g = g2.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
      g.addColorStop(0, c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      g2.fillStyle = g;
      g2.fillRect(0, 0, SIZE, SIZE);
      this.hazeCache = { canvas, colour: c };
    }
    const r = this.w * 0.42;
    const cy = this.oy + this.h * 0.08;
    ctx.globalAlpha = this.alpha;
    ctx.drawImage(this.hazeCache.canvas, this.ox - r, cy - r, r * 2, r * 2);
  }

  // -------------------------------------------------------------------------
  // Ground
  // -------------------------------------------------------------------------

  private groundPass(zMin: number, zMax: number): void {
    const { ctx, view } = this;
    const th = view.theme;
    const dpr = this.dpr;
    const z0 = view.kind === 'forward' ? this.cz + 1 : zMin;
    const xFar = view.kind === 'forward' ? 70 : -view.far;

    // --- survey grid, fading with distance --------------------------------
    const step = 6;
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 0.8 * dpr;
    const bands = view.kind === 'forward' ? 3 : 1;
    for (let band = 0; band < bands; band += 1) {
      const za = z0 + ((zMax - z0) * band) / bands;
      const zb = z0 + ((zMax - z0) * (band + 1)) / bands;
      ctx.globalAlpha = this.alpha * (1 - band * 0.3);
      ctx.beginPath();
      const xs = view.kind === 'forward' ? -70 : xFar;
      const xe = view.kind === 'forward' ? 70 : -ROAD_HALF - WALK;
      for (let x = Math.ceil(xs / step) * step; x <= xe; x += step) {
        if (this.segment(x, 0, za, x, 0, zb)) {
          ctx.moveTo(this.sx0, this.sy0);
          ctx.lineTo(this.sx1, this.sy1);
        }
      }
      for (let z = Math.ceil(za / step) * step; z <= zb; z += step) {
        if (this.segment(xs, 0, z, xe, 0, z)) {
          ctx.moveTo(this.sx0, this.sy0);
          ctx.lineTo(this.sx1, this.sy1);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = this.alpha;

    // --- carriageway and footpaths ---------------------------------------
    const quad = (x0: number, x1: number, fill: string) => {
      const m = this.groundPoly([x0, z0, x1, z0, x1, zMax, x0, zMax], 4);
      if (m < 3) return;
      ctx.fillStyle = fill;
      ctx.beginPath();
      this.tracePoly(m);
      ctx.fill();
    };
    quad(-ROAD_HALF, ROAD_HALF, th.ground.asphalt);
    quad(-ROAD_HALF - WALK, -ROAD_HALF, th.ground.walk);
    quad(ROAD_HALF, ROAD_HALF + WALK, th.ground.walk);

    const line = (x: number, width: number, style: string) => {
      if (!this.segment(x, 0, z0, x, 0, zMax)) return;
      ctx.strokeStyle = style;
      ctx.lineWidth = width * dpr;
      ctx.beginPath();
      ctx.moveTo(this.sx0, this.sy0);
      ctx.lineTo(this.sx1, this.sy1);
      ctx.stroke();
    };
    // The signature: the road's edges glow.
    line(-ROAD_HALF, 7, th.roadGlow);
    line(ROAD_HALF, 7, th.roadGlow);
    line(-ROAD_HALF, 1.6, th.roadEdge);
    line(ROAD_HALF, 1.6, th.roadEdge);
    line(-0.12, 0.9, th.lane);
    line(0.12, 0.9, th.lane);
    line(-ROAD_HALF - WALK, 0.8, th.grid);
    line(ROAD_HALF + WALK, 0.8, th.grid);

    // Lane dashes, anchored to the world so they stream past as the camera moves.
    ctx.strokeStyle = th.lane;
    ctx.lineWidth = 1.1 * dpr;
    ctx.beginPath();
    for (let z = Math.floor(z0 / 4) * 4; z < zMax; z += 4) {
      if (view.kind === 'forward' && z - this.cz > 95) break;
      for (const x of [-1.7, 1.7]) {
        if (this.segment(x, 0, z, x, 0, z + 2)) {
          ctx.moveTo(this.sx0, this.sy0);
          ctx.lineTo(this.sx1, this.sy1);
        }
      }
    }
    ctx.stroke();
  }

  // -------------------------------------------------------------------------
  // Collection, culling and ordering
  // -------------------------------------------------------------------------

  private push(d: number, obj: Obj | null, bill: Bill | null, car: number, ys: number, fog: number, mix: number): void {
    let it = this.items[this.count];
    if (!it) {
      it = { d: 0, obj: null, bill: null, car: -1, ys: 1, fog: 1, mix: 0 };
      this.items.push(it);
    }
    it.mix = mix;
    it.d = d;
    it.obj = obj;
    it.bill = bill;
    it.car = car;
    it.ys = ys;
    it.fog = fog;
    this.count += 1;
  }

  /**
   * Rise out of the ground near the horizon; recede into the air with distance.
   * Returns [height scale, fade, tint step]. Distance TINTS a building toward
   * the air and leaves it solid (Theme.fogMat): fading it instead made every
   * far building see-through, the ones behind showing through it, which is
   * the look of a wireframe, not of a model. Only the last stretch before the
   * limit also fades, so nothing pops into view there.
   */
  private atmos(depth: number): [number, number, number] {
    const far = this.view.far;
    const top = FOG_STEPS - 1;
    if (this.view.kind !== 'forward') {
      const fade = depth > far * 0.8 ? Math.max(0, 1 - (depth - far * 0.8) / (far * 0.2)) : 1;
      return [1, fade, Math.round(Math.min(1, Math.max(0, (depth - far * 0.35) / (far * 0.65))) * top)];
    }
    const u = Math.min(1, Math.max(0, (far - depth) / RISE));
    const ys = 1 - (1 - u) ** 3;
    const mix = Math.min(1, Math.max(0, (depth - far * 0.36) / (far * 0.64))) ** 1.1;
    const fade = depth <= far * 0.86 ? 1 : Math.max(0, 1 - (depth - far * 0.86) / (far * 0.14));
    return [ys, fade, Math.round(mix * top)];
  }

  /** Is a circle of radius r (world) around x,z possibly on screen? */
  private onScreen(x: number, z: number, r: number): number {
    const d = this.depth(x, z);
    if (d + r < NEAR || d - r > this.view.far) return -1;
    const dx = x - this.cx;
    const dz = z - this.cz;
    const sx = this.ox + (this.f * (dx * this.rx + dz * this.rz)) / Math.max(d, NEAR);
    const sr = (this.f * r) / Math.max(d - r, NEAR * 4);
    if (sx + sr < this.cullL || sx - sr > this.cullR) return -1;
    return d;
  }

  private collect(): void {
    this.count = 0;
    const side = this.view.kind === 'side';
    for (const o of this.objs) {
      if (o.parts.length) {
        const d = this.onScreen(o.cx, o.cz, o.r);
        if (d >= 0) {
          const [ys, fog, mix] = this.atmos(d);
          if (fog > 0.02) this.push(this.plan(o.cx, o.cz), o, null, -1, ys, fog, mix);
        }
      }
      for (const b of o.bills) {
        // A side view looks across the road from the far kerb: nothing on the
        // near side may stand between the lens and the street.
        if (side && b.x > ROAD_HALF) continue;
        const d = this.onScreen(b.x, b.z, Math.max(b.s, 1.5));
        if (d < 0) continue;
        const [ys, fog, mix] = this.atmos(d);
        if (fog > 0.02) this.push(this.plan(b.x, b.z), null, b, -1, ys, fog, mix);
      }
    }
    if (this.view.traffic && LAYERS.traffic) this.traffic();
  }

  private plan(x: number, z: number): number {
    const dx = x - this.cx;
    const dz = z - this.cz;
    return dx * dx + dz * dz;
  }

  /** Moving traffic: positions are a pure function of time, so nothing is stored. */
  private traffic(): void {
    const span = this.view.kind === 'forward' ? this.view.far * 0.75 : this.view.far * 2;
    const base = this.view.kind === 'forward' ? this.cz + 4 : this.cz - span / 2;
    for (let i = 0; i < TRAFFIC; i += 1) {
      const lane = i % 4;
      const dir = LANES[lane]! < 0 ? 1 : -1;
      const speed = 8 + ((i * 37) % 9);
      const phase = ((i * 7919) % 1000) / 1000;
      const along = (((phase * span + dir * speed * this.t) % span) + span) % span;
      const z = base + along;
      const x = LANES[lane]!;
      const d = this.onScreen(x, z, 1.4);
      if (d < 0) continue;
      const [, fog, mix] = this.atmos(d);
      this.push(this.plan(x, z), null, null, i, 1, fog, mix);
    }
  }

  private sortItems(): void {
    // Far first. Insertion sort would be quadratic here; the array is large.
    const n = this.count;
    const items = this.items;
    const view = items.slice(0, n).sort((a, b) => b.d - a.d);
    for (let i = 0; i < n; i += 1) items[i] = view[i]!;
  }

  /** Lawns, parking, pools, crossings — then every shadow in one fill. */
  private decalsAndShadows(): void {
    const { ctx } = this;
    const th = this.view.theme;
    ctx.globalAlpha = this.alpha;
    for (const o of this.objs) {
      if (!o.decals.length) continue;
      if (this.onScreen(o.cx, o.cz, o.r) < 0) continue;
      for (const dc of o.decals) {
        const m = this.groundPoly(dc.p, dc.p.length / 2);
        if (m >= 3) {
          ctx.fillStyle = th.ground[dc.g];
          ctx.beginPath();
          this.tracePoly(m);
          ctx.fill();
          if (dc.g === 'water') this.ripples(dc.p);
        }
        if (dc.lines) {
          ctx.strokeStyle = th.detail;
          ctx.lineWidth = 0.8 * this.dpr;
          ctx.beginPath();
          for (let i = 0; i < dc.lines.length; i += 4) {
            if (this.segment(dc.lines[i]!, 0, dc.lines[i + 1]!, dc.lines[i + 2]!, 0, dc.lines[i + 3]!)) {
              ctx.moveTo(this.sx0, this.sy0);
              ctx.lineTo(this.sx1, this.sy1);
            }
          }
          ctx.stroke();
        }
      }
    }

    if (!th.shadow) return;
    ctx.fillStyle = th.shadow;
    ctx.beginPath();
    const hex = new Array<number>(12);
    for (const o of this.objs) {
      if (!o.shadows.length) continue;
      const d = this.onScreen(o.cx, o.cz, o.r + o.h * 0.8);
      if (d < 0) continue;
      const [ys] = this.atmos(d);
      const s = o.shadows;
      for (let i = 0; i < s.length; i += 5) {
        const x0 = s[i]!;
        const z0 = s[i + 1]!;
        const x1 = s[i + 2]!;
        const z1 = s[i + 3]!;
        const h = s[i + 4]! * ys;
        const a = h * SHADOW_X;
        const b = h * SHADOW_Z;
        hex[0] = x0; hex[1] = z0; hex[2] = x1; hex[3] = z0; hex[4] = x1 + a; hex[5] = z0 + b;
        hex[6] = x1 + a; hex[7] = z1 + b; hex[8] = x0 + a; hex[9] = z1 + b; hex[10] = x0; hex[11] = z1;
        const m = this.groundPoly(hex, 6);
        if (m >= 3) this.tracePoly(m);
      }
    }
    ctx.fill();
  }

  /** Light moving across a pool. */
  private ripples(p: Float32Array): void {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      x0 = Math.min(x0, p[i]!);
      x1 = Math.max(x1, p[i]!);
      z0 = Math.min(z0, p[i + 1]!);
      z1 = Math.max(z1, p[i + 1]!);
    }
    const { ctx } = this;
    ctx.strokeStyle = this.view.theme.ripple;
    ctx.lineWidth = 0.9 * this.dpr;
    ctx.beginPath();
    for (let k = 1; k <= 3; k += 1) {
      const zk = z0 + ((z1 - z0) * k) / 4;
      let pen = false;
      for (let s = 0; s <= 8; s += 1) {
        const x = x0 + ((x1 - x0) * s) / 8;
        const z = zk + Math.sin(x * 1.4 + this.t * 1.7 + k * 1.9) * (z1 - z0) * 0.04;
        if (!this.point(x, 0.02, z)) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(this.px, this.py);
        else ctx.moveTo(this.px, this.py);
        pen = true;
      }
    }
    ctx.stroke();
  }

  // -------------------------------------------------------------------------
  // Buildings
  // -------------------------------------------------------------------------

  /** The tint step of the item being drawn. */
  private step = 0;

  private drawItem(it: Item): void {
    this.step = it.mix;
    // Buildings take their distance as colour (fogMat). Trees, lamps and
    // cars have no tinted palette, so they thin out a little instead.
    const thin = it.obj ? 1 : 1 - (it.mix / (FOG_STEPS - 1)) * 0.7;
    this.ctx.globalAlpha = this.alpha * it.fog * thin;
    if (it.obj) this.drawObj(it.obj, it.ys);
    else if (it.bill) {
      if (LAYERS.bills) this.drawBill(it.bill, it.ys);
    }
    else if (it.car >= 0) this.drawCar(it.car);
  }

  /**
   * Order a building's parts. STACKED parts (plans overlap, heights do not) are
   * drawn by vertical distance from the camera — the podium before the tower
   * when we look down on it, the other way round when we look up. Everything
   * else is drawn far to near.
   */
  private orderParts(parts: Part[], ys: number): number {
    const n = Math.min(parts.length, this.order.length);
    const ord = this.order;
    for (let i = 0; i < n; i += 1) ord[i] = i;
    const cy = this.cy;
    const vkey = (p: Part) => {
      const a = p.y0 * ys;
      const b = p.y1 * ys;
      return cy < a ? a - cy : cy > b ? cy - b : 0;
    };
    const drawFirst = (a: Part, b: Part): boolean => {
      const stacked =
        (a.y1 <= b.y0 + 0.02 || b.y1 <= a.y0 + 0.02) &&
        a.bx0 < b.bx1 && b.bx0 < a.bx1 && a.bz0 < b.bz1 && b.bz0 < a.bz1;
      if (stacked) return vkey(a) > vkey(b);
      return this.plan(a.cx, a.cz) > this.plan(b.cx, b.cz);
    };
    for (let i = 1; i < n; i += 1) {
      const v = ord[i]!;
      let j = i - 1;
      while (j >= 0 && drawFirst(parts[v]!, parts[ord[j]!]!)) {
        ord[j + 1] = ord[j]!;
        j -= 1;
      }
      ord[j + 1] = v;
    }
    return n;
  }

  private drawObj(o: Obj, ys: number): void {
    const n = this.orderParts(o.parts, ys);
    const depth = this.depth(o.cx, o.cz);
    const edgeW = Math.max(0.55, Math.min(1.25, 32 / Math.max(depth, 1))) * this.dpr;
    for (let i = 0; i < n; i += 1) this.drawPart(o.parts[this.order[i]!]!, ys, edgeW);
  }

  private visible(face: Face, ys: number): boolean {
    const p = face.p;
    return (
      face.nx * (this.cx - p[0]!) + face.ny * (this.cy - p[1]! * ys) + face.nz * (this.cz - p[2]!) > 0
    );
  }

  private drawPart(part: Part, ys: number, edgeW: number): void {
    const { ctx } = this;
    const th = this.view.theme;
    // Too small to see: skip the whole part rather than rasterise dust.
    const d = Math.max(this.depth(part.cx, part.cz), NEAR);
    if ((this.f * (part.y1 - part.y0) * ys) / d < 0.7 && (this.f * (part.bx1 - part.bx0 + part.bz1 - part.bz0)) / d < 2.5) return;

    this.edgeN = 0;
    this.segN = 0;
    const detailMin = 20 * this.dpr;

    for (const face of part.faces) {
      if (!this.visible(face, ys)) continue;
      const m = this.poly(face.p, face.p.length / 3, ys);
      if (m < 3) continue;

      // Screen size decides how much of the facade is worth drawing.
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < m; k += 1) {
        const x = this.scr[k * 2]!;
        const y = this.scr[k * 2 + 1]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const big = maxX - minX > detailMin * 0.5 && maxY - minY > detailMin * 0.5;

      const tones = th.fogMat[face.mat];
      const row = this.step * 8;
      const tone = tones[row + face.level]!;
      const glaze = face.mat === 'glass' && LAYERS.glaze && maxX - minX > detailMin * 1.2 && maxY - minY > detailMin * 1.2;
      ctx.fillStyle = tone;
      ctx.beginPath();
      this.tracePoly(m);
      ctx.fill();
      if (big && face.mat === 'glass' && LAYERS.sheen) this.sheen(face, m, minX, minY, maxX, maxY);

      if (!face.noEdge && LAYERS.edges && this.edgeN + m * 2 + 1 < this.edges.length) {
        this.edges[this.edgeN++] = m;
        for (let k = 0; k < m * 2; k += 1) this.edges[this.edgeN++] = this.scr[k]!;
      }

      if (glaze) this.glaze(face, ys);
      if (big && face.panes && LAYERS.panes && !(face.paneNightOnly && th.name === 'day')) this.drawPanes(face, ys);
      if (big && face.lines && LAYERS.lines && maxX - minX > detailMin && maxY - minY > detailMin) this.queueLines(face.lines, ys);
    }
    if (part.lines && LAYERS.lines) this.queueLines(part.lines, ys);

    if (this.segN) {
      ctx.strokeStyle = th.fogDetail[this.step]!;
      ctx.lineWidth = 0.75 * this.dpr;
      ctx.beginPath();
      for (let k = 0; k < this.segN; k += 4) {
        ctx.moveTo(this.segs[k]!, this.segs[k + 1]!);
        ctx.lineTo(this.segs[k + 2]!, this.segs[k + 3]!);
      }
      ctx.stroke();
    }
    if (this.edgeN) {
      ctx.strokeStyle = th.fogEdge[this.step]!;
      ctx.lineWidth = edgeW;
      ctx.beginPath();
      for (let k = 0; k < this.edgeN; ) {
        const m = this.edges[k++]!;
        ctx.moveTo(this.edges[k]!, this.edges[k + 1]!);
        for (let v = 1; v < m; v += 1) ctx.lineTo(this.edges[k + v * 2]!, this.edges[k + v * 2 + 1]!);
        ctx.closePath();
        k += m * 2;
      }
      ctx.stroke();
    }
  }

  /**
   * A soft diagonal reflection across a glass face. Its position is keyed to the
   * camera and to where the face stands, so as the camera travels the light
   * slides across the facades — glass that reflects rather than glass that is
   * merely tinted. Drawn inside the face's own outline, still in `scr`.
   */
  private sheen(face: Face, m: number, x0: number, y0: number, x1: number, y1: number): void {
    const { ctx } = this;
    const k = this.cz * 0.006 + (face.p[0]! + face.p[2]!) * 0.017;
    const c = 0.15 + 0.7 * (((k % 1) + 1) % 1);
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(Math.max(0, c - 0.12), 'rgba(255,255,255,0)');
    g.addColorStop(c, this.view.theme.sheen);
    g.addColorStop(Math.min(1, c + 0.12), 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    this.tracePoly(m);
    ctx.fill();
  }

  private readonly band = new Float32Array(MAX_VERTS * 3);

  /**
   * The sky in a curtain wall: the upper part of a large glass face, lifted
   * toward white, with a hard horizon where the reflection meets the street —
   * how tall glass actually reads from below. One translucent fill of part of
   * the face: a gradient across the whole face looked the same and cost
   * 12-20 ms a frame at full resolution on the drawing thread.
   */
  private glaze(face: Face, ys: number): void {
    const p = face.p;
    const n = Math.min(p.length / 3, MAX_VERTS);
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const y = p[i * 3 + 1]!;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (y1 - y0 < 0.5) return;
    const cut = y0 + (y1 - y0) * 0.5;
    const b = this.band;
    for (let i = 0; i < n; i += 1) {
      b[i * 3] = p[i * 3]!;
      b[i * 3 + 1] = Math.max(p[i * 3 + 1]!, cut);
      b[i * 3 + 2] = p[i * 3 + 2]!;
    }
    const m = this.poly(b, n, ys);
    if (m < 3) return;
    const { ctx } = this;
    const was = ctx.globalAlpha;
    ctx.globalAlpha = was * (1 - (this.step / (FOG_STEPS - 1)) * 0.75);
    ctx.fillStyle = this.view.theme.glaze;
    ctx.beginPath();
    this.tracePoly(m);
    ctx.fill();
    ctx.globalAlpha = was;
  }

  private queueLines(l: Float32Array, ys: number): void {
    for (let i = 0; i < l.length; i += 6) {
      if (this.segN + 4 > this.segs.length) return;
      if (!this.segment(l[i]!, l[i + 1]! * ys, l[i + 2]!, l[i + 3]!, l[i + 4]! * ys, l[i + 5]!)) continue;
      this.segs[this.segN++] = this.sx0;
      this.segs[this.segN++] = this.sy0;
      this.segs[this.segN++] = this.sx1;
      this.segs[this.segN++] = this.sy1;
    }
  }

  private drawPanes(face: Face, ys: number): void {
    const { ctx } = this;
    const panes = face.panes!;
    const vars = face.paneVar!;
    const colours = this.view.theme.pane;
    const was = ctx.globalAlpha;
    ctx.globalAlpha = was * (1 - (this.step / (FOG_STEPS - 1)) * 0.8);
    for (let v = 0; v < colours.length; v += 1) {
      let any = false;
      ctx.beginPath();
      for (let q = 0; q < vars.length; q += 1) {
        if (vars[q] !== v) continue;
        const m = this.poly(panes.subarray(q * 12, q * 12 + 12), 4, ys);
        if (m < 3) continue;
        this.tracePoly(m);
        any = true;
      }
      if (any) {
        ctx.fillStyle = colours[v]!;
        ctx.fill();
      }
    }
    ctx.globalAlpha = was;
  }

  // -------------------------------------------------------------------------
  // Sprites
  // -------------------------------------------------------------------------

  private drawBill(b: Bill, ys: number): void {
    switch (b.k) {
      case 'tree':
      case 'shrub':
        return this.tree(b, ys);
      case 'conifer':
        return this.conifer(b, ys);
      case 'palm':
        return this.palm(b, ys);
      case 'lamp':
        return this.lamp(b);
      case 'crane':
        return this.crane(b, ys);
      case 'silo':
        return this.silo(b, ys);
      case 'beacon':
        return this.beacon(b, ys);
    }
  }

  private tree(b: Bill, ys: number): void {
    const { ctx } = this;
    const th = this.view.theme;
    const h = b.h * ys;
    const cy = b.k === 'shrub' ? b.s * 0.8 : h * 0.72;
    const d = this.depth(b.x, b.z);
    // Right under the lens a tree is a blob across the corner, not a tree.
    if (d < 16) return;
    if (!this.point(b.x, cy, b.z)) return;
    const x = this.px;
    const y = this.py;
    const r = (this.f * b.s) / d;
    if (r < 0.6) return;
    if (b.k === 'tree' && this.point(b.x, 0, b.z)) {
      ctx.strokeStyle = th.trunk;
      ctx.lineWidth = Math.max(0.7, r * 0.12);
      ctx.beginPath();
      ctx.moveTo(this.px, this.py);
      ctx.lineTo(x, y + r * 0.6);
      ctx.stroke();
    }
    ctx.fillStyle = th.treeFill;
    ctx.strokeStyle = th.treeEdge;
    ctx.lineWidth = Math.max(0.5, Math.min(0.9, r * 0.06)) * this.dpr;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // A sunlit crown, up and to the left where the light comes from: volume
    // without a gradient, which would cost an allocation per tree per frame.
    if (r > 3) {
      ctx.fillStyle = th.treeLight;
      ctx.beginPath();
      ctx.arc(x - r * 0.26, y - r * 0.28, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private conifer(b: Bill, ys: number): void {
    const { ctx } = this;
    const th = this.view.theme;
    const h = b.h * ys;
    const d = Math.max(this.depth(b.x, b.z), NEAR);
    if (!this.point(b.x, h * 0.18, b.z)) return;
    const bx = this.px;
    const by = this.py;
    if (!this.point(b.x, h, b.z)) return;
    const w = (this.f * b.s) / d;
    if (w < 0.6) return;
    ctx.fillStyle = th.treeFill;
    ctx.strokeStyle = th.treeEdge;
    ctx.lineWidth = Math.max(0.6, Math.min(1.1, w * 0.08)) * this.dpr;
    ctx.beginPath();
    ctx.moveTo(this.px, this.py);
    ctx.lineTo(bx + w, by);
    ctx.lineTo(bx - w, by);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (w > 3) {
      ctx.beginPath();
      ctx.moveTo(bx - w * 0.62, by - (by - this.py) * 0.38);
      ctx.lineTo(bx + w * 0.62, by - (by - this.py) * 0.38);
      ctx.stroke();
    }
  }

  private palm(b: Bill, ys: number): void {
    const { ctx } = this;
    const th = this.view.theme;
    const h = b.h * ys;
    const lean = ((b.seed % 7) - 3) * 0.12;
    if (!this.point(b.x, 0, b.z)) return;
    const x0 = this.px;
    const y0 = this.py;
    if (!this.point(b.x + lean, h, b.z)) return;
    const x1 = this.px;
    const y1 = this.py;
    const d = Math.max(this.depth(b.x, b.z), NEAR);
    const r = (this.f * b.s) / d;
    if (r < 0.8) return;
    ctx.strokeStyle = th.trunk;
    ctx.lineWidth = Math.max(0.8, r * 0.1);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.2 + r * 0.25, (y0 + y1) / 2, x1, y1);
    ctx.stroke();
    // Fronds: drooping arcs round the crown.
    ctx.strokeStyle = th.treeEdge;
    ctx.lineWidth = Math.max(0.8, Math.min(1.6, r * 0.09)) * this.dpr;
    ctx.beginPath();
    const fronds = 8;
    for (let k = 0; k < fronds; k += 1) {
      const a = (k / fronds) * Math.PI * 2 + b.seed;
      const ex = x1 + Math.cos(a) * r;
      const ey = y1 + Math.abs(Math.sin(a)) * r * 0.35 + r * 0.35;
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(x1 + Math.cos(a) * r * 0.6, y1 - r * 0.35, ex, ey);
    }
    ctx.stroke();
    ctx.fillStyle = th.treeEdge;
    ctx.beginPath();
    ctx.arc(x1, y1, Math.max(1, r * 0.1), 0, Math.PI * 2);
    ctx.fill();
  }

  private lamp(b: Bill): void {
    const { ctx } = this;
    const th = this.view.theme;
    const base = b.y;
    // The arm reaches out over the carriageway from whichever kerb it stands on.
    const arm = b.x > 0 ? -0.9 : 0.9;
    if (!this.point(b.x, base, b.z)) return;
    const x0 = this.px;
    const y0 = this.py;
    if (!this.point(b.x, base + b.h, b.z)) return;
    const x1 = this.px;
    const y1 = this.py;
    if (!this.point(b.x + arm, base + b.h + 0.1, b.z)) return;
    const d = Math.max(this.depth(b.x, b.z), NEAR);
    if (y0 - y1 < 2) return;
    ctx.strokeStyle = th.edge;
    ctx.lineWidth = Math.max(0.6, Math.min(1.3, 18 / d)) * this.dpr;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(this.px, this.py);
    ctx.stroke();
    // Street lights only glow after dark; by day the head is a small dot.
    const glow = Math.min((this.f * 1.3) / d, 14 * this.dpr);
    if (th.name === 'night' && glow > 1.5) {
      ctx.fillStyle = th.lampGlow;
      ctx.beginPath();
      ctx.arc(this.px, this.py + glow * 0.2, glow, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = th.lampCore;
    ctx.beginPath();
    ctx.arc(this.px, this.py, Math.min(2.2, Math.max(0.8, glow * 0.14)) * this.dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Tower crane: lattice mast, a jib that slews slowly round, the counter-jib
   * and its weights, the trolley and hook, and the pendant ties to the peak.
   */
  private crane(b: Bill, ys: number): void {
    const { ctx } = this;
    const th = this.view.theme;
    const H = b.h * ys;
    const d = Math.max(this.depth(b.x, b.z), NEAR);
    if ((this.f * H) / d < 12) return;
    const m = 0.45;
    const segs: number[] = [];
    const add = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
      if (this.segment(x0, y0, z0, x1, y1, z1)) segs.push(this.sx0, this.sy0, this.sx1, this.sy1);
    };
    // Mast: two chords and the lacing between them.
    add(b.x - m, 0, b.z, b.x - m, H, b.z);
    add(b.x + m, 0, b.z, b.x + m, H, b.z);
    for (let y = 0; y < H - 1; y += 1.8) add(b.x - m, y, b.z, b.x + m, y + 1.8, b.z);

    // Slewing jib.
    const a = this.t * 0.24 + (b.seed % 628) / 100;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const peak = H + 3.2;
    const tipX = b.x + cx * b.s;
    const tipZ = b.z + cz * b.s;
    const tailX = b.x - cx * b.s * 0.32;
    const tailZ = b.z - cz * b.s * 0.32;
    add(b.x, H, b.z, tipX, H, tipZ);
    add(b.x, H + 0.9, b.z, tipX, H + 0.5, tipZ);
    add(b.x, H, b.z, tailX, H, tailZ);
    add(b.x, peak, b.z, tipX, H + 0.5, tipZ);
    add(b.x, peak, b.z, tailX, H, tailZ);
    add(b.x, H, b.z, b.x, peak, b.z);
    // Trolley and hook, travelling slowly along the jib.
    const along = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(this.t * 0.38 + b.seed));
    const hx = b.x + cx * b.s * along;
    const hz = b.z + cz * b.s * along;
    // ...and the load going up and down on it.
    const hookY = H * (0.3 + 0.4 * (0.5 + 0.5 * Math.sin(this.t * 0.5 + b.seed * 0.7)));
    add(hx, H, hz, hx, hookY, hz);

    ctx.strokeStyle = th.crane;
    ctx.lineWidth = Math.max(0.6, Math.min(1.2, 22 / d)) * this.dpr;
    ctx.beginPath();
    for (let i = 0; i < segs.length; i += 4) {
      ctx.moveTo(segs[i]!, segs[i + 1]!);
      ctx.lineTo(segs[i + 2]!, segs[i + 3]!);
    }
    ctx.stroke();

    // Counterweight and the hook block.
    if (this.point(tailX, H - 0.6, tailZ)) {
      const s = Math.max(1.5, (this.f * 0.9) / d);
      ctx.fillStyle = th.mat.accent[4]!;
      ctx.fillRect(this.px - s, this.py - s * 0.5, s * 2, s * 1.4);
    }
    if (this.point(hx, hookY, hz)) {
      const s = Math.max(1, (this.f * 0.35) / d);
      ctx.fillStyle = th.crane;
      ctx.fillRect(this.px - s, this.py, s * 2, s * 1.6);
    }
    this.blink(b.x, peak, b.z, b.seed);
  }

  private silo(b: Bill, ys: number): void {
    const { ctx } = this;
    const th = this.view.theme;
    const H = b.h * ys;
    const d = Math.max(this.depth(b.x, b.z), NEAR);
    if (!this.point(b.x, 0, b.z)) return;
    const bx = this.px;
    const by = this.py;
    if (!this.point(b.x, H, b.z)) return;
    const tx = this.px;
    const ty = this.py;
    const r = (this.f * b.s) / d;
    if (r < 0.8) return;
    // The top's apparent ellipse, from two points on its rim.
    let ry = r * 0.25;
    if (this.point(b.x, H, b.z - b.s)) {
      const yFront = this.py;
      if (this.point(b.x, H, b.z + b.s)) ry = Math.max(0.5, Math.abs(yFront - this.py) / 2);
    }
    const g = ctx.createLinearGradient(bx - r, 0, bx + r, 0);
    g.addColorStop(0, th.mat.metal[6]!);
    g.addColorStop(0.55, th.mat.metal[4]!);
    g.addColorStop(1, th.mat.metal[1]!);
    ctx.fillStyle = g;
    ctx.strokeStyle = th.edge;
    ctx.lineWidth = Math.max(0.6, Math.min(1.2, 30 / d)) * this.dpr;
    ctx.beginPath();
    ctx.moveTo(tx - r, ty);
    ctx.lineTo(bx - r, by);
    ctx.ellipse(bx, by, r, ry, 0, Math.PI, 0, true);
    ctx.lineTo(tx + r, ty);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Hoops down the barrel.
    ctx.strokeStyle = th.detail;
    ctx.lineWidth = 0.7 * this.dpr;
    ctx.beginPath();
    for (let k = 1; k < 6; k += 1) {
      const y = ty + ((by - ty) * k) / 6;
      const x = tx + ((bx - tx) * k) / 6;
      ctx.moveTo(x - r, y);
      ctx.ellipse(x, y, r, ry, 0, Math.PI, 0, true);
    }
    ctx.stroke();
    // Conical cap.
    ctx.fillStyle = th.mat.roof[6]!;
    ctx.strokeStyle = th.edge;
    ctx.beginPath();
    ctx.ellipse(tx, ty, r, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (this.point(b.x, H + b.s * 0.55, b.z)) {
      ctx.beginPath();
      ctx.moveTo(tx - r, ty);
      ctx.lineTo(this.px, this.py);
      ctx.lineTo(tx + r, ty);
      ctx.stroke();
    }
  }

  private beacon(b: Bill, ys: number): void {
    const { ctx } = this;
    const base = b.y * ys;
    if (!this.segment(b.x, base, b.z, b.x, base + b.h, b.z)) return;
    ctx.strokeStyle = this.view.theme.edge;
    ctx.lineWidth = 0.8 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(this.sx0, this.sy0);
    ctx.lineTo(this.sx1, this.sy1);
    ctx.stroke();
    this.blink(b.x, base + b.h, b.z, b.seed);
  }

  /** Aircraft-warning light: on for a moment every couple of seconds. */
  private blink(x: number, y: number, z: number, seed: number): void {
    const on = Math.sin(this.t * 2.6 + (seed % 97)) > 0.55;
    if (!on || !this.point(x, y, z)) return;
    const { ctx } = this;
    ctx.fillStyle = this.view.theme.lampGlow;
    ctx.beginPath();
    ctx.arc(this.px, this.py, 6 * this.dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = this.view.theme.beacon;
    ctx.beginPath();
    ctx.arc(this.px, this.py, 1.8 * this.dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  // -------------------------------------------------------------------------
  // Traffic
  // -------------------------------------------------------------------------

  private readonly carBody = new Float32Array(15 * 12);

  private drawCar(i: number): void {
    const { ctx } = this;
    const th = this.view.theme;
    const lane = i % 4;
    const x = LANES[lane]!;
    const dir = x < 0 ? 1 : -1;
    const span = this.view.kind === 'forward' ? this.view.far * 0.75 : this.view.far * 2;
    const base = this.view.kind === 'forward' ? this.cz + 4 : this.cz - span / 2;
    const speed = 6 + ((i * 37) % 7);
    const phase = ((i * 7919) % 1000) / 1000;
    const along = (((phase * span + dir * speed * this.t) % span) + span) % span;
    const z = base + along;
    const d = Math.max(this.depth(x, z), NEAR);
    const L = i % 5 === 0 ? 3.4 : 2.1;
    const W = i % 5 === 0 ? 1.1 : 0.95;
    const H = i % 5 === 0 ? 1.6 : 0.66;

    // Far away a car is just its lights.
    if ((this.f * L) / d < 5) {
      if (!this.point(x, 0.5, z)) return;
      ctx.fillStyle = dir > 0 ? th.carTail : th.carHead;
      ctx.fillRect(this.px - 0.8 * this.dpr, this.py - 0.6 * this.dpr, 1.6 * this.dpr, 1.2 * this.dpr);
      return;
    }

    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: 'car' | 'glass') => {
      const faces: Array<[number[], number, number, number]> = [
        [[x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0], 0, 0, -1],
        [[x1, y0, z1, x0, y0, z1, x0, y1, z1, x1, y1, z1], 0, 0, 1],
        [[x0, y0, z1, x0, y0, z0, x0, y1, z0, x0, y1, z1], -1, 0, 0],
        [[x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0], 1, 0, 0],
        [[x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1], 0, 1, 0],
      ];
      ctx.strokeStyle = th.edge;
      ctx.lineWidth = Math.max(0.5, Math.min(1, 20 / d)) * this.dpr;
      for (const [p, nx, ny, nz] of faces) {
        if (nx * (this.cx - p[0]!) + ny * (this.cy - p[1]!) + nz * (this.cz - p[2]!) <= 0) continue;
        this.carBody.set(p);
        const m = this.poly(this.carBody, 4, 1);
        if (m < 3) continue;
        const level = ny > 0 ? 7 : nz < 0 ? 5 : nx < 0 ? 5 : 1;
        ctx.fillStyle = th.mat[mat][level]!;
        ctx.beginPath();
        this.tracePoly(m);
        ctx.fill();
        ctx.stroke();
      }
    };

    const hw = W / 2;
    const hl = L / 2;
    box(x - hw, x + hw, 0.14, H, z - hl, z + hl, 'car');
    if (i % 5 !== 0) box(x - hw * 0.9, x + hw * 0.9, H, H + 0.44, z - hl * 0.5, z + hl * 0.45, 'glass');

    // Lights at whichever end faces the camera.
    const endZ = dir > 0 ? z - hl : z + hl;
    const colour = dir > 0 ? th.carTail : th.carHead;
    ctx.fillStyle = colour;
    for (const sx of [-hw * 0.7, hw * 0.7]) {
      if (!this.point(x + sx, 0.45, endZ)) continue;
      const r = Math.max(0.8, (this.f * 0.14) / d) * this.dpr * 0.6;
      ctx.beginPath();
      ctx.arc(this.px, this.py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

