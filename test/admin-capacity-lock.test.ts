import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { handleContinuityRequest } from "../src/continuity";
import type { Env } from "../src/config/env";

const ctx = { waitUntil(_promise: Promise<unknown>) {} } as unknown as ExecutionContext;

function setup() {
  const objectNames: string[] = [];
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
  const env = {
    DB: db,
    ASSETS: { async fetch() { return new Response("asset"); } },
    ADMIN_DASHBOARD_USER: "admin",
    ADMIN_DASHBOARD_PASSWORD: "test-admin-password",
    ADMIN_SESSION_SECRET: "test-session-secret-with-sufficient-entropy",
    ADMIN_VOICE_DAILY_QUOTA_BYPASS: "true",
    GCP_PROJECT_ID: "test-project",
    GCP_SERVICE_ACCOUNT_JSON: JSON.stringify({
      type: "service_account",
      client_email: "test@example.test",
      private_key: "not-used-by-status-check",
    }),
    USER_STATE: {
      idFromName(name: string) {
        objectNames.push(name);
        return { name };
      },
      get(id: { name: string }) {
        return {
          async fetch(url: string) {
            if (url.endsWith("/session/status")) {
              return Response.json({
                ok: true,
                dailySecondsRemaining: 1800,
                activeSessions: 0,
                requestsRemaining: 5,
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
  return { env, objectNames };
}

describe("admin voice capacity locks", () => {
  it("uses versioned admin guard keys so abandoned old reservations don't block testing", async () => {
    const mock = setup();
    const login = await handleContinuityRequest(
      new Request("https://askmoina.test/admin/login", {
        method: "POST",
        headers: { Origin: "https://askmoina.test", "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "test-admin-password" }),
      }),
      mock.env,
      ctx,
    );
    expect(login?.status).toBe(200);
    const cookie = (login?.headers.get("Set-Cookie") || "").split(";")[0];

    const response = await worker.fetch(
      new Request("https://askmoina.test/api/voice/status", {
        headers: { Cookie: cookie, "CF-Connecting-IP": "203.0.113.25" },
      }),
      mock.env,
      ctx,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ available: true, adminDailyQuotaBypassed: true });
    expect(mock.objectNames.some(name => name.startsWith("voice-admin-ip:v2:"))).toBe(true);
    expect(mock.objectNames).toContain("voice-admin-global-budget:v2");
    expect(mock.objectNames.some(name => name === "voice-admin-ip:" + name.split(":").pop())).toBe(false);
  });
});
