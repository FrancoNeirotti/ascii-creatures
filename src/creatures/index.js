// Every creature is a plain object:
//   key, label, swatch, hint      picker and caption
//   defaults, controls, hide      tuning values, extra tweak sliders, shared sliders to hide
//   area, scale, speed, max       screen area per creature, size multiplier, px/s, count cap
//   trail: { light, dark }        trail colour per theme family (black uses dark)
//   create(c, flock)              add per-creature state to the base record
//   enter?(c, flock)              reset state when (re)entering the screen
//   prepare?(flock, dt)           once per step, before updates
//   update(c, flock, dt)          steer and animate one creature
//   startle?(c, nx, ny, s, flock) react to a nearby click (default: pushed away)
//   tap?(x, y, flock)             replace click handling entirely
//   draw(c, pen, flock) or drawAll(flock, pen)

import butterfly from "./butterfly.js";
import koi from "./koi.js";
import jellyfish from "./jellyfish.js";
import dragonfly from "./dragonfly.js";
import frog from "./frog.js";
import crane from "./crane.js";
import crab from "./crab.js";
import firefly from "./firefly.js";

export const CREATURES = { butterfly, koi, jellyfish, dragonfly, frog, crane, crab, firefly };
