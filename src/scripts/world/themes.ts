/**
 * The two lighting schemes.
 *
 * DAY is a white architectural model — the kind presented on a table in a
 * developer's sales office: warm plaster volumes, stone shade, graphite
 * linework, the glass a cool neutral grey. It sits on the site's light grounds and
 * stays inside the site's graphite, ivory and bronze, so it reads as part of the
 * page rather than as a picture pasted onto it.
 *
 * NIGHT is the same city after dark, for the one dark band on the site:
 * graphite volumes, warm lit windows, amber street lights and headlights.
 *
 * Every material is a two-stop ramp expanded to eight tones, indexed by the
 * face's sun shading. Strings are built once here, because building colour
 * strings per face per frame is the kind of cost that adds up to dropped frames.
 */
import type { GroundKind, Material, Theme } from './types';

type RGB = readonly [number, number, number];

function hex(h: string): RGB {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Steps of distance tint: 0 is close, FOG_STEPS - 1 is the far skyline. */
export const FOG_STEPS = 8;
/** How far toward the air the farthest step goes. */
const FOG_MAX = 0.8;

function rgba(c: readonly number[], alpha: number): string {
  const [r, g, b] = c.map((v) => Math.round(v));
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${+alpha.toFixed(3)})`;
}

function parse(css: string): [number, number, number, number] {
  if (css.startsWith('#')) return [...hex(css), 1];
  const m = css.match(/[\d.]+/g) ?? [];
  return [Number(m[0] ?? 0), Number(m[1] ?? 0), Number(m[2] ?? 0), m[3] === undefined ? 1 : Number(m[3])];
}

/** Every tone of every material, mixed toward the air colour step by step. */
function fogRamps(mat: Record<Material, string[]>, air: string): Record<Material, string[]> {
  const a = parse(air);
  const out = {} as Record<Material, string[]>;
  for (const key of Object.keys(mat) as Material[]) {
    const list: string[] = [];
    for (let f = 0; f < FOG_STEPS; f += 1) {
      const k = (f / (FOG_STEPS - 1)) * FOG_MAX;
      for (const tone of mat[key]) {
        const c = parse(tone);
        list.push(rgba([0, 1, 2].map((i) => c[i]! + (a[i]! - c[i]!) * k), c[3]));
      }
    }
    out[key] = list;
  }
  return out;
}

/** A line colour thinning out with distance. */
function fogLine(css: string): string[] {
  const c = parse(css);
  return Array.from({ length: FOG_STEPS }, (_, f) => rgba(c, c[3] * (1 - (f / (FOG_STEPS - 1)) * 0.78)));
}

/** Eight tones from `dark` to `light`, as opaque or translucent CSS colours. */
function ramp(dark: string, light: string, alpha = 1): string[] {
  const a = hex(dark);
  const b = hex(light);
  const out: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const t = i / 7;
    const c = [0, 1, 2].map((k) => Math.round(a[k]! + (b[k]! - a[k]!) * t));
    out.push(alpha >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`);
  }
  return out;
}

/*
 * DAY — the premium architectural model.
 *
 * Measured against how high-end architectural visualisation is actually lit:
 * the buildings are pearl white with cool slate shade, never tinted; glass is a
 * blue-grey that reads as glass rather than as coloured paint; pitched roofs
 * are dark slate; landscaping is desaturated; the linework is a fine dark
 * indigo at low opacity. Warmth comes only from champagne-gold accents and
 * lamps; bronze marks what should catch the eye — the signage and the road's
 * edge — so it reads as intent, not tint. (A violet-and-fuchsia version came
 * first; the redesign to graphite, ivory and bronze retired it.)
 *
 * The first version tinted every surface lavender and used terracotta, sage
 * and aqua to tell the building types apart. The owner's verdict was that it
 * did not look premium, and they were right: saturated colour on every surface
 * is the look of a toy town, not a development.
 *
 * The second verdict was that the model looked flat and washed out. So the
 * light now does the work, as in a clay render: sunlit faces a faintly warm
 * white, faces turned from the sun a clearly deeper cool slate, and firmer
 * shadows on the ground — the volumes read from across the room.
 */
const DAY_MAT: Record<Material, string[]> = {
  // The model: warm plaster white in the sun, stone grey turned away from it.
  wall: ramp('#a39e94', '#fffcf7'),
  // Glass: a cool, neutral grey-blue — the one cool note, so it reads as glass.
  glass: ramp('#56606e', '#eef1f3'),
  roof: ramp('#bcb7ad', '#fffdf9'),
  // Pitched roofs: warm slate.
  tile: ramp('#4a4641', '#a29b91'),
  metal: ramp('#8d9299', '#f4f5f6'),
  // Signage and fascia bands in bronze: detail, not decoration.
  sign: ramp('#5f4524', '#b08a52'),
  accent: ramp('#8c6a3a', '#e3cc9e'),
  shutter: ramp('#9c9993', '#e2e0db'),
  slab: ramp('#aea99f', '#fffcf8'),
  car: ramp('#c2beb7', '#ffffff'),
};

const DAY_GROUND: Record<GroundKind, string> = {
  asphalt: 'rgba(218,215,209,0.96)',
  walk: 'rgba(244,242,237,0.97)',
  parking: 'rgba(229,226,220,0.93)',
  lawn: 'rgba(190,204,188,0.66)',
  water: 'rgba(146,184,200,0.6)',
  deck: 'rgba(238,232,222,0.96)',
  yard: 'rgba(233,230,224,0.78)',
  path: 'rgba(241,236,227,0.97)',
  marking: 'rgba(255,255,255,0.95)',
};

