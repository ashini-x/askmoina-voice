import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const theme = readFileSync(new URL("../public/askmoina-liquid-system.css", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const copilotAssets = readFileSync(new URL("../src/copilot-assets.ts", import.meta.url), "utf8");
const deploymentWorkflow = readFileSync(new URL("../.github/workflows/deploy-candidate-a-live-voice.yml", import.meta.url), "utf8");

describe("AskMoina Liquid Glass design system", () => {
  it("defines the approved smoky-core palette and keeps glass restrained", () => {
    for (const token of [
      "--askmoina-obsidian: #090A0D",
      "--askmoina-graphite: #151619",
      "--askmoina-champagne: #D7C0AD",
      "--askmoina-titanium: #98A8BB",
      "--askmoina-porcelain: #F5EFE9",
      "--askmoina-glass:",
      "prefers-reduced-motion: reduce",
      "prefers-reduced-transparency: reduce"
    ]) expect(theme).toContain(token);
    expect(theme).toContain("Camera / real-world copilot");
    expect(theme).toContain("controls, sheets, menus, dialogs");
  });

  it("serves the shared stylesheet as a public asset before authentication", () => {
    expect(worker).toContain('"/askmoina-liquid-system.css",');
    expect(worker).toContain('"/askmoina-liquid-system.css": "text/css; charset=utf-8"');
    expect(worker).toContain('href="/askmoina-liquid-system.css?v=20261019-1"');
  });

  it("loads the theme on the embedded camera app and important static surfaces", () => {
    expect(copilotAssets).toContain(String.raw`href=\"/askmoina-liquid-system.css?v=20261019-1\"`);
    for (const path of [
      "../public/copilot.html",
      "../public/install.html",
      "../public/login.html",
      "../public/account.html",
      "../public/offline.html"
    ]) {
      const html = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(html, path).toContain("/askmoina-liquid-system.css?v=20261019-1");
    }
  });

  it("keeps production deployment smoke aligned with the live Liquid Glass shell", () => {
    expect(deploymentWorkflow).toContain('manifest.background_color !== "#090A0D"');
    expect(deploymentWorkflow).toContain('manifest.theme_color !== "#090A0D"');
    expect(deploymentWorkflow).toContain("/askmoina-liquid-system.css");
    expect(deploymentWorkflow).toContain("askmoina-pwa-shell-v19");
  });

  it("keeps the PWA theme current for installed and offline launches", () => {
    const serviceWorker = readFileSync(new URL("../public/service-worker.js", import.meta.url), "utf8");
    const manifest = readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8");
    expect(serviceWorker).toContain('const CACHE_NAME = "askmoina-pwa-shell-v19"');
    expect(serviceWorker).toContain("/askmoina-liquid-system.css?v=20261019-1");
    expect(manifest).toContain('"background_color": "#090A0D"');
    expect(manifest).toContain('"theme_color": "#090A0D"');
  });
});
