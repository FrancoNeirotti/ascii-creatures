// Frog: sits, then leaps in an arc (drawn bigger at the top of the jump), stretching
// its hind legs and reaching with its front legs. Each landing leaves a splash.

import { Mat } from "../renderer.js";
import { SHARED_DEFAULTS } from "../flock.js";
import { angleDelta, clamp, fract, lerp, rand, segment, segmentDistance, smoothRange, speckle } from "../math.js";

const SKIN = [104, 184, 76];
const LEG_SKIN = [92, 164, 66];
const SPOT = [30, 70, 30];
const SPOT_RIM = [190, 222, 130];
const RIDGE = [206, 226, 150];
const LEG_BAND = [36, 80, 32];
const EYE_BG = [240, 240, 228];
const EYE_FG = [16, 16, 12];
const BLINK = [20, 30, 16];
const TOE = [120, 190, 90];

// Leg poses as joint chains (u, v) for the right side; v is mirrored for the left.
const HIND_SIT = [[-0.16, 0.11], [0, 0.22], [-0.19, 0.25], [-0.04, 0.31]];
const HIND_STRETCH = [[-0.17, 0.09], [-0.38, 0.15], [-0.56, 0.13], [-0.68, 0.15]];
const HIND_WIDTH = [0.056, 0.04, 0.026];
const FORE_SIT = [[0.06, 0.1], [0.09, 0.19], [0.18, 0.2]];
const FORE_TUCK = [[0.06, 0.1], [0.02, 0.16], [-0.06, 0.15]];
const FORE_REACH = [[0.08, 0.11], [0.16, 0.19], [0.27, 0.19]];
const FORE_WIDTH = [0.028, 0.022];
const EYE = [0.18, 0.1];
const TURN_LIMIT = 0.35; // max course correction per leap (rad)
const LEAP_TRIES = [1, 0.8, 1.2, 0.65, 1.35]; // landing distances tried to avoid neighbours

const blendPose = (a, b, t) => a.map(([u, v], i) => [lerp(u, b[i][0], t), lerp(v, b[i][1], t)]);

/** Body half-width at u: a rounded rump plus a head that swells as it breathes. */
function bodyHalfWidth(u, breathe) {
  const rump = 0.155 * Math.sqrt(Math.max(0, 1 - ((u + 0.1) / 0.18) ** 2));
  let head = 0.15 * breathe * Math.sqrt(Math.max(0, 1 - ((u - 0.12) / 0.18) ** 2));
  if (u > 0.18) head *= 1 - 0.5 * ((u - 0.18) / 0.12) ** 2;
  return Math.max(rump, head);
}

/** Inside a tapered limb? Leaves 0..1 position along the whole limb in `limb.t`. */
const limb = { t: 0 };
function inLimb(points, widths, u, v) {
  for (let k = 0; k < points.length - 1; k++) {
    const [au, av] = points[k];
    const [bu, bv] = points[k + 1];
    const d = segmentDistance(u, v, au, av, bu, bv);
    if (d <= widths[k] * (1 - 0.25 * segment.t)) {
      limb.t = (k + segment.t) / (points.length - 1);
      return true;
    }
  }
  return false;
}

