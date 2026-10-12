import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleContinuityRequest } from "../src/continuity";
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

describe("M36 permission-based memory continuity", () => {
  it("shows memory sharing off by default and previewable", async () => {
    const response = await handleContinuityRequest(new Request("https://askmoina.test/vault"), mockEnv(), ctx);
    const html = await response!.text();
    expect(html).toContain('id="useInVoice"> Use all saved memories in new AskMoina conversations across this browser');
    expect(html).toContain('id="voiceContextPreview"');
    expect(html).toContain("Off by default");
    expect(html).toContain("cannot retract notes already sent to a connected conversation");
  });

  it("makes saved notes editable and deletable without treating the vault as plaintext", async () => {
    const response = await handleContinuityRequest(new Request("https://askmoina.test/vault.js"), mockEnv(), ctx);
    const script = await response!.text();
    expect(script).toContain('edit.textContent="Edit memory"');
    expect(script).toContain('save.textContent="Save changes"');
    expect(script).toContain('del.textContent="Delete memory"');
    expect(script).toContain('m.text=next');
    expect(script).toContain('renderConsentPreview()');
  });

  it("guards setup injection with opt-out consent and clears tab fallback", async () => {
    const response = await handleContinuityRequest(new Request("https://askmoina.test/continuity.js"), mockEnv(), ctx);
    const script = await response!.text();
    expect(script).toContain('const consentKey = "askmoina.memory.consent.v1"');
    expect(script).toContain('if (consent !== "disabled")');
    expect(script).toContain('sessionStorage.removeItem(contextKey)');
    expect(script).toContain('window.addEventListener("storage"');
  });

  it("keeps ordinary sessions useful without any memory context", async () => {
    const memorySource = readFileSync(new URL("../src/sessions/memory-context.ts", import.meta.url), "utf8");
    expect(memorySource).toContain('if (!memoryContext) return baseInstruction;');
  });
});
