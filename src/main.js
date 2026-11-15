import { CreatureScene } from "./scene.js";
import { CREATURES } from "./creatures/index.js";
import { SHARED_CONTROLS } from "./flock.js";
import { createTweaks } from "./tweaks.js";
import { THEMES } from "./renderer.js";

const STORE = "ascii-creatures:";
const read = (key) => {
  try {
    return localStorage.getItem(STORE + key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(STORE + key, value);
  } catch {}
};
const isCreature = (key) => key != null && Object.hasOwn(CREATURES, key);

// ?creature=koi picks one; ?count=12 fixes how many.
const params = new URLSearchParams(location.search);
let current = [params.get("creature"), read("creature")].find(isCreature) ?? "butterfly";
const storedTheme = read("theme");
let theme = Object.hasOwn(THEMES, storedTheme ?? "")
  ? storedTheme
  : matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
document.documentElement.dataset.theme = theme;

const scene = new CreatureScene(document.querySelector("canvas"), {
  creature: CREATURES[current],
  count: Number(params.get("count")) || undefined,
  theme,
});

const hint = document.querySelector(".hint");

function controlGroups(creature) {
  const hidden = new Set(creature.hide ?? []);
  const keep = (list) => list.filter((c) => !hidden.has(c.key));
  return [["Movement", keep(SHARED_CONTROLS.movement)], ...creature.controls, ["Look", keep(SHARED_CONTROLS.look)]];
}

// Creature picker: a radio group of pills at the top of the Tweaks panel; arrow keys
// move between them. The same element moves into each creature's rebuilt panel.
const picker = document.createElement("div");
picker.className = "picker";
picker.setAttribute("role", "radiogroup");
picker.setAttribute("aria-label", "Creature");
const buttons = Object.values(CREATURES).map((creature) => {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "radio");
  button.dataset.key = creature.key;
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.setProperty("--swatch", `rgb(${creature.swatch.join(",")})`);
  button.append(dot, creature.label);
  button.addEventListener("click", () => select(creature.key));
  picker.append(button);
  return button;
});

function mountTweaks() {
  const creature = CREATURES[current];
  hint.textContent = creature.hint ?? "";
  // The creature's main colour, used for focus accents (e.g. the search bar).
  document.documentElement.style.setProperty("--creature", `rgb(${creature.swatch.join(",")})`);
  return createTweaks({
    scene,
    defaults: creature.defaults,
    groups: controlGroups(creature),
    storageKey: `${STORE}tweaks:${current}`,
    lead: ["Creature", picker],
  });
}
let tweaks = mountTweaks();

function markSelected() {
  for (const button of buttons) {
    const on = button.dataset.key === current;
    button.setAttribute("aria-checked", String(on));
    button.tabIndex = on ? 0 : -1;
  }
}

function select(key) {
  if (key === current) return;
  current = key;
  scene.setCreature(CREATURES[key]);
  const hadFocus = picker.contains(document.activeElement);
  tweaks.destroy();
  tweaks = mountTweaks();
  markSelected();
  // Moving the picker into the new panel drops focus; put it back on the chosen creature.
  if (hadFocus) buttons.find((b) => b.dataset.key === key)?.focus();
  write("creature", key);
}

picker.addEventListener("keydown", (event) => {
  const index = buttons.indexOf(document.activeElement);
  if (index < 0) return;
  const moves = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: buttons.length - 1 };
  if (!(event.key in moves)) return;
  event.preventDefault();
  const next = buttons[(moves[event.key] + buttons.length) % buttons.length];
  next.focus();
  select(next.dataset.key);
});
markSelected();

// "/" focuses the search bar (unless already typing somewhere).
const searchInput = document.querySelector(".search input");
document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
  event.preventDefault();
  searchInput.focus();
});

// Theme toggle.
const themeButton = document.querySelector(".theme-toggle");
// Theme toggle cycles dark -> black -> light.
const THEME_ORDER = ["dark", "black", "light"];
const nextTheme = () => THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
const syncThemeButton = () => {
  const label = `Theme: ${theme}. Switch to ${nextTheme()}`;
  themeButton.setAttribute("aria-label", label);
  themeButton.title = label;
};
themeButton.addEventListener("click", () => {
  theme = nextTheme();
  document.documentElement.dataset.theme = theme;
  scene.setTheme(theme);
  write("theme", theme);
  syncThemeButton();
});
syncThemeButton();
