/* AskMoina Fluid Interactivity: interruptible spring-driven transforms and opacity. */
(() => {
  "use strict";
  if (window.__askmoinaFluidMotion) return;

  const profiles = Object.freeze({
    expand: Object.freeze({ mass: 1, stiffness: 380, damping: 30 }),
    sheet: Object.freeze({ mass: 1, stiffness: 320, damping: 28 }),
    tap: Object.freeze({ mass: 0.8, stiffness: 500, damping: 24 }),
    exit: Object.freeze({ mass: 1, stiffness: 240, damping: 26 })
  });
  const active = new WeakMap();
  const pointers = new Map();
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const clampDelta = 0.032;
  const stepMax = 0.008;

  function propertyFor(key) {
    if (key === "x" || key === "y") return "translate";
    if (key === "scale" || key === "scaleX" || key === "scaleY") return "scale";
    return "opacity";
  }
  function inlineValue(el, key) {
    return el.style[propertyFor(key)] || "";
  }
  function restoreProperty(el, property, value) {
    el.style[property] = value || "";
  }
  function restoreValue(el, key, value) {
    restoreProperty(el, propertyFor(key), value);
  }
  function parsePair(value, defaults) {
    if (!value || value === "none") return defaults.slice();
    const parts = value.trim().split(/\s+/);
    const first = Number.parseFloat(parts[0]);
    const second = parts.length > 1 ? Number.parseFloat(parts[1]) : first;
    return [
      Number.isFinite(first) ? first : defaults[0],
      Number.isFinite(second) ? second : defaults[1]
    ];
  }
  function readTranslate(el) {
    const inline = el.style.translate;
    const value = inline && inline !== "none" ? inline : getComputedStyle(el).translate;
    return parsePair(value, [0, 0]);
  }
  function readScale(el) {
    const inline = el.style.scale;
    const value = inline && inline !== "none" ? inline : getComputedStyle(el).scale;
    return parsePair(value, [1, 1]);
  }
  function readValue(el, key, state) {
    if (key === "x" || key === "y") {
      const pair = readTranslate(el);
      if (state && Number.isFinite(state.values[key])) return state.values[key];
      return pair[key === "x" ? 0 : 1];
    }
    if (key === "scale") {
      if (state && (state.keys.includes("scaleX") || state.keys.includes("scaleY"))) return 1;
      const pair = readScale(el);
      return pair[0];
    }
    if (key === "scaleX" || key === "scaleY") {
      if (state && Number.isFinite(state.values.scale)) return 1;
      const pair = readScale(el);
      return pair[key === "scaleX" ? 0 : 1];
    }
    const value = Number.parseFloat(getComputedStyle(el).opacity);
    return Number.isFinite(value) ? value : 1;
  }
  function writeValue(el, key, value, state) {
    const values = state?.values;
    if (key === "x" || key === "y") {
      const current = readTranslate(el);
      const x = key === "x" ? value : (Number.isFinite(values?.x) ? values.x : current[0]);
      const y = key === "y" ? value : (Number.isFinite(values?.y) ? values.y : current[1]);
      el.style.translate = x + "px " + y + "px";
      return;
    }
    if (key === "scale" || key === "scaleX" || key === "scaleY") {
      const current = readScale(el);
      const uniform = Number.isFinite(values?.scale) ? values.scale : (key === "scale" ? value : 1);
      const hasX = Number.isFinite(values?.scaleX) || key === "scaleX";
      const hasY = Number.isFinite(values?.scaleY) || key === "scaleY";
      if (!hasX && !hasY) {
        el.style.scale = String(key === "scale" ? value : uniform);
        return;
      }
      const sx = (key === "scaleX" ? value : (Number.isFinite(values?.scaleX) ? values.scaleX : current[0])) * uniform;
      const sy = (key === "scaleY" ? value : (Number.isFinite(values?.scaleY) ? values.scaleY : current[1])) * uniform;
      el.style.scale = sx + " " + sy;
      return;
    }
    el.style.opacity = String(Math.max(0, Math.min(1, value)));
  }

  function animate(el, target, profile = profiles.expand, options = {}) {
    if (!(el instanceof Element)) return;
    const requestedKeys = Object.keys(target).filter(key =>
      key === "x" || key === "y" || key === "scale" ||
      key === "scaleX" || key === "scaleY" || key === "opacity"
    );
    if (!requestedKeys.length) { options.onComplete?.(); return; }

    const previous = active.get(el);
    if (previous) cancelAnimationFrame(previous.raf);
    // Retarget in-place: keep axes already in motion so an interruption never drops coordinates.
    const keys = [...new Set([...(previous?.keys ?? []), ...requestedKeys])];
    const finalTarget = { ...(previous?.target ?? {}), ...target };
    const original = { ...(previous?.original ?? {}) };
    for (const key of requestedKeys) {
      const property = propertyFor(key);
      if (!(property in original)) original[property] = inlineValue(el, key);
    }
    const persistTarget = options.persistTarget ?? previous?.persistTarget ?? false;

    if (reducedMotion()) {
      for (const key of keys) {
        if (key === "opacity" && finalTarget[key] === 1) el.style.opacity = "1";
        else if ((key === "scale" && finalTarget[key] === 1) ||
                 ((key === "scaleX" || key === "scaleY") && finalTarget[key] === 1) ||
                 ((key === "x" || key === "y") && finalTarget[key] === 0)) {
          restoreValue(el, key, original[propertyFor(key)]);
        } else {
          writeValue(el, key, finalTarget[key], { keys, values: finalTarget });
        }
      }
      active.delete(el);
      el.classList.remove("ios-interactive-node");
      options.onComplete?.();
      return;
    }

    const values = Object.create(null);
    const velocities = Object.create(null);
    for (const key of keys) {
      const scalingAxesAlreadyActive = previous && (previous.keys.includes("scaleX") || previous.keys.includes("scaleY"));
      const uniformScaleAlreadyActive = previous && previous.keys.includes("scale");
      values[key] = options.from && Number.isFinite(options.from[key])
        ? options.from[key]
        : previous && Number.isFinite(previous.values[key]) ? previous.values[key]
        : key === "scale" && scalingAxesAlreadyActive ? 1
        : (key === "scaleX" || key === "scaleY") && uniformScaleAlreadyActive ? 1
        : readValue(el, key, previous);
      velocities[key] = Number.isFinite(options.velocity?.[key]) ? options.velocity[key]
        : previous && Number.isFinite(previous.velocities[key]) ? previous.velocities[key] : 0;
    }
    const state = {
      raf: 0, original, keys, values, velocities, target: finalTarget,
      profile, persistTarget, onComplete: options.onComplete
    };
    active.set(el, state);
    el.classList.add("ios-interactive-node");
    for (const key of keys) writeValue(el, key, values[key], state);
    let last = performance.now();

    const tick = now => {
      if (active.get(el) !== state) return;
      const dt = Math.min(Math.max((now - last) / 1000, 0), clampDelta);
      last = now;
      const steps = Math.max(1, Math.ceil(dt / stepMax));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        for (const key of keys) {
          const acceleration = (-profile.stiffness * (state.values[key] - state.target[key])
            - profile.damping * state.velocities[key]) / profile.mass;
          state.velocities[key] += acceleration * h;
          state.values[key] += state.velocities[key] * h;
        }
      }
      for (const key of keys) writeValue(el, key, state.values[key], state);

      const settled = keys.every(key =>
        Math.abs(state.values[key] - state.target[key]) < (key === "x" || key === "y" ? 0.08 : 0.001) &&
        Math.abs(state.velocities[key]) < (key === "x" || key === "y" ? 0.8 : 0.01)
      );
      if (settled) {
        if (state.persistTarget) {
          for (const key of keys) state.values[key] = state.target[key];
          for (const key of keys) writeValue(el, key, state.target[key], state);
        } else {
          for (const property of new Set(keys.map(propertyFor))) restoreProperty(el, property, state.original[property]);
        }
        active.delete(el);
        el.classList.remove("ios-interactive-node");
        state.onComplete?.();
        return;
      }
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  }

  function springTo(el, targetScale, profile = profiles.tap, initialVelocity) {
    animate(el, { scale: targetScale }, profile, {
      velocity: Number.isFinite(initialVelocity) ? { scale: initialVelocity } : undefined
    });
  }

  // FLIP: transform an already-laid-out destination from a captured source rectangle.
  // Layout measurement happens once; animation frames only update composited transform/opacity.
  function flip(el, fromRect, profile = profiles.expand, options = {}) {
    if (!(el instanceof Element) || !fromRect) { options.onComplete?.(); return; }
    const toRect = el.getBoundingClientRect();
    if (!toRect.width || !toRect.height || !fromRect.width || !fromRect.height) {
      options.onComplete?.();
      return;
    }
    const fromCenterX = fromRect.left + fromRect.width / 2;
    const fromCenterY = fromRect.top + fromRect.height / 2;
    const toCenterX = toRect.left + toRect.width / 2;
    const toCenterY = toRect.top + toRect.height / 2;
    animate(el, { x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }, profile, {
      from: {
        x: fromCenterX - toCenterX,
        y: fromCenterY - toCenterY,
        scaleX: fromRect.width / toRect.width,
        scaleY: fromRect.height / toRect.height,
        opacity: options.fromOpacity ?? 1
      },
      velocity: options.velocity,
      onComplete: options.onComplete
    });
  }

  const interactive = "button, a[href], [role='button'], summary, input[type='button'], input[type='submit'], input[type='reset']";
  document.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const el = event.target instanceof Element ? event.target.closest(interactive) : null;
    if (!el || el.matches(":disabled,[aria-disabled='true'],#showProblemButton,.show-problem-button,[data-fluid-motion='off']") ||
        el.closest("[data-fluid-motion='off']")) return;
    if (el.dataset.fluidPressed === "1") return;
    el.dataset.fluidPressed = "1";
    pointers.set(event.pointerId, el);
    springTo(el, 0.965, profiles.tap);
  }, { passive: true, capture: true });

  function releasePointer(event) {
    const el = pointers.get(event.pointerId);
    if (!el) return;
    pointers.delete(event.pointerId);
    delete el.dataset.fluidPressed;
    const state = active.get(el);
    springTo(el, 1, profiles.tap, state?.velocities?.scale);
  }
  document.addEventListener("pointerup", releasePointer, { passive: true, capture: true });
  document.addEventListener("pointercancel", releasePointer, { passive: true, capture: true });
  window.addEventListener("blur", () => {
    for (const [pointerId, el] of pointers) {
      delete el.dataset.fluidPressed;
      const state = active.get(el);
      springTo(el, 1, profiles.tap, state?.velocities?.scale);
      pointers.delete(pointerId);
    }
  });

  window.__askmoinaFluidMotion = Object.freeze({
    profiles,
    animate,
    springTo,
    flip,
    stop(el, restore = true) {
      const state = active.get(el);
      if (!state) return;
      cancelAnimationFrame(state.raf);
      if (restore) {
        for (const property of new Set(state.keys.map(propertyFor))) {
          restoreProperty(el, property, state.original[property]);
        }
      }
      active.delete(el);
      el.classList.remove("ios-interactive-node");
      state.onComplete = null;
    }
  });
})();
