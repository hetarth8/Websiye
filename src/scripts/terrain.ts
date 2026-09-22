/**
 * The city behind the site — lifecycle, camera, scheduling and quality.
 *
 * Every `canvas[data-terrain]` on a page is a window into ONE shared city
 * (src/scripts/world). This file decides, per canvas, where its camera stands,
 * how it moves and when it may draw; world/renderer.ts does the drawing.
 *
 * Modes:
 *   hero     the home page's opening screen — the skyline district, by day
 *   band     the dark "We own the ground we build on" band — industry, at night
 *   page     subpage headers — whichever district the page is about
 *   strip    full-width interludes between sections — a side-on street view
 *   opening  the welcome window: full-bleed, the resort on the left, a rising
 *            skyline on the right, already moving before anything else appears
 *   travel   the page-transition overlay: the camera surges down the road as a
 *            page leaves and decelerates into the next page's district
 *   backdrop behind every other section of every page, added at run time (see
 *            decorateSections) — so the city is the ground the whole site
 *            stands on. Faint, kept clear of every word and every card.
 *
 * Per-canvas overrides, all optional:
 *   data-world-district  resort | residential | skyline | industrial | highway
 *   data-world-vp        vanishing point, fraction of width
 *   data-world-cull      "left,right" — fractions a CSS mask hides completely
 *   data-world-theme     day | night
 *
 * PERFORMANCE is part of the design, and it is measured, not assumed.
 *
 *   One loop. Every scene is driven by a single requestAnimationFrame
 *   scheduler (`Loop`), which decides each frame which scenes may draw:
 *     - nothing hidden draws: off screen, in a background tab, behind the
 *       welcome window, or under the page-transition overlay;
 *     - only the most visible one or two scenes animate (the quality tier
 *       decides how many); others keep their last frame until they lead;
 *     - at most one or two scene draws happen in any one frame, so two
 *       scenes falling due together never double a frame's cost.
 *
 *   Quality tiers (`TIERS`): high → medium → low. A governor watches the
 *   page's actual frame rate and the drawing thread's frame cost while the
 *   city animates, and steps down a tier when either cannot keep up, back up
 *   only after sustained headroom. Tiers lower the FRAME RATE only — never the
 *   resolution or the detail (the owner judged a softer city "very poor") —
 *   and never to zero: the governor cannot stop the city. 'still' is for
 *   reduced motion and Save-Data alone. The tier is kept for the session, so
 *   the next page starts where this one settled. `html[data-quality]` lets
 *   the stylesheet thin the glass blur the same way.
 *
 *   Cheap frames. Clearings under text and cards are painted ONCE into a
 *   half-resolution mask and stamped out of each frame with one image draw.
 *   Positions come from a cached layout and the scroll offset, not from
 *   layout reads every frame. Text is measured in idle time.
 *
 * The motion itself:
 *   - SCROLL travel: each canvas moves `span` world units along the road while
 *     its section crosses the viewport, and the camera cranes up a little.
 *   - LIGHT: the day scenes' horizon glow warms as the page is read.
 *   - SURGE: `world:surge` flies every running scene forward briefly; the
 *     welcome window's exit and the page transitions both use it.
 *
 * Reduced motion, Save-Data and reduced data → still frames, no loop.
 * Nothing here styles the DOM beyond classes and two data attributes on
 * <html>; the CSP is untouched.
 */
import { anchorZ, LAYERS, paintShield, paintSolids, SHIELD_REACH, type ViewConfig } from './world/renderer';
import {
  SceneRenderer,
  warm as warmHere,
  type FrameSpec,
  type Layers,
  type MaskPlacement,
  type MaskSpec,
  type ViewSpec,
} from './world/scene-renderer';
import { THEMES } from './world/themes';
import type { DistrictId, ThemeName } from './world/types';

type Mode = 'hero' | 'band' | 'page' | 'strip' | 'opening' | 'travel' | 'backdrop';

type Preset = Omit<ViewConfig, 'theme'> & {
  theme: ThemeName;
  /** Max pointer parallax, degrees. 0 disables it. */
  yaw: number;
  pitch: number;
  dprCap: number;
  /** Keep the scene clear beneath the section's text, controls and surfaces. */
  shield: boolean;
  /** World units the camera cranes up across the canvas's scroll pass. */
  crane: number;
  /**
   * Free the bitmap while off screen. A section-sized canvas at retina density
   * is several megabytes of GPU memory; a page with a dozen of them holding
   * bitmaps nobody can see is how a phone runs out.
   */
  release: boolean;
  /** A soft background: drawn at the tier's backdrop rate, never the full one. */
  soft: boolean;
  /**
   * World units the camera glides forward and back again, over `glidePeriod`
   * seconds — for a scene that never scrolls. An endless drift carried the
   * welcome window out of its composed street into empty lots.
   */
  glide: number;
  glidePeriod: number;
  /**
   * Degrees the camera slowly pans left and right on its own, and world units
   * it rises and settles: the city moves whether or not anyone scrolls or
   * moves the mouse, like a drone holding over a site.
   */
  sway: number;
  bob: number;
};

const BASE: Omit<Preset, 'kind' | 'district'> = {
  theme: 'day',
  bias: -6,
  span: 60,
  drift: 0,
  camH: 20,
  camX: 0,
  vpX: 0.5,
  horizonY: 0.26,
  focal: 0.95,
  far: 150,
  cullLeft: 0,
  cullRight: 1,
  buildings: true,
  traffic: true,
  strength: 1,
  yaw: 2,
  pitch: 1.2,
  dprCap: 2,
  shield: false,
  crane: 0,
  release: true,
  soft: false,
  glide: 5,
  glidePeriod: 40,
  sway: 1.2,
  bob: 0.5,
};

const PRESETS: Record<Mode, Preset> = {
  hero: {
    ...BASE,
    kind: 'forward',
    district: 'skyline',
    bias: -8,
    span: 70,
    camH: 22,
    vpX: 0.74,
    horizonY: 0.24,
    focal: 1,
    far: 175,
    cullLeft: 0.42,
    yaw: 2.5,
    pitch: 1.5,
    shield: true,
    crane: 4,
  },
  band: {
    ...BASE,
    kind: 'forward',
    theme: 'night',
    district: 'industrial',
    span: 80,
    vpX: 0.66,
    horizonY: 0.24,
    cullLeft: 0.34,
    pitch: 1,
    shield: true,
    crane: 4,
  },
  page: {
    ...BASE,
    kind: 'forward',
    district: 'skyline',
    vpX: 0.76,
    far: 140,
    cullLeft: 0.44,
    shield: true,
    crane: 3,
  },
  strip: {
    ...BASE,
    kind: 'side',
    district: 'resort',
    bias: 62,
    span: 46,
    camH: 6,
    camX: 12,
    horizonY: 0.6,
    focal: 0.85,
    far: 72,
    yaw: 0,
    pitch: 0,
    soft: true,
    // A slow tracking shot along the street, back and forth, on its own.
    glide: 7,
    glidePeriod: 34,
    sway: 0,
    bob: 0,
  },
  opening: {
    ...BASE,
    kind: 'forward',
    district: 'resort',
    bias: -2,
    span: 0,
    // The welcome window never scrolls, so the camera glides down the road on
    // its own, then eases back: the world is alive from the first frame and
    // never leaves the stretch composed for it.
    drift: 0,
    glide: 14,
    glidePeriod: 36,
    sway: 1.8,
    bob: 0.9,
    // High and wide: the whole development, not the nearest facade.
    camH: 31,
    horizonY: 0.33,
    focal: 0.72,
    far: 175,
    yaw: 1.5,
    pitch: 1,
    // Sized by its window, which is display:none once closed — an empty box
    // releases the bitmap (see resize), so no observer is needed.
    release: false,
  },
  travel: {
    ...BASE,
    kind: 'forward',
    district: 'skyline',
    bias: -4,
    span: 0,
    camH: 21,
    horizonY: 0.34,
    focal: 0.84,
    far: 160,
    yaw: 0,
    pitch: 0,
    dprCap: 1.5,
    release: false,
    glide: 0,
    sway: 0,
    bob: 0,
  },
  backdrop: {
    ...BASE,
    kind: 'forward',
    district: 'skyline',
    span: 64,
    camH: 27,
    horizonY: 0.22,
    focal: 0.92,
    far: 160,
    // Behind content, it supports rather than competes: well below full
    // strength, and never drawn under a word or a card.
    // Quiet behind content: the redesign's clean hierarchy asks the city to
    // be the ground the site stands on, not a second layer of information.
    strength: 0.52,
    yaw: 1.4,
    pitch: 0.8,
    // As sharp as the screen: at one pixel per CSS pixel the city read as a
    // blur behind the cards on a 125% Windows display.
    dprCap: 2,
    shield: true,
    crane: 3,
    soft: true,
  },
};

