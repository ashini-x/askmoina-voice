import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

describe("Stockfish WebAssembly content-security policy", () => {
  it("allows WASM only for the dedicated Stockfish worker and not general eval", () => {
    const start = workerSource.lastIndexOf("const workerScriptPolicy =");
    const end = workerSource.indexOf('headers.set("X-Content-Type-Options"', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const block = workerSource.slice(start, end);

    expect(block).toContain('url.pathname === "/chess/stockfish-19-lite-single.js"');
    expect(block).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(block).toContain("script-src 'self'");
    expect(block).not.toContain("'unsafe-eval'");
  });
});
