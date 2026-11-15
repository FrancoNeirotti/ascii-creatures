// Butterfly: blue iridescent wings that flap (and sometimes hold flat to glide), a
// dark segmented body, curling antennae, and a jittery fluttering path.

import { Mat } from "../renderer.js";
import { SHARED_DEFAULTS } from "../flock.js";
import { TAU, clamp, fract, rand } from "../math.js";

// Wing outlines in polar form around the wing root: radius as a function of angle.
const FOREWING = { from: -0.3, to: 1, reach: 0.56, peak: 0.55, round: 0.5, scallop: 0 };
const HINDWING = { from: -1.45, to: 0.15, reach: 0.44, peak: 0.48, round: 0.42, scallop: 0.04 };
const FORE_ROOT = 0.06;
const HIND_ROOT = -0.02;

const BODY = [30, 30, 42];
const VEIN_DARK = [22, 28, 62];
const WING_ROOT = [26, 44, 110];
const WING_TIP = [30, 50, 120];
const EDGE_SPOT = [236, 240, 255];

const FLAP_RATE = 2.6; // flaps per second at rest
const GLIDE_CHANCE = 0.35; // per second, scaled by the Glide setting
const FLUTTER_FORCE = 1.3;

/** Wing radius at angle `angle` (t is the same angle as 0..1 across the wing). */
function wingRadius(wing, angle, t = (angle - wing.from) / (wing.to - wing.from)) {
  if (t <= 0 || t >= 1) return 0;
  const k = t < wing.peak ? (t / wing.peak) * 0.5 : 0.5 + ((t - wing.peak) / (1 - wing.peak)) * 0.5;
  const radius = wing.reach * Math.pow(Math.sin(Math.PI * k), wing.round);
  return wing.scallop ? radius * (1 - wing.scallop * (0.5 + 0.5 * Math.cos(t * Math.PI * 14))) : radius;
}

/** Body half-width at u: round head, thorax, tapering abdomen. */
function bodyHalfWidth(u) {
  if (u > 0.17 || u < -0.32) return 0;
  if (u > 0.11) return Math.sqrt(Math.max(0, 0.03 * 0.03 - (u - 0.14) ** 2));
  if (u > -0.04) return 0.034;
  return 0.03 * (1 - 0.6 * ((-0.04 - u) / 0.28));
}

/** Inside a wing? Leaves angle position (0..1) in wingHit.t and radius fraction in wingHit.r. */
const wingHit = { t: 0, r: 0 };
function inWing(wing, u, v) {
  const angle = Math.atan2(u, v);
  const t = (angle - wing.from) / (wing.to - wing.from);
  const limit = wingRadius(wing, angle, t);
  const r = Math.hypot(u, v);
  if (r > limit) return false;
  wingHit.t = t;
  wingHit.r = r / limit;
  return true;
}

const at = { x: 0, y: 0 };

