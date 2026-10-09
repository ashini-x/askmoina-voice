import { describe, expect, it } from "vitest";
import { UserState } from "../src/sessions/user-state";

class Storage {
  values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  async put(key: string, value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
  async transaction<T>(fn: (tx: Storage) => Promise<T>): Promise<T> { return fn(this); }
}

describe("internal request rate limits", () => {
  it("blocks requests after the configured per-minute threshold", async () => {
    const storage = new Storage();
    const state = { storage } as unknown as DurableObjectState;
    const durable = new UserState(state, { ENVIRONMENT: "test" } as never);
    const hit = () => durable.fetch(new Request("https://user-state/internal/rate-limit", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 2, windowMs: 60000 }),
    }));
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(429);
  });
});