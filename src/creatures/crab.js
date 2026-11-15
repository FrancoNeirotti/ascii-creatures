// Crab: scuttles sideways in bursts, leaves footprints, and bolts with claws raised and
// open when you click near it.

import { Mat } from "../renderer.js";
import { SHARED_DEFAULTS } from "../flock.js";
import { TAU, angleDelta, clamp, inEllipse, rand, segmentDistance, speckle } from "../math.js";

const SHELL = [204, 82, 52];
const SHELL_LIGHT = [232, 132, 92];
const SHELL_DARK = [140, 46, 32];
const CLAW = [214, 92, 56];
const CLAW_TIP = [60, 30, 30];
const LEG = [186, 72, 44];
const EYE_FG = [255, 252, 246];
const EYE_BG = [14, 10, 10];
const LEG_ROOTS = [0.07, -0.01, -0.08, -0.14]; // where each leg pair leaves the shell (u)

const a = { x: 0, y: 0 };

export default {
  key: "crab",
  label: "Crab",
  swatch: SHELL,
  hint: "Click near them to make them bolt",
  defaults: {
    ...SHARED_DEFAULTS,
    detail: 1.7,
    fog: 0.12,
    density: 1.8,
    sway: 0,
    spread: 0,
    farthest: 0.25,
    farBias: 0.7,
    grip: 3,
    separation: 400,
    trail: 1.2,
    trailFade: 0.35,
    shimmer: 0.1,
    sparkle: 0.03,
    burst: 1,
    rest: 1,
    legSpeed: 1,
    scare: 0.55,
  },
  controls: [
    [
      "Scuttling",
      [
        { key: "burst", label: "Burst length", min: 0.2, max: 4, step: 0.05, hint: "How long each scuttle lasts." },
        { key: "rest", label: "Pause length", min: 0, max: 4, step: 0.05, hint: "Pause between scuttles. 0 never stops." },
        { key: "legSpeed", label: "Leg speed", min: 0.2, max: 3, step: 0.05, hint: "How fast the legs step." },
        { key: "scare", label: "Scare", min: 0, max: 3, step: 0.05, hint: "How fast and far they bolt when you click near." },
      ],
    ],
  ],
  area: 70000,
  scale: 0.8,
  speed: 95,
  trail: { light: [176, 146, 104], dark: [206, 178, 136] },

  create: (c) => ({
    ...c,
    running: true,
    until: 0,
    facing: Math.random() < 0.5 ? 1 : -1, // which side leads when walking
    gait: rand(0, TAU),
    alarm: 0,
    fleeDir: 0,
    fleeSpeed: 0,
    fleeFrom: 0,
  }),

  enter(c, flock) {
    c.running = true;
    c.until = flock.time + rand(0.3, 1.2);
    c.heading = flock.course - (c.facing * Math.PI) / 2;
  },

  update(c, flock, dt) {
    const t = flock.tuning;
    const now = flock.time;
    if (now >= c.until) {
      c.running = !c.running || t.rest <= 0;
      c.until = now + (c.running ? rand(0.5, 1.6) * t.burst : rand(0.3, 1.4) * t.rest);
    }

    const cruise = flock.cruise(c);
    const course = flock.heading + c.bias * t.spread;
    const fleeing = now < c.startledUntil;
    const progress = fleeing ? (now - c.fleeFrom) / (c.startledUntil - c.fleeFrom) : 1;
    const travel = fleeing ? c.fleeDir : course;

    flock.beginForces();
    if (fleeing) flock.steer(c, c.fleeDir, Math.max(cruise, c.fleeSpeed * (1 - progress * progress)), 8);
    else flock.steer(c, course, c.running ? cruise : 0, t.grip * 2);
    flock.separate(c);
    const speed = flock.integrate(c, dt, fleeing ? Math.max(cruise * 2, c.fleeSpeed) : cruise * 2);
    if (flock.hasLeft(c)) flock.reenter(c);

    // The body stays 90° off the direction of travel. When fleeing, lead with whichever
    // side is already closer to the escape direction.
    let facing = c.facing;
    if (fleeing && Math.abs(angleDelta(c.heading + (facing * Math.PI) / 2, travel)) > Math.PI / 2) facing = -facing;
    const want = travel - (facing * Math.PI) / 2;
    const rate = (fleeing ? 10 : 3) * dt;
    c.heading += clamp(angleDelta(c.heading, want), -rate, rate);

    c.gait += (dt * speed * t.legSpeed) / Math.max(4, c.span * 0.09);
    c.alarm = Math.max(0, c.alarm - dt * 0.7);
  },

  startle(c, nx, ny, strength, flock) {
    const t = flock.tuning;
    if (t.scare <= 0) return;
    c.fleeDir = Math.atan2(ny, nx) + rand(-0.35, 0.35);
    c.fleeSpeed = flock.cruise(c) * (2.5 + 3 * strength) * t.scare;
    c.fleeFrom = flock.time;
    c.startledUntil = flock.time + (1 + 1.5 * strength) * Math.sqrt(t.scare);
    c.vx = Math.cos(c.fleeDir) * c.fleeSpeed;
    c.vy = Math.sin(c.fleeDir) * c.fleeSpeed;
    c.running = true;
    c.until = c.startledUntil + rand(0.3, 1);
    c.alarm = 1;
  },

  draw(c, pen) {
    const span = c.span;
    const body = { x: c.x, y: c.y, heading: c.heading, span, depth: c.depth, id: c.id };

    // Legs first so the shell covers their roots. Opposite sides step out of phase.
    for (const side of [-1, 1]) {
      LEG_ROOTS.forEach((root, k) => {
        const phase = c.gait + k * Math.PI * 0.5 + (side > 0 ? Math.PI : 0);
        const lift = Math.max(0, Math.sin(phase));
        const splay = (k - 1.5) * 0.06;
        const kneeU = root + splay * 0.6;
        const kneeV = (0.36 - 0.03 * lift) * side;
        const footU = root + splay * 1.4 + 0.04 * Math.cos(phase);
        const footV = (0.52 + 0.03 * Math.cos(phase) - 0.06 * lift) * side;
        pen.lineBody(body, root, 0.22 * side, kneeU, kneeV, LEG);
        pen.lineBody(body, kneeU, kneeV, footU, footV, LEG);
        if (lift < 0.05 && Math.cos(phase) > 0.9) {
          pen.toWorld(body, footU, footV, a);
          pen.shed(a.x, a.y, 0.12 * c.depth); // footprint as the foot plants
        }
      });
    }

    const alarm = c.alarm;
    pen.shape(body, 0.62, (u, v, p) => {
      const av = Math.abs(v);

      // Shell: a superellipse whose front edge is scalloped.
      const across = av / 0.27;
      const scallop = u > 0.06 ? 0.06 * (0.5 + 0.5 * Math.cos(across * Math.PI * 7)) : 0;
      if (Math.pow(Math.abs(u / 0.17), 2.2) + Math.pow(across, 2.4) <= 1 - scallop) {
        if (speckle(u, v, 0.05, 0.012, c.id)) return p.set(SHELL_DARK, Mat.DARK);
        if (Math.abs(av - 0.08) < 0.01 && u > -0.08 && u < 0.05) return p.set(SHELL_DARK, Mat.DARK, "|");
        if (inEllipse(u, av, 0.01, 0, 0.1, 0.13)) return p.set(SHELL_LIGHT);
        return p.set(SHELL);
      }

      // Arm from shell to pincer; raised and spread when alarmed.
      if (segmentDistance(u, av, 0.12, 0.17, 0.26 + 0.07 * alarm, 0.25 + 0.05 * alarm) < 0.034) return p.set(CLAW);

      // Pincer: a rotated ellipse with a wedge cut out that opens with alarm.
      const cu = 0.34 + 0.08 * alarm;
      const cv = 0.19 + 0.04 * alarm;
      const scale = 1 + 0.15 * alarm;
      const tilt = 0.55;
      const m = ((u - cu) * Math.cos(tilt) - (av - cv) * Math.sin(tilt)) / scale;
      const e = ((u - cu) * Math.sin(tilt) + (av - cv) * Math.cos(tilt)) / scale;
      if ((m / 0.09) ** 2 + (e / 0.055) ** 2 <= 1) {
        const gap = 0.15 + 0.55 * alarm;
        if (m > 0.02 && Math.abs(e) < gap * (m - 0.02)) return false;
        return m > 0.06 ? p.set(CLAW_TIP, Mat.DARK) : p.set(CLAW);
      }
      return false;
    });

    const eyeSpacing = Math.min(0.14, Math.max(0.06, (pen.cw * 0.55) / span));
    for (const side of [-1, 1]) {
      pen.toWorld(body, 0.2, eyeSpacing * side, a);
      pen.spot(a.x, a.y, "●", EYE_FG, EYE_BG, c.depth);
    }
  },
};
