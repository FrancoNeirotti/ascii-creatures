// Small numeric helpers shared by the simulation, the renderer and the creatures.

export const TAU = Math.PI * 2;

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (lo, hi) => lo + Math.random() * (hi - lo);
export const fract = (x) => x - Math.floor(x);
export const smoothstep = (t) => t * t * (3 - 2 * t);

/** GLSL-style smoothstep: 0 below edge0, 1 above edge1, eased in between. */
export function smoothRange(edge0, edge1, x) {
  return smoothstep(clamp((x - edge0) / (edge1 - edge0), 0, 1));
}

/**
 * Jittered dot pattern: true when (u, v) falls inside one of the dots of a grid with
 * spacing `cell` and roughly `radius`-sized dots. Used for spots and speckles.
 */
export function speckle(u, v, cell, radius, seed) {
  const a = u / cell;
  const b = v / cell;
  const col = Math.floor(a);
  const row = Math.floor(b);
  const cx = 0.25 + 0.5 * hash3(col, row, seed);
  const cy = 0.25 + 0.5 * hash3(col, row, seed + 11);
  const r = (radius / cell) * (0.6 + 0.6 * hash3(col, row, seed + 23));
  return (a - col - cx) ** 2 + (b - row - cy) ** 2 < r * r;
}

/** Shortest signed angle that turns `from` into `to`, in (-PI, PI]. */
export function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Deterministic hash of three integers to [0, 1). Used for stable per-cell randomness. */
export function hash3(a, b, c) {
  let h =
    Math.imul(a | 0, 374761393) ^
    Math.imul(b | 0, 668265263) ^
    Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [0, 1), built on hash3. */
export function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smoothstep(x - xi);
  const fy = smoothstep(y - yi);
  const top = lerp(hash3(xi, yi, seed), hash3(xi + 1, yi, seed), fx);
  const bottom = lerp(hash3(xi, yi + 1, seed), hash3(xi + 1, yi + 1, seed), fx);
  return lerp(top, bottom, fy);
}

export function inEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

/** Distance from point P to segment AB. The projection parameter is left in `segment.t`. */
export const segment = { t: 0 };
export function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  segment.t = t;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

/** 3x3 hue-rotation colour matrix (same maths as SVG feColorMatrix type="hueRotate"). */
export function hueRotation(degrees) {
  const c = Math.cos((degrees * Math.PI) / 180);
  const s = Math.sin((degrees * Math.PI) / 180);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
}

/** The ASCII stroke that best matches a line direction. Screen y points down. */
export function lineGlyph(angle) {
  let a = angle % Math.PI;
  if (a < 0) a += Math.PI;
  if (a < Math.PI / 8 || a >= (7 * Math.PI) / 8) return "-";
  if (a < (3 * Math.PI) / 8) return "\\";
  if (a < (5 * Math.PI) / 8) return "|";
  return "/";
}
