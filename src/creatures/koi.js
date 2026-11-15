// Koi: a 14-node spine that follows the head, a travelling tail wave, five classic
// varieties (kohaku, sanke, showa, ogon, chagoi), and food pellets you drop by clicking.

import { Mat } from "../renderer.js";
import { SHARED_DEFAULTS } from "../flock.js";
import { TAU, angleDelta, clamp, hash3, lerp, rand, smoothRange } from "../math.js";

const NODES = 14;
const FOOD_LIFETIME = 14; // seconds
const MAX_FOOD = 60;
const MAX_BEND = 0.22; // max angle between spine segments (rad)
const VARIETIES = ["kohaku", "sanke", "showa", "ogon", "chagoi"];

const WHITE = [244, 240, 230];
const WHITE_ON_LIGHT = [222, 217, 206];
const RED = [222, 66, 40];
const INK = [34, 34, 40];
const GOLD = [238, 182, 64];
const CHAGOI = [236, 124, 44];
const FIN = [236, 226, 214];
const FIN_ON_LIGHT = [206, 196, 182];
const PELLET = [232, 178, 104];
const EYE_BG = [14, 12, 16];
const EYE_FG = [255, 252, 246];

/** Half-width (in body lengths) at arc position s: 0 = snout, 1 = tail tip. */
function halfWidth(s) {
  if (s < 0.12) return 0.1 * Math.pow(Math.sin(((s / 0.12) * Math.PI) / 2), 0.6);
  if (s < 0.35) return 0.1 + 0.016 * Math.sin(((s - 0.12) / 0.23) * (Math.PI / 2));
  if (s < 0.82) return 0.116 - 0.088 * smoothRange(0.35, 0.82, s);
  return 0.028 + ((s - 0.82) / 0.18) * 0.1; // tail fan
}

/** Smooth blotch pattern for the red and black patches. */
function patches(s, side, seed) {
  return (
    Math.sin(s * 11 + seed) * Math.cos(side * 22 + seed * 1.3) +
    0.6 * Math.sin(s * 23 + side * 15 + seed * 2.1) +
    0.35 * Math.sin(s * 5 - seed * 0.7)
  );
}

const foodOf = (flock) => (flock.shared.food ??= []);

/** Nearest pellet within `range`; `nearness` becomes 1 at the pellet, 0 at the range edge. */
let nearness = 0;
function nearestFood(c, flock, range) {
  let best = null;
  let bestDistance = range;
  for (const f of foodOf(flock)) {
    const d = Math.hypot(f.x - c.x, f.y - c.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = f;
    }
  }
  nearness = best ? 1 - bestDistance / range : 0;
  return best;
}

function drawFood(flock, pen) {
  for (const f of foodOf(flock)) {
    const age = (flock.time - f.born) / FOOD_LIFETIME;
    pen.dot(f.x, f.y, age < 0.7 ? "o" : ".", PELLET, Math.min(0.9, Math.max(0, age - 0.5) * 1.6));
  }
}

const bent = new Float32Array(NODES * 2); // spine with the tail wave applied
const arc = new Float32Array(NODES); // cumulative length along `bent`

