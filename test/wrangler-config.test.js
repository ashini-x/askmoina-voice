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

  it("enables the daily quota bypass only for authenticated admin sessions", () => {
    expect(config.vars?.ADMIN_VOICE_DAILY_QUOTA_BYPASS).toBe("true");
    expect(config.vars?.MAX_LIVE_SESSION_SECONDS).toBe("540");
    expect(config.vars?.MAX_CONCURRENT_SESSIONS_PER_USER).toBe("1");
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
});
