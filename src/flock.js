// Flock simulation: spawning, depth, a shared travel course, and the steering helpers
// that each creature's update() combines in its own way.

import { angleDelta, clamp, rand } from "./math.js";

const STARTLE_RADIUS = 240;

/** Settings every creature has. Each creature overrides some of them in its defaults. */
export const SHARED_DEFAULTS = {
  density: 1,
  cornerToCorner: false,
  direction: 49,
  speed: 1,
  sway: 0.04,
  spread: 0.06,
  size: 1,
  farthest: 0.45,
  farBias: 1.6,
  grip: 2,
  separation: 300,
  hueShift: 0,
  shimmer: 0.3,
  sparkle: 0.12,
  fog: 0.75,
  trail: 1,
  trailFade: 1.3,
  grid: 1.05,
  detail: 1.3,
};

export const SHARED_CONTROLS = {
  movement: [
    { key: "density", label: "Density", min: 0.1, max: 4, step: 0.05, hint: "How many are on screen." },
    { key: "cornerToCorner", label: "Corner to corner", toggle: true, hint: "Travel from bottom-left to top-right on any window shape. Off: use Direction." },
    { key: "direction", label: "Direction (°)", min: 0, max: 360, step: 1, disabledWhen: "cornerToCorner", hint: "Travel direction: 0 is right, 90 is up." },
    { key: "speed", label: "Speed", min: 0.1, max: 3, step: 0.05, hint: "How fast they travel." },
    { key: "sway", label: "Sway", min: 0, max: 0.6, step: 0.01, hint: "Slow drift of the whole group off its course." },
    { key: "spread", label: "Spread", min: 0, max: 0.8, step: 0.01, hint: "How far each one's path strays from the group's." },
    { key: "size", label: "Size", min: 0.3, max: 2.5, step: 0.05, hint: "How big they are." },
    { key: "farthest", label: "Farthest depth", min: 0.1, max: 1, step: 0.01, hint: "Scale of the farthest ones. 1 puts everyone at the same depth." },
    { key: "farBias", label: "Far bias", min: 0.3, max: 3, step: 0.05, hint: "Higher puts more of them in the distance." },
    { key: "grip", label: "Hold course", min: 0.2, max: 5, step: 0.05, hint: "How hard they steer back onto course." },
    { key: "separation", label: "Separation", min: 0, max: 1000, step: 10, hint: "How strongly neighbours keep apart." },
  ],
  look: [
    { key: "hueShift", label: "Hue shift (°)", min: -180, max: 180, step: 1, hint: "Rotate all colours around the colour wheel." },
    { key: "shimmer", label: "Shimmer", min: 0, max: 1, step: 0.01, hint: "Brightness roll on iridescent surfaces." },
    { key: "sparkle", label: "Sparkle", min: 0, max: 0.5, step: 0.01, hint: "How often cells flash white." },
    { key: "fog", label: "Distance fade", min: 0, max: 1, step: 0.01, hint: "How much far ones fade into the background." },
    { key: "trail", label: "Trail", min: 0, max: 4, step: 0.05, hint: "How much they leave behind." },
    { key: "trailFade", label: "Trail fade", min: 0.05, max: 6, step: 0.05, hint: "How quickly trails fade." },
    { key: "grid", label: "Grid", min: 0, max: 4, step: 0.05, hint: "Background grid strength." },
    { key: "detail", label: "ASCII detail", min: 0.5, max: 2, step: 0.05, hint: "Higher means smaller characters and finer creatures." },
  ],
};

export class Flock {
  constructor(animal, tuning, fixedCount) {
    this.animal = animal;
    this.tuning = tuning;
    this.fixedCount = fixedCount;
    this.width = 0;
    this.height = 0;
    this.time = 0;
    this.creatures = []; // kept sorted far -> near so nearer ones draw on top
    this.events = []; // trail splashes for the renderer: { x, y, radius, amount }
    this.shared = {}; // creature-wide state (e.g. food pellets)
    this.baseSpan = 120;
    this.force = { x: 0, y: 0 };
    this.nextId = 1;
  }

  resize(width, height) {
    const first = this.width === 0;
    this.width = width;
    this.height = height;
    this.baseSpan = clamp(Math.min(width, height) * 0.2, 80, 190) * this.animal.scale;
    if (first) this.populate(true);
  }

  /** The group's base direction of travel, in radians (screen y points down). */
  get course() {
    return this.tuning.cornerToCorner
      ? Math.atan2(-this.height, this.width)
      : (-this.tuning.direction * Math.PI) / 180;
  }

  /** Course plus slow, shared sway. */
  get heading() {
    const t = this.time;
    return this.course + this.tuning.sway * (Math.sin(t * 0.13) + 0.5 * Math.sin(t * 0.31 + 1.7));
  }

  get targetCount() {
    if (this.fixedCount) return this.fixedCount;
    const sizeFactor = (this.baseSpan / this.animal.scale / 160) ** 2;
    const count = ((this.width * this.height) / (this.animal.area * sizeFactor)) * this.tuning.density;
    return clamp(Math.round(count), 1, this.animal.max ?? 200);
  }

  depthFor(roll) {
    const { farthest, farBias } = this.tuning;
    return farthest + (1 - farthest) * Math.pow(roll, farBias);
  }

  /** Cruising speed in px/s; far creatures move slower on screen. */
  cruise(c) {
    return this.animal.speed * (0.55 + 0.45 * c.depth) * this.tuning.speed;
  }

