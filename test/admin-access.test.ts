import { describe, expect, it } from "vitest";
import { handleAdminRequest } from "../src/admin";
import type { Env } from "../src/config/env";

const env = {} as unknown as Env;

describe("private operations dashboard access", () => {
  it("does not expose admin APIs without a signed session", async () => {
    const response = await handleAdminRequest(new Request("https://askmoina.example/admin/api/overview"), env);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("serves a login page with a restrictive policy and no personal data", async () => {
    const response = await handleAdminRequest(new Request("https://askmoina.example/admin"), env);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
    expect(html).toContain("Personal memory contents are not available here");
    expect(html).toContain('action="/admin/login"');
  });

  it("rejects cross-origin logout requests", async () => {
    const response = await handleAdminRequest(new Request("https://askmoina.example/admin/logout", {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    }), env);
    expect(response.status).toBe(403);
  });
});