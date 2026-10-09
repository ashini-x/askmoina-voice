import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("static client memory handoff", () => {
  it("sends the selected vault notes in the first voice setup frame", () => {
    const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
    expect(app).toContain('sessionStorage.getItem("askmoina.memory.context")');
    expect(app).toContain("setupPayload.memory_context = selectedMemoryContext");
    expect(app).toContain("sessionSocket.send(JSON.stringify(setupPayload))");
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
