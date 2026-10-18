import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const runtime = readFileSync(new URL("../public/fluid-interactivity.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/fluid-interactivity.css", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const nativeMenu = readFileSync(new URL("../public/native-app.js", import.meta.url), "utf8");
const selectionAssets = readFileSync(new URL("../src/copilot-assets.ts", import.meta.url), "utf8");

describe("AskMoina fluid interactivity", () => {
  it("uses the exact spring profiles from the iOS fluid specification", () => {
    expect(runtime).toContain("expand: Object.freeze({ mass: 1, stiffness: 380, damping: 30 })");
    expect(runtime).toContain("sheet: Object.freeze({ mass: 1, stiffness: 320, damping: 28 })");
    expect(runtime).toContain("tap: Object.freeze({ mass: 0.8, stiffness: 500, damping: 24 })");
    expect(runtime).toContain("exit: Object.freeze({ mass: 1, stiffness: 240, damping: 26 })");
  });

  it("uses a mass/stiffness/damping solver with interruptible state and velocity", () => {
    expect(runtime).toContain("profile.stiffness * (state.values[key] - state.target[key])");
    expect(runtime).toContain("profile.damping * state.velocities[key]");
    expect(runtime).toContain("cancelAnimationFrame(previous.raf)");
    expect(runtime).toContain("previous && Number.isFinite(previous.velocities[key])");
    expect(runtime).toContain("pointers.set(event.pointerId, el)");
    expect(runtime).toContain("prefers-reduced-motion: reduce");
    expect(runtime).toContain("function flip(el, fromRect");
    expect(runtime).toContain("scaleX: fromRect.width / toRect.width");
    expect(runtime).toContain("scaleY: fromRect.height / toRect.height");
  });

  it("keeps the shared CSS free of time-based interaction transitions", () => {
    expect(styles).toContain("-webkit-tap-highlight-color: transparent");
    expect(styles).toContain("will-change: transform, opacity");
    expect(styles).toContain("touch-action: none");
    expect(styles).toContain("transition: none !important");
    expect(styles).not.toContain("transition: all");
    expect(styles).not.toContain("transition: transform");
    expect(styles).not.toContain("animation-duration:");
  });

  it("loads the runtime early and injects it into the Co-Pilot and native shells", () => {
    expect(worker).toContain('"/fluid-interactivity.js"');
    expect(worker).toContain('"/fluid-interactivity.css"');
    expect(worker).toContain("withFluidInteractivity(body");
    expect(worker).toContain("withFluidInteractivity(html, appVersion)");
    expect(worker).toContain("withFluidInteractivity(html, \"0.4.80\")");
  });

  it("springs response-card details instead of toggling them abruptly", () => {
    expect(selectionAssets).toContain("engine.profiles.expand");
    expect(selectionAssets).toContain("engine.profiles.exit");
    expect(selectionAssets).toContain("if (!responseCardExpanded) responseCardDetails.hidden = true");
  });

  it("uses spring profiles for moinaOS card entry and exit and native menu sheets", () => {
    expect(selectionAssets).toContain("engine.profiles.expand");
    expect(selectionAssets).toContain("engine.profiles.exit");
    expect(selectionAssets).toContain("engine.flip(cameraApp, sourceRect, engine.profiles.expand");
    expect(selectionAssets).toContain("persistTarget: true");
    expect(selectionAssets).not.toContain("window.setTimeout(finishSelection, 160)");
    expect(nativeMenu).toContain("engine.profiles.sheet");
    expect(nativeMenu).toContain("engine.profiles.exit");
  });
});