/** Start a leap toward `angle`. Steered leaps stay near the course and avoid landing on neighbours. */
function startLeap(c, flock, angle, power, steered = true) {
  const t = flock.tuning;
  if (steered) angle = flock.heading + clamp(angleDelta(flock.heading, angle), -TURN_LIMIT, TURN_LIMIT);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const reach = c.span * rand(2.4, 3.6) * t.leap * t.speed * power;
  let length = reach;
  if (steered && t.separation > 0) {
    let bestGap = -1;
    for (const factor of LEAP_TRIES) {
      const lx = c.x + cos * reach * factor;
      const ly = c.y + sin * reach * factor;
      let gap = Infinity;
      for (const other of flock.creatures) {
        if (other === c || Math.abs(other.depth - c.depth) > 0.2) continue;
        const ox = other.leaping ? other.toX : other.x;
        const oy = other.leaping ? other.toY : other.y;
        gap = Math.min(gap, Math.hypot(lx - ox, ly - oy) / (c.span + other.span));
      }
      if (gap > bestGap) {
        bestGap = gap;
        length = reach * factor;
      }
      if (gap >= 0.6 * (t.separation / 300)) break;
    }
  }
  c.leaping = true;
  c.s = 0;
  c.dur = rand(0.42, 0.55) * Math.sqrt(t.leap) * (power > 1 ? 0.8 : 1);
  c.heading = angle;
  c.fromX = c.x;
  c.fromY = c.y;
  c.toX = c.x + cos * length;
  c.toY = c.y + sin * length;
  c.vx = (c.toX - c.fromX) / c.dur;
  c.vy = (c.toY - c.fromY) / c.dur;
}

const at = { x: 0, y: 0 };

function draw(c, pen, flock) {
  const t = flock.tuning;
  const s = c.leaping ? c.s : 0;
  const height = 4 * s * (1 - s) * t.height; // 0 on the ground, peaks mid-leap
  const span = c.span * (1 + 0.35 * height);
  const body = { x: c.x, y: c.y, heading: c.heading, span, depth: c.depth, id: c.id };
  const stretch = c.leaping ? smoothRange(0, 0.16, s) * (1 - smoothRange(0.72, 1, s)) : 0;
  const hind = blendPose(HIND_SIT, HIND_STRETCH, stretch);
  const fore = c.leaping
    ? s < 0.6
      ? blendPose(FORE_SIT, FORE_TUCK, smoothRange(0, 0.2, s))
      : blendPose(FORE_TUCK, FORE_REACH, smoothRange(0.6, 0.95, s))
    : FORE_SIT;
  const breathe = c.leaping ? 1 : 1 + 0.045 * Math.sin(pen.time * 6 + c.id);
  const blinking = !c.leaping && fract(pen.time * 0.21 + c.id * 0.37) < 0.035;

  // Toes: a small fan of strokes at the end of each foot.
  for (const side of [-1, 1]) {
    const toes = (from, to, count, length, fan) => {
      const dir = Math.atan2(to[1] - from[1], to[0] - from[0]);
      for (let k = 0; k < count; k++) {
        const a = dir + (k / (count - 1) - 0.5) * fan;
        pen.lineBody(body, to[0], to[1] * side, to[0] + Math.cos(a) * length, (to[1] + Math.sin(a) * length) * side, TOE);
      }
    };
    toes(hind[2], hind[3], 4, 0.075, 1.2);
    toes(fore[1], fore[2], 3, 0.045, 1.1);
  }

  pen.shape(
    body,
    0.9,
    (u, v, p) => {
      const av = Math.abs(v);
      const half = bodyHalfWidth(u, breathe);
      if (av <= half && u > -0.29 && u < 0.3) {
        if (Math.abs(av - 0.11) < 0.012 && u > -0.22 && u < 0.14) return p.set(RIDGE, Mat.SHEEN); // dorsal ridges
        if (u < 0.1) {
          if (speckle(u, v, 0.085, 0.024, c.id)) return p.set(SPOT, Mat.DARK);
          if (speckle(u, v, 0.085, 0.036, c.id)) return p.set(SPOT_RIM, Mat.SHEEN);
        }
        const shade = 0.9 + 0.2 * (1 - av / Math.max(half, 0.001));
        return p.rgb(SKIN[0] * shade, SKIN[1] * shade, SKIN[2] * shade, Mat.SHEEN);
      }
      // Webbed hind foot, opening in the direction of the last joint.
      const [footU, footV] = hind[3];
      const [ankleU, ankleV] = hind[2];
      const footDir = Math.atan2(footV - ankleV, footU - ankleU);
      const off = Math.atan2(av - footV, u - footU) - footDir;
      if (Math.hypot(u - footU, av - footV) < 0.06 && Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < 0.5) {
        return p.set(TOE, Mat.GLOW, ".");
      }
      if (inLimb(hind, HIND_WIDTH, u, av) || inLimb(fore, FORE_WIDTH, u, av)) {
        return fract(limb.t * 4.5) < 0.3 ? p.set(LEG_BAND, Mat.DARK) : p.set(LEG_SKIN, Mat.SHEEN);
      }
      return false;
    },
    { light: 1 + 0.15 * height },
  );

  for (const side of [-1, 1]) {
    pen.toWorld(body, EYE[0], EYE[1] * side, at);
    if (blinking) pen.spot(at.x, at.y, "-", BLINK, SKIN, c.depth);
    else pen.spot(at.x, at.y, "●", EYE_FG, EYE_BG, c.depth);
  }
}

