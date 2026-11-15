// Tweaks panel: sliders and toggles generated from control definitions. Values that
// differ from the creature's defaults are saved to localStorage under `storageKey`.

const OPEN_KEY = "ascii-creatures:tweaks-open";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const decimalsFor = (step) => (step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step))));

function readJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

/**
 * @param scene       object with `tuning` and `set(key, value)`
 * @param defaults    the creature's default tuning
 * @param groups      [[title, [control, ...]], ...]
 * @param storageKey  where to persist changed values
 * @param lead        optional [title, element] shown as the first section (the creature picker)
 */
export function createTweaks({ scene, defaults, groups, storageKey, lead }) {
  // Restore saved values, rejecting anything of the wrong type or outside its slider range.
  const controlByKey = new Map(groups.flatMap(([, controls]) => controls).map((c) => [c.key, c]));
  for (const [key, value] of Object.entries(readJSON(storageKey))) {
    if (!(key in defaults) || typeof value !== typeof defaults[key]) continue;
    const control = controlByKey.get(key);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      scene.set(key, control ? Math.min(control.max, Math.max(control.min, value)) : value);
    } else {
      scene.set(key, value);
    }
  }

  const save = () => {
    const changed = {};
    for (const key of Object.keys(defaults)) if (scene.tuning[key] !== defaults[key]) changed[key] = scene.tuning[key];
    try {
      localStorage.setItem(storageKey, JSON.stringify(changed));
    } catch {}
  };

  const panel = el("aside", "tweaks panel");
  panel.setAttribute("aria-label", "Tweaks");
  const head = el("header", "tweaks-head");
  const reset = el("button", "tweaks-action", "Reset");
  reset.type = "button";
  const close = el("button", "tweaks-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close tweaks");
  head.append(el("h2", "", "Tweaks"), reset, close);
  const bodyEl = el("div", "tweaks-body");
  panel.append(head, bodyEl);

  const opener = el("button", "tweaks-open panel", "Tweaks");
  opener.type = "button";

  if (lead) {
    const [title, node] = lead;
    const section = el("section", "tweaks-group");
    section.append(el("h3", "", title), node);
    bodyEl.append(section);
  }

  const refreshers = [];
  const refreshAll = () => refreshers.forEach((fn) => fn());

  for (const [title, controls] of groups) {
    if (!controls.length) continue;
    const section = el("section", "tweaks-group");
    section.append(el("h3", "", title));
    for (const control of controls) {
      const row = el("label", `tweaks-row ${control.toggle ? "toggle" : "range"}`);
      if (control.hint) row.title = `${control.hint}\nDouble-click the name to reset.`;
      const name = el("span", "tweaks-label", control.label);
      const resetOne = (event) => {
        event.preventDefault();
        scene.set(control.key, defaults[control.key]);
        refreshAll();
        save();
      };
      name.addEventListener("dblclick", resetOne);

      if (control.toggle) {
        const input = el("input");
        input.type = "checkbox";
        input.addEventListener("change", () => {
          scene.set(control.key, input.checked);
          refreshAll();
          save();
        });
        refreshers.push(() => (input.checked = Boolean(scene.tuning[control.key])));
        row.append(name, input);
      } else {
        // A <span>, not <output>: an <output> before the input would capture the <label>.
        const output = el("span", "tweaks-value");
        output.setAttribute("aria-hidden", "true");
        const input = el("input");
        Object.assign(input, { type: "range", min: control.min, max: control.max, step: control.step });
        input.setAttribute("aria-label", control.label);
        const places = decimalsFor(control.step);
        refreshers.push(() => {
          const value = scene.tuning[control.key];
          input.value = String(value);
          output.textContent = Number(value).toFixed(places);
          input.style.setProperty("--fill", `${((value - control.min) / (control.max - control.min)) * 100}%`);
          const disabled = control.disabledWhen ? Boolean(scene.tuning[control.disabledWhen]) : false;
          input.disabled = disabled;
          row.classList.toggle("off", disabled);
        });
        input.addEventListener("input", () => {
          scene.set(control.key, Number(input.value));
          refreshAll();
          save();
        });
        row.append(name, output, input);
      }
      section.append(row);
    }
    bodyEl.append(section);
  }
  refreshAll();

  reset.addEventListener("click", () => {
    for (const key of Object.keys(defaults)) scene.set(key, defaults[key]);
    refreshAll();
    try {
      localStorage.removeItem(storageKey);
    } catch {}
  });

  const setOpen = (open) => {
    panel.hidden = !open;
    opener.hidden = open;
    try {
      localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {}
  };
  close.addEventListener("click", () => {
    setOpen(false);
    opener.focus();
  });
  opener.addEventListener("click", () => {
    setOpen(true);
    close.focus();
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setOpen(false);
    opener.focus();
  });
  document.body.append(panel, opener);

  let open = false;
  try {
    open = localStorage.getItem(OPEN_KEY) === "1";
  } catch {}
  setOpen(open);

  return {
    destroy() {
      panel.remove();
      opener.remove();
    },
  };
}
