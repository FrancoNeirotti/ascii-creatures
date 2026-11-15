// Dragonfly: hovers, darts and cruises. Clear veined wings, a ringed abdomen, and
// a light sweep that runs along the wings with each beat.

import { Mat } from "../renderer.js";
import { SHARED_DEFAULTS } from "../flock.js";
import { TAU, fract, hash3, lineGlyph, rand } from "../math.js";

// Each wing is a tapered blade from a root at (u, v), angled forward by `angle`.
const FOREWING = { u: 0.11, v: 0.02, angle: 0.08, length: 0.5, width: 0.062, broad: 0 };
const HINDWING = { u: 0.06, v: 0.02, angle: -0.05, length: 0.48, width: 0.07, broad: 0.5 };

const GREEN = [50, 220, 120];
const HEAD_LIGHT = [96, 232, 130];
const HEAD_DARK = [28, 70, 44];
const LEG = [40, 60, 44];
const ABDOMEN_DARK = [24, 72, 46];
const ABDOMEN_RING = [200, 255, 220];
const TAIL_TIP = [18, 40, 28];
const LEADING_EDGE = [236, 168, 70];
const VEIN = [226, 236, 214];
const WING_ROOT = [90, 220, 140];
const PTEROSTIGMA = [176, 70, 40];
const FLASH = [255, 255, 255];
const EYE_FG = [10, 10, 12];
const EYE_BG = [240, 240, 232];

const wing = { s: 0, x: 0 }; // s: 0 root -> 1 tip, x: -1..1 across the blade
function inWing(w, u, v) {
  const du = u - w.u;
  const dv = v - w.v;
  const sin = Math.sin(w.angle);
  const cos = Math.cos(w.angle);
  const s = (du * sin + dv * cos) / w.length;
  if (s < 0 || s > 1) return false;
  const across = du * cos - dv * sin;
  const half = w.width * Math.pow(Math.sin(Math.PI * (0.1 + 0.9 * s)), 0.45) * (1 + w.broad * (1 - s) * (1 - s));
  if (Math.abs(across) > half) return false;
  wing.s = s;
  wing.x = across / half;
  return true;
}

const eye = { x: 0, y: 0 };

function draw(c, pen) {
  const span = c.span;
  const body = { x: c.x, y: c.y, heading: c.heading, span, depth: c.depth, id: c.id };
  const foreBeat = 0.86 + 0.14 * Math.cos(c.phase);
  const hindBeat = 0.86 + 0.14 * Math.cos(c.phase + 1.7);
  const minHalf = pen.cw * 0.38;
  const sweep = fract(c.phase / TAU);
  const flashSlot = Math.floor(pen.time * 24);

  for (const side of [-1, 1]) {
    pen.lineBody(body, 0.14, 0.03 * side, 0.2, 0.07 * side, LEG);
    pen.lineBody(body, 0.1, 0.03 * side, 0.12, 0.08 * side, LEG);
  }

  pen.shape(
    body,
    0.74,
    (u, v, p) => {
      const av = Math.abs(v);

      // Head: big striped eyes.
      const hu = (u - 0.12) / 0.07;
      const hv = av / 0.046;
      if (hu * hu + hv * hv <= 1) return p.set(fract((u + av) * 22) < 0.5 ? HEAD_LIGHT : HEAD_DARK, Mat.SHEEN, "#8");

      // Abdomen: a long tapering tube with rings.
      if (u < 0.06 && u > -0.74) {
        const half = Math.max(0.017 - 0.006 * ((0.06 - u) / 0.8), minHalf / span);
        if (av <= half) {
          if (u < -0.66) return p.set(TAIL_TIP, Mat.DARK);
          const ring = fract(u * 20);
          if (ring < 0.1) return p.set(ABDOMEN_RING, Mat.SHEEN, "-");
          if (ring < 0.45) return p.set(GREEN, Mat.SHEEN, "=");
          return p.set(ABDOMEN_DARK, Mat.SHEEN, ":=");
        }
      }

      for (const [w, beat] of [
        [FOREWING, foreBeat],
        [HINDWING, hindBeat],
      ]) {
        if (!inWing(w, u, av / beat)) continue;
        // Vein strokes follow the wing's own directions, in screen space.
        const side = v >= 0 ? 1 : -1;
        const along = lineGlyph(c.heading + Math.atan2(side * Math.cos(w.angle), Math.sin(w.angle)));
        const cross = lineGlyph(c.heading + Math.atan2(-side * Math.sin(w.angle), Math.cos(w.angle)));
        const { s, x } = wing;
        if (s > 0.82 && s < 0.9 && x > 0.35) return p.set(PTEROSTIGMA, Mat.SHEEN, "#");
        if (x > 0.72) return p.set(LEADING_EDGE, Mat.LINE, along);
        if (Math.abs(s - sweep) < 0.05 && hash3(Math.round(u * 60), Math.round(v * 60), flashSlot) > 0.45) {
          return p.set(FLASH, Mat.LINE, "*+");
        }
        const longVein = Math.abs(x + 0.15) < 0.09 || Math.abs(x - 0.35) < 0.07 || x < -0.85 || s > 0.97;
        const crossVein = fract(s * 9) < 0.09;
        if (longVein) return p.set(VEIN, Mat.LINE, crossVein ? "+" : along);
        if (crossVein) return p.set(VEIN, Mat.LINE, cross);
        if (s < 0.18) return p.set(WING_ROOT, Mat.GLOW, ".");
        return hash3(Math.round(u * 50), Math.round(v * 50), c.id) > 0.6 && p.set(VEIN, Mat.LINE, ".");
      }
      return false;
    },
    { light: 0.92 + 0.08 * foreBeat },
  );

  if (0.068 * span >= pen.cw) {
    for (const side of [-1, 1]) {
      pen.toWorld(body, 0.2, 0.034 * side, eye);
      pen.spot(eye.x, eye.y, "●", EYE_FG, EYE_BG, c.depth);
    }
  }
  if (c.mode === "dart") pen.shed(c.x, c.y, 0.06 * c.depth);
}