/**
 * Which part of the city each home-page section stands in — in the order the
 * page tells its story. Anything not listed (and every section on a subpage)
 * uses the district of the page's own header scene, so a division page stays
 * in its own trade all the way down.
 */
const SECTION_DISTRICTS: Record<string, DistrictId> = {
  about: 'skyline',
  founder: 'residential',
  org: 'skyline',
  services: 'highway',
  fleet: 'industrial',
  equipment: 'industrial',
  projects: 'skyline',
  proof: 'highway',
  government: 'highway',
  credentials: 'residential',
  process: 'industrial',
  faq: 'resort',
  contact: 'skyline',
};

/**
 * Content surfaces the city is cleared from entirely, not just under their
 * words. A table of 29 rows, a card, a list of questions: the city belongs in
 * the space around them, and seen through them it only makes them harder to
 * read. `data-surface` marks one that has no class of its own to find it by.
 */
const SURFACES = '.card, .panel-light, .project-card, table, [data-surface]';

/** Sections shorter than this are ribbons and dividers, not grounds. */
const BACKDROP_MIN_HEIGHT = 220;

const DISTRICTS: readonly DistrictId[] = ['resort', 'residential', 'skyline', 'industrial', 'highway'];

/**
 * Put a backdrop behind every section that does not already have a scene.
 *
 * Done at run time rather than in each component so that every section on
 * every page gets one without eighteen templates carrying the same markup —
 * and so that a JavaScript-less visitor, who would see no animation anyway,
 * gets no empty canvases either. Every height is read BEFORE anything is
 * inserted: interleaving the reads with the writes forced a layout per section.
 */
function decorateSections(): void {
  const fallback = pageDistrict();
  const targets = [...document.querySelectorAll<HTMLElement>('main section')].filter(
    (section) =>
      !section.querySelector('canvas[data-terrain]') &&
      !section.parentElement?.closest('.world-host') &&
      section.offsetHeight >= BACKDROP_MIN_HEIGHT,
  );
  for (const section of targets) {
    const wrap = document.createElement('div');
    wrap.className = 'world-backdrop';
    wrap.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    canvas.className = 'terrain terrain--backdrop';
    canvas.dataset.terrain = 'backdrop';
    canvas.dataset.worldDistrict = SECTION_DISTRICTS[section.id] ?? fallback;
    wrap.appendChild(canvas);
    section.prepend(wrap);
    section.classList.add('world-host');
  }
}

/** Below this width the copy spans the page and the CSS masks change shape. */
const NARROW = 1024;
/** How quickly the camera catches up with the scroll position, per 60th of a second. */
const EASE = 0.1;
/** Top speed of a surge, world units per second. */
const SURGE_SPEED = 72;
/** How far the lens widens at top speed. */
const SURGE_WIDEN = 0.16;
/** Masks are painted at this fraction of the canvas's resolution; they are soft anyway. */
const MASK_RES = 0.5;
/** A backdrop's CSS mask, in mask px per CSS px: every edge in it is feathered 16-40px. */
const CSS_MASK_RES = 0.35;

/**
 * The horizon glow through the day, top of the page to bottom: cool morning,
 * clear midday, warm late afternoon. Precomputed, so a frame never builds a
 * colour string.
 */
const LIGHT: string[] = (() => {
  const stops: Array<[number, [number, number, number, number]]> = [
    [0, [214, 196, 160, 0.14]],
    [0.5, [226, 214, 190, 0.12]],
    [1, [240, 190, 130, 0.18]],
  ];
  const out: string[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const k = t <= 0.5 ? 0 : 1;
    const [t0, a] = stops[k]!;
    const [t1, b] = stops[k + 1]!;
    const u = (t - t0) / (t1 - t0);
    const c = a.map((v, j) => v + (b[j]! - v) * u);
    out.push(`rgba(${Math.round(c[0]!)},${Math.round(c[1]!)},${Math.round(c[2]!)},${c[3]!.toFixed(3)})`);
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

interface Tier {
  name: 'high' | 'medium' | 'low' | 'still';
  /** Frames a second for the main scenes and for the soft backgrounds (0 = still). */
  fps: number;
  softFps: number;
  /** How many scenes may animate at once, and draw in any one frame. */
  live: number;
  perFrame: number;
  /** Fraction of each view's normal distance. */
  far: number;
  sheen: boolean;
  panes: boolean;
  lines: boolean;
  decals: boolean;
}

const TIERS: readonly Tier[] = [
  // The picture never gets worse — full resolution and full detail on every
  // tier. A struggling device gets FEWER frames, not blurrier ones: the owner
  // judged the lower-resolution city "very poor", and a slower city is far
  // less visible than a soft one.
  { name: 'high', fps: 60, softFps: 30, live: 2, perFrame: 2, far: 1, sheen: true, panes: true, lines: true, decals: true },
  { name: 'medium', fps: 30, softFps: 30, live: 2, perFrame: 2, far: 1, sheen: false, panes: true, lines: true, decals: true },
  { name: 'low', fps: 24, softFps: 20, live: 1, perFrame: 1, far: 0.92, sheen: false, panes: true, lines: true, decals: true },
  { name: 'still', fps: 0, softFps: 0, live: 0, perFrame: 1, far: 1, sheen: true, panes: true, lines: true, decals: true },
];

const TIER_KEY = 'aht:world-tier';
/** The slowest tier the governor may choose; 'still' is for reduced motion only. */
const LOWEST = 2;

function shouldBeStatic(): boolean {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  if (window.matchMedia('(prefers-reduced-data: reduce)').matches) return true;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  return Boolean(nav.connection?.saveData);
}

/**
 * The governor. It samples the page's real frame interval while the city is
 * animating, and moves one tier at a time: down when the median frame is
 * slower than ~49 fps or one frame in ten takes over 34 ms; up only after
 * eight seconds of clear headroom, and never back to a tier it was driven out
 * of in this session (no oscillation).
 */
const Quality = {
  index: 0,
  /** The best tier this session has proved it can hold. */
  ceiling: 0,
  samples: new Float32Array(90),
  n: 0,
  head: 0,
  changedAt: 0,
  listeners: [] as Array<() => void>,

  get tier(): Tier {
    return TIERS[this.index]!;
  },

  init(): void {
    if (shouldBeStatic()) {
      this.index = 3;
      this.ceiling = 3;
    } else {
      let stored: { index: number; ceiling: number } | null = null;
      try {
        const raw = window.sessionStorage.getItem(TIER_KEY);
        if (raw) stored = JSON.parse(raw) as { index: number; ceiling: number };
      } catch {
        /* Private modes throw; start from the hints below. */
      }
      if (stored && stored.index >= 0 && stored.index <= 3) {
        // Never restore a stopped city: a session that once hit a slow patch
        // stayed frozen on every page until the tab was closed.
        this.index = Math.min(stored.index, LOWEST);
        this.ceiling = Math.min(stored.ceiling, this.index);
      } else {
        // A first guess from what the device says about itself. The governor
        // corrects it within a second or two either way.
        const nav = navigator as Navigator & { deviceMemory?: number };
        const coarse = window.matchMedia('(pointer: coarse)').matches;
        const cores = nav.hardwareConcurrency ?? 8;
        const memory = nav.deviceMemory ?? 8;
        this.index = coarse || cores <= 4 || memory <= 4 ? 1 : 0;
        this.ceiling = 0;
      }
    }
    this.publish();
  },

  publish(): void {
    document.documentElement.dataset.quality = this.tier.name;
    try {
      window.sessionStorage.setItem(TIER_KEY, JSON.stringify({ index: this.index, ceiling: this.ceiling }));
    } catch {
      /* Not remembered across pages, then. */
    }
  },

  /** No judging until then: a surge, a page leaving, is not the city's normal cost. */
  holdUntil: 0,

  hold(ms: number): void {
    this.holdUntil = Math.max(this.holdUntil, performance.now() + ms);
    this.n = 0;
    this.head = 0;
  },

  record(ms: number): void {
    // A background tab, a debugger pause, a page swap: not a frame. Nor is
    // anything in the first moments of the page, when images and fonts are
    // decoding whatever the city does, or during a surge.
    const now = performance.now();
    if (ms <= 0 || ms > 250 || now < 1500 || now < this.holdUntil) return;
    this.samples[this.head] = ms;
    this.head = (this.head + 1) % this.samples.length;
    this.n = Math.min(this.n + 1, this.samples.length);
  },

  /**
   * The second signal: what each city frame costs against the time the tier
   * gives it (1.0 = exactly its budget). The page can be perfectly smooth
   * while the drawing thread falls behind — the city would then move in
   * visible steps — so that too moves the tier.
   */
  work: new Float32Array(30),
  workN: 0,
  workHead: 0,

  recordWork(ms: number, budgetMs: number): void {
    if (ms <= 0 || budgetMs <= 0 || performance.now() < this.holdUntil) return;
    this.work[this.workHead] = ms / budgetMs;
    this.workHead = (this.workHead + 1) % this.work.length;
    this.workN = Math.min(this.workN + 1, this.work.length);
  },

  reset(now: number): void {
    this.n = 0;
    this.head = 0;
    this.workN = 0;
    this.workHead = 0;
    this.changedAt = now;
  },

  evaluatedAt: 0,

  evaluate(now: number): void {
    if (now - this.evaluatedAt < 500) return;
    this.evaluatedAt = now;
    if (this.index >= 3 || now - this.changedAt < 1200 || now < this.holdUntil) return;
    const s = Array.from(this.samples.subarray(0, this.n)).sort((a, b) => a - b);
    const median = s.length ? s[s.length >> 1]! : 0;
    const p90 = s.length ? s[Math.floor(s.length * 0.9)]! : 0;
    const w = Array.from(this.work.subarray(0, this.workN)).sort((a, b) => a - b);
    const load = w.length ? w[w.length >> 1]! : 0;
    // Two signals. The page's own frame rate — even with the city drawn in
    // the worker, each new city frame makes the GPU re-blur the glass over it
    // and composite it, so a struggling page is still the city's to relieve.
    // And the city's own frame cost against its budget.
    // Down: plainly failing (a handful of very slow frames is proof enough),
    // or failing over a full sample, or the drawing cannot keep its rate.
    const severe = this.n >= 10 && median > 40;
    const failing = this.n >= 45 && (median > 20.5 || p90 > 34);
    const behind = this.workN >= 10 && load > 1.25;
    // Down as far as the low tier and no further. The governor never stops
    // the city: a stopped city is the one thing the owner notices at once
    // ("why did you make all the animation stagnant"), and at the low tier it
    // draws in the worker at 20-24 frames a second, costing the page nothing.
    // Only reduced motion and Save-Data mean no motion (shouldBeStatic).
    const allowed = this.index < LOWEST && (severe || failing || behind);
    if (allowed) {
      this.index += 1;
      // Driven out of the tier above: this session will not try it again —
      // unless it happened while the page was still settling in.
      if (now > 4000) this.ceiling = Math.max(this.ceiling, this.index);
      this.change(now);
      return;
    }
    // Up: clear headroom on both counts, for long enough to mean it.
    const easy = this.n >= 60 && median < 17.4 && p90 < 20.5 && this.workN >= 20 && load < 0.55;
    if (this.index > this.ceiling && easy && now - this.changedAt > 8000) {
      this.index -= 1;
      this.change(now);
    }
  },

  change(now: number): void {
    this.reset(now);
    this.publish();
    this.listeners.forEach((fn) => fn());
  },
};

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/** Idle time where the browser offers it, a short timeout where it does not. */
function idle(fn: () => void, timeout = 600): void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout });
  else window.setTimeout(fn, 50);
}