function drawKoi(c, pen, flock) {
  const t = flock.tuning;
  const span = c.span;
  const nodes = c.nodes;
  const variety = VARIETIES[c.variety];
  const seed = c.id * 1.37;
  const white = pen.palette.base === "light" ? WHITE_ON_LIGHT : WHITE;
  const fin = pen.palette.base === "light" ? FIN_ON_LIGHT : FIN;

  // Tail wave: sideways offset growing toward the tail, travelling backwards.
  for (let k = 0; k < NODES; k++) {
    const f = k / (NODES - 1);
    const prev = Math.max(0, k - 1);
    const next = Math.min(NODES - 1, k + 1);
    let dx = nodes[prev * 2] - nodes[next * 2];
    let dy = nodes[prev * 2 + 1] - nodes[next * 2 + 1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const offset = span * 0.06 * Math.pow(f, 1.6) * Math.sin(c.phase - f * 4.5) * Math.min(1.5, t.tailBeat);
    bent[k * 2] = nodes[k * 2] - dy * offset;
    bent[k * 2 + 1] = nodes[k * 2 + 1] + dx * offset;
    arc[k] = k > 0 ? arc[k - 1] + Math.hypot(bent[k * 2] - bent[k * 2 - 2], bent[k * 2 + 1] - bent[k * 2 - 1]) : 0;
  }
  const total = arc[NODES - 1] || 1;
  const mid = NODES >> 1;
  const body = { x: bent[mid * 2], y: bent[mid * 2 + 1], heading: c.heading, span, depth: c.depth, id: c.id };
  const finWave = 0.8 + 0.2 * Math.sin(c.phase * 0.7);

  pen.shape(body, 0.72, (_u, _v, p, px, py) => {
    // Project the sample onto the bent spine: s = arc position, side = signed distance.
    let best = Infinity;
    let s = 0;
    let side = 0;
    let beyond = 0;
    for (let k = 0; k < NODES - 1; k++) {
      const ax = bent[k * 2];
      const ay = bent[k * 2 + 1];
      const ex = bent[k * 2 + 2] - ax;
      const ey = bent[k * 2 + 3] - ay;
      const len2 = ex * ex + ey * ey || 1;
      const proj = ((px - ax) * ex + (py - ay) * ey) / len2;
      const along = clamp(proj, 0, 1);
      const len = Math.sqrt(len2);
      const cross = ex * (py - ay) - ey * (px - ax);
      if (k === NODES - 2 && proj > 1) {
        const perp = Math.abs(cross) / len;
        if (perp * perp < best) {
          best = perp * perp;
          s = 1;
          beyond = ((proj - 1) * len) / span;
          side = (perp / span) * (cross >= 0 ? 1 : -1);
        }
        continue;
      }
      const d2 = (px - ax - ex * along) ** 2 + (py - ay - ey * along) ** 2;
      if (d2 < best) {
        best = d2;
        s = (arc[k] + along * len) / total;
        side = (Math.sqrt(d2) / span) * (cross >= 0 ? 1 : -1);
        beyond = 0;
      }
    }
    // Glyph seeds follow the bending spine rather than the straight body axis.
    p.u = s;
    p.v = side;
    if (beyond > 0) return false;

    const across = Math.abs(side);
    const half = halfWidth(s);
    if (across > half) {
      const pectoral = s > 0.17 && s < 0.34 && across < half + 0.1 * finWave * Math.sin(((s - 0.17) / 0.17) * Math.PI);
      const pelvic = s > 0.48 && s < 0.6 && across < half + 0.05 * Math.sin(((s - 0.48) / 0.12) * Math.PI);
      return (pectoral || pelvic) && p.set(fin, Mat.GLOW, "-=");
    }
    if (s > 0.82) {
      // Forked tail fin.
      if (s > 0.93 && across < ((s - 0.93) / 0.07) * 0.06) return false;
      return p.set(fin, Mat.GLOW, s > 0.9 ? "/\\" : "=");
    }
    const red = patches(s, side, seed) > 0.25;
    switch (variety) {
      case "kohaku":
        return red && s < 0.8 ? p.set(RED) : p.set(white);
      case "sanke":
        if (hash3(Math.round(s * 30), Math.round(side * 60), c.id) > 0.9 && s > 0.15) return p.set(INK, Mat.DARK);
        return red && s < 0.8 ? p.set(RED) : p.set(white);
      case "showa":
        if (patches(s, side, seed + 4) > 0.55) return p.set(white);
        return red ? p.set(RED) : p.set(INK, Mat.DARK, "%#");
      case "ogon":
        return p.set(GOLD, Mat.IRIDESCENT);
      default: {
        const shade = 1 - 0.15 * (across / half);
        return p.rgb(CHAGOI[0] * shade, CHAGOI[1] * shade, CHAGOI[2], Mat.IRIDESCENT);
      }
    }
  });

  // Eyes, either side of the head, once they are at least a cell apart.
  const eyeOffset = halfWidth(0.09) * 0.55 * span;
  if (2 * eyeOffset >= pen.cw) {
    const target = 0.09 * total;
    let k = 0;
    while (k < NODES - 2 && arc[k + 1] < target) k++;
    const len = arc[k + 1] - arc[k] || 1;
    const f = (target - arc[k]) / len;
    const dx = (bent[k * 2 + 2] - bent[k * 2]) / len;
    const dy = (bent[k * 2 + 3] - bent[k * 2 + 1]) / len;
    const x = bent[k * 2] + dx * f * len;
    const y = bent[k * 2 + 1] + dy * f * len;
    for (const side of [-1, 1]) pen.spot(x - dy * eyeOffset * side, y + dx * eyeOffset * side, "●", EYE_FG, EYE_BG, c.depth);
  }
  pen.shed(bent[(NODES - 2) * 2], bent[(NODES - 2) * 2 + 1], 0.02 * c.depth);
}

export default {
  key: "koi",
  label: "Koi",
  swatch: [244, 196, 44],
  hint: "Click the water to drop food",
  defaults: {
    ...SHARED_DEFAULTS,
    fog: 0.64,
    density: 1.6,
    speed: 1.6,
    spread: 0,
    sway: 0,
    farthest: 0.33,
    farBias: 1.3,
    grip: 2.65,
    separation: 780,
    trail: 4,
    trailFade: 0.4,
    shimmer: 0.35,
    sparkle: 0.08,
    meander: 0.4,
    foodRange: 200,
    tailBeat: 1,
  },
  controls: [
    [
      "Swimming",
      [
        { key: "meander", label: "Meander", min: 0, max: 3, step: 0.05, hint: "How much they weave in lazy S-curves." },
        { key: "tailBeat", label: "Tail beat", min: 0.2, max: 3, step: 0.05, hint: "How fast and wide the tail swishes." },
      ],
    ],
    [
      "Feeding",
      [
        {
          key: "foodRange",
          label: "Food range",
          min: 0,
          max: 500,
          step: 10,
          hint: "How close a koi has to be to notice food you drop. The closer it is, the harder it turns and the faster it swims over.",
        },
      ],
    ],
  ],
  area: 75000,
  scale: 1.15,
  speed: 50,
  trail: { light: [90, 140, 190], dark: [110, 170, 220] },

  create: (c) => ({
    ...c,
    nodes: new Float32Array(NODES * 2),
    phase: rand(0, TAU),
    variety: Math.floor(hash3(c.id, 7, 3) * VARIETIES.length),
  }),

  /** Lay the spine out straight behind the head. */
  enter(c) {
    const gap = c.span / (NODES - 1);
    for (let k = 0; k < NODES; k++) {
      c.nodes[k * 2] = c.x - Math.cos(c.heading) * gap * k;
      c.nodes[k * 2 + 1] = c.y - Math.sin(c.heading) * gap * k;
    }
  },

  /** Pellets drift to a stop and dissolve. */
  prepare(flock, dt) {
    const food = foodOf(flock);
    const drag = Math.exp(-dt * 0.8);
    for (const f of food) {
      f.vx *= drag;
      f.vy *= drag;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    for (let k = food.length - 1; k >= 0; k--) {
      if (flock.time - food[k].born > FOOD_LIFETIME) food.splice(k, 1);
    }
  },

  /** A click scatters a handful of pellets. */
  tap(x, y, flock) {
    const food = foodOf(flock);
    const count = 7 + Math.floor(Math.random() * 5);
    for (let k = 0; k < count; k++) {
      const a = rand(0, TAU);
      const r = 70 * Math.sqrt(Math.random());
      const f = { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: Math.cos(a) * rand(4, 14), vy: Math.sin(a) * rand(4, 14), born: flock.time };
      food.push(f);
      flock.events.push({ x: f.x, y: f.y, radius: 1, amount: 0.5 });
    }
    if (food.length > MAX_FOOD) food.splice(0, food.length - MAX_FOOD);
  },

  update(c, flock, dt) {
    const t = flock.tuning;
    const now = flock.time;
    const food = nearestFood(c, flock, t.foodRange);
    const eager = food ? 0.25 + 0.75 * nearness : 0;
    let aim = food
      ? Math.atan2(food.y - c.y, food.x - c.x)
      : flock.heading + c.bias * t.spread + t.meander * 0.6 * Math.sin(now * 0.35 + c.id * 1.7);

    // Bend the aim away from crowded neighbours.
    const force = flock.beginForces();
    flock.separate(c, t.separation, 0.5);
    if (force.x || force.y) {
      const cruise = flock.cruise(c);
      aim = Math.atan2(Math.sin(aim) * cruise + force.y * 0.3, Math.cos(aim) * cruise + force.x * 0.3);
    }
    const turn = lerp(0.9 * t.grip, 2.6, eager) * dt;
    c.heading += clamp(angleDelta(c.heading, aim), -turn, turn);

    const speed = flock.cruise(c) * lerp(0.85 + 0.25 * Math.sin(now * 0.5 + c.id), 1.8, eager);
    c.vx = Math.cos(c.heading) * speed;
    c.vy = Math.sin(c.heading) * speed;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.phase += dt * (2 + speed / 25) * t.tailBeat;

    // Spine follows the head, each joint bending at most MAX_BEND.
    const nodes = c.nodes;
    const gap = c.span / (NODES - 1);
    nodes[0] = c.x;
    nodes[1] = c.y;
    let back = c.heading + Math.PI;
    for (let k = 1; k < NODES; k++) {
      let a = Math.atan2(nodes[k * 2 + 1] - nodes[k * 2 - 1], nodes[k * 2] - nodes[k * 2 - 2]);
      a = back + clamp(angleDelta(back, a), -MAX_BEND, MAX_BEND);
      nodes[k * 2] = nodes[k * 2 - 2] + Math.cos(a) * gap;
      nodes[k * 2 + 1] = nodes[k * 2 - 1] + Math.sin(a) * gap;
      back = a;
    }

    if (food && Math.hypot(food.x - c.x, food.y - c.y) < c.span * 0.1 + 6) {
      const all = foodOf(flock);
      all.splice(all.indexOf(food), 1);
      flock.events.push({ x: food.x, y: food.y, radius: 1, amount: 0.7 });
    }
    if (flock.hasLeft(c, c.span * 1.3)) flock.reenter(c);
  },

  drawAll(flock, pen) {
    drawFood(flock, pen);
    for (const c of flock.creatures) drawKoi(c, pen, flock);
  },
};
