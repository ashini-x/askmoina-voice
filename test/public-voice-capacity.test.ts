import { describe, expect, it } from "vitest";
import worker from "../src/index";
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

describe("public audio-first voice access", () => {
  it("serves guest voice status without creating an account and checks per-network safety limits", async () => {
    const objectNames: string[] = [];
    const response = await worker.fetch(
      new Request("https://askmoina.test/api/voice/status", { headers: { "CF-Connecting-IP": "203.0.113.25" } }),
      testEnv(objectNames), ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.json()).toMatchObject({ available: true, reason: "available" });
    expect(objectNames).toHaveLength(1);
    expect(objectNames[0]).toContain("guest-voice:");
  });

  it("serves an audio-only no-signup home while keeping the old camera route unavailable to guests", async () => {
    const objectNames: string[] = [];
    const env = testEnv(objectNames);
    // The root Worker route loads this public asset from the asset binding.
    env.ASSETS = {
      async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        if (path === "/audio") {
          return new Response('<!doctype html><title>askmoina</title><button id="toggleVoice">Talk</button><section id="mathFundCard"></section><div id="transcript"></div><p>moinaOS 2 · Invite only</p>', {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
        return new Response("asset");
      },
    } as unknown as Fetcher;
    const root = await worker.fetch(new Request("https://askmoina.test/"), env, ctx);
    expect(root.status).toBe(200);
    expect(root.headers.get("Set-Cookie")).toBeNull();
    const html = await root.text();
    expect(html).toContain('id="toggleVoice"');
    expect(html).toContain('id="mathFundCard"');
    expect(html).toContain("moinaOS 2");
    expect(html).not.toContain('id="videoPreview"');
    expect(html).not.toContain("Face ID");
    expect(objectNames).toHaveLength(0);

    const copilot = await worker.fetch(new Request("https://askmoina.test/copilot"), env, ctx);
    expect(copilot.status).toBe(302);
    expect(copilot.headers.get("Location")).toBe("https://askmoina.test/");
    expect(objectNames).toHaveLength(0);
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