export default {
  key: "butterfly",
  label: "Butterfly",
  swatch: [50, 135, 255],
  hint: "Click near them to scatter them",
  defaults: {
    ...SHARED_DEFAULTS,
    density: 1.05,
    speed: 1.05,
    sway: 0,
    spread: 0,
    size: 1.25,
    farthest: 0.18,
    farBias: 1.7,
    grip: 5,
    separation: 700,
    trail: 1.55,
    trailFade: 0.15,
    flutter: 0,
    glide: 2.75,
    flapRate: 1,
  },
  controls: [
    [
      "Flight",
      [
        { key: "flutter", label: "Flutter", min: 0, max: 3, step: 0.05, hint: "How much their path zigzags." },
        { key: "glide", label: "Glide", min: 0, max: 4, step: 0.05, hint: "How often they stop flapping and glide with wings held flat." },
        { key: "flapRate", label: "Flap rate", min: 0.2, max: 3, step: 0.05, hint: "How fast their wings beat." },
      ],
    ],
  ],
  area: 48000,
  scale: 1,
  speed: 90,
  trail: { light: [70, 118, 226], dark: [96, 156, 255] },

  create: (c) => ({ ...c, phase: rand(0, TAU), open: 1, glide: 0, glideUntil: 0, flutterX: 0, flutterY: 0 }),

  enter(c) {
    c.flutterX = 0;
    c.flutterY = 0;
  },

  update(c, flock, dt) {
    const t = flock.tuning;
    const now = flock.time;
    const cruise = flock.cruise(c);
    const force = flock.beginForces();
    flock.steer(c, flock.heading + c.bias * t.spread, cruise, t.grip);

    // Flutter: a random walk of sideways force, damped, weaker while gliding.
    const jitter = Math.sqrt(dt) * 520 * FLUTTER_FORCE * t.flutter * (1 - 0.8 * c.glide) * (0.5 + 0.5 * c.depth);
    c.flutterX += -c.flutterX * 3 * dt + (Math.random() * 2 - 1) * jitter;
    c.flutterY += -c.flutterY * 3 * dt + (Math.random() * 2 - 1) * jitter;
    force.x += c.flutterX;
    force.y += c.flutterY;

    // Each downstroke pushes forward.
    const stroke = Math.max(0, -Math.sin(c.phase)) * (1 - c.glide);
    force.x += Math.cos(c.heading) * stroke * cruise * 1.4;
    force.y += Math.sin(c.heading) * stroke * cruise * 1.4;
    flock.separate(c);
    const speed = flock.integrate(c, dt, cruise * 2.2);
    if (flock.hasLeft(c)) flock.reenter(c);
    if (speed > 12) flock.turnToward(c, dt);

    if (c.glide < 0.5 && now > c.glideUntil && speed > cruise * 0.5 && Math.random() < GLIDE_CHANCE * t.glide * dt) {
      c.glideUntil = now + rand(0.5, 1.4);
    }
    c.glide += ((now < c.glideUntil ? 1 : 0) - c.glide) * Math.min(1, dt * 6);

    const effort = clamp(speed / (cruise * 2), 0, 1);
    c.phase += dt * TAU * FLAP_RATE * t.flapRate * (0.8 + 0.6 * effort) * (1 - 0.9 * c.glide);
    const flap = Math.pow(0.5 + 0.5 * Math.cos(c.phase), 0.8);
    c.open = 0.1 + 0.9 * (flap * (1 - c.glide) + 0.96 * c.glide);
  },

  startle(c, nx, ny, strength, flock) {
    const push = strength * 420 * c.depth;
    c.vx += nx * push;
    c.vy += ny * push;
    c.startledUntil = flock.time + rand(0.6, 1.2);
    c.glideUntil = 0;
  },

  draw(c, pen) {
    const span = c.span;
    const open = Math.max(0.08, c.open);
    const body = { x: c.x, y: c.y, heading: c.heading + 0.06 * Math.sin(c.phase), span, depth: c.depth, id: c.id };
    const minHalf = pen.cw * 0.4; // keep the body at least one cell wide

    pen.shape(
      body,
      0.75,
      (u, v, p) => {
        const av = Math.abs(v);
        const half = bodyHalfWidth(u);
        if (half > 0 && av * span <= Math.max(half * span, minHalf)) return p.set(BODY, Mat.THORAX);
        // Wings fold toward the body by squashing the across-axis.
        const across = av / open;
        let fore;
        if (inWing(FOREWING, u - FORE_ROOT, across)) fore = true;
        else if (inWing(HINDWING, u - HIND_ROOT, across)) fore = false;
        else return false;
        const { t, r } = wingHit;
        if (r > 0.86) {
          // Dark border with a row of white spots on the forewing.
          return fore && r < 0.95 && Math.abs(fract(t * 5) - 0.5) < 0.14
            ? p.set(EDGE_SPOT, Mat.HIGHLIGHT)
            : p.set(VEIN_DARK, Mat.DARK);
        }
        if (r < 0.08) return p.set(WING_ROOT, Mat.DARK);
        if (fore && t > 0.9) return p.set(WING_TIP, Mat.DARK);
        return p.rgb(50 + 70 * r, 135 + 60 * r, 255, Mat.IRIDESCENT);
      },
      { light: 0.6 + 0.4 * c.open, tilt: c.open * 3 },
    );

    // Antennae, with a club tip when big enough to show it.
    const wobble = 0.012 * Math.sin(pen.time * 3 + c.id);
    for (const side of [-1, 1]) {
      pen.lineBody(body, 0.16, 0.012 * side, 0.37 + wobble, (0.12 + wobble) * side, pen.palette.ink, span > 120 ? "o" : undefined);
    }

    // Trail from the forewing tips, stronger on the downstroke.
    const stroke = Math.max(0, -Math.sin(c.phase)) * (1 - c.glide);
    const tipAngle = FOREWING.from + (FOREWING.to - FOREWING.from) * FOREWING.peak;
    const tipU = FORE_ROOT + Math.sin(tipAngle) * FOREWING.reach * 0.95;
    const tipV = Math.cos(tipAngle) * FOREWING.reach * 0.95 * c.open;
    for (const side of [-1, 1]) {
      pen.toWorld(body, tipU, tipV * side, at);
      pen.shed(at.x, at.y, (0.02 + 0.1 * stroke) * c.depth);
    }
  },
};