const scenes: Scene[] = [];

/**
 * Layout-dependent values, read as rarely as possible. `window.scrollY` and
 * friends make the browser apply any pending style changes on the spot, so
 * reading them every frame while an animation is rewriting styles (the
 * welcome window's exit, say) forced a full style pass per frame — 17% of a
 * mid-range phone's CPU during the exit, with only a fixed overlay drawing.
 * Sizes come from resize events; the scroll offset is read at most once a
 * frame, and only when a scene that scrolls actually needs it.
 */
const View = {
  w: window.innerWidth,
  h: window.innerHeight,
  docH: document.documentElement.scrollHeight,
  scrollY: 0,
  scrollX: 0,
  frame: -1,
};
let frameNo = 0;

/** The scroll offset for this frame, read once. */
function scroll(): { x: number; y: number } {
  if (View.frame !== frameNo) {
    View.frame = frameNo;
    View.scrollY = window.scrollY;
    View.scrollX = window.scrollX;
  }
  return { x: View.scrollX, y: View.scrollY };
}

const Loop = {
  raf: 0,
  running: false,
  last: 0,
  /** The previous tick animated something, so its interval is a real frame. */
  wasLive: false,

  kick(): void {
    if (this.running || document.visibilityState !== 'visible') return;
    this.running = true;
    this.last = 0;
    this.wasLive = false;
    this.raf = requestAnimationFrame(tick);
  },

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  },
};

function tick(now: number): void {
  if (!Loop.running) return;
  frameNo += 1;
  const dt = Loop.last ? now - Loop.last : 0;
  Loop.last = now;

  const tier = Quality.tier;
  const vw = View.w;
  const vh = View.h;

  // Who wants to animate, most important first: the transition overlay and
  // the welcome window own the screen outright; otherwise the most visible.
  const wanting: Scene[] = [];
  const stills: Scene[] = [];
  for (const s of scenes) {
    const st = s.state(tier);
    if (st === 'animate') wanting.push(s);
    else if (st === 'still') stills.push(s);
  }
  if (wanting.length > 1) wanting.sort((a, b) => b.priority(vw, vh) - a.priority(vw, vh));
  // The tier's limit is on the LARGE scenes. A street strip between two
  // sections is a sliver of the screen and cheap to draw, and at the low
  // tier's limit of one it always lost the slot to the section beside it —
  // so every strip on the page stood frozen.
  const live: Scene[] = [];
  let large = 0;
  const cap = Math.max(tier.live, wanting.some((s) => s.exclusive) ? 1 : 0);
  for (const s of wanting) {
    if (s.small) live.push(s);
    else if (large < cap) {
      live.push(s);
      large += 1;
    }
  }
  // A scene that wanted to animate but was not chosen keeps its frame — unless
  // it has none worth keeping, in which case it gets one still draw.
  for (const s of wanting) if (s.dirty && !live.includes(s)) stills.push(s);

  let budget = tier.perFrame;
  const due = live.filter((s) => s.due(now, tier)).sort((a, b) => b.overdue(now) - a.overdue(now));
  for (const s of due) {
    if (budget <= 0 && !s.surging) break;
    s.step(now, tier);
    budget -= 1;
  }
  // Still frames spend what is left of the budget, one at a time.
  if (budget > 0 && stills.length) {
    if (stills.length > 1) stills.sort((a, b) => b.priority(vw, vh) - a.priority(vw, vh));
    stills[0]!.still(now, tier);
  }

  if (live.length) {
    if (Loop.wasLive) Quality.record(dt);
    Quality.evaluate(now);
  }
  Loop.wasLive = live.length > 0;

  if (live.length || stills.length > 1 || (stills.length === 1 && budget <= 0)) {
    Loop.raf = requestAnimationFrame(tick);
  } else {
    Loop.running = false;
  }
}

// ---------------------------------------------------------------------------
// Where a scene is drawn
// ---------------------------------------------------------------------------

/**
 * A scene's drawing surface. Normally the worker (the page thread and the GPU
 * pay nothing for the city); on the page itself only where the browser cannot
 * hand a canvas to a worker, or when `?worldbench` wants to time it directly.
 */
interface Surface {
  /** A frame is still being drawn: send no other. */
  readonly busy: boolean;
  /** What the last frame cost to draw, ms. */
  readonly lastMs: number;
  size(w: number, h: number): void;
  masks(host: MaskSpec | null, anchors: MaskSpec[]): void;
  draw(frame: FrameSpec): void;
}

class LocalSurface implements Surface {
  readonly busy = false;
  lastMs = 0;
  readonly scene: SceneRenderer;
  constructor(canvas: HTMLCanvasElement, spec: ViewSpec, software: boolean) {
    this.scene = new SceneRenderer(canvas, spec, software);
  }
  size(w: number, h: number): void {
    this.scene.size(w, h);
  }
  masks(host: MaskSpec | null, anchors: MaskSpec[]): void {
    this.scene.masks(host, anchors);
  }
  draw(frame: FrameSpec): void {
    this.lastMs = this.scene.draw(frame);
  }
}

let worker: Worker | null = null;
const remote = new Map<number, WorkerSurface>();
let nextId = 1;

