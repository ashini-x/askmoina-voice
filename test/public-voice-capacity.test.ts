import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { visitorIdFromRequest } from "../src/continuity";
import { UserState } from "../src/sessions/user-state";
import type { Env } from "../src/config/env";

const ctx = { waitUntil(_promise: Promise<unknown>) {} } as unknown as ExecutionContext;

function testEnv(objectNames: string[]) {
  const db = {
    prepare(_sql: string) {
      return {
        bind(..._args: unknown[]) { return this; },
        async run() { return { meta: { changes: 1 } }; },
        async first<T>() { return null as T | null; },
        async all<T>() { return { results: [] as T[] }; },
      };
    },
  };
  const env = {
    DB: db,
    ASSETS: { async fetch() { return new Response("asset"); } },
    ADMIN_VOICE_DAILY_QUOTA_BYPASS: "false",
    GCP_PROJECT_ID: "test-project",
    GCP_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "service_account", client_email: "test@example.test", private_key: "unused" }),
    USER_STATE: {
      idFromName(name: string) { objectNames.push(name); return { name }; },
      get(id: { name: string }) {
        return {
          async fetch(url: string) {
            if (url.endsWith("/session/status")) {
              return Response.json({
                ok: true,
                dailySecondsRemaining: 1800,
                activeSessions: 0,
                requestsRemaining: 20,
                retryAfterSeconds: 0,
                rateLimited: false,
                concurrencyLimited: false,
                dailyLimitReached: false,
              });
            }
            return Response.json({ allowed: true, reservedSeconds: 540 });
          },
        };
      },
    },
  } as unknown as Env;
  return env;
}

function statusRequest(token: string) {
  return new Request("https://askmoina.test/api/voice/status", {
    headers: {
      "CF-Connecting-IP": "203.0.113.25",
      Cookie: "moina_visitor=" + token,
    },
  });
}

describe("public voice pilot capacity", () => {
  it("uses per-browser quota identities while retaining an IP-level burst guard", async () => {
    const objectNames: string[] = [];
    const env = testEnv(objectNames);
    const tokenA = "A".repeat(43);
    const tokenB = "B".repeat(43);

    const responseA = await worker.fetch(statusRequest(tokenA), env, ctx);
    const responseB = await worker.fetch(statusRequest(tokenB), env, ctx);
    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    expect((await responseA.json() as { available: boolean }).available).toBe(true);
    expect((await responseB.json() as { available: boolean }).available).toBe(true);

    const idA = await visitorIdFromRequest(statusRequest(tokenA));
    const idB = await visitorIdFromRequest(statusRequest(tokenB));
    expect(idA).not.toBe(idB);
    expect(objectNames).toContain("voice-visitor:" + idA);
    expect(objectNames).toContain("voice-visitor:" + idB);
    expect(objectNames.filter(name => name.startsWith("voice-ip-rate:v1:"))).toHaveLength(2);
  });

  it("issues a browser identity cookie when status is the first endpoint visited", async () => {
    const objectNames: string[] = [];
    const response = await worker.fetch(
      new Request("https://askmoina.test/api/voice/status", { headers: { "CF-Connecting-IP": "203.0.113.25" } }),
      testEnv(objectNames),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toMatch(/^moina_visitor=[A-Za-z0-9_-]{43};/);
    expect(objectNames.some(name => name.startsWith("voice-visitor:"))).toBe(true);
  });
});


describe("voice rate-limit-only reservations", () => {
  it("counts IP connection attempts without reserving daily voice seconds or an active session", async () => {
    const records = new Map<string, unknown>();
    const storage = {
      async get<T>(key: string) { return records.get(key) as T | undefined; },
      async put<T>(key: string, value: T) { records.set(key, value); },
      async delete(key: string) { return records.delete(key); },
      async transaction<T>(fn: (tx: unknown) => Promise<T>) {
        const tx = {
          async get<T>(key: string) { return records.get(key) as T | undefined; },
          async put<T>(key: string, value: T) { records.set(key, value); },
          async delete(key: string) { return records.delete(key); },
        };
        return fn(tx);
      },
    };
    const state = { storage } as unknown as DurableObjectState;
    const env = { ENVIRONMENT: "test" } as unknown as Env;
    const guard = new UserState(state, env);
    const now = Date.now();

    for (let i = 1; i <= 20; i++) {
      const response = await guard.fetch(new Request("https://user-state/session/acquire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-" + i,
          now,
          maxSessionSeconds: 540,
          maxDailySeconds: 1800,
          maxConcurrentSessions: 1,
          enforceRateLimit: true,
          enforceDailyLimit: false,
          rateLimitOnly: true,
        }),
      }));
      expect(response.status).toBe(200);
    }

    const blocked = await guard.fetch(new Request("https://user-state/session/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-21",
        now,
        maxSessionSeconds: 540,
        maxDailySeconds: 1800,
        maxConcurrentSessions: 1,
        enforceRateLimit: true,
        enforceDailyLimit: false,
        rateLimitOnly: true,
      }),
    }));
    expect(blocked.status).toBe(429);

    const status = await guard.fetch(new Request("https://user-state/session/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        now,
        maxDailySeconds: 1800,
        maxConcurrentSessions: 1,
        enforceRateLimit: true,
        enforceDailyLimit: false,
      }),
    }));
    expect(await status.json()).toMatchObject({
      ok: true,
      dailySecondsRemaining: 1800,
      activeSessions: 0,
      rateLimited: true,
    });
  });
});
