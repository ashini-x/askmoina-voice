import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../public/copilot.html", import.meta.url), "utf8");
const embedded = readFileSync(new URL("../src/copilot-assets.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

describe("Stockfish WebAssembly content security policy", () => {
  it("allows WebAssembly compilation without enabling general JavaScript eval in the Co-Pilot meta policy", () => {
    const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
    expect(match?.[1]).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(match?.[1]).not.toMatch(/(?:^|\s)'unsafe-eval'(?:\s|;|$)/);
    expect(embedded).toContain("script-src 'self' 'wasm-unsafe-eval'; media-src 'self' blob:");
  });

  it("allows WebAssembly in the page response policy and the dedicated Stockfish worker response policy", () => {
    const pagePolicyCount = (worker.match(/script-src 'self' 'wasm-unsafe-eval'; media-src 'self' blob:/g) || []).length;
    expect(pagePolicyCount).toBeGreaterThanOrEqual(3);
    expect(worker).toContain("? \"script-src 'self' 'wasm-unsafe-eval'\"");
    expect(worker).not.toContain("script-src 'self' 'unsafe-eval'");
  });
});
