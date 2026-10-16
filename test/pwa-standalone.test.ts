import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("AskMoina standalone PWA contract", () => {
  it("defines the installed app shell and an existing AskMoina icon", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest"));
    expect(manifest.display).toBe("standalone");
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url).toBe("/?source=pwa");
    expect(manifest.icons[0].src).toBe("/askmoina-bird-final.png");
    expect(existsSync(resolve(root, "public/askmoina-bird-final.png"))).toBe(true);
  });

  it("requires actual standalone display mode, not a URL marker", () => {
    const gate = read("public/pwa-gate.js");
    expect(gate).toContain('window.matchMedia("(display-mode: standalone)")');
    expect(gate).toContain("window.navigator.standalone === true");
    expect(gate).toContain('window.location.replace("/install.html")');
    expect(gate).not.toMatch(/location\.search|searchParams\s*\.\s*get/);
  });

  it("applies the standalone gate to home, Co-Pilot, and sign-in HTML", () => {
    const worker = read("src/index.ts");
    expect(worker).toContain('if (isPwaStandaloneAppPath(url.pathname)) html = withPwaStandaloneGate(html);');
    expect(worker).toContain("body = withPwaStandaloneGate(body)");
    expect(worker).toContain("assetHtml = withPwaStandaloneGate(assetHtml)");
  });

  it("revalidates live UI code and never caches authenticated API responses", () => {
    const serviceWorker = read("public/service-worker.js");
    expect(serviceWorker).toContain('fetch(request, { cache: "no-store" })');
    expect(serviceWorker).toContain('if (url.pathname.startsWith("/api/")');
    expect(serviceWorker).toContain('request.mode === "navigate"');
    expect(serviceWorker).not.toContain('"/app.js"');
    expect(serviceWorker).not.toContain('"/copilot.js"');
  });

  it("keeps the PWA runtime scripts syntactically valid", () => {
    for (const path of [
      "public/pwa-gate.js",
      "public/pwa-runtime.js",
      "public/service-worker.js",
    ]) {
      execFileSync(process.execPath, ["--check", resolve(root, path)], { stdio: "pipe" });
    }
  });
});
