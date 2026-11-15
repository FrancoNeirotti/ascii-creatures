// Jellyfish: a translucent bell that pulses to swim, with frilly oral arms, thin
// trailing tentacles, a glow on each pulse, and drifting plankton in the water.

import { Mat } from "../renderer.js";
import { SHARED_DEFAULTS } from "../flock.js";
import { TAU, angleDelta, clamp, fract, hash3, lerp, rand, smoothRange } from "../math.js";

const BELL_TOP = [255, 168, 230];
const BELL_BASE = [232, 56, 182];
const RIM = [255, 200, 240];
const FRILL = [255, 214, 244];
const DOTS = [255, 240, 250];
const ARM_FRILL = [255, 214, 240];
const ARM_CORE = [204, 56, 172];
const TENTACLE = [232, 100, 204];
const PLANKTON = [255, 170, 226];
const PLANKTON_AREA = 6000; // px² per plankton mote

const BELL_BACK = -0.04; // u of the bell's open edge

const a = { x: 0, y: 0 };
const b = { x: 0, y: 0 };

/** 0..1 brightness pulse: quick rise at the start of each stroke, slow decay. */
function pulseGlow(c) {
  const cycle = fract(c.phase / TAU);
  return cycle < 0.16 ? smoothRange(0, 0.16, cycle) : Math.exp(-(cycle - 0.16) * 4.5);
}

function drawPlankton(flock, pen) {
  const { width, height } = flock;
  const count = Math.round((width * height) / PLANKTON_AREA);
  const time = pen.time;
  for (let i = 0; i < count; i++) {
    const rise = 3 + 9 * hash3(i, 3, 1);
    const x = hash3(i, 1, 1) * width + Math.sin(time * 0.25 + i) * 6;
    const y = (((hash3(i, 2, 1) * height - time * rise) % height) + height) % height;
    const twinkle = 0.5 + 0.5 * Math.sin(time * (0.8 + 1.6 * hash3(i, 4, 1)) + i);
    const big = hash3(i, 5, 1) > 0.92;
    pen.dot(x, y, big ? "*" : ".", PLANKTON, Math.min(0.95, 0.35 + 0.5 * (1 - twinkle) + (big ? 0 : 0.15)));
  }
}

function drawJelly(c, pen, flock) {
  const t = flock.tuning;
  const span = c.span;
  const squeeze = c.squeeze;
  const body = { x: c.x, y: c.y, heading: c.heading, span, depth: c.depth, id: c.id };
  const armLength = t.tentacles;
  const fog = pen.fogFor(c.depth);
  const bellLength = 0.32 * (1 + 0.14 * squeeze);
  const bellWidth = 0.3 * (1 - 0.2 * squeeze);
  const drag = clamp(-c.turn * 0.5, -0.5, 0.5); // tentacles swing out on turns
  const glow = pulseGlow(c) * t.pulseGlow;

  // Thin tentacles from the bell rim.
  for (let k = 0; k < 8; k++) {
    const root = ((k / 7 - 0.5) * 2 * bellWidth * 0.6);
    let pu = BELL_BACK - 0.02;
    let pv = root;
    const segments = 14;
    const length = 1.5 * armLength * (0.75 + 0.35 * hash3(c.id, k, 4));
    for (let j = 1; j <= segments; j++) {
      const f = j / segments;
      const nu = BELL_BACK - 0.02 - f * length * (1 - 0.12 * squeeze);
      const nv = root * (1 - 0.3 * f) + 0.04 * Math.sin(c.phase - f * 3.5 + k * 1.3) * f + drag * f * f * 0.4;
      pen.toWorld(body, pu, pv, a);
      pen.toWorld(body, nu, nv, b);
      pen.line(a.x, a.y, b.x, b.y, TENTACLE, Math.min(0.95, fog + 0.45 + 0.35 * f));
      pu = nu;
      pv = nv;
    }
  }

  // Frilly oral arms down the middle.
  for (let k = 0; k < 4; k++) {
    const root = (k / 3 - 0.5) * 0.11;
    const steps = 26;
    const length = 1.05 * armLength * (0.8 + 0.3 * hash3(c.id, k, 7));
    for (let j = 1; j <= steps; j++) {
      const f = j / steps;
      const u = BELL_BACK - f * length;
      const v = root * (1 - 0.4 * f) + 0.05 * Math.sin(c.phase * 0.9 - f * 4.5 + k * 1.7) * f + drag * f * 0.25;
      const frill = 0.055 * (1 - 0.5 * f) * Math.cos(f * 9 + k * 1.3 + pen.time * 0.6);
      const armFog = Math.min(0.95, fog + 0.3 * f);
      pen.toWorld(body, u, v, a);
      pen.dot(a.x, a.y, j % 3 ? ":" : "|", ARM_CORE, Math.min(0.95, armFog + 0.15));
      for (const side of [-1, 1]) {
        pen.toWorld(body, u, v + frill * side, a);
        pen.dot(a.x, a.y, "{}~§"[(j + k + (side > 0 ? 1 : 0)) % 4], ARM_FRILL, armFog);
      }
    }
    pen.toWorld(body, BELL_BACK - length, root, a);
    pen.shed(a.x, a.y, 0.015 * c.depth);
  }

  // Faint halo around the bell that brightens on each pulse.
  const haloScale = 1.3 * (1 + 0.18 * glow);
  pen.shape(
    body,
    0.32 * haloScale + 0.1,
    (u, v, p) =>
      Math.hypot((u - BELL_BACK) / (bellLength * haloScale), v / (bellWidth * haloScale)) < 1 &&
      u > BELL_BACK - 0.08 &&
      p.set(RIM, Mat.LINE, "."),
    { fog: clamp(fog + 0.55 - 0.3 * glow, 0, 0.95) },
  );

  // The bell: half-ellipse dome with a frilled skirt, radial canals and dots.
  pen.shape(
    body,
    0.42,
    (u, v, p) => {
      const f = (u - BELL_BACK) / bellLength;
      const m = v / bellWidth;
      const r2 = f * f + m * m;
      const skirt = BELL_BACK - 0.04 * m * m;
      if (r2 > 1 || u < skirt) {
        if (Math.abs(m) > 1 || u > skirt || u < skirt - 0.04) return false;
        const frill = 0.04 * Math.sin(fract((m + 1) * 5.5) * Math.PI);
        return u > skirt - frill && p.set(FRILL, Mat.SHEEN, "o");
      }
      const r = Math.sqrt(r2);
      if (r > 0.88) return p.set(RIM, Mat.SHEEN, ":;");
      const angle = Math.atan2(m, f);
      if (f > 0.3) {
        const gu = Math.round(f * 11);
        const gv = Math.round(m * 13);
        if (Math.hypot(f * 11 - gu, m * 13 - gv) < 0.32 && hash3(gu, gv, c.id) > 0.45) return p.set(DOTS, Mat.SHEEN, ".'");
      }
      if (r > 0.35 && fract((angle / Math.PI) * 6) < 0.1) return p.set(RIM, Mat.SHEEN, "|"); // radial canals
      const shade = 0.75 + 0.25 * Math.max(clamp(f, 0, 1), r * r);
      const k = clamp(f, 0, 1) * 0.8;
      return p.rgb(
        lerp(BELL_BASE[0], BELL_TOP[0], k) * shade,
        lerp(BELL_BASE[1], BELL_TOP[1], k) * shade,
        lerp(BELL_BASE[2], BELL_TOP[2], k) * shade,
        Mat.SHEEN,
        " .",
      );
    },
    { light: (0.92 + 0.18 * squeeze) * (1 + 0.6 * glow) },
  );
}