export default {
  key: "dragonfly",
  label: "Dragonfly",
  swatch: GREEN,
  hint: "Click to make them dart",
  hide: ["shimmer"],
  defaults: {
    ...SHARED_DEFAULTS,
    fog: 0.26,
    density: 2.1,
    sway: 0,
    spread: 0,
    farthest: 0.32,
    farBias: 3,
    grip: 5,
    separation: 720,
    trail: 0.6,
    trailFade: 1.2,
    sparkle: 0.18,
    hover: 1.3,
    cruising: 0.5,
    dart: 1.5,
    wingbeat: 1,
  },
  controls: [
    [
      "Flight",
      [
        { key: "hover", label: "Hover time", min: 0.1, max: 4, step: 0.05, hint: "Average time hanging in place. Mostly brief, now and then long." },
        { key: "cruising", label: "Cruising", min: 0, max: 1, step: 0.01, hint: "How often they fly on for a few seconds instead of hovering." },
        { key: "dart", label: "Dart speed", min: 0.2, max: 3, step: 0.05, hint: "How fast each dart is." },
        { key: "wingbeat", label: "Wingbeat", min: 0.2, max: 2, step: 0.05, hint: "How fast the wings flicker." },
      ],
    ],
  ],
  area: 150000,
  scale: 2.1,
  speed: 70,
  trail: { light: [40, 160, 100], dark: [140, 255, 190] },

  create: (c) => ({ ...c, phase: rand(0, TAU), mode: "hover", until: 0, aim: 0 }),

  enter(c, flock) {
    c.mode = "hover";
    c.until = flock.time + rand(0, 0.6);
    c.aim = flock.course;
  },

  update(c, flock, dt) {
    const t = flock.tuning;
    const now = flock.time;
    const cruise = flock.cruise(c);

    // hover -> dart -> (cruise | hover); cruise -> (dart | hover)
    if (now >= c.until) {
      const previous = c.mode;
      c.mode =
        previous === "hover"
          ? "dart"
          : previous === "dart"
            ? Math.random() < t.cruising
              ? "cruise"
              : "hover"
            : Math.random() < 0.35
              ? "dart"
              : "hover";
      if (c.mode === "dart") {
        c.until = now + rand(0.15, 0.45);
        if (previous === "cruise") c.aim = c.heading + rand(-0.4, 0.4) * (t.spread + 0.2);
      } else if (c.mode === "cruise") {
        c.until = now + rand(1.2, 4.5);
        c.aim = flock.heading + c.bias * t.spread + rand(-0.5, 0.5) * t.spread;
      } else {
        // Exponential hover times: mostly short, occasionally long.
        c.until = now + Math.min(3, Math.max(0.15, -Math.log(1 - Math.random()) * 0.7)) * t.hover;
        c.aim = flock.heading + c.bias * t.spread * 0.5 + rand(-1, 1) * t.spread * 1.6;
      }
    }

    const force = flock.beginForces();
    if (c.mode === "dart") {
      flock.steer(c, c.aim, cruise * 4 * t.dart, 10);
    } else if (c.mode === "cruise") {
      c.aim += rand(-1, 1) * dt * 1.2;
      c.aim += (flock.heading + c.bias * t.spread - c.aim) * Math.min(1, dt * 0.8);
      flock.steer(c, c.aim, cruise * 1.8, 3);
    } else {
      flock.steer(c, flock.heading, cruise * 0.25, 4 * t.grip);
      force.x += Math.cos(now * 3 + c.id) * 40; // hover wobble
      force.y += Math.sin(now * 4.3 + c.id * 2) * 40;
    }
    flock.separate(c);
    flock.integrate(c, dt, cruise * 4.5 * t.dart);
    if (flock.hasLeft(c)) flock.reenter(c);
    if (c.mode === "cruise") flock.turnToward(c, dt, 4);
    else flock.turnToward(c, dt, c.mode === "dart" ? 14 : 2.5, c.aim);
    c.phase += dt * TAU * 7 * t.wingbeat;
  },

  startle(c, _nx, _ny, strength, flock) {
    c.mode = "dart";
    c.aim = flock.heading + c.bias * flock.tuning.spread;
    c.until = flock.time + 0.25 + 0.3 * strength;
    c.startledUntil = c.until;
  },

  draw,
};
