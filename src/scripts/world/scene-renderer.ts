/**
 * One scene's drawing, independent of where it runs.
 *
 * The page thread (terrain.ts) decides WHAT a scene shows — camera, masks,
 * layers, size — and hands it over as plain data. This class does the drawing,
 * either in a worker (world/worker.ts, the normal case: the page thread and
 * the GPU never pay for the city) or on the page itself where the browser has
 * no OffscreenCanvas. Everything that crosses between the two is structured-
 * clonable: no DOM, no functions, no theme objects — a theme travels by name.
 */
import { city } from './city';
import { LAYERS, makeCanvas, paintShield, paintSolids, WorldRenderer, type FrameInput, type MaskDraw, type ViewConfig } from './renderer';
import { THEMES } from './themes';
import type { ThemeName } from './types';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Bitmap = HTMLCanvasElement | OffscreenCanvas;

/** A view, as data: the theme by name. */
export type ViewSpec = Omit<ViewConfig, 'theme'> & { theme: ThemeName };

/** One mask to paint: rects in mask px (x, y, w, h each), at `k` mask px per CSS px. */
export interface MaskSpec {
  w: number;
  h: number;
  k: number;
  text: Float32Array;
  solid: Float32Array;
}

/** Where to stamp a mask this frame: -1 is the host mask, 0.. the anchors. */
export interface MaskPlacement {
  which: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export type Layers = Partial<Record<keyof typeof LAYERS, boolean>>;

/** Everything one frame needs, as data. */
export interface FrameSpec {
  input: Omit<FrameInput, 'masks'>;
  placements: MaskPlacement[];
  layers: Layers;
  /** Per-frame view changes: the tier's distance, the narrow-layout cull. */
  far: number;
  cullLeft: number;
  cullRight: number;
}

export class SceneRenderer {
  private readonly ctx: Ctx2D;
  private readonly renderer: WorldRenderer;
  private readonly view: ViewConfig;
  private hostMask: Bitmap | null = null;
  private anchorMasks: Array<Bitmap | null> = [];
  private readonly draws: MaskDraw[] = [];

  constructor(
    private readonly canvas: Bitmap,
    spec: ViewSpec,
    private readonly software: boolean,
  ) {
    // In a worker the drawing is the CPU's: `willReadFrequently` keeps the
    // canvas out of the GPU, which on an integrated chip is the scarce part —
    // it has the page to composite. Measured on this site: a backdrop frame
    // cost 55 ms through a Radeon 820M and 33 ms on one CPU core.
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: software }) as Ctx2D | null;
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
    this.view = { ...spec, theme: THEMES[spec.theme] };
    this.renderer = new WorldRenderer(ctx as CanvasRenderingContext2D, this.view);
    this.renderer.software = software;
  }

  /** A new size, applied with the next frame — see size(). */
  private pending: [number, number] | null = null;

  /**
   * Resizing a canvas empties it, and an emptied canvas handed over by a
   * worker is shown empty until something is drawn — a blank flash in the
   * middle of the page. So a new size waits for the next frame, and the two
   * land together; until then the old picture simply stretches. Releasing
   * (0 × 0) happens at once: that canvas is off screen.
   */
  size(w: number, h: number): void {
    if (!w || !h) {
      this.pending = null;
      this.canvas.width = 1;
      this.canvas.height = 1;
      this.hostMask = null;
      this.anchorMasks = [];
      return;
    }
    if (w === this.canvas.width && h === this.canvas.height) this.pending = null;
    else this.pending = [w, h];
  }

  masks(host: MaskSpec | null, anchors: MaskSpec[]): void {
    this.hostMask = host ? paint(host, this.software) : null;
    this.anchorMasks = anchors.map((a) => paint(a, this.software));
  }

  /** Draw a frame; returns what it cost, in ms. */
  draw(frame: FrameSpec): number {
    const began = performance.now();
    if (this.pending) {
      [this.canvas.width, this.canvas.height] = this.pending;
      this.pending = null;
    }
    if (!this.canvas.width || !this.canvas.height) return 0;
    Object.assign(LAYERS, frame.layers);
    this.view.far = frame.far;
    this.view.cullLeft = frame.cullLeft;
    this.view.cullRight = frame.cullRight;
    this.draws.length = 0;
    for (const p of frame.placements) {
      const img = p.which === -2 ? this.softSpot() : p.which < 0 ? this.hostMask : this.anchorMasks[p.which];
      if (img) this.draws.push({ img, sx: p.sx, sy: p.sy, sw: p.sw, sh: p.sh, dx: p.dx, dy: p.dy, dw: p.dw, dh: p.dh });
    }
    this.renderer.render({ ...frame.input, masks: this.draws });
    // A canvas records its drawing and paints it later, when the frame is
    // handed over — so without this the time below is only the recording,
    // and the quality governor would believe a 40 ms frame cost 6. Reading
    // one pixel makes the painting happen now, on this thread, where it had
    // to happen anyway; the reply then also means "finished", truly.
    if (this.software) this.ctx.getImageData(0, 0, 1, 1);
    return performance.now() - began;
  }

  private spot: Bitmap | null = null;

  /**
   * A soft round clearing, 30% at its centre and none at its rim,
   * stretched into place by its placement (`which: -2`). The welcome window
   * uses it to dim the city under its lens. That used to be a CSS mask on the
   * canvas, and glass blurring a masked, constantly redrawn layer was the
   * shader combination that froze a first-time browser for 600 ms.
   */
  private softSpot(): Bitmap | null {
    if (this.spot) return this.spot;
    const S = 128;
    const c = makeCanvas(S, S);
    const g = c?.getContext('2d', { willReadFrequently: this.software }) as Ctx2D | null | undefined;
    if (!c || !g) return null;
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    this.spot = c;
    return c;
  }

  /** For tests: the frame's pixels. */
  pixels(): ImageData | null {
    if (!this.canvas.width || !this.canvas.height) return null;
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }
}

function paint(spec: MaskSpec, software: boolean): Bitmap | null {
  const mask = makeCanvas(Math.max(1, Math.ceil(spec.w)), Math.max(1, Math.ceil(spec.h)));
  // CPU-backed when the frames are: see WorldRenderer.software.
  const g = mask?.getContext('2d', { willReadFrequently: software }) as Ctx2D | null | undefined;
  if (!mask || !g) return null;
  paintSolids(g, spec.solid, spec.k);
  paintShield(g, spec.text, spec.k);
  return mask;
}

/** Build a stretch of road ahead of need. */
export function warm(zMin: number, zMax: number): void {
  city.warm(zMin, zMax);
}
