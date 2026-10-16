import { describe, expect, it } from "vitest";
import { handleContinuityRequest, isAdmin, visitorIdFromRequest } from "../src/continuity";
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

describe("AskMoina continuity identity", () => {
  it("does not treat an anonymous browser cookie as account identity", async () => {
    const token = "A".repeat(43);
    const id = await visitorIdFromRequest(new Request("https://askmoina.test/", { headers: { Cookie: "moina_visitor=" + token } }), mockEnv());
    expect(id).toBeNull();
  });

  it("does not accept malformed identity cookies as a visitor ID", async () => {
    const id = await visitorIdFromRequest(new Request("https://askmoina.test/", { headers: { Cookie: "moina_visitor=not-a-valid-token" } }), mockEnv());
    expect(id).toBeNull();
  });
});

describe("Legacy Vault route retirement", () => {
  it("does not expose the retired Vault page, client script, or backup API", async () => {
    for (const route of [
      "/vault",
      "/vault.js",
      "/api/vault/123e4567-e89b-42d3-a456-426614174000",
    ]) {
      expect(await handleContinuityRequest(new Request("https://askmoina.test" + route), mockEnv(), ctx)).toBeNull();
    }
  });
});

describe("Continuity admin access", () => {
  it("makes the signed admin session available to same-origin voice routes", async () => {
    const env = {
      ...mockEnv(),
      ADMIN_DASHBOARD_USER: "admin",
      ADMIN_DASHBOARD_PASSWORD: "test-admin-password",
      ADMIN_SESSION_SECRET: "test-session-secret-with-sufficient-entropy",
    } as unknown as Env;
    const response = await handleContinuityRequest(
      new Request("https://askmoina.test/admin/login", {
        method: "POST",
        headers: {
          Origin: "https://askmoina.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: "admin", password: "test-admin-password" }),
      }),
      env,
      ctx,
    );
    expect(response?.status).toBe(200);
    const setCookie = response?.headers.get("Set-Cookie") || "";
    expect(setCookie).toContain("moina_admin_session=");
    expect(setCookie).toContain("Path=/;");
    expect(setCookie).toContain("HttpOnly");
    const cookie = setCookie.split(";")[0];
    const voiceRequest = new Request("https://askmoina.test/api/voice/socket", {
      headers: { Cookie: cookie },
    });
    await expect(isAdmin(voiceRequest, env)).resolves.toBe(true);
    await expect(isAdmin(new Request("https://askmoina.test/api/voice/socket"), env)).resolves.toBe(false);

    const logout = await handleContinuityRequest(
      new Request("https://askmoina.test/admin/logout", {
        method: "POST",
        headers: { Origin: "https://askmoina.test", Cookie: cookie },
      }),
      env,
      ctx,
    );
    expect(logout?.status).toBe(200);
    const clearedCookies = logout?.headers.get("Set-Cookie") || "";
    expect(clearedCookies).toContain("Path=/;");
    expect(clearedCookies).toContain("Path=/admin;");
  });

  it("shows the voice audition lab link on the authenticated admin dashboard", async () => {
    const env = {
      ...mockEnv(),
      ADMIN_DASHBOARD_USER: "admin",
      ADMIN_DASHBOARD_PASSWORD: "test-admin-password",
      ADMIN_SESSION_SECRET: "test-session-secret-with-sufficient-entropy",
    } as unknown as Env;
    const login = await handleContinuityRequest(
      new Request("https://askmoina.test/admin/login", {
        method: "POST",
        headers: { Origin: "https://askmoina.test", "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "test-admin-password" }),
      }),
      env,
      ctx,
    );
    expect(login?.status).toBe(200);
    const cookie = (login?.headers.get("Set-Cookie") || "").split(";")[0];
    const dashboard = await handleContinuityRequest(
      new Request("https://askmoina.test/admin", { headers: { Cookie: cookie } }),
      env,
      ctx,
    );
    expect(dashboard?.status).toBe(200);
    expect(await dashboard?.text()).toContain('href="/voice-lab">Voice audition lab</a>');
  });

  it("requires an authenticated admin session before returning dashboard APIs", async () => {
    const response = await handleContinuityRequest(
      new Request("https://askmoina.test/admin/api/overview"),
      mockEnv(), ctx,
    );
    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({ error: "unauthorized" });
  });

  it("does not serve the retired Vault or cross-tab memory injector", async () => {
    for (const path of ["/vault", "/vault.js", "/continuity.js", "/api/vault/123e4567-e89b-42d3-a456-426614174000"]) {
      expect(await handleContinuityRequest(new Request("https://askmoina.test" + path), mockEnv(), ctx)).toBeNull();
    }
  });
});

