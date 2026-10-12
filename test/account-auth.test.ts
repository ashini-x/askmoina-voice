import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { handleAuthRequest, getAuthenticatedUserId } from "../src/auth/accounts";
import type { Env } from "../src/config/env";
const ctx = { waitUntil(_promise: Promise<unknown>) {} } as unknown as ExecutionContext;
function envMock(): Env {
  const db = { prepare(_sql: string) { return {
    bind(..._args: unknown[]) { return this; },
    async run() { return { meta: { changes: 0 } }; },
    async first<T>() { return null as T | null; },
    async all<T>() { return { results: [] as T[] }; },
  }; } };
  const assets = { async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    return new Response(path === "/login.html" ? "Face ID Touch ID Phone number + OTP"
      : path === "/account.html" ? "Your AskMoina ID" : "auth", { status: 200 });
  } };
  return { DB: db, ASSETS: assets } as unknown as Env;
}
describe("unique account ID and no-guest access", () => {
  it("presents all three signup and login methods", async () => {
    const r = await handleAuthRequest(new Request("https://askmoina.test/login"), envMock());
    expect(r?.status).toBe(200);
    const body = await r?.text();
    expect(body).toContain("Face ID");
    expect(body).toContain("Touch ID");
    expect(body).toContain("Phone number + OTP");
  });
  it("does not treat a browser cookie as an account identity", async () => {
    const r = new Request("https://askmoina.test/", { headers: { Cookie: "moina_visitor=" + "A".repeat(43) } });
    expect(await getAuthenticatedUserId(r, envMock())).toBeNull();
  });
  it("denies guest voice status and redirects from home and camera co-pilot", async () => {
    const env = envMock();
    const status = await worker.fetch(new Request("https://askmoina.test/api/voice/status"), env, ctx);
    expect(status.status).toBe(401);
    expect(await status.json()).toMatchObject({ error: "authentication_required" });
    for (const path of ["/", "/copilot"]) {
      const response = await worker.fetch(new Request("https://askmoina.test" + path), env, ctx);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("https://askmoina.test/login");
    }
  });
  it("redirects the account page for an unauthenticated request", async () => {
    const r = await handleAuthRequest(new Request("https://askmoina.test/account"), envMock());
    expect(r?.status).toBe(302);
    expect(r?.headers.get("Location")).toBe("https://askmoina.test/login");
  });
});
