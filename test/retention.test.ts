import { describe, expect, it } from "vitest";
import { runRetentionMaintenance } from "../src/maintenance/retention";
import type { Env } from "../src/config/env";

type RecordedQuery = { sql: string; params: unknown[] };

function mockEnv(options?: { changes?: number; throwOn?: string }) {
  const queries: RecordedQuery[] = [];
  const db = {
    prepare(sql: string) {
      let params: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          params = values;
          return this;
        },
        async run() {
          queries.push({ sql, params });
          if (options?.throwOn && sql.trimStart().startsWith("DELETE FROM " + options.throwOn)) {
            throw new Error("mock database failure");
          }
          return { meta: { changes: options?.changes ?? 0 } };
        },
      };
    },
  };
  return { env: { DB: db } as unknown as Pick<Env, "DB" | "ANALYTICS_RAW_RETENTION_DAYS">, queries };
}

describe("scheduled retention maintenance", () => {
  it("uses the configured analytics cutoff and bounded indexed deletes", async () => {
    const { env, queries } = mockEnv({ changes: 2 });
    const fixedNow = Date.parse("2026-10-10T00:00:00.000Z");
    const result = await runRetentionMaintenance(
      { ...env, ANALYTICS_RAW_RETENTION_DAYS: "30" },
      fixedNow,
    );

    expect(result.analyticsRetentionDays).toBe(30);
    expect(result.adminAuditRetentionDays).toBe(90);
    expect(queries).toHaveLength(5);
    expect(queries.every((query) => query.params[1] === 10_000)).toBe(true);
    expect(queries.find((query) => query.sql.includes("voice_sessions"))?.params[0])
      .toBe("2026-09-10T00:00:00.000Z");
    expect(queries.find((query) => query.sql.includes("admin_audit_log"))?.params[0])
      .toBe("2026-07-12T00:00:00.000Z");
    expect(result.failedTables).toEqual([]);
  });

  it("never deletes encrypted vault backups and protects referenced visitor profiles", async () => {
    const { env, queries } = mockEnv();
    await runRetentionMaintenance({ ...env, ANALYTICS_RAW_RETENTION_DAYS: "30" }, 1_800_000_000_000);

    expect(queries.some((query) => /DELETE\s+FROM\s+vault_backups/i.test(query.sql))).toBe(false);
    const visitorCleanup = queries.find((query) => query.sql.includes("DELETE FROM visitor_profiles"));
    expect(visitorCleanup?.sql).toContain("NOT EXISTS (SELECT 1 FROM voice_sessions");
    expect(visitorCleanup?.sql).toContain("NOT EXISTS (SELECT 1 FROM usage_events");
  });

  it("falls back safely for invalid retention settings", async () => {
    const { env, queries } = mockEnv();
    const result = await runRetentionMaintenance(
      { ...env, ANALYTICS_RAW_RETENTION_DAYS: "-1" },
      Date.parse("2026-10-10T00:00:00.000Z"),
    );

    expect(result.analyticsRetentionDays).toBe(30);
    expect(queries[0]?.params[0]).toBe("2026-09-10T00:00:00.000Z");
  });

  it("continues cleaning other tables if one table fails", async () => {
    const { env, queries } = mockEnv({ throwOn: "usage_events" });
    const result = await runRetentionMaintenance(
      { ...env, ANALYTICS_RAW_RETENTION_DAYS: "30" },
      Date.parse("2026-10-10T00:00:00.000Z"),
    );

    expect(result.failedTables).toEqual(["usage_events"]);
    expect(queries.some((query) => query.sql.includes("admin_audit_log"))).toBe(true);
    expect(queries.some((query) => query.sql.includes("visitor_profiles"))).toBe(true);
  });

  it("marks tables that still hit the batch limit so backlog is visible", async () => {
    const { env } = mockEnv({ changes: 10_000 });
    const result = await runRetentionMaintenance(
      { ...env, ANALYTICS_RAW_RETENTION_DAYS: "30" },
      Date.parse("2026-10-10T00:00:00.000Z"),
    );

    expect(result.tablesAtBatchLimit).toHaveLength(5);
    expect(result.batchesRun.voice_sessions).toBe(4);
  });
});
