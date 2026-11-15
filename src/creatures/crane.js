// Crane: a large white bird with black flight feathers and a red crown, flying in a
// loose line. Two flap styles: an even open/close, or a folding wrist upstroke.

import { Mat } from "../renderer.js";
import { SHARED_DEFAULTS } from "../flock.js";
import { TAU, fract, hash3, inEllipse, lerp, rand } from "../math.js";

// Wing spans from the body (ROOT) out to the tip; ELBOW is the wrist joint.
const ROOT = 0.045;
const ELBOW = 0.25;
const TIP = 0.5;

const WHITE = [236, 238, 242];
const BLACK = [32, 32, 38];
const GREY = [78, 78, 92];
const CROWN_FG = [255, 214, 200];
const CROWN_BG = [226, 36, 36];
const EYE_BG = [14, 12, 16];
const EYE_FG = [255, 252, 246];
const BEAK = [196, 196, 150];
const LEG = [60, 60, 66];

/** Point (along, out) inside the rest-pose wing? Leaves feather coordinates in `feather`. */
const feather = { s: 0, q: 0 }; // s: 0 root -> 1 tip, q: 0 trailing -> 1 leading edge
function inWing(along, out) {
  if (out < ROOT || out > TIP) return false;
  const s = (out - ROOT) / (TIP - ROOT);
  const lead = 0.12 + 0.03 * s - 0.09 * s * s;
  let trail = (-0.075 + 0.03 * s) * 1.2;
  if (s < 0.78) trail += 0.012 * (0.5 + 0.5 * Math.cos(s * TAU * 9)); // scalloped trailing edge
  const back = s > 0.72 ? lerp(trail, lead - 0.015, Math.pow((s - 0.72) / 0.28, 1.4)) : trail;
  if (along > lead || along < back) return false;
  const q = (along - back) / (lead - back);
  if (s > 0.78 && q < 0.92 && fract(q * 6) < 0.24) return false; // gaps between primaries
  feather.s = s;
  feather.q = q;
  return true;
}

// Wing pose for this frame: how open the arm and hand are, wrist sweep, body lift.
const pose = { arm: 1, hand: 1, sweep: 0, lift: 0 };

function evenFlap(c) {
  const beat = Math.pow(0.5 + 0.5 * Math.cos(c.phase), 0.8);
  const open = Math.max(0.12, 0.25 + 0.75 * (beat * (1 - c.glide) + c.glide));
  pose.arm = open;
  pose.hand = open;
  pose.sweep = 0;
  pose.lift = 0;
}

const DOWNSTROKE = 0.6;
const RAISED = 0.85;
const LOWERED = -0.6;
function foldingFlap(c) {
  const cycle = fract(c.phase / TAU);
  const ease = (r) => 0.5 - 0.5 * Math.cos(Math.PI * r);
  let angle;
  let sweep;
  let fold;
  if (cycle < DOWNSTROKE) {
    const r = cycle / DOWNSTROKE;
    angle = lerp(RAISED, LOWERED, ease(r));
    sweep = -0.12 * Math.sin(Math.PI * r);
    fold = 0;
    pose.lift = Math.sin(Math.PI * r);
  } else {
    const r = (cycle - DOWNSTROKE) / (1 - DOWNSTROKE);
    angle = lerp(LOWERED, RAISED, ease(r));
    sweep = 1.05 * Math.sin(Math.PI * r);
    fold = 0.45 * Math.sin(Math.PI * r);
    pose.lift = 0;
  }
  const g = c.glide;
  angle = lerp(angle, 0.1, g);
  pose.sweep = lerp(sweep, 0, g);
  pose.arm = Math.cos(angle);
  pose.hand = Math.max(0.2, Math.cos(angle + Math.sign(angle || 1) * fold * (1 - g)));
  pose.lift *= 1 - g;
}

/** Map a screen-space body point back into the rest-pose wing (undo foreshortening and wrist sweep). */
const rest = { u: 0, v: 0 };
function unfold(u, v) {
  const elbow = ROOT + (ELBOW - ROOT) * pose.arm;
  const pivot = 0.03;
  const du = u - pivot;
  const dv = v - elbow;
  const cos = Math.cos(pose.sweep);
  const sin = Math.sin(pose.sweep);
  const beyond = -du * sin + dv * cos;
  if (v <= elbow || beyond < 0) {
    rest.u = u;
    rest.v = ROOT + (v - ROOT) / pose.arm;
  } else {
    rest.u = pivot + du * cos + dv * sin;
    rest.v = ELBOW + beyond / pose.hand;
  }
  return rest;
}

const at = { x: 0, y: 0 };

export default {
  key: "crane",
  label: "Crane",
  swatch: [214, 220, 238],
  hint: "Click to scatter them",
  defaults: {
    ...SHARED_DEFAULTS,
    detail: 1.7,
    density: 0.8,
    speed: 1.5,
    sway: 0,
    spread: 0,
    farthest: 0.35,
    farBias: 1.3,
    grip: 3,
    separation: 150,
    trail: 0,
    shimmer: 0.1,
    sparkle: 0.04,
    wingbeat: 1,
    glide: 1,
    foldFlap: false,
  },
  controls: [
    [
      "Flight",
      [
        { key: "wingbeat", label: "Wingbeat", min: 0.3, max: 2.5, step: 0.05, hint: "How fast they flap." },
        { key: "glide", label: "Glide", min: 0, max: 4, step: 0.05, hint: "How often they stop flapping and glide." },
        { key: "foldFlap", label: "Folding flap", toggle: true, hint: "Off: wings open and close evenly. On: slow downstroke, quick upstroke folding at the wrist." },
      ],
    ],
  ],
  area: 55000,
  scale: 1.45,
  speed: 85,
  trail: { light: [150, 152, 170], dark: [200, 204, 226] },

  create: (c) => ({ ...c, phase: rand(0, TAU), pace: 0.8 + 0.4 * hash3(c.id, 5, 9), glide: 0, glideUntil: 0 }),

  update(c, flock, dt) {
    const t = flock.tuning;
    const now = flock.time;
    const cruise = flock.cruise(c);
    const course = flock.heading + c.bias * t.spread;
    flock.beginForces();
    flock.steer(c, course, cruise, t.grip);
    flock.separate(c, t.separation, 0.45);
    flock.integrate(c, dt, cruise * 1.6);
    if (flock.hasLeft(c)) flock.reenter(c);
    flock.turnToward(c, dt, 2, course);
    if (c.glide < 0.5 && now > c.glideUntil && Math.random() < 0.25 * t.glide * dt) c.glideUntil = now + rand(1, 2.5);
    c.glide += ((now < c.glideUntil ? 1 : 0) - c.glide) * Math.min(1, dt * 3);
    c.phase += dt * TAU * 1.25 * t.wingbeat * c.pace * (1 - 0.92 * c.glide);
  },

  draw(c, pen, flock) {
    if (flock.tuning.foldFlap) foldingFlap(c);
    else evenFlap(c);
    const span = c.span * (1 + 0.025 * pose.lift);
    const body = { x: c.x, y: c.y, heading: c.heading, span, depth: c.depth, id: c.id };
    const neckHalf = Math.max(0.018, (pen.cw * 0.45) / span);
    const headRadius = Math.max(0.032, (pen.cw * 0.6) / span);

    for (const side of [-1, 1]) pen.lineBody(body, -0.2, 0.014 * side, -0.62, 0.022 * side, LEG); // trailing legs
    pen.lineBody(body, 0.47, 0, 0.6, 0, BEAK);

    pen.shape(
      body,
      0.66,
      (u, v, p) => {
        const av = Math.abs(v);
        if (Math.hypot(u - 0.44, av) < headRadius) return p.set(BLACK, Mat.DARK);
        if (u > 0.12 && u < 0.43 && av < neckHalf) return u > 0.28 ? p.set(GREY, Mat.DARK) : p.set(WHITE);
        if (inEllipse(u, av, -0.19, 0, 0.08, 0.045 + 0.4 * Math.max(0, -0.12 - u) ** 1.2)) return p.set(WHITE); // tail bustle
        if (inEllipse(u, av, 0, 0, 0.16, 0.055)) return p.set(WHITE);
        if (av <= ROOT) return false;
        const r = unfold(u, av);
        if (!inWing(r.u, r.v)) return false;
        if (feather.q < 0.42 && feather.s < 0.7) return p.set(BLACK, Mat.DARK); // black secondaries
        const shade = 0.9 + 0.1 * feather.q;
        return p.rgb(WHITE[0] * shade, WHITE[1] * shade, WHITE[2] * shade);
      },
      { light: 0.82 + 0.18 * pose.arm },
    );

    pen.toWorld(body, 0.445, 0, at);
    pen.spot(at.x, at.y, "@", CROWN_FG, CROWN_BG, c.depth);
    if (0.064 * span >= pen.cw * 1.2) {
      const spacing = Math.max(0.032, pen.cw / span);
      for (const side of [-1, 1]) {
        pen.toWorld(body, 0.44, spacing * side, at);
        pen.spot(at.x, at.y, "●", EYE_FG, EYE_BG, c.depth);
      }
    }
  },
};