class WorkerSurface implements Surface {
  busy = false;
  lastMs = 0;
  readonly id = nextId++;
  /** Called when a frame has been drawn, with what it cost. */
  onDrawn: ((ms: number) => void) | null = null;
  constructor(canvas: HTMLCanvasElement, spec: ViewSpec) {
    const offscreen = canvas.transferControlToOffscreen();
    remote.set(this.id, this);
    worker!.postMessage({ type: 'init', id: this.id, canvas: offscreen, spec }, [offscreen]);
  }
  size(w: number, h: number): void {
    worker!.postMessage({ type: 'size', id: this.id, w, h });
  }
  masks(host: MaskSpec | null, anchors: MaskSpec[]): void {
    const transfer: Transferable[] = [];
    for (const m of host ? [host, ...anchors] : anchors) transfer.push(m.text.buffer, m.solid.buffer);
    worker!.postMessage({ type: 'masks', id: this.id, host, anchors }, transfer);
  }
  draw(frame: FrameSpec): void {
    this.busy = true;
    worker!.postMessage({ type: 'frame', id: this.id, frame });
  }
  drawn(ms: number): void {
    this.busy = false;
    this.lastMs = ms;
    this.onDrawn?.(ms);
    Loop.kick();
  }
}

/**
 * Start the drawing thread and wait for it to say it is alive. Anything short
 * of that — no OffscreenCanvas, a blocked script, a thread that never answers —
 * and every scene is drawn on the page instead, exactly as before. A canvas
 * cannot be taken back once handed over, so none is until the thread answers.
 */
function startWorker(): Promise<boolean> {
  if (typeof Worker === 'undefined' || !('transferControlToOffscreen' in HTMLCanvasElement.prototype)) {
    return Promise.resolve(false);
  }
  try {
    worker = new Worker(new URL('./world/worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const fail = () => {
      worker?.terminate();
      worker = null;
      resolve(false);
    };
    const timer = window.setTimeout(fail, 3000);
    worker!.onerror = () => {
      window.clearTimeout(timer);
      fail();
    };
    worker!.onmessage = (event: MessageEvent<{ type: string; id?: number; ms?: number }>) => {
      const m = event.data;
      if (m.type === 'ready') {
        window.clearTimeout(timer);
        resolve(true);
      } else if (m.type === 'drawn' && m.id !== undefined) {
        remote.get(m.id)?.drawn(m.ms ?? 0);
      }
    };
  });
}

/** Build road ahead of need, wherever the city lives. */
function warmRoad(zMin: number, zMax: number): void {
  if (worker) worker.postMessage({ type: 'warm', zMin, zMax });
  else warmHere(zMin, zMax);
}

// ---------------------------------------------------------------------------
// A scene
// ---------------------------------------------------------------------------

/** The district this page is about: the first scene on it that is not the overlay. */
function pageDistrict(): DistrictId {
  const first = document.querySelector<HTMLCanvasElement>(
    'canvas[data-terrain]:not([data-terrain="travel"]):not([data-terrain="opening"]):not([data-terrain="backdrop"])',
  );
  const d = first?.dataset.worldDistrict as DistrictId | undefined;
  if (d && DISTRICTS.includes(d)) return d;
  return first?.dataset.terrain === 'band' ? 'industrial' : 'skyline';
}

/** Build a canvas's view from its mode, then its data attributes. */
function viewFor(canvas: HTMLCanvasElement, mode: Mode): { view: ViewConfig; preset: Preset } {
  const preset = PRESETS[mode];
  const ds = canvas.dataset;
  const fromAttr = ds.worldDistrict as DistrictId | undefined;
  const district =
    fromAttr && DISTRICTS.includes(fromAttr) ? fromAttr : mode === 'travel' ? pageDistrict() : preset.district;
  const themeName: ThemeName = ds.worldTheme === 'night' || ds.worldTheme === 'day' ? ds.worldTheme : preset.theme;
  const vp = Number(ds.worldVp);
  const [cl, cr] = (ds.worldCull ?? '').split(',').map(Number);

  const view: ViewConfig = {
    kind: preset.kind,
    theme: THEMES[themeName],
    district,
    bias: preset.bias,
    span: preset.span,
    drift: preset.drift,
    camH: preset.camH,
    camX: preset.camX,
    vpX: Number.isFinite(vp) && vp > 0 ? vp : preset.vpX,
    horizonY: preset.horizonY,
    focal: preset.focal,
    far: preset.far,
    cullLeft: cl !== undefined && Number.isFinite(cl) ? cl : preset.cullLeft,
    cullRight: cr !== undefined && Number.isFinite(cr) ? cr : preset.cullRight,
    buildings: preset.buildings,
    traffic: preset.traffic,
    strength: preset.strength,
  };
  return { view, preset };
}

/** A sticky element inside a section, and the text and surfaces that ride on it. */
interface Anchored {
  el: HTMLElement;
  w: number;
  h: number;
  text: number[];
  solid: number[];
  /** Mask px per CSS px of this anchor's mask, and its size in mask px. */
  k: number;
  mw: number;
  mh: number;
}

/** Where the canvas and its host are on screen this frame, in CSS px. */
interface Place {
  cx: number;
  cy: number;
  cw: number;
  ch: number;
  hx: number;
  hy: number;
  hw: number;
  hh: number;
}

class Scene {
  /**
   * Created on first need, not with the scene. Handing a canvas to the worker
   * gives it a compositor surface of its own; handing over all 23 of a page's
   * at load stalled the GPU for over half a second. Most sections are never
   * reached before the visitor leaves, and theirs are never made at all.
   */
  private surfaceObj: Surface | null = null;
  private readonly spec: ViewSpec;
  private readonly where: 'worker' | 'gpu' | 'cpu';
  private readonly view: ViewConfig;
  private readonly preset: Preset;
  readonly mode: Mode;
  private readonly baseCull: [number, number];
  private readonly baseFar: number;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private alphaScale = 1;

  private readonly isStatic: boolean;
  /** The welcome window's own scene, which may run while it is open. */
  private readonly inStartWindow: boolean;
  /** For the transition overlay: the element whose state decides if it shows. */
  private readonly gate: HTMLElement | null;
  /** The element the canvas sits in: its section's box, whatever the canvas does. */
  private readonly host: HTMLElement;
  /** Held on screen while its section scrolls past (CSS sticky); see the constructor. */
  private readonly pinned: boolean;
  /**
   * Draws once and holds, however fast the device: a backdrop that cannot be
   * pinned scrolls with its text on a touch screen, and animating it would
   * cost every fling for a background the eye is not on.
   */
  private readonly holdStill: boolean;
  /** Overlays and the welcome window: position:fixed, so scrolling moves nothing. */
  private readonly fixed: boolean;

  private inView = false;
  /** Within reach of the viewport: the bitmap is kept, but nothing is drawn yet. */
  private near = false;
  /** Needs a frame: new bitmap, new mask, new tier — or never drawn. */
  dirty = true;
  private t0 = 0;
  private t = 0;
  private lastDraw = 0;
  private lastStep = 0;
  private drawScrollY = 0;

  private yaw = 0;
  private pitchPx = 0;
  private targetYaw = 0;
  private targetPitch = 0;

  private camZ = Number.NaN;
  private anchor: number;
  private progress = 0.5;

  // Layout, cached: document position of the host, CSS sizes.
  private hostTop = 0;
  private hostLeft = 0;
  private hostW = 0;
  private hostH = 0;
  private offTop = 0;
  private offLeft = 0;
  private cssW = 0;
  private cssH = 0;

  // Clearings, in CSS px from the host's corner (x, y, w, h each).
  private hostText: number[] = [];
  private hostSolid: number[] = [];
  private anchors: Anchored[] = [];
  private measured = false;
  private measureQueued = false;
  /** The host's size when its words were last measured. */
  private measuredW = 0;
  private measuredH = 0;
  /** The host mask as last sent: mask px per CSS px, and whether there is one. */
  private hostK = 0;
  private hasHostMask = false;
  private maskDirty = true;
  private readonly placements: MaskPlacement[] = [];