export default {
  key: "frog",
  label: "Frog",
  swatch: SKIN,
  hint: "Click near them to make them jump",
  hide: ["grip"],
  defaults: {
    ...SHARED_DEFAULTS,
    fog: 0,
    size: 1.2,
    density: 1.3,
    sway: 0,
    spread: 0,
    farthest: 0.35,
    farBias: 1.4,
    separation: 450,
    trail: 3.45,
    trailFade: 0.4,
    shimmer: 0.15,
    sparkle: 0.05,
    hop: 1,
    leap: 0.45,
    height: 1,
  },
  controls: [
    [
      "Leaping",
      [
        { key: "hop", label: "How often", min: 0.2, max: 4, step: 0.05, hint: "How often they leap." },
        { key: "leap", label: "Leap length", min: 0.3, max: 2.5, step: 0.05, hint: "How far each leap goes." },
        { key: "height", label: "Leap height", min: 0, max: 2.5, step: 0.05, hint: "How high each leap arcs: they draw bigger at the top." },
      ],
    ],
  ],
  area: 75000,
  scale: 0.95,
  speed: 80,
  trail: { light: [80, 150, 170], dark: [110, 200, 220] },

  create: (c) => ({ ...c, leaping: false, until: 0, aim: 0, s: 0, dur: 0.5, fromX: 0, fromY: 0, toX: 0, toY: 0 }),

  enter(c, flock) {
    c.leaping = false;
    c.s = 0;
    c.vx = 0;
    c.vy = 0;
    c.aim = flock.heading + c.bias * flock.tuning.spread;
    c.heading = c.aim;
    c.until = flock.time + rand(0, 1.5);
  },

  update(c, flock, dt) {
    const t = flock.tuning;
    const now = flock.time;
    if (!c.leaping) {
      c.vx = 0;
      c.vy = 0;
      flock.turnToward(c, dt, 2.5, c.aim);
      if (now >= c.until) startLeap(c, flock, c.aim, 1);
      return;
    }
    c.s += dt / c.dur;
    if (c.s >= 1) {
      c.leaping = false;
      c.x = c.toX;
      c.y = c.toY;
      c.vx = 0;
      c.vy = 0;
      c.until = now + rand(0.5, 2.2) / (t.hop * t.speed);
      c.aim = flock.heading + (c.bias + rand(-0.7, 0.7)) * t.spread;
      flock.events.push({ x: c.x, y: c.y, radius: 2, amount: 0.7 * c.depth * t.trail }); // landing splash
      if (flock.hasLeft(c)) flock.reenter(c);
      return;
    }
    c.x = lerp(c.fromX, c.toX, c.s);
    c.y = lerp(c.fromY, c.toY, c.s);
  },

  startle(c, nx, ny, strength, flock) {
    if (c.leaping) return;
    startLeap(c, flock, Math.atan2(ny, nx), 1 + strength, false);
    c.startledUntil = flock.time + c.dur;
  },

  draw,
};
