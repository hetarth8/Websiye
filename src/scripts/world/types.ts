/**
 * Shared shapes for the city renderer.
 *
 * Coordinates are world units: x across the main road (0 is its centre line,
 * negative is the left-hand side), y up, z along the road away from the viewer.
 * One unit is roughly one metre, which is what keeps a villa, a car and a
 * forty-storey tower in believable proportion to each other.
 *
 * Geometry is built ONCE per lot and cached (see city.ts); only projection runs
 * per frame. That split is the whole performance model — nothing here allocates
 * in the draw loop except the painter's list, which is pooled.
 */

/** Surface materials. Each resolves to eight sun-shaded tones per theme. */
export type Material =
  | 'wall'
  | 'glass'
  | 'roof'
  | 'tile'
  | 'metal'
  | 'sign'
  | 'accent'
  | 'shutter'
  | 'slab'
  | 'car';

/** Flat ground finishes, drawn in the ground pass beneath everything. */
export type GroundKind = 'asphalt' | 'walk' | 'parking' | 'lawn' | 'water' | 'deck' | 'yard' | 'path' | 'marking';

/**
 * One planar polygon.
 *
 * `level` (0-7) is its sun shading, fixed at build time from the normal: the
 * light never moves, so recomputing it per frame would be pure waste.
 */
export interface Face {
  p: Float32Array;
  nx: number;
  ny: number;
  nz: number;
  mat: Material;
  level: number;
  /** Glazing: quads, 12 floats each, drawn only while this face is visible. */
  panes?: Float32Array;
  /** Per-pane variant (0 dark glass, 1-3 lit at night). */
  paneVar?: Uint8Array;
  /**
   * Draw the panes only after dark. A glass tower's daytime facade is its
   * mullion grid; at night it is its lit rooms. Drawing both by day would
   * double the cost of the most expensive buildings for no visible gain.
   */
  paneNightOnly?: boolean;
  /** Detail segments (mullions, floor lines, railings), 6 floats each. */
  lines?: Float32Array;
  /** Skip the outline stroke — for faces whose edges would only add noise. */
  noEdge?: boolean;
}

/**
 * A convex volume. Parts are the unit of painter's ordering inside a building:
 * two visible faces of one convex part can never overlap on screen, so a part's
 * faces need no sorting of their own.
 */
export interface Part {
  faces: Face[];
  y0: number;
  y1: number;
  cx: number;
  cz: number;
  /**
   * Plan bounds. Two parts whose plans overlap but whose heights do not are
   * STACKED (a tower on its podium, a roof on its walls) and are ordered by
   * height relative to the camera; anything else is ordered by distance.
   */
  bx0: number;
  bx1: number;
  bz0: number;
  bz1: number;
  /** Segments owned by the part rather than a face — structural frames, masts. */
  lines?: Float32Array;
}

/** Things drawn as sprites rather than polygons. */
export type BillKind = 'tree' | 'conifer' | 'palm' | 'shrub' | 'lamp' | 'crane' | 'silo' | 'beacon';

export interface Bill {
  k: BillKind;
  x: number;
  y: number;
  z: number;
  /** Size: canopy radius, lamp height, crane jib length, silo radius. */
  s: number;
  /** Height where it matters (tree, crane mast, silo). */
  h: number;
  seed: number;
}

/** A ground polygon (x,z pairs at y = 0) with optional markings. */
export interface Decal {
  p: Float32Array;
  g: GroundKind;
  /** Markings on it: x,z,x,z segments. */
  lines?: Float32Array;
}

/** Everything on one lot. */
export interface Obj {
  parts: Part[];
  bills: Bill[];
  decals: Decal[];
  /** Footprints for shadows: x0,z0,x1,z1,h per footprint. */
  shadows: Float32Array;
  cx: number;
  cz: number;
  /** Bounding radius in plan, for culling. */
  r: number;
  /** Tallest point, for culling. */
  h: number;
}

export type DistrictId = 'resort' | 'residential' | 'skyline' | 'industrial' | 'highway';

export type ThemeName = 'day' | 'night';

export interface Theme {
  name: ThemeName;
  /** Eight tones per material, darkest (shaded) to lightest (sunlit). */
  mat: Record<Material, string[]>;
  /**
   * The same tones seen through distance: FOG_STEPS × 8 per material, index
   * `step * 8 + tone`. Far buildings are tinted toward the air, not made
   * see-through — a translucent building shows the one behind it through it.
   */
  fogMat: Record<Material, string[]>;
  /** Outline and linework colours per fog step. */
  fogEdge: string[];
  fogDetail: string[];
  ground: Record<GroundKind, string>;
  pane: string[];
  /** The reflection that slides across glass facades as the camera moves. */
  sheen: string;
  /** The sky reflected in the upper part of a large glass face. */
  glaze: string;
  edge: string;
  detail: string;
  grid: string;
  lane: string;
  roadEdge: string;
  roadGlow: string;
  zebra: string;
  shadow: string | null;
  treeFill: string;
  /** The sunlit crown drawn over the canopy. */
  treeLight: string;
  treeEdge: string;
  trunk: string;
  lampCore: string;
  lampGlow: string;
  carHead: string;
  carTail: string;
  beacon: string;
  ripple: string;
  crane: string;
  haze: string;
}
