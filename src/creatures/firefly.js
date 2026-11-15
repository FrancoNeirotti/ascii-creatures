// Firefly: a small beetle that wanders and flashes. The glow feeds the trail field,
// so flashes leave a soft halo that fades.

import { Mat } from "../renderer.js";
import { SHARED_DEFAULTS } from "../flock.js";
import { TAU, clamp, hash3, inEllipse, lerp, rand } from "../math.js";

const LANTERN_DIM = [96, 84, 40];
const LANTERN_LIT = [255, 236, 118];
const THORAX = [44, 36, 30];
const HOOD = [206, 92, 58];
const WING = [190, 200, 220];

const lantern = { x: 0, y: 0 };

export default {
  key: "firefly",
  label: "Firefly",
  swatch: LANTERN_LIT,
  hint: "Click to scatter them",
  hide: ["shimmer"],
  defaults: {
    ...SHARED_DEFAULTS,
    fog: 0.5,
    density: 1.6,
    speed: 0.7,
    sway: 0.3,
    spread: 0.6,
    size: 0.9,
    farthest: 0.25,
    farBias: 1.2,
    grip: 1,
    separation: 150,
    shimmer: 0,
    sparkle: 0,
    trail: 2.2,
    trailFade: 0.9,
    blinkRate: 1,
    glow: 1,
    wander: 1,
  },
  controls: [
    [
      "Glow",
      [
        { key: "blinkRate", label: "Blink rate", min: 0.1, max: 4, step: 0.05, hint: "How often each one flashes." },
        { key: "glow", label: "Halo", min: 0, max: 3, step: 0.05, hint: "How much light a flash leaves around it." },
        { key: "wander", label: "Wander", min: 0, max: 3, step: 0.05, hint: "How much each one meanders." },
      ],
    ],
  ],
  area: 26000,
  scale: 0.45,
  speed: 38,
  trail: { light: [214, 168, 36], dark: [255, 214, 90] },

  create: (c) => ({
    ...c,
    blink: rand(0, TAU),
    rate: 0.7 + 0.6 * hash3(c.id, 3, 1),
    turn: 0,
    wing: rand(0, TAU),
    lit: 0,
  }),

  update(c, flock, dt) {
    const t = flock.tuning;
    const cruise = flock.cruise(c);
    c.turn += rand(-1, 1) * dt * 3 * t.wander;
    c.turn = clamp(c.turn * Math.exp(-dt * 0.5), -1.5, 1.5);
    const aim = flock.heading + c.bias * t.spread + c.turn;

    flock.beginForces();
    flock.steer(c, aim, cruise * (0.6 + 0.4 * Math.sin(flock.time * 0.7 + c.id)), t.grip);
    flock.separate(c);
    flock.integrate(c, dt, cruise * 2);
    if (flock.hasLeft(c)) flock.reenter(c);
    flock.turnToward(c, dt, 4);

    // Short, sharp flashes: a high power of a sine keeps most of the cycle dark.
    c.blink += dt * t.blinkRate * c.rate * 1.6;
    c.lit = Math.pow(Math.max(0, Math.sin(c.blink)), 8);
    c.wing += dt * TAU * 12;
  },

  draw(c, pen, flock) {
    const lit = c.lit;
    const body = { x: c.x, y: c.y, heading: c.heading, span: c.span, depth: c.depth, id: c.id };
    const wingOpen = 0.6 + 0.4 * Math.sin(c.wing);

    pen.shape(
      body,
      0.45,
      (u, v, p) => {
        const av = Math.abs(v);
        if (inEllipse(u, av, -0.13, 0, 0.15, 0.075)) {
          // Mid-flash the lantern is a solid bright cell; otherwise a dim glow.
          if (lit > 0.4) return p.rgb(LANTERN_LIT[0], LANTERN_LIT[1], LANTERN_LIT[2] * (0.6 + 0.4 * lit), Mat.HIGHLIGHT, "@*");
          return p.rgb(
            lerp(LANTERN_DIM[0], LANTERN_LIT[0], lit),
            lerp(LANTERN_DIM[1], LANTERN_LIT[1], lit),
            lerp(LANTERN_DIM[2], LANTERN_LIT[2], lit),
            Mat.GLOW,
            ".:*",
          );
        }
        if (inEllipse(u, av, 0.14, 0, 0.04, 0.045)) return p.set(HOOD);
        if (inEllipse(u, av, 0.05, 0, 0.07, 0.06)) return p.set(THORAX, Mat.DARK);
        if (inEllipse(u, av, -0.02, 0.12 * wingOpen, 0.16, 0.07 * wingOpen + 0.01)) return p.set(WING, Mat.LINE, "~-");
        return false;
      },
      { light: 0.8 + 0.2 * lit },
    );

    if (lit > 0.05) {
      pen.toWorld(body, -0.13, 0, lantern);
      pen.stamp(lantern.x, lantern.y, 2, 0.5 * lit * flock.tuning.glow * c.depth * pen.frameScale);
    }
  },
};
