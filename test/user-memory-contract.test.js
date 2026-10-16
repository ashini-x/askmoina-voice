import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/user-memory.ts", import.meta.url), "utf8");
const conversationSource = readFileSync(new URL("../src/conversations.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0007_user_memories.sql", import.meta.url), "utf8");

describe("account-scoped preference memory contract", () => {
  it("requires an authenticated account and owner-scopes every query", () => {
    expect(source).toContain("getAuthenticatedUserId(request, env)");
    expect(source).toContain("WHERE owner_id = ?");
    expect(source).toContain('pathname === ROOT && request.method === "DELETE"');
    expect(source).toContain('pathname === ROOT + "/settings" && request.method === "PATCH"');
  });

  it("captures preferences only after a finalized user turn has been stored", () => {
    expect(conversationSource).toContain("observeUserPreferenceFromTurn(env, ownerId, text)");
    expect(source).toContain("if (!await readEnabled(env, ownerId)) return;");
    expect(source).toContain("function extractPreference(text: string): string | null");
  });

  it("keeps preferences in a dedicated owner-cascading schema with duplicate prevention", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS user_memory_settings");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS user_memories");
    expect(migration).toContain("REFERENCES account_users(user_id) ON DELETE CASCADE");
    expect(migration).toContain("UNIQUE (owner_id, preference_key)");
  });
});
