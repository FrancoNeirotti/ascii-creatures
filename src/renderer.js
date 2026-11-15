// ASCII renderer.
//
// The canvas is divided into a grid of character cells. Each frame, creatures "paint"
// cells by describing their shape as a function of body coordinates; the renderer
// samples that function at five points per cell and turns coverage + material into a
// glyph, a text colour and (for solid cells) a background fill. A separate energy field
// holds trails (wakes, footprints, dust) that diffuse and fade over time.

import { clamp, hash3, hueRotation, lineGlyph } from "./math.js";

/** Material decides how a covered cell is turned into a glyph and colours. */
export const Mat = Object.freeze({
  BODY: 0, //       filled cell, glyph density follows brightness
  DARK: 1, //       filled cell, light glyph on a dark fill (outlines, markings)
  HIGHLIGHT: 2, //  filled cell, dark glyph on a bright fill (spots, specular)
  IRIDESCENT: 3, // like BODY, but brightness rolls with the shimmer setting
  GLOW: 4, //       dim fill, bright glyph (light sources)
  LINE: 5, //       glyph only, no fill (fins, wings seen edge-on, filaments)
  THORAX: 6, //     filled cell, bright glyph from "8#@" (dense bodies)
  SHEEN: 7, //      darkened fill, brightened glyph (glossy skin, translucent bells)
});

const RAMPS = {
  [Mat.BODY]: ".:;+=*%#",
  [Mat.DARK]: "#%@",
  [Mat.HIGHLIGHT]: "o*",
  [Mat.IRIDESCENT]: ".:;+=*%#",
  [Mat.GLOW]: ".:*",
  [Mat.LINE]: ".:+*",
  [Mat.THORAX]: "8#@",
  [Mat.SHEEN]: ".:*",
};
const EDGE_FAINT = ".',`";
const EDGE_FIRM = ":;";
const SPARKS = [
  [255, 255, 255],
  [228, 246, 255],
  [200, 244, 255],
];
// Four sub-cell sample points (fractions of a cell), in addition to the centre.
const CORNERS = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];

const EMPTY = 0;
const SOLID = 1;
const SOFT = 2;
const TRAIL_LEVELS = 6;
const MAX_ENERGY = 1.6;

// `base` is the light/dark family a theme belongs to, for per-theme creature colours.
export const THEMES = {
  dark: { base: "dark", background: [8, 9, 14], grid: [255, 255, 255, 0.055], trailAlpha: 0.85, ink: [150, 160, 200] },
  black: { base: "dark", background: [0, 0, 0], grid: [255, 255, 255, 0.045], trailAlpha: 0.85, ink: [150, 160, 200] },
  light: { base: "light", background: [244, 241, 233], grid: [30, 34, 60, 0.07], trailAlpha: 0.7, ink: [42, 42, 59] },
};

const pack = (r, g, b) =>
  (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255);
const cssColor = (c) => `rgb(${c >>> 16},${(c >>> 8) & 255},${c & 255})`;

/** What a shape function reports for one sample point. Returned `true` from set()/rgb(). */
class Paint {
  r = 0;
  g = 0;
  b = 0;
  mat = Mat.BODY;
  glyphs = null;
  // Body-space coordinates of the sample. Shapes may overwrite them with their own
  // parameterisation (e.g. arc length along a bending spine) to keep glyphs stable.
  u = 0;
  v = 0;

  set(color, mat = Mat.BODY, glyphs = null) {
    return this.rgb(color[0], color[1], color[2], mat, glyphs);
  }
  rgb(r, g, b, mat = Mat.BODY, glyphs = null) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.mat = mat;
    this.glyphs = glyphs;
    return true;
  }
  copy(other) {
    this.r = other.r;
    this.g = other.g;
    this.b = other.b;
    this.mat = other.mat;
    this.glyphs = other.glyphs;
    this.u = other.u;
    this.v = other.v;
  }
}

export class AsciiRenderer {
  constructor(canvas, tuning) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas is unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.tuning = tuning;
    this.backdrop = document.createElement("canvas");
    this.paint = new Paint();
    this.hit = new Paint();
    this.rgbOut = [0, 0, 0];

    this.cw = 12; // cell width, CSS px
    this.ch = 18; // cell height, CSS px
    this.cols = 0;
    this.rows = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.time = 0;
    this.frameScale = 1;
    this.theme = "dark";
    this.palette = THEMES.dark;
    this.animal = null;
    this.fontFamily = "ui-monospace, Menlo, Consolas, monospace";
    this.hue = hueRotation(0);
    this.hueOn = false;
    this.trailStyles = [];
    this.allocate(0);
  }

  allocate(cells) {
    this.energy = new Float32Array(cells);
    this.energyNext = new Float32Array(cells);
    this.flag = new Uint8Array(cells);
    this.fill = new Uint32Array(cells);
    this.color = new Uint32Array(cells);
    this.glyph = new Uint16Array(cells);
  }

  setFontFamily(family) {
    if (family) this.fontFamily = family;
  }

  setTheme(name) {
    this.theme = name;
    this.palette = THEMES[name];
    this.restyle();
  }

  setAnimal(animal, tuning) {
    this.animal = animal;
    this.tuning = tuning;
    this.energy.fill(0);
    this.restyle();
  }

  /** Recompute everything derived from theme, hue shift and grid strength. */
  restyle() {
    this.hue = hueRotation(this.tuning.hueShift);
    this.hueOn = this.tuning.hueShift % 360 !== 0;
    const base = this.animal?.trail?.[this.palette.base] ?? this.palette.ink;
    const [r, g, b] = this.tint(base[0], base[1], base[2]).map(Math.round);
    this.trailStyles = Array.from(
      { length: TRAIL_LEVELS },
      (_, i) => `rgba(${r},${g},${b},${((this.palette.trailAlpha * (i + 1)) / TRAIL_LEVELS).toFixed(3)})`,
    );
    this.paintBackdrop();
  }

  /** Apply the hue shift. Returns a shared array: read it before calling tint again. */
  tint(r, g, b) {
    const out = this.rgbOut;
    if (!this.hueOn) {
      out[0] = r;
      out[1] = g;
      out[2] = b;
      return out;
    }
    const m = this.hue;
    out[0] = m[0] * r + m[1] * g + m[2] * b;
    out[1] = m[3] * r + m[4] * g + m[5] * b;
    out[2] = m[6] * r + m[7] * g + m[8] * b;
    return out;
  }

  /** Blend a colour toward the background by `amount` (0 = unchanged) and pack it. */
  fade(r, g, b, amount) {
    const [br, bg, bb] = this.palette.background;
    return pack(r + (br - r) * amount, g + (bg - g) * amount, b + (bb - b) * amount);
  }

  fogFor(depth) {
    return (1 - depth) * this.tuning.fog;
  }

  resize(width, height, dpr) {
    const oldCols = this.cols;
    const oldRows = this.rows;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.cw = clamp(Math.round(width / 124 / this.tuning.detail), 5, 24);
    this.ch = Math.round(this.cw * 1.45);
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);
    this.canvas.width = this.backdrop.width = Math.round(width * dpr);
    this.canvas.height = this.backdrop.height = Math.round(height * dpr);
    if (this.cols !== oldCols || this.rows !== oldRows) this.allocate(this.cols * this.rows);
    this.paintBackdrop();
  }

  /** Background colour and cell grid, cached on an offscreen canvas. */
  paintBackdrop() {
    const { width, height, dpr, cw, ch } = this;
    if (!width) return;
    const ctx = this.backdrop.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = cssColor(pack(...this.palette.background));
    ctx.fillRect(0, 0, this.backdrop.width, this.backdrop.height);
    const [r, g, b, a] = this.palette.grid;
    ctx.strokeStyle = `rgba(${r},${g},${b},${(a * this.tuning.grid).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += cw) {
      const px = Math.round(x * dpr) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height * dpr);
    }
    for (let y = 0; y <= height; y += ch) {
      const py = Math.round(y * dpr) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(width * dpr, py);
    }
    ctx.stroke();
  }

  render(flock, dt) {
    if (!this.cols) return;
    const { ctx, dpr } = this;
    this.time = flock.time;
    // Creatures leave trail while drawing; scale it by frame length so the amount
    // is the same at 60 Hz and 144 Hz.
    this.frameScale = dt * 60;

    for (const e of flock.events) this.stamp(e.x, e.y, e.radius, e.amount);
    flock.events.length = 0;
    this.diffuse(dt);
    this.flag.fill(EMPTY);

    const animal = flock.animal;
    if (animal.drawAll) animal.drawAll(flock, this);
    else for (const c of flock.creatures) animal.draw(c, this, flock);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.backdrop, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawTrail();
    ctx.font = `600 ${Math.round(this.ch * 0.74)}px ${this.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.drawCells();
  }

  // ---- drawing API used by creatures ------------------------------------------------

  /** Body point (u along heading, v to its right, both in body lengths) to screen space. */
  toWorld(body, u, v, out) {
    const cos = Math.cos(body.heading);
    const sin = Math.sin(body.heading);
    out.x = body.x + (u * cos - v * sin) * body.span;
    out.y = body.y + (u * sin + v * cos) * body.span;
    return out;
  }

  cellIndex(x, y) {
    const col = Math.floor(x / this.cw);
    const row = Math.floor(y / this.ch);
    return col < 0 || row < 0 || col >= this.cols || row >= this.rows ? -1 : row * this.cols + col;
  }

  /**
   * Rasterise a creature. `sampler(u, v, paint, px, py)` returns true and fills `paint`
   * when the body point (u, v) is inside the shape. `reach` bounds the shape, in body lengths.
   */
  shape(body, reach, sampler, { light = 1, tilt = 0, fog = this.fogFor(body.depth) } = {}) {
    const { cw, ch, cols, rows, flag, fill, color, glyph, paint, hit, time } = this;
    const { shimmer, sparkle } = this.tuning;
    const cos = Math.cos(body.heading);
    const sin = Math.sin(body.heading);
    const span = body.span;
    const radius = reach * span;
    const c0 = Math.max(0, Math.floor((body.x - radius) / cw));
    const c1 = Math.min(cols - 1, Math.floor((body.x + radius) / cw));
    const r0 = Math.max(0, Math.floor((body.y - radius) / ch));
    const r1 = Math.min(rows - 1, Math.floor((body.y + radius) / ch));
    const glyphCell = cw * 0.9;
    const flickerSlot = Math.floor(time * 6);

    const probe = (px, py) => {
      const dx = px - body.x;
      const dy = py - body.y;
      const u = (dx * cos + dy * sin) / span;
      const v = (dy * cos - dx * sin) / span;
      paint.glyphs = null;
      paint.u = u;
      paint.v = v;
      return sampler(u, v, paint, px, py);
    };

    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const x0 = col * cw;
        const y0 = row * ch;
        const centre = probe(x0 + cw / 2, y0 + ch / 2);
        let hits = 0;
        if (centre) {
          hit.copy(paint);
          hits = 1;
        }
        for (let k = 0; k < CORNERS.length; k += 2) {
          if (probe(x0 + CORNERS[k] * cw, y0 + CORNERS[k + 1] * ch)) {
            if (!hits) hit.copy(paint);
            hits++;
          }
        }
        if (!hits) continue;

        const i = row * cols + col;
        const coverage = hits / 5;
        const solid = centre && coverage >= 0.6;
        // A nearer creature's edge never erases a farther creature's solid body.
        if (!solid && flag[i] === SOLID) continue;

        let [r, g, b] = this.tint(hit.r, hit.g, hit.b);
        let bright = light * (1 + (hash3(col, row, flickerSlot) - 0.5) * 0.06);
        if (solid && hit.mat === Mat.IRIDESCENT) {
          bright *= 1 - 0.4 * shimmer + shimmer * Math.sin(time * 2.2 + hit.u * 9 + hit.v * 6 + tilt + body.heading * 2);
        }
        r *= bright;
        g *= bright;
        b *= bright;

        // Seed tied to the body, not the screen, so glyphs ride along with the creature.
        const seed =
          (hash3(Math.round((hit.u * span) / glyphCell), Math.round((hit.v * span) / glyphCell), body.id) *
            4294967295) >>>
          0;
        const pick = (ramp) => ramp.charCodeAt((seed >>> 8) % ramp.length);

        if (!solid) {
          flag[i] = SOFT;
          color[i] = this.fade(r, g, b, Math.min(1, fog + 0.55 - 0.45 * coverage));
          glyph[i] = pick(coverage >= 0.5 ? EDGE_FIRM : EDGE_FAINT);
          continue;
        }

        if (hit.mat === Mat.LINE) {
          if (flag[i] === SOLID) continue;
          flag[i] = SOFT;
          color[i] = this.fade(r, g, b, fog);
          if (hit.glyphs) glyph[i] = pick(hit.glyphs);
          else {
            const ramp = RAMPS[Mat.LINE];
            const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
            glyph[i] = ramp.charCodeAt(clamp(Math.floor(lum * ramp.length), 0, ramp.length - 1));
          }
          continue;
        }

        flag[i] = SOLID;
        const sparkRoll = hash3(seed, Math.floor(time * 2.4 + (seed % 997) / 97), 7);
        const spark = SPARKS[seed % SPARKS.length];

        if (hit.mat === Mat.GLOW) {
          fill[i] = this.fade(r, g, b, Math.min(1, 0.62 + fog * 0.38));
          color[i] = sparkRoll < sparkle ? pack(...spark) : this.fade(r, g, b, fog);
          glyph[i] = pick(hit.glyphs ?? RAMPS[Mat.GLOW]);
          continue;
        }

        if (hit.mat === Mat.SHEEN) {
          fill[i] = this.fade(r * 0.58, g * 0.58, b * 0.58, fog);
          color[i] =
            sparkRoll < sparkle
              ? pack(...spark)
              : this.fade(Math.min(255, r * 1.05 + 50), Math.min(255, g * 1.05 + 50), Math.min(255, b * 1.05 + 50), fog);
          glyph[i] = pick(hit.glyphs ?? RAMPS[Mat.SHEEN]);
          continue;
        }

        const base = this.fade(r, g, b, fog);
        fill[i] = base;
        const fr = base >>> 16;
        const fg = (base >>> 8) & 255;
        const fb = base & 255;
        const ramp = hit.glyphs ?? RAMPS[hit.mat];
        let text;
        if (hit.mat === Mat.THORAX) text = pack(fr * 1.6 + 44, fg * 1.6 + 40, fb * 1.6 + 36);
        else if (hit.mat === Mat.DARK) text = pack(fr * 1.7 + 34, fg * 1.7 + 30, fb * 1.7 + 30);
        else if (hit.mat === Mat.HIGHLIGHT) text = pack(fr * 0.4, fg * 0.4, fb * 0.4);
        else text = pack(fr * 0.42, fg * 0.42, fb * 0.42);

        if (hit.glyphs || (hit.mat !== Mat.BODY && hit.mat !== Mat.IRIDESCENT)) {
          glyph[i] = pick(ramp);
        } else {
          // Brighter fill -> sparser glyph, with a little per-cell jitter for texture.
          const lum = (0.3 * fr + 0.59 * fg + 0.11 * fb) / 255;
          const jitter = ((seed >>> 4) % 3) - 1;
          glyph[i] = ramp.charCodeAt(clamp(Math.floor((1 - lum) * (ramp.length - 0.01)) + jitter, 0, ramp.length - 1));
        }
        const sparkChance = hit.mat === Mat.IRIDESCENT ? sparkle : hit.mat === Mat.BODY ? sparkle / 3 : 0;
        color[i] = sparkRoll < sparkChance ? pack(...spark) : text;
      }
    }
  }

  /** A stroke of `- \ | /` glyphs between two screen points. */
  line(x1, y1, x2, y2, rgb, fog, endGlyph) {
    const { flag, color, glyph } = this;
    const [r, g, b] = this.tint(rgb[0], rgb[1], rgb[2]);
    const packed = this.fade(r, g, b, fog);
    const code = lineGlyph(Math.atan2(y2 - y1, x2 - x1)).charCodeAt(0);
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (this.cw * 0.5)));
    let last = -1;
    for (let k = 1; k <= steps; k++) {
      const i = this.cellIndex(x1 + ((x2 - x1) * k) / steps, y1 + ((y2 - y1) * k) / steps);
      if (i < 0 || flag[i] === SOLID) continue;
      flag[i] = SOFT;
      color[i] = packed;
      glyph[i] = code;
      last = i;
    }
    if (endGlyph && last >= 0) glyph[last] = endGlyph.charCodeAt(0);
  }

  /** `line` between two body-space points. */
  lineBody(body, u1, v1, u2, v2, rgb, endGlyph) {
    const a = this.toWorld(body, u1, v1, { x: 0, y: 0 });
    const b = this.toWorld(body, u2, v2, { x: 0, y: 0 });
    this.line(a.x, a.y, b.x, b.y, rgb, this.fogFor(body.depth), endGlyph);
  }

  /** One glyph with no fill, under any solid cell. */
  dot(x, y, char, rgb, fog) {
    const i = this.cellIndex(x, y);
    if (i < 0 || this.flag[i] === SOLID) return;
    const [r, g, b] = this.tint(rgb[0], rgb[1], rgb[2]);
    this.flag[i] = SOFT;
    this.color[i] = this.fade(r, g, b, fog);
    this.glyph[i] = char.charCodeAt(0);
  }

  /** One filled glyph that sits on top of everything drawn so far (eyes, markers). */
  spot(x, y, char, fg, bg, depth) {
    const i = this.cellIndex(x, y);
    if (i < 0) return;
    const fog = this.fogFor(depth);
    const [br, bgc, bb] = this.tint(bg[0], bg[1], bg[2]);
    this.fill[i] = this.fade(br, bgc, bb, fog);
    const [r, g, b] = this.tint(fg[0], fg[1], fg[2]);
    this.color[i] = this.fade(r, g, b, fog);
    this.flag[i] = SOLID;
    this.glyph[i] = char.charCodeAt(0);
  }

  // ---- trail energy field -----------------------------------------------------------

  /** Leave trail at one cell (per 60 Hz frame), scaled by the Trail setting. */
  shed(x, y, amount) {
    const i = this.cellIndex(x, y);
    if (i >= 0) {
      this.energy[i] = Math.min(MAX_ENERGY, this.energy[i] + amount * this.tuning.trail * this.frameScale);
    }
  }

  /** Add a round splash of trail energy (ripples, taps). Radius is in cells. */
  stamp(x, y, radius, amount) {
    const { energy, cols, rows } = this;
    const cx = Math.floor(x / this.cw);
    const cy = Math.floor(y / this.ch);
    for (let row = cy - radius; row <= cy + radius; row++) {
      for (let col = cx - radius; col <= cx + radius; col++) {
        if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
        const d = Math.hypot(col - cx, (row - cy) * 1.4);
        if (d > radius + 0.5) continue;
        const i = row * cols + col;
        energy[i] = Math.min(MAX_ENERGY, energy[i] + amount * (1 - d / (radius + 1)));
      }
    }
  }

  /** Blur each cell with its four neighbours, then decay. */
  diffuse(dt) {
    const { cols, rows, energy: src, energyNext: dst } = this;
    const decay = Math.exp(-dt * this.tuning.trailFade);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const left = col > 0 ? src[i - 1] : src[i];
        const right = col < cols - 1 ? src[i + 1] : src[i];
        const up = row > 0 ? src[i - cols] : src[i];
        const down = row < rows - 1 ? src[i + cols] : src[i];
        dst[i] = (src[i] * 4 + left + right + up + down) * 0.125 * decay;
      }
    }
    this.energy = dst;
    this.energyNext = src;
  }

  drawTrail() {
    const { ctx, cols, cw, ch, energy, flag, time } = this;
    const dotSize = Math.max(2, Math.round(cw * 0.19));
    for (let level = 0; level < TRAIL_LEVELS; level++) {
      ctx.fillStyle = this.trailStyles[level];
      for (let i = 0; i < energy.length; i++) {
        const e = energy[i];
        if (e < 0.12 || flag[i] === SOLID) continue;
        const col = i % cols;
        const row = (i / cols) | 0;
        const twinkle = 0.75 + 0.25 * Math.sin(time * 5 + hash3(col, row, 3) * 40);
        if (clamp(Math.floor(e * twinkle * 4 * TRAIL_LEVELS) - 1, 0, TRAIL_LEVELS - 1) !== level) continue;
        const size = e > 0.6 ? dotSize + 1 : dotSize;
        ctx.fillRect(
          Math.round(col * cw + cw * 0.5 - size / 2),
          Math.round(row * ch + ch * 0.6 - size / 2),
          size,
          size,
        );
      }
    }
  }

  drawCells() {
    const { ctx, cols, rows, cw, ch, flag, fill, color, glyph } = this;
    const total = cols * rows;
    for (let i = 0; i < total; i++) {
      const state = flag[i];
      if (state === EMPTY) continue;
      const x = (i % cols) * cw;
      const y = ((i / cols) | 0) * ch;
      if (state === SOLID) {
        ctx.fillStyle = cssColor(fill[i]);
        ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);
      }
      ctx.fillStyle = cssColor(color[i]);
      ctx.fillText(String.fromCharCode(glyph[i]), x + cw / 2, y + ch / 2 + 1);
    }
  }
}
