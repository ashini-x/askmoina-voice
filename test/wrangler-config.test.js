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
  it("enables only the private Veda portal while keeping the listening runtime disabled", () => {
    expect(config.vars.VEDA_PORTAL_ENABLED).toBe("true");
    expect(config.previews?.vars?.VEDA_PORTAL_ENABLED).toBe("true");
    expect(config.vars.VEDA_ENABLED).toBe("false");
    expect(config.previews?.vars?.VEDA_ENABLED).toBe("false");
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

  it("declares the isolated Veda session namespace as SQLite-backed", () => {
    expect(config.exports?.VedaSessionState).toEqual({
      type: "durable-object",
      storage: "sqlite",
    });
    expect(config.durable_objects?.bindings).toEqual(
      expect.arrayContaining([{ name: "VEDA_SESSION_STATE", class_name: "VedaSessionState" }]),
    );
    expect(config.previews?.durable_objects?.bindings).toEqual(
      expect.arrayContaining([{ name: "VEDA_SESSION_STATE", class_name: "VedaSessionState" }]),
    );
  });

  it("keeps the Veda DB binding separate from both AskMoina databases", () => {
    const vedaProd = config.d1_databases.find((db) => db.binding === "VEDA_DB");
    const vedaPreview = config.previews?.d1_databases?.find((db) => db.binding === "VEDA_DB");
    const askMoinaProd = config.d1_databases.find((db) => db.binding === "DB");
    const askMoinaPreview = config.previews?.d1_databases?.find((db) => db.binding === "DB");
    expect(vedaProd).toMatchObject({ database_name: "veda-prod", migrations_dir: "migrations/veda" });
    expect(vedaPreview).toMatchObject({ database_name: "veda-preview", migrations_dir: "migrations/veda" });
    expect(vedaProd.database_id).not.toBe(askMoinaProd.database_id);
    expect(vedaPreview.database_id).not.toBe(askMoinaPreview.database_id);
    expect(vedaProd.database_id).not.toBe(vedaPreview.database_id);
  });

});