  step(dt) {
    this.time += dt;
    this.populate(false);
    for (const c of this.creatures) {
      c.depth = this.depthFor(c.roll);
      c.span = this.baseSpan * c.depth * this.tuning.size;
    }
    this.animal.prepare?.(this, dt);
    for (const c of this.creatures) this.animal.update(c, this, dt);
  }

  /** A tap at (x, y): creatures either handle it themselves or get pushed away. */
  startle(x, y) {
    if (this.animal.tap) {
      this.animal.tap(x, y, this);
      return;
    }
    this.events.push({ x, y, radius: 6, amount: 1.4 });
    for (const c of this.creatures) {
      const dx = c.x - x;
      const dy = c.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > STARTLE_RADIUS) continue;
      const strength = 1 - d / STARTLE_RADIUS;
      if (this.animal.startle) {
        this.animal.startle(c, dx / d, dy / d, strength, this);
      } else {
        const push = strength * 420 * c.depth;
        c.vx += (dx / d) * push;
        c.vy += (dy / d) * push;
        c.startledUntil = this.time + rand(0.6, 1.2);
      }
    }
  }

  populate(initial) {
    const target = this.targetCount;
    while (this.creatures.length > target) {
      this.creatures.splice(Math.floor(Math.random() * this.creatures.length), 1);
    }
    while (this.creatures.length < target) {
      const c = this.spawn();
      // On first fill (and for half of later arrivals) start somewhere on screen.
      if (initial || Math.random() < 0.5) {
        c.x = rand(0, this.width);
        c.y = rand(0, this.height);
        this.animal.enter?.(c, this);
      }
      const at = this.creatures.findIndex((other) => other.roll > c.roll);
      this.creatures.splice(at < 0 ? this.creatures.length : at, 0, c);
    }
  }

  spawn() {
    const base = {
      id: this.nextId++,
      roll: Math.random(),
      depth: 1,
      span: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      heading: 0,
      bias: 0,
      startledUntil: 0,
    };
    base.depth = this.depthFor(base.roll);
    base.span = this.baseSpan * base.depth * this.tuning.size;
    const c = this.animal.create(base, this);
    this.reenter(c);
    return c;
  }

  /** Put a creature just off the upwind edge, weighting edges by how much they face the course. */
  reenter(c) {
    const { width, height, course } = this;
    const margin = c.span * 0.6;
    const cos = Math.cos(course);
    const sin = Math.sin(course);
    const sideWeight = height * Math.abs(cos);
    const endWeight = width * Math.abs(sin);
    if (Math.random() * (sideWeight + endWeight) < sideWeight) {
      c.x = cos >= 0 ? -margin : width + margin;
      c.y = rand(0, height);
    } else {
      c.x = rand(0, width);
      c.y = sin <= 0 ? height + margin : -margin;
    }
    const speed = this.cruise(c);
    c.heading = course;
    c.vx = cos * speed;
    c.vy = sin * speed;
    c.bias = rand(-1, 1);
    this.animal.enter?.(c, this);
  }

  /** True once a creature has crossed the downwind edge, or wandered far off-screen. */
  hasLeft(c, margin = c.span) {
    const { width, height, course } = this;
    const cos = Math.cos(course);
    const sin = Math.sin(course);
    const downwind =
      (cos > 0.05 && c.x > width + margin) ||
      (cos < -0.05 && c.x < -margin) ||
      (sin < -0.05 && c.y < -margin) ||
      (sin > 0.05 && c.y > height + margin);
    const lost = c.x < -3 * margin || c.x > width + 3 * margin || c.y < -3 * margin || c.y > height + 3 * margin;
    return downwind || lost;
  }

  // ---- steering helpers: begin, add forces, integrate --------------------------------

  beginForces() {
    this.force.x = 0;
    this.force.y = 0;
    return this.force;
  }

  /** Accelerate toward moving at `speed` along `angle`. */
  steer(c, angle, speed, strength) {
    this.force.x += (Math.cos(angle) * speed - c.vx) * strength;
    this.force.y += (Math.sin(angle) * speed - c.vy) * strength;
  }

  /** Push away from neighbours at a similar depth. `reach` is in body lengths. */
  separate(c, strength = this.tuning.separation, reach = 0.42) {
    if (strength <= 0) return;
    for (const other of this.creatures) {
      if (other === c || Math.abs(other.depth - c.depth) > 0.18) continue;
      const dx = c.x - other.x;
      const dy = c.y - other.y;
      const d = Math.hypot(dx, dy);
      const limit = (c.span + other.span) * reach;
      if (d < limit && d > 0.001) {
        const push = (1 - d / limit) * strength;
        this.force.x += (dx / d) * push;
        this.force.y += (dy / d) * push;
      }
    }
  }

  /** Apply accumulated force, cap speed (higher while startled), move. Returns speed. */
  integrate(c, dt, maxSpeed) {
    c.vx += this.force.x * dt;
    c.vy += this.force.y * dt;
    let speed = Math.hypot(c.vx, c.vy);
    const cap = maxSpeed + (this.time < c.startledUntil ? 300 : 0);
    if (speed > cap) {
      c.vx *= cap / speed;
      c.vy *= cap / speed;
      speed = cap;
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    return speed;
  }

  /** Rotate the body toward `angle` (default: velocity) at up to `rate` rad/s. */
  turnToward(c, dt, rate = 7, angle = Math.atan2(c.vy, c.vx)) {
    const max = rate * dt;
    c.heading += clamp(angleDelta(c.heading, angle), -max, max);
  }
}