  /** Forward travel from surges, and the speed that produces it. */
  private travelled = 0;
  private speed = 0;
  private surgeUntil = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    mode: Mode,
    where: 'worker' | 'gpu' | 'cpu',
  ) {
    const { view, preset } = viewFor(canvas, mode);
    this.mode = mode;
    this.view = view;
    this.preset = preset;
    this.baseCull = [view.cullLeft, view.cullRight];
    this.baseFar = view.far;
    this.spec = { ...view, theme: view.theme.name };
    this.where = where;
    this.anchor = anchorZ(view);
    this.isStatic = shouldBeStatic();
    this.inStartWindow = !!canvas.closest('[data-start]');
    this.gate = mode === 'travel' ? canvas.closest<HTMLElement>('[data-transition]') : null;
    this.host = canvas.parentElement ?? canvas;
    this.fixed = mode === 'opening' || mode === 'travel';

    // A backdrop is pinned to the viewport while its section scrolls past, so a
    // tall section shows a whole city — skyline, streets, horizon — instead of
    // one long strip of road stretched down 2,500px. It is also what keeps a
    // canvas to ONE SCREEN: a section-tall bitmap on a phone reached 585x5314
    // (12 MB), and iOS kills a tab that holds a few of those. Pinning is safe
    // on a touch screen now that the clearing under the words is a CSS mask on
    // the section itself (see cssMask), which the compositor moves with the
    // words; it used to be cut into the canvas, a frame or more behind them.
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    this.pinned = mode === 'backdrop' && !this.isStatic;
    this.holdStill = mode === 'backdrop' && !this.pinned;
    if (this.pinned) canvas.classList.add('is-pinned');

    // Size follows the PARENT: the welcome-window and overlay canvases have no
    // visible box until they are shown, so the parent's ResizeObserver doubles
    // as their open/close signal. A backdrop is sized by its own box (the
    // viewport, when pinned), so that is watched too.
    const sized = new ResizeObserver(() => this.resize());
    sized.observe(this.host);
    if (mode === 'backdrop') sized.observe(canvas);

    if (this.fixed) {
      // Fixed to the screen: "in view" whenever its window or overlay shows,
      // which occluded() and the box size decide.
      this.inView = true;
      this.near = true;
    }
    if (this.gate) {
      new MutationObserver(() => this.onGate()).observe(this.gate, { attributes: true, attributeFilter: ['data-state'] });
    } else if (!this.fixed) {
      // Two questions, two observers. Is it ON screen? — only then may it draw.
      // Is it NEAR the screen? — then keep a bitmap ready, so its first frame
      // is there on arrival.
      new IntersectionObserver(
        (entries) => {
          this.inView = entries.some((e) => e.isIntersecting);
          if (this.inView) Loop.kick();
        },
        { threshold: 0 },
      ).observe(canvas);
      new IntersectionObserver(
        (entries) => {
          const was = this.near;
          this.near = entries.some((e) => e.isIntersecting);
          if (this.near && !was) {
            this.resize();
            this.queueMeasure();
          }
          if (!this.near && was) this.releaseBitmap();
        },
        { threshold: 0, rootMargin: '300px 0px' },
      ).observe(canvas);
    }

    if (preset.yaw > 0 && fine && !this.isStatic) this.bindPointer();
  }

  // --- what the loop asks -------------------------------------------------

  /** Owns the screen while it runs: nothing else competes with it. */
  get exclusive(): boolean {
    return !!this.gate || this.inStartWindow;
  }

  /** A sliver of the screen — a street strip — cheap enough to always animate. */
  get small(): boolean {
    return this.mode === 'strip' || (!!this.cssW && this.cssW * this.cssH < View.w * View.h * 0.25);
  }

  get surging(): boolean {
    return this.speed > 0;
  }

  private get occluded(): boolean {
    const root = document.documentElement;
    if (this.gate) return !this.gate.dataset.state || this.gate.dataset.state === 'idle';
    if (this.inStartWindow) return !root.classList.contains('start-ready');
    // IntersectionObserver reports geometry, not visibility: scenes under the
    // opaque welcome window, or under the transition's city, draw for nobody.
    return root.classList.contains('start-ready') || overlay?.dataset.state === 'covering';
  }

  /** off: nothing to do. animate: wants the loop. still: wants one frame. */
  state(tier: Tier): 'off' | 'animate' | 'still' {
    if (!this.w || !this.h || this.occluded) return 'off';
    // Within reach but not yet on screen: one frame now, so it never arrives
    // as an empty canvas that fills in a moment later.
    if (!this.inView) return this.near && this.dirty ? 'still' : 'off';
    if (this.isStatic || this.holdStill || tier.fps === 0) return this.dirty ? 'still' : 'off';
    return 'animate';
  }

  /** Visible area in px², weighted so the overlays always come first. */
  priority(vw: number, vh: number): number {
    if (this.exclusive) return Number.POSITIVE_INFINITY;
    const p = this.place();
    const w = Math.max(0, Math.min(p.cx + p.cw, vw) - Math.max(p.cx, 0));
    const h = Math.max(0, Math.min(p.cy + p.ch, vh) - Math.max(p.cy, 0));
    return w * h * (this.preset.soft ? 1 : 1.6);
  }

  due(now: number, tier: Tier): boolean {
    // One frame in flight at a time: a frame the drawing thread has not
    // finished is never queued behind by another.
    if (this.busy) return false;
    if (this.dirty || this.speed > 0) return true;
    const fps = this.preset.soft ? tier.softFps : tier.fps;
    if (!fps) return false;
    return now - this.lastDraw >= 1000 / fps - 4;
  }

  overdue(now: number): number {
    return this.dirty ? 1e9 : now - this.lastDraw;
  }

  /** Advance the camera and draw a frame. */
  step(now: number, tier: Tier): void {
    if (!this.t0) this.t0 = now;
    const dt = this.lastStep ? Math.min(0.05, Math.max(0, (now - this.lastStep) / 1000)) : 0;
    this.lastStep = now;
    this.t = (now - this.t0) / 1000;
    // Time-based smoothing: the same feel at 60, 30 or 20 frames a second.
    const k = 1 - Math.pow(0.94, dt * 60);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitchPx += (this.targetPitch - this.pitchPx) * k;
    const pace = this.advance(now, dt);
    this.draw(tier, this.t, false, pace, dt);
    this.lastDraw = now;
  }

  /** One frame that holds: a still device, a scene not in the lead, a new mask. */
  still(now: number, tier: Tier): void {
    this.draw(tier, this.isStatic ? 4.2 : this.t, true, 0, 0);
    this.lastDraw = now;
  }

  // --- events -------------------------------------------------------------

  surge(ms = 1400): void {
    if (this.isStatic || this.gate) return;
    this.surgeUntil = performance.now() + ms;
    Loop.kick();
  }

  /**
   * The overlay's camera: from a rolling start at this page's district into a
   * full surge for as long as the page is leaving. The arrival needs no camera
   * of its own — the browser's View Transition carries the motion across.
   * Nothing is drawn here: the click that started the transition must stay
   * cheap, so the first frame is the loop's.
   */
  private onGate(): void {
    if (this.gate?.dataset.state === 'covering') {
      this.anchor = anchorZ(this.view);
      this.camZ = Number.NaN;
      this.travelled = 0;
      this.speed = Math.max(this.speed, SURGE_SPEED * 0.25);
      this.surgeUntil = Number.POSITIVE_INFINITY;
      this.resize();
      Loop.kick();
    } else {
      this.surgeUntil = 0;
      this.speed = 0;
      this.releaseBitmap();
    }
  }

  /** The tier changed: new distance, and a fresh frame — never a new bitmap. */
  retier(): void {
    this.view.far = this.baseFar * Quality.tier.far;
    this.dirty = true;
    Loop.kick();
  }

  private bindPointer(): void {
    const target = this.canvas.closest('section, [data-start]') ?? this.host;
    const toRad = Math.PI / 180;
    target.addEventListener(
      'pointermove',
      (event: Event) => {
        const e = event as PointerEvent;
        // From the cached layout, not a layout read: mouse moves arrive many
        // times a frame, and while scrolling the browser synthesises more.
        // Measuring the section on each one forced a layout every time.
        const r = this.place();
        if (!r.hw || !r.hh) return;
        const nx = ((e.clientX - r.hx) / r.hw) * 2 - 1;
        const ny = ((e.clientY - r.hy) / r.hh) * 2 - 1;
        this.targetYaw = nx * this.preset.yaw * toRad;
        this.targetPitch = ny * this.preset.pitch * 0.01 * this.h;
      },
      { passive: true },
    );
    target.addEventListener(
      'pointerleave',
      () => {
        this.targetYaw = 0;
        this.targetPitch = 0;
      },
      { passive: true },
    );
  }

  // --- bitmap and layout ----------------------------------------------------

  /** The bitmap size last given to the surface (a handed-over canvas cannot be asked). */
  private sentW = 0;
  private sentH = 0;

  private get surface(): Surface {
    if (!this.surfaceObj) {
      if (this.where === 'worker') {
        const surface = new WorkerSurface(this.canvas, this.spec);
        surface.onDrawn = (ms) => this.drawn(ms);
        this.surfaceObj = surface;
      } else {
        this.surfaceObj = new LocalSurface(this.canvas, this.spec, this.where === 'cpu');
      }
    }
    return this.surfaceObj;
  }

  /** Is a frame in flight? A scene with no surface yet has none. */
  private get busy(): boolean {
    return this.surfaceObj?.busy ?? false;
  }

  releaseBitmap(): void {
    if (this.sentW || this.sentH) this.surface.size(0, 0);
    this.sentW = 0;
    this.sentH = 0;
    this.w = 0;
    this.h = 0;
    this.hasHostMask = false;
    this.maskDirty = true;
    this.dirty = true;
  }

  resize(): void {
    // A released canvas stays released until it comes back within reach —
    // or, for the transition overlay, until a transition actually starts.
    const gated = this.gate && this.gate.dataset.state !== 'covering';
    if (!this.near || gated) {
      this.releaseBitmap();
      return;
    }
    this.layout();
    if (!this.cssW || !this.cssH) {
      // display:none — the welcome window once closed. Nothing to keep.
      this.releaseBitmap();
      return;
    }
    const narrow = window.innerWidth < NARROW;
    // Below the desktop layout the masks become corner ellipses, so the
    // left/right cull no longer matches them and is switched off.
    this.view.cullLeft = narrow ? 0 : this.baseCull[0];
    this.view.cullRight = narrow ? 1 : this.baseCull[1];
    this.alphaScale = narrow ? 0.7 : 1;
    // Drawn solid; how faint it sits is the canvas's opacity (renderer.ts).
    this.canvas.style.setProperty('--city-alpha', String(+(this.view.strength * this.alphaScale).toFixed(3)));
    this.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, this.preset.dprCap, narrow ? 1.5 : 2));
    const w = Math.round(this.cssW * this.dpr);
    const h = Math.round(this.cssH * this.dpr);
    if (w !== this.sentW || h !== this.sentH) {
      this.surface.size(w, h);
      this.sentW = w;
      this.sentH = h;
      this.maskDirty = true;
      this.dirty = true;
    }
    this.w = w;
    this.h = h;
    // The section changed size — a photo finished loading above the words, a
    // font swapped in, the window narrowed — so its words have moved: measure
    // them again. Re-caching the section's position alone left the clearings
    // where the words used to be.
    if (this.measured && (Math.abs(this.hostW - this.measuredW) > 1 || Math.abs(this.hostH - this.measuredH) > 1)) {
      this.queueMeasure();
    }
    if (this.dirty) Loop.kick();
  }

  /** Cache where the host sits in the document and how big the canvas is. */
  layout(): void {
    const hr = this.host.getBoundingClientRect();
    const cr = this.canvas.getBoundingClientRect();
    const sy = this.fixed ? 0 : window.scrollY;
    const sx = this.fixed ? 0 : window.scrollX;
    this.hostTop = hr.top + sy;
    this.hostLeft = hr.left + sx;
    this.hostW = hr.width;
    this.hostH = hr.height;
    this.cssW = cr.width;
    this.cssH = cr.height;
    // Where the canvas sits in its host when not stuck (always 0,0 in practice).
    this.offTop = this.pinned ? 0 : cr.top - hr.top;
    this.offLeft = cr.left - hr.left;
  }

  /** This frame's positions, from the cache and the scroll offset alone. */
  private place(): Place {
    const s = this.fixed ? null : scroll();
    const sy = s ? s.y : 0;
    const sx = s ? s.x : 0;
    const hy = this.hostTop - sy;
    const hx = this.hostLeft - sx;
    // position: sticky; top: 0 — inside a host of the section's height.
    const cy = this.pinned ? Math.min(Math.max(hy, 0), hy + this.hostH - this.cssH) : hy + this.offTop;
    return { cx: hx + this.offLeft, cy, cw: this.cssW, ch: this.cssH, hx, hy, hw: this.hostW, hh: this.hostH };
  }

  // --- clearings ------------------------------------------------------------

  /** Measure in idle time, not in the middle of whatever caused the change. */
  queueMeasure(): void {
    if (!this.preset.shield || this.measureQueued) return;
    this.measureQueued = true;
    idle(() => {
      this.measureQueued = false;
      if (this.near) this.measureShield();
    });
  }

  /**
   * Measure every line of text and every control in this canvas's section, at
   * glyph level (Range rects, not element boxes — a box is often far wider
   * than its words), plus every content surface, in CSS px from the host's
   * corner. Text in a sticky column holds still on screen while the section
   * moves, so it is kept relative to THAT element instead.
   */
  measureShield(): void {
    if (!this.preset.shield) return;
    const scope = this.canvas.closest('section') ?? this.host;
    const hr = this.host.getBoundingClientRect();
    if (!hr.width || !hr.height) return;

    const anchors: Anchored[] = [];
    const anchorRects: DOMRect[] = [];
    const anchorOf = new Map<Element, number>();
    // The nearest sticky ancestor within the section, or -1. Cached along the
    // path, so each element's style is read once per measure.
    const anchorFor = (start: Element): number => {
      const path: Element[] = [];
      let found = -1;
      for (let e: Element | null = start; e && e !== scope; e = e.parentElement) {
        const known = anchorOf.get(e);
        if (known !== undefined) {
          found = known;
          break;
        }
        path.push(e);
        if (getComputedStyle(e).position === 'sticky') {
          const r = e.getBoundingClientRect();
          found = anchors.push({ el: e as HTMLElement, w: r.width, h: r.height, text: [], solid: [], k: 0, mw: 0, mh: 0 }) - 1;
          anchorRects.push(r);
          break;
        }
      }
      for (const e of path) anchorOf.set(e, found);
      return found;
    };

    // Where each element WILL be, not where it is this instant: an element
    // still waiting for its reveal sits a few dozen pixels off its place
    // (motion.ts writes the offset as an inline transform). Measured as it
    // stood, its clearing landed beside the words and then jumped when the
    // reveal finished — white boxes in empty space, lines behind the text.
    const ZERO: [number, number] = [0, 0];
    const shifts = new Map<Element, [number, number]>();
    const shiftOf = (el: Element | null): [number, number] => {
      if (!el || el === scope) return ZERO;
      const known = shifts.get(el);
      if (known) return known;
      const up = shiftOf(el.parentElement);
      let own = up;
      const inline = (el as HTMLElement).style?.transform;
      if (inline && inline !== 'none') {
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        if (m.m41 || m.m42) own = [up[0] + m.m41, up[1] + m.m42];
      }
      shifts.set(el, own);
      return own;
    };

    const hostText: number[] = [];
    const hostSolid: number[] = [];
    const push = (r: DOMRect, from: Element, solid: boolean) => {
      if (r.width < 1 || r.height < 1) return;
      const a = anchorFor(from);
      const [sx, sy] = a < 0 ? shiftOf(from) : ZERO;
      const left = r.left - sx;
      const top = r.top - sy;
      if (left + r.width < hr.left || left > hr.right || top + r.height < hr.top || top > hr.bottom) return;
      const o = a < 0 ? hr : anchorRects[a]!;
      const list = a < 0 ? (solid ? hostSolid : hostText) : solid ? anchors[a]!.solid : anchors[a]!.text;
      list.push(left - o.left, top - o.top, r.width, r.height);
    };
    const range = document.createRange();
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest('[aria-hidden="true"]')) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) push(r, el, false);
    }
    scope.querySelectorAll('a, button, input, select, textarea').forEach((el) => push(el.getBoundingClientRect(), el, false));
    scope.querySelectorAll(SURFACES).forEach((el) => push(el.getBoundingClientRect(), el, true));

    this.hostText = hostText;
    this.hostSolid = hostSolid;
    this.anchors = anchors;
    this.measured = true;
    this.measuredW = hr.width;
    this.measuredH = hr.height;
    this.maskDirty = true;
    this.dirty = true;
    // The section may have moved while nobody was looking.
    this.layout();
    if (this.cssCleared) this.cssMask();
    Loop.kick();
  }

  private maskToken = 0;
  private maskKey = '';

  /** Its clearings are a CSS mask (cssMask), not cut out of each frame. */
  private get cssCleared(): boolean {
    return this.preset.shield && !this.fixed;
  }

  /**
   * The clearings under the section's words and cards, as a CSS mask rather
   * than cut out of each frame. A backdrop's canvas is pinned to the screen
   * while the words scroll past it; a clearing drawn into the canvas could
   * only follow them a frame or more late, so cards and headings visibly slid
   * over city lines that then vanished — the flashing the owner saw. So the
   * mask goes on the section-sized wrapper, which belongs to the page: the
   * compositor moves it with the words in the very same frame. The hero, band
   * and page headers put it on the canvas itself (it scrolls with its words),
   * and the drawing thread is spared a full-frame composite every frame.
   * Painted once per measure, encoded off the main thread (toBlob), applied
   * as a data: URL (the CSP allows data: images).
   */
  private cssMask(): void {
    const onWrap = this.mode === 'backdrop';
    const target = onWrap ? this.host : this.canvas;
    const W = onWrap ? this.hostW : this.cssW;
    const H = onWrap ? this.hostH : this.cssH;
    const ox = onWrap ? 0 : this.offLeft;
    const oy = onWrap ? 0 : this.offTop;
    if (!W || !H) return;
    // The same words in the same places: keep the mask that is up.
    let sum = 0;
    for (let i = 0; i < this.hostText.length; i += 1) sum += this.hostText[i]! * ((i % 7) + 1);
    for (let i = 0; i < this.hostSolid.length; i += 1) sum -= this.hostSolid[i]! * ((i % 5) + 1);
    const key = `${Math.round(W)}x${Math.round(H)}@${ox},${oy}:${this.hostText.length}/${this.hostSolid.length}:${Math.round(sum)}`;
    if (key === this.maskKey) return;
    this.maskKey = key;
    const k = Math.min(CSS_MASK_RES, 4096 / W, 4096 / H);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(W * k));
    c.height = Math.max(1, Math.ceil(H * k));
    const g = c.getContext('2d');
    if (!g) return;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-out';
    g.setTransform(c.width / W, 0, 0, c.height / H, -ox * (c.width / W), -oy * (c.height / H));
    paintSolids(g, this.hostSolid, 1);
    paintShield(g, this.hostText, 1);
    const token = ++this.maskToken;
    c.toBlob((blob) => {
      if (!blob || token !== this.maskToken) return;
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result;
        if (token !== this.maskToken || typeof url !== 'string') return;
        // Decoded before it is swapped in: a mask image the compositor has to
        // wait for is, for that frame, no mask at all — the city blinks out.
        const img = new Image();
        img.src = url;
        img.decode()
          .catch(() => undefined)
          .then(() => {
            if (token !== this.maskToken) return;
            target.style.setProperty('--world-clear', `url("${url}")`);
            target.dataset.clear = '';
          });
      };
      reader.readAsDataURL(blob);
    }, 'image/png');
  }

  /**
   * Hand the clearings to the surface, which paints them into masks at half
   * the canvas's resolution. One mask spans the whole host; a tall section's
   * is capped to what a canvas may be, trading a little softness for a
   * bounded bitmap. Each sticky element gets its own.
   */
  private sendMasks(): void {
    this.maskDirty = false;
    const scale = this.cssW ? this.w / this.cssW : 1;
    let host: MaskSpec | null = null;
    this.hasHostMask = false;
    if (!this.cssCleared && (this.hostText.length || this.hostSolid.length)) {
      const k = Math.min(scale * MASK_RES, 4096 / Math.max(this.hostH, 1), 4096 / Math.max(this.hostW, 1));
      host = { w: this.hostW * k, h: this.hostH * k, k, text: scaled(this.hostText, k, 0), solid: scaled(this.hostSolid, k, 0) };
      this.hostK = k;
      this.hasHostMask = true;
    }
    const R = SHIELD_REACH + 4;
    const anchors = this.anchors.map((a) => {
      const k = scale * MASK_RES;
      a.k = k;
      a.mw = Math.max(1, Math.ceil((a.w + R * 2) * k));
      a.mh = Math.max(1, Math.ceil((a.h + R * 2) * k));
      return { w: a.mw, h: a.mh, k, text: scaled(a.text, k, R * k), solid: scaled(a.solid, k, R * k) };
    });
    this.surface.masks(host, anchors);
  }

  /** This frame's mask stamps, in canvas bitmap px. */
  private placeMasks(p: Place): MaskPlacement[] {
    this.placements.length = 0;
    // The welcome window's city steps back under the lens: 70% strength at
    // the centre, full by the edge of an ellipse 60% × 80% of the frame, so
    // the mark leads. Drawn into the frame — see SceneRenderer.softSpot.
    if (this.mode === 'opening') {
      this.placements.push({ which: -2, sx: 0, sy: 0, sw: 128, sh: 128, dx: this.w * 0.2, dy: this.h * 0.12, dw: this.w * 0.6, dh: this.h * 0.8 });
    }
    if (!this.preset.shield) return this.placements;
    if (this.maskDirty) this.sendMasks();
    const toBitmap = p.cw ? this.w / p.cw : 1;
    if (this.hasHostMask) {
      const k = this.hostK;
      const sx = (p.cx - p.hx) * k;
      const sy = (p.cy - p.hy) * k;
      const draw = (dy: number) =>
        this.placements.push({ which: -1, sx, sy: sy + dy * k, sw: p.cw * k, sh: p.ch * k, dx: 0, dy: 0, dw: this.w, dh: this.h });
      draw(0);
    }
    const R = SHIELD_REACH + 4;
    this.anchors.forEach((a, which) => {
      if (!a.mw) return;
      const r = a.el.getBoundingClientRect();
      this.placements.push({
        which,
        sx: 0,
        sy: 0,
        sw: a.mw,
        sh: a.mh,
        dx: (r.left - R - p.cx) * toBitmap,
        dy: (r.top - R - p.cy) * toBitmap,
        dw: (a.w + R * 2) * toBitmap,
        dh: (a.h + R * 2) * toBitmap,
      });
    });
    return this.placements;
  }

  /** The time this scene's frame may take at the current tier, ms. */
  budget(): number {
    const tier = Quality.tier;
    const fps = this.preset.soft ? tier.softFps : tier.fps;
    return fps ? 1000 / fps : 1000;
  }

  // --- drawing --------------------------------------------------------------

  /**
   * Where the scroll position puts this canvas's camera on the road. Measured
   * on the section, not the canvas: a pinned canvas stands still on screen.
   */
  private scrollTarget(p: Place): number {
    if (!this.view.span || this.fixed) return this.anchor;
    const vh = View.h || 1;
    const top = this.mode === 'backdrop' ? p.hy : p.cy;
    const height = this.mode === 'backdrop' ? p.hh : p.ch;
    this.progress = Math.max(0, Math.min(1, (vh - top) / (vh + Math.max(height, 1))));
    return this.anchor + (this.progress - 0.5) * this.view.span;
  }

  /** Surge physics: ease up to speed while a surge is on, coast down after. */
  private advance(now: number, dt: number): number {
    const target = now < this.surgeUntil ? SURGE_SPEED : 0;
    const rate = target > this.speed ? 3.2 : this.gate ? 2.6 : 1.8;
    this.speed += (target - this.speed) * Math.min(1, rate * dt);
    if (this.speed < 0.05) this.speed = 0;
    this.travelled += this.speed * dt;
    return this.speed / SURGE_SPEED;
  }

  private light(): string | undefined {
    if (this.view.theme.name !== 'day' || this.mode === 'travel' || this.mode === 'opening') return undefined;
    const max = View.docH - View.h;
    const page = max > 0 ? Math.max(0, Math.min(1, scroll().y / max)) : 0;
    return LIGHT[Math.round(page * (LIGHT.length - 1))];
  }

  private hazeKey = '';

  /**
   * The horizon glow, as the canvas's own CSS background (see .terrain): the
   * same radial glow the renderer used to paint first in every frame, placed
   * at the vanishing point, but drawn once by the compositor instead of 30
   * times a second on the CPU. Rewritten only when its colour or size changes.
   */
  private setHaze(): void {
    if (this.view.kind !== 'forward' || !this.cssW) return;
    const colour = this.light() ?? this.view.theme.haze;
    const a = 1;
    const key = `${colour}|${a}|${this.cssW}|${this.cssH}`;
    if (key === this.hazeKey) return;
    this.hazeKey = key;
    const s = this.canvas.style;
    s.setProperty('--haze-c', withAlpha(colour, a));
    s.setProperty('--haze-r', `${Math.round(this.cssW * 0.42)}px`);
    s.setProperty('--haze-x', `${(this.view.vpX * 100).toFixed(1)}%`);
    s.setProperty('--haze-y', `${((this.view.horizonY + 0.08) * 100).toFixed(1)}%`);
  }

  /** The renderer's optional layers for this scene at this tier. */
  private detail(tier: Tier): Layers {
    if (benching) return { ...LAYERS, haze: false };
    return {
      // The horizon glow is the canvas's CSS background (setHaze): a full-frame
      // fill in the drawing thread cost 8-11 ms of every 30 at full resolution.
      haze: false,
      sheen: tier.sheen && !this.preset.soft,
      panes: tier.panes,
      lines: tier.lines,
      decals: tier.decals,
    };
  }

  private draw(tier: Tier, t: number, snap: boolean, pace: number, dt: number): void {
    if (!this.w || !this.h) return;
    // The first frame of a section with words in it waits for their clearing:
    // a frame with the city running through the heading is worse than none.
    if (this.preset.shield && !this.measured) this.measureShield();
    const p = this.place();
    // Starts at full speed forward (the sine's steepest point) so the very
    // first frames already move, then eases back and forth over its stretch.
    const glide = this.preset.glide ? this.preset.glide * (1 + Math.sin((t * Math.PI * 2) / this.preset.glidePeriod)) : 0;
    const target = this.isStatic ? this.anchor : this.scrollTarget(p) + this.view.drift * t + glide;
    if (snap || !Number.isFinite(this.camZ)) this.camZ = target;
    else this.camZ += (target - this.camZ) * (1 - Math.pow(1 - EASE, dt * 60));
    // A slow breath in and out keeps a still page alive without being busy.
    const breathe = this.isStatic ? 0 : Math.sin(t * 0.22) * 0.9;
    const input = {
      w: this.w,
      h: this.h,
      dpr: this.dpr,
      camZ: this.camZ + breathe + this.travelled,
      t,
      yaw: this.yaw + (this.isStatic ? 0 : this.preset.sway * (Math.PI / 180) * Math.sin((t * Math.PI * 2) / 26)),
      pitchPx: this.pitchPx,
      alpha: 1,
      focalScale: 1 - SURGE_WIDEN * pace,
      lift: this.isStatic ? 0 : (this.progress - 0.5) * this.preset.crane + this.preset.bob * Math.sin((t * Math.PI * 2) / 31),
    };
    this.setHaze();
    this.surface.draw({
      input,
      placements: this.placeMasks(p),
      layers: this.detail(tier),
      far: this.view.far,
      cullLeft: this.view.cullLeft,
      cullRight: this.view.cullRight,
    });
    if (this.surfaceObj instanceof LocalSurface) this.drawn(this.surfaceObj.lastMs);
    this.drawScrollY = window.scrollY;
    this.dirty = false;
  }

  /** Called once, when the first frame is on the canvas. */
  onFirstFrame: (() => void) | null = null;

  /** A frame has been drawn (here, or reported back by the drawing thread). */
  private drawn(ms: number): void {
    // Still frames are not paced, so only animated ones count against the tier.
    if (!this.isStatic && !this.holdStill) Quality.recordWork(ms, this.budget());
    const first = this.onFirstFrame;
    this.onFirstFrame = null;
    first?.();
  }

  /** Build this view's stretch of road in idle time, so arriving costs nothing. */
  warm(): void {
    const half = this.view.kind === 'forward' ? 0 : 80;
    warmRoad(this.anchor - this.view.span / 2 - 6 - half, this.anchor + this.view.span / 2 + this.view.far + half);
  }

  // --- measuring --------------------------------------------------------------

  /** For `?worldbench`: which scene this is, and how big. */
  get info(): { mode: Mode; section: string; w: number; h: number; tier: string } {
    return { mode: this.mode, section: this.canvas.closest('section')?.id ?? '', w: this.w, h: this.h, tier: Quality.tier.name };
  }

  /**
   * For `?worldbench`: draw `frames` frames back to back, waiting for each to
   * be finished — a one-pixel read-back forces the drawing through, GPU work
   * included — and return the average cost of a frame in ms.
   */
  bench(frames: number): number {
    const local = this.surfaceObj;
    if (!this.w || !(local instanceof LocalSurface)) return -1;
    const began = performance.now();
    for (let i = 0; i < frames; i += 1) {
      this.draw(Quality.tier, this.t + i / 60, false, 0, 1 / 60);
      local.scene.pixels();
    }
    return (performance.now() - began) / frames;
  }
}

/** An rgba() colour with its alpha multiplied by k. */
function withAlpha(rgba: string, k: number): string {
  const m = rgba.match(/[\d.]+/g);
  if (!m || m.length < 3) return rgba;
  const a = (m[3] === undefined ? 1 : Number(m[3])) * k;
  return `rgba(${m[0]},${m[1]},${m[2]},${a.toFixed(3)})`;
}

/** Scale x, y, w, h rects by k and offset them by o (mask px). */
function scaled(src: number[], k: number, o: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 4) {
    out[i] = src[i]! * k + o;
    out[i + 1] = src[i + 1]! * k + o;
    out[i + 2] = src[i + 2]! * k;
    out[i + 3] = src[i + 3]! * k;
  }
  return out;
}

/** Set while `?worldbench` is toggling layers by hand. */
let benching = false;

/** The page-transition overlay, whose `data-state` says when it covers the page. */
let overlay: HTMLElement | null = null;

export async function initTerrain(): Promise<void> {
  const root = document.documentElement;
  overlay = document.querySelector<HTMLElement>('[data-transition]');
  Quality.init();
  decorateSections();

  // `?worldbench` times the drawing directly, so it keeps it on this thread
  // (`&cpu` in software, as the worker would); everyone else gets the worker.
  const params = new URLSearchParams(window.location.search);
  const benchMode = params.has('worldbench');
  const where: 'worker' | 'gpu' | 'cpu' = !benchMode && (await startWorker()) ? 'worker' : params.has('cpu') ? 'cpu' : 'gpu';
  root.dataset.worldThread = where;

  // The welcome window's scene first, so the window can start at once.
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-terrain]')].sort(
    (a, b) => Number(b.dataset.terrain === 'opening') - Number(a.dataset.terrain === 'opening'),
  );
  for (const canvas of canvases) {
    const mode = canvas.dataset.terrain as Mode | undefined;
    if (!mode || !(mode in PRESETS)) continue;
    try {
      scenes.push(new Scene(canvas, mode, where));
    } catch {
      /* No 2D context: the page is simply the page. */
    }
  }

  // The welcome window waits for this before building the mark: "the city is
  // already alive, then the mark appears". So it is sent when the window's
  // city has its first frame on screen — or at once if there is no window
  // open. start.ts gives up waiting after a second regardless.
  const ready = () => {
    if (root.dataset.world === 'ready') return;
    root.dataset.world = 'ready';
    window.dispatchEvent(new Event('world:ready'));
  };
  const opening = scenes.find((s) => s.mode === 'opening');
  if (opening && root.classList.contains('start-ready')) {
    opening.onFirstFrame = ready;
    window.setTimeout(ready, 900);
  } else {
    ready();
  }
  if (!scenes.length) return;

  // A measuring hook, present only when asked for in the address.
  if (benchMode) {
    (window as unknown as { __worldBench?: unknown }).__worldBench = {
      scenes,
      layers: LAYERS,
      quality: Quality,
      bench(on: boolean) {
        benching = on;
      },
    };
  }

  Quality.listeners.push(() => scenes.forEach((s) => s.retier()));
  scenes.forEach((s) => s.retier());

  // Build every scene's stretch of road in idle time, nearest first.
  const byDistance = [...scenes].sort((a, b) => a.priority(innerWidth, innerHeight) - b.priority(innerWidth, innerHeight)).reverse();
  const warmNext = () => {
    const s = byDistance.shift();
    if (!s) return;
    s.warm();
    idle(warmNext, 1500);
  };
  idle(warmNext, 1500);

  // Anything that moves the page's layout moves every host: re-cache, in idle.
  let relayoutQueued = false;
  const relayout = () => {
    if (relayoutQueued) return;
    relayoutQueued = true;
    idle(() => {
      relayoutQueued = false;
      View.docH = document.documentElement.scrollHeight;
      scenes.forEach((s) => s.layout());
      Loop.kick();
    }, 300);
  };
  new ResizeObserver(relayout).observe(document.body);
  window.addEventListener(
    'resize',
    () => {
      View.w = window.innerWidth;
      View.h = window.innerHeight;
      relayout();
    },
    { passive: true },
  );

  // Text settles after fonts load: clearings re-measured. (Not after each
  // reveal: measuring already allows for a reveal's offset, and re-measuring
  // on every one swapped masks in and out all the way down the page.)
  const remeasureAll = () => scenes.forEach((s) => s.queueMeasure());
  document.fonts?.ready.then(remeasureAll).catch(() => {});
  window.addEventListener('load', remeasureAll, { once: true });

  window.addEventListener('world:surge', (event) => {
    const ms = (event as CustomEvent<{ ms?: number }>).detail?.ms;
    Quality.hold((ms ?? 1400) + 800);
    scenes.forEach((s) => s.surge(ms));
  });
  // The transition overlay's surge is the gate, not an event: hold for it too.
  if (overlay) {
    new MutationObserver(() => {
      if (overlay?.dataset.state === 'covering') Quality.hold(2500);
    }).observe(overlay, { attributes: true, attributeFilter: ['data-state'] });
  }

  // `start-ready` opens and closes the welcome window; the transition overlay
  // says when it covers the page. Either changes who may draw.
  new MutationObserver(() => Loop.kick()).observe(root, { attributes: true, attributeFilter: ['class'] });
  if (overlay) new MutationObserver(() => Loop.kick()).observe(overlay, { attributes: true, attributeFilter: ['data-state'] });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') Loop.kick();
    else Loop.stop();
  });

  // A page kept in the back/forward cache keeps no bitmaps.
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) return;
    Loop.stop();
    scenes.forEach((s) => s.releaseBitmap());
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    scenes.forEach((s) => s.resize());
    Loop.kick();
  });

  Loop.kick();
}
