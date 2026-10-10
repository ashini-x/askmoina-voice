import type { Env } from "../config/env";

const DEFAULT_ANALYTICS_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3_650;
const ADMIN_AUDIT_RETENTION_DAYS = 90;
const DELETE_BATCH_SIZE = 10_000;
const MAX_BATCHES_PER_TABLE_PER_RUN = 2;

type CleanupTable =
  | "voice_sessions"
  | "usage_events"
  | "admin_audit_log"
  | "admin_login_attempts"
  | "visitor_profiles";

export interface RetentionMaintenanceResult {
  analyticsRetentionDays: number;
  adminAuditRetentionDays: number;
  rowsDeleted: Record<CleanupTable, number>;
  batchesRun: Record<CleanupTable, number>;
  tablesAtBatchLimit: CleanupTable[];
  failedTables: CleanupTable[];
}

function configuredDays(value: string | undefined, fallback: number): number {
  const raw = value?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_RETENTION_DAYS);
}

/**
 * Delete old operational records in bounded, indexed batches.
 *
 * The task intentionally never deletes vault_backups: those are user-controlled
 * encrypted backups, not disposable analytics. The hourly schedule gradually
 * catches up after an outage without issuing a single unbounded DELETE.
 */
export async function runRetentionMaintenance(
  env: Pick<Env, "DB" | "ANALYTICS_RAW_RETENTION_DAYS">,
  now = Date.now(),
): Promise<RetentionMaintenanceResult> {
  const analyticsRetentionDays = configuredDays(
    env.ANALYTICS_RAW_RETENTION_DAYS,
    DEFAULT_ANALYTICS_RETENTION_DAYS,
  );
  const analyticsCutoff = new Date(now - analyticsRetentionDays * 24 * 60 * 60 * 1_000).toISOString();
  const auditCutoff = new Date(now - ADMIN_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString();

  const tables: Array<{ name: CleanupTable; cutoff: string; sql: string }> = [
    {
      name: "voice_sessions",
      cutoff: analyticsCutoff,
      sql: "DELETE FROM voice_sessions WHERE rowid IN (SELECT rowid FROM voice_sessions WHERE started_at < ? ORDER BY started_at ASC LIMIT ?)",
    },
    {
      name: "usage_events",
      cutoff: analyticsCutoff,
      sql: "DELETE FROM usage_events WHERE rowid IN (SELECT rowid FROM usage_events WHERE created_at < ? ORDER BY created_at ASC LIMIT ?)",
    },
    {
      name: "admin_audit_log",
      cutoff: auditCutoff,
      sql: "DELETE FROM admin_audit_log WHERE rowid IN (SELECT rowid FROM admin_audit_log WHERE created_at < ? ORDER BY created_at ASC LIMIT ?)",
    },
    {
      name: "admin_login_attempts",
      cutoff: analyticsCutoff,
      sql: "DELETE FROM admin_login_attempts WHERE rowid IN (SELECT rowid FROM admin_login_attempts WHERE updated_at < ? ORDER BY updated_at ASC LIMIT ?)",
    },
    {
      name: "visitor_profiles",
      cutoff: analyticsCutoff,
      sql: "DELETE FROM visitor_profiles WHERE rowid IN (SELECT p.rowid FROM visitor_profiles AS p WHERE p.last_seen_at < ? AND NOT EXISTS (SELECT 1 FROM voice_sessions AS s WHERE s.visitor_id = p.visitor_id) AND NOT EXISTS (SELECT 1 FROM usage_events AS u WHERE u.user_id = p.visitor_id) ORDER BY p.last_seen_at ASC LIMIT ?)",
    },
  ];

  const rowsDeleted: Record<CleanupTable, number> = {
    voice_sessions: 0,
    usage_events: 0,
    admin_audit_log: 0,
    admin_login_attempts: 0,
    visitor_profiles: 0,
  };
  const batchesRun: Record<CleanupTable, number> = {
    voice_sessions: 0,
    usage_events: 0,
    admin_audit_log: 0,
    admin_login_attempts: 0,
    visitor_profiles: 0,
  };
  const failedTables: CleanupTable[] = [];
  const tablesAtBatchLimit: CleanupTable[] = [];

  for (const table of tables) {
    let hitBatchLimit = true;
    for (let batch = 0; batch < MAX_BATCHES_PER_TABLE_PER_RUN; batch += 1) {
      try {
        const result = await env.DB.prepare(table.sql)
          .bind(table.cutoff, DELETE_BATCH_SIZE)
          .run();
        const deleted = Math.max(0, Number(result.meta?.changes ?? 0));
        rowsDeleted[table.name] += deleted;
        batchesRun[table.name] += 1;
        if (deleted < DELETE_BATCH_SIZE) {
          hitBatchLimit = false;
          break;
        }
      } catch (error) {
        failedTables.push(table.name);
        hitBatchLimit = false;
        console.error("[AskMoina] Retention cleanup failed", JSON.stringify({
          table: table.name,
          error: error instanceof Error ? error.name : "unknown",
        }));
        break;
      }
    }
    if (hitBatchLimit && !failedTables.includes(table.name)) tablesAtBatchLimit.push(table.name);
  }

  const result: RetentionMaintenanceResult = {
    analyticsRetentionDays,
    adminAuditRetentionDays: ADMIN_AUDIT_RETENTION_DAYS,
    rowsDeleted,
    batchesRun,
    tablesAtBatchLimit,
    failedTables,
  };

  console.info("[AskMoina] Retention maintenance completed", JSON.stringify(result));
  return result;
}