export default {
  key: "jellyfish",
  label: "Jellyfish",
  swatch: BELL_BASE,
  hint: "Click near them to make them pulse",
  hide: ["shimmer"],
  defaults: {
    ...SHARED_DEFAULTS,
    speed: 1.05,
    sway: 0.04,
    spread: 0.08,
    farthest: 0.3,
    farBias: 1.4,
    grip: 1.4,
    trail: 0.8,
    trailFade: 0.6,
    sparkle: 0.1,
    pulseRate: 1,
    pulsePower: 1,
    pulseGlow: 1,
    tentacles: 1,
  },
  controls: [
    [
      "Swimming",
      [
        { key: "pulseRate", label: "Pulse rate", min: 0.2, max: 3, step: 0.05, hint: "How often the bell pulses." },
        { key: "pulsePower", label: "Pulse power", min: 0.2, max: 3, step: 0.05, hint: "How far each pulse pushes it forward." },
        { key: "pulseGlow", label: "Pulse glow", min: 0, max: 3, step: 0.05, hint: "How much the bell lights up on each pulse." },
        { key: "tentacles", label: "Arm length", min: 0, max: 2.5, step: 0.05, hint: "Length of the frilly arms and thin tentacles." },
      ],
    ],
  ],
  area: 95000,
  scale: 1.6,
  speed: 55,
  trail: { light: [200, 80, 170], dark: [255, 130, 214] },

  create: (c) => ({ ...c, phase: rand(0, TAU), squeeze: 0, turn: 0 }),

  update(c, flock, dt) {
    const t = flock.tuning;
    c.phase += dt * TAU * 0.6 * t.pulseRate * (0.9 + 0.2 * c.roll);
    const cycle = fract(c.phase / TAU);
    // Contract quickly (first 22% of the cycle), relax slowly.
    c.squeeze = cycle < 0.22 ? smoothRange(0, 0.22, cycle) : 1 - smoothRange(0.22, 1, cycle);

    const aim = flock.heading + c.bias * t.spread;
    const before = c.heading;
    c.heading += clamp(angleDelta(c.heading, aim), -0.6 * t.grip * dt, 0.6 * t.grip * dt);
    c.turn += (angleDelta(before, c.heading) / dt - c.turn) * Math.min(1, dt * 3);

    // Thrust only during the contraction; water drag the rest of the time.
    const cruise = flock.cruise(c);
    const force = flock.beginForces();
    const thrust = cycle < 0.22 ? 6.2 * cruise * t.pulsePower : 0;
    force.x += Math.cos(c.heading) * thrust - c.vx * 1.4;
    force.y += Math.sin(c.heading) * thrust - c.vy * 1.4;
    flock.separate(c, t.separation, 0.5);
    flock.integrate(c, dt, cruise * 3);
    if (flock.hasLeft(c, c.span * 1.4)) flock.reenter(c);
  },

  /** A tap triggers an immediate pulse and a push forward. */
  startle(c, _nx, _ny, strength, flock) {
    c.phase = Math.floor(c.phase / TAU) * TAU + TAU;
    const push = 260 * strength * c.depth;
    c.vx += Math.cos(c.heading) * push;
    c.vy += Math.sin(c.heading) * push;
    c.startledUntil = flock.time + 0.8;
  },

  drawAll(flock, pen) {
    drawPlankton(flock, pen);
    for (const c of flock.creatures) drawJelly(c, pen, flock);
  },
};
