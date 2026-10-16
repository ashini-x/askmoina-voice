import { describe, expect, it } from "vitest";
import { handleContinuityRequest } from "../src/continuity";
import { buildPersonalizedSystemInstruction } from "../src/sessions/memory-context";
import type { Env } from "../src/config/env";

function mockEnv() {
  const db = {
    prepare(_sql: string) {
      return {
        bind(..._args: unknown[]) { return this; },
        async run() { return { meta: { changes: 0 } }; },
        async first<T>() { return null as T | null; },
        async all<T>() { return { results: [] as T[] }; },
      };
    },
  };
  return { DB: db } as unknown as Env;
}
const ctx = { waitUntil(_promise: Promise<unknown>) {} } as unknown as ExecutionContext;

describe("legacy Vault retirement", () => {
  it("does not serve the retired Vault page or script", async () => {
    expect(await handleContinuityRequest(new Request("https://askmoina.test/vault"), mockEnv(), ctx)).toBeNull();
    expect(await handleContinuityRequest(new Request("https://askmoina.test/vault.js"), mockEnv(), ctx)).toBeNull();
  });

  it("does not expose the old cross-tab context injector", async () => {
    expect(await handleContinuityRequest(new Request("https://askmoina.test/continuity.js"), mockEnv(), ctx)).toBeNull();
  });

  it("keeps normal live sessions useful without any optional memory context", () => {
    const base = "base instruction";
    expect(buildPersonalizedSystemInstruction(base, "")).toBe(base);
    expect(buildPersonalizedSystemInstruction(base, null)).toBe(base);
  });

  it("adds bounded saved context only when context exists", () => {
    const base = "base instruction";
    const result = buildPersonalizedSystemInstruction(base, "Earlier session: I prefer short answers");
    expect(result).toContain(base);
    expect(result).toContain("BEGIN USER-SAVED MEMORIES");
    expect(result).toContain("I prefer short answers");
  });
});
