import { describe, expect, it } from "vitest";
import { handleVaultRequest } from "../src/vault";
import type { Env } from "../src/config/env";

const env = {} as unknown as Env;

describe("encrypted memory backup API", () => {
  it("rejects cross-origin writes before touching storage", async () => {
    const response = await handleVaultRequest(new Request("https://askmoina.example/api/vault/backup", {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: "{}",
    }), env);
    expect(response.status).toBe(403);
  });

  it("rejects malformed request bodies", async () => {
    const response = await handleVaultRequest(new Request("https://askmoina.example/api/vault/backup", {
      method: "POST",
      headers: { Origin: "https://askmoina.example", "Content-Type": "application/json" },
      body: "{not-json",
    }), env);
    expect(response.status).toBe(400);
  });

  it("refuses unsupported encryption parameters", async () => {
    const response = await handleVaultRequest(new Request("https://askmoina.example/api/vault/backup", {
      method: "POST",
      headers: { Origin: "https://askmoina.example", "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultId: "1234567890abcdef1234567890abcdef",
        token: "A".repeat(43),
        expectedRevision: 0,
        version: 1,
        kdf: "weak-kdf",
        iterations: 1,
        salt: "A".repeat(22),
        iv: "A".repeat(16),
        ciphertext: "A".repeat(24),
      }),
    }), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_vault_envelope" });
  });
});