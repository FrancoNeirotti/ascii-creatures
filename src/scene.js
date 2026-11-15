// Ties a Flock to an AsciiRenderer on one canvas: fixed-timestep loop, resizing,
// clicks, pausing off-screen, and a still frame for reduced-motion users.

import { Flock } from "./flock.js";
import { AsciiRenderer } from "./renderer.js";

const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 4;

export class CreatureScene {
  constructor(canvas, { creature, count, theme = "dark", tuning } = {}) {
    this.canvas = canvas;
    this.count = count;
    this.raf = 0;
    this.last = 0;
    this.pending = 0;
    this.visible = true;
    this.disposed = false;

    this.creature = creature;
    this.tuning = { ...creature.defaults, ...tuning };
    this.flock = new Flock(creature, this.tuning, count);
    this.renderer = new AsciiRenderer(canvas, this.tuning);
    this.renderer.setFontFamily(getComputedStyle(canvas).fontFamily);
    this.renderer.setAnimal(creature, this.tuning);
    this.renderer.setTheme(theme);

    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.visible = entries.at(-1).isIntersecting;
      this.schedule();
    });
    this.intersectionObserver.observe(canvas);
    this.reducedMotion.addEventListener("change", this.onMotionPreference);
    window.addEventListener("pointerdown", this.onPointerDown, { passive: true });

    this.resize();
    document.fonts?.ready.then(() => {
      if (!this.disposed && this.reducedMotion.matches) this.drawStill();
    });
    this.schedule();
  }

  frame = (now) => {
    // rAF timestamps can precede the performance.now() taken in schedule(): clamp at 0.
    const elapsed = Math.max(0, Math.min(0.1, (now - this.last) / 1000));
    this.last = now;
    this.raf = requestAnimationFrame(this.frame);
    if (this.flock.width === 0) return; // no valid size yet: don't spawn at (0, 0)
    this.pending += elapsed;
    let steps = 0;
    while (this.pending >= STEP && steps < MAX_STEPS_PER_FRAME) {
      this.flock.step(STEP);
      this.pending -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.pending = 0; // drop time rather than spiral
    this.renderer.render(this.flock, elapsed);
  };

  onMotionPreference = () => {
    if (this.reducedMotion.matches) {
      cancelAnimationFrame(this.raf);
      this.drawStill();
    } else {
      this.schedule();
    }
  };

  onPointerDown = (event) => {
    if (this.reducedMotion.matches || event.target !== this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.flock.startle(event.clientX - rect.left, event.clientY - rect.top);
  };

  setCreature(creature, tuning) {
    this.creature = creature;
    this.tuning = { ...creature.defaults, ...tuning };
    this.flock = new Flock(creature, this.tuning, this.count);
    this.renderer.setAnimal(creature, this.tuning);
    this.resize();
  }

  /** Change one tuning value and refresh whatever depends on it. */
  set(key, value) {
    this.tuning[key] = value;
    if (key === "detail") this.resize();
    else if (key === "hueShift" || key === "grid") this.renderer.restyle();
    if (this.reducedMotion.matches) this.drawStill();
  }

  setTheme(theme) {
    this.renderer.setTheme(theme);
    if (this.reducedMotion.matches) this.drawStill();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(rect.width, rect.height, dpr);
    this.flock.resize(rect.width, rect.height);
    if (this.reducedMotion.matches) this.drawStill();
  }

  schedule() {
    cancelAnimationFrame(this.raf);
    if (this.disposed || !this.visible || this.reducedMotion.matches) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Reduced motion: settle the scene for a few simulated seconds and show one frame. */
  drawStill() {
    if (this.flock.time < 4) for (let i = 0; i < 240; i++) this.flock.step(STEP);
    this.renderer.render(this.flock, STEP);
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.reducedMotion.removeEventListener("change", this.onMotionPreference);
    window.removeEventListener("pointerdown", this.onPointerDown);
  }
}
