import { describe, expect, it } from "vitest";
import { extractPreference } from "../src/user-memory";
import { readFileSync } from "node:fs";

describe("automatic preference memory", () => {
  it("captures directly stated, reusable interaction preferences", () => {
    expect(extractPreference("I prefer short answers with clear examples.")).toContain("I prefer short answers");
    expect(extractPreference("Please remember that I prefer Assamese-English replies")).toContain("I prefer Assamese-English replies");
    expect(extractPreference("From now on, answer me in simple words")).toContain("answer me in simple words");
  });

  it("does not treat ordinary questions and conversation topics as preferences", () => {
    expect(extractPreference("Can you explain how a circuit breaker works?")).toBeNull();
    expect(extractPreference("The weather is nice today.")).toBeNull();
  });

  it("does not automatically store explicit sensitive disclosures or credentials", () => {
    expect(extractPreference("I prefer concise answers, and my medical condition is ...")).toBeNull();
    expect(extractPreference("My password is hunter2")).toBeNull();
    expect(extractPreference("I prefer to get OTP codes by text")).toBeNull();
  });

  it("keeps memories account-scoped and lets the account disable or delete them", () => {
    const source = readFileSync(new URL("../src/user-memory.ts", import.meta.url), "utf8");
    expect(source).toContain("getAuthenticatedUserId(request, env)");
    expect(source).toContain("WHERE owner_id = ?");
    expect(source).toContain('pathname === ROOT && request.method === "DELETE"');
    expect(source).toContain('pathname === ROOT + "/settings" && request.method === "PATCH"');
    expect(source).toContain('method_not_allowed');
  });

  it("stores preference records separately from conversation transcript records", () => {
    const migration = readFileSync(new URL("../migrations/0007_user_memories.sql", import.meta.url), "utf8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS user_memory_settings");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS user_memories");
    expect(migration).toContain("REFERENCES account_users(user_id) ON DELETE CASCADE");
    expect(migration).toContain("UNIQUE (owner_id, preference_key)");
  });
});
