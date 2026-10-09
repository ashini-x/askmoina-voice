import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("static client memory handoff", () => {
  it("reads selected vault notes across tabs and sends them in the first voice setup frame", () => {
    const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
    expect(app).toContain('localStorage.getItem("askmoina.memory.context")');
    expect(app).toContain('sessionStorage.getItem("askmoina.memory.context")');
    expect(app).toContain("setupPayload.memory_context = selectedMemoryContext");
    expect(app).toContain("sessionSocket.send(JSON.stringify(setupPayload))");
  });

  it("shares selected memories across tabs but clears them on opt-out and vault lock", () => {
    const continuity = readFileSync(new URL("../src/continuity.ts", import.meta.url), "utf8");
    expect(continuity).toContain('localStorage.setItem(TAB_CONTEXT,text)');
    expect(continuity).toContain('localStorage.removeItem(TAB_CONTEXT)');
    expect(continuity).toContain('localStorage.getItem(contextKey) || sessionStorage.getItem(contextKey)');
    expect(continuity).toContain("across this browser");
  });

  it("links to Memory Vault from the static homepage", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    expect(html).toContain('href="/vault"');
  });

  it("routes the static homepage through the Worker for identity and memory-context setup", () => {
    const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    expect(config).toContain('"run_worker_first": ["/", "/index.html", "/api/*"]');
  });
});
