import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
);

describe("production Worker configuration", () => {
  it("declares UserState as a SQLite-backed Durable Object using Wrangler's current schema", () => {
    expect(config.exports?.UserState).toEqual({
      type: "durable-object",
      storage: "sqlite",
    });
  });

  it("does not configure application-owned session, daily, concurrency, or admin quota limits", () => {
    for (const key of [
      "ADMIN_VOICE_DAILY_QUOTA_BYPASS",
      "MAX_LIVE_SESSION_SECONDS",
      "MAX_DAILY_SESSION_SECONDS",
      "MAX_CONCURRENT_SESSIONS_PER_USER",
      "MAX_GLOBAL_DAILY_SESSION_SECONDS",
      "MAX_GLOBAL_CONCURRENT_SESSIONS",
    ]) {
      expect(config.vars).not.toHaveProperty(key);
    }
  });

  it("routes both voice-lab URLs through the Worker so the admin gate cannot be bypassed by static assets", () => {
    expect(config.assets?.run_worker_first).toEqual(
      expect.arrayContaining(["/voice-lab", "/voice-lab.html"]),
    );
  });

  it("declares the production credentials required by voice and admin routes", () => {
    expect(config.secrets?.required).toEqual(
      expect.arrayContaining([
        "GCP_SERVICE_ACCOUNT_JSON",
        "ADMIN_DASHBOARD_PASSWORD",
        "ADMIN_SESSION_SECRET",
      ]),
    );
  });
  it("keeps Veda disabled in production and preview until its private installation and runtime are implemented", () => {
    expect(config.vars.VEDA_ENABLED).toBe("false");
    expect(config.previews?.vars?.VEDA_ENABLED).toBe("false");
  });

  it("routes reserved Veda paths through the Worker rather than allowing static-asset bypasses", () => {
    expect(config.assets?.run_worker_first).toEqual(
      expect.arrayContaining(["/veda", "/veda/*", "/api/*"]),
    );
  });

});