/** The air a day scene recedes into: the page's own warm ivory. */
const DAY_AIR = '#efece5';
const DAY_EDGE = 'rgba(30,32,36,0.46)';
const DAY_DETAIL = 'rgba(40,42,48,0.24)';

export const DAY: Theme = {
  name: 'day',
  mat: DAY_MAT,
  fogMat: fogRamps(DAY_MAT, DAY_AIR),
  fogEdge: fogLine(DAY_EDGE),
  fogDetail: fogLine(DAY_DETAIL),
  ground: DAY_GROUND,
  // Windows: dark neutral glass, varied a little so a facade is not a stamp.
  pane: ['rgba(64,72,86,0.42)', 'rgba(96,104,118,0.38)', 'rgba(52,58,70,0.48)', 'rgba(156,162,172,0.5)'],
  sheen: 'rgba(255,255,255,0.34)',
  glaze: 'rgba(255,255,255,0.36)',
  edge: DAY_EDGE,
  detail: DAY_DETAIL,
  grid: 'rgba(120,112,98,0.13)',
  lane: 'rgba(70,70,76,0.4)',
  // The highway's edge: a bronze line, not neon.
  roadEdge: 'rgba(160,124,72,0.85)',
  roadGlow: 'rgba(196,164,111,0.16)',
  zebra: 'rgba(255,255,255,0.95)',
  shadow: 'rgba(30,30,34,0.22)',
  treeFill: 'rgba(208,218,206,0.97)',
  treeLight: 'rgba(246,249,244,0.85)',
  treeEdge: 'rgba(78,94,84,0.42)',
  trunk: 'rgba(96,88,80,0.5)',
  lampCore: 'rgba(232,170,72,0.95)',
  lampGlow: 'rgba(232,170,72,0.14)',
  carHead: 'rgba(255,255,255,0.95)',
  carTail: 'rgba(196,60,44,0.85)',
  beacon: 'rgba(244,144,0,1)',
  ripple: 'rgba(255,255,255,0.9)',
  crane: 'rgba(50,52,58,0.62)',
  haze: 'rgba(214,190,147,0.16)',
};

const NIGHT_MAT: Record<Material, string[]> = {
  wall: ramp('#0f1012', '#2b2d31'),
  glass: ramp('#101217', '#2c313a'),
  roof: ramp('#121315', '#313337'),
  tile: ramp('#1c1a18', '#3d3833'),
  metal: ramp('#101318', '#2b3038'),
  sign: ramp('#8c6a3a', '#e7d6b8'),
  accent: ramp('#a88450', '#f3eada'),
  shutter: ramp('#15161a', '#2c2e33'),
  slab: ramp('#141518', '#35373c'),
  car: ramp('#16171a', '#3a3c41'),
};

const NIGHT_GROUND: Record<GroundKind, string> = {
  asphalt: 'rgba(14,15,17,0.92)',
  walk: 'rgba(30,31,34,0.9)',
  parking: 'rgba(22,23,26,0.88)',
  lawn: 'rgba(30,52,40,0.6)',
  water: 'rgba(80,150,170,0.42)',
  deck: 'rgba(36,34,32,0.92)',
  yard: 'rgba(24,25,28,0.8)',
  path: 'rgba(44,42,40,0.9)',
  marking: 'rgba(247,245,240,0.6)',
};

const NIGHT_AIR = '#1c1d20';

export const NIGHT: Theme = {
  name: 'night',
  mat: NIGHT_MAT,
  fogMat: fogRamps(NIGHT_MAT, NIGHT_AIR),
  fogEdge: fogLine('rgba(247,245,240,0.4)'),
  fogDetail: fogLine('rgba(214,190,147,0.24)'),
  ground: NIGHT_GROUND,
  // 0 is unlit glass; the rest are lit rooms, warm, the way offices and homes
  // actually glow after dark.
  pane: ['rgba(40,42,48,0.7)', 'rgba(255,236,200,0.85)', 'rgba(253,200,120,0.82)', 'rgba(230,214,184,0.8)'],
  sheen: 'rgba(255,240,214,0.07)',
  glaze: 'rgba(255,240,214,0.06)',
  edge: 'rgba(247,245,240,0.4)',
  detail: 'rgba(214,190,147,0.24)',
  grid: 'rgba(214,190,147,0.14)',
  lane: 'rgba(247,245,240,0.4)',
  roadEdge: 'rgba(244,168,70,0.9)',
  roadGlow: 'rgba(244,144,0,0.2)',
  zebra: 'rgba(247,245,240,0.7)',
  shadow: null,
  treeFill: 'rgba(28,46,38,0.95)',
  treeLight: 'rgba(48,76,62,0.7)',
  treeEdge: 'rgba(150,190,160,0.4)',
  trunk: 'rgba(196,170,150,0.4)',
  lampCore: 'rgba(255,232,180,1)',
  lampGlow: 'rgba(253,200,120,0.2)',
  carHead: 'rgba(255,248,230,1)',
  carTail: 'rgba(236,84,54,1)',
  beacon: 'rgba(244,144,0,1)',
  ripple: 'rgba(247,245,240,0.7)',
  crane: 'rgba(247,245,240,0.55)',
  haze: 'rgba(244,160,60,0.12)',
};

export const THEMES = { day: DAY, night: NIGHT } as const;
