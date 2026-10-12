import type { Env } from "../config/env";

interface VoiceSession {
  startedAt: number;
  lastHeartbeatAt?: number;
  reservedSeconds: number;
  usageDate: string;
}

interface GuardRecord {
  windowStart: number;
  requestCount: number;
  usageDate: string;
  dailySeconds: number;
  sessions: Record<string, VoiceSession>;
}

const STORAGE_KEY = "voice-guard";
const RATE_WINDOW_MS = 60_000;
const IP_REQUESTS_PER_MINUTE = 20;
const MAX_SUPPORTED_SESSION_SECONDS = 540;
const MAX_SUPPORTED_DAILY_SECONDS = 36_000;
const MAX_SUPPORTED_CONCURRENT_SESSIONS = 100;
const STALE_SESSION_GRACE_MS = 60_000;
const SESSION_LEASE_TIMEOUT_MS = 45_000;

function indiaDate(now: number): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10);
}

function positiveInt(value: unknown, fallback: number, maximum: number): number {
  const parsed = typeof value === "number" ? Math.floor(value) : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function newRecord(now: number): GuardRecord {
  return {
    windowStart: now,
    requestCount: 0,
    usageDate: indiaDate(now),
    dailySeconds: 0,
    sessions: {},
  };
}

function isSessionStale(session: VoiceSession, now: number): boolean {
  const hardExpiry = session.startedAt + session.reservedSeconds * 1_000 + STALE_SESSION_GRACE_MS;
  // Sessions written before the lease field existed are treated as having
  // last checked in when they started, so old orphaned locks self-heal.
  const lastHeartbeatAt = Number.isFinite(session.lastHeartbeatAt)
    ? Number(session.lastHeartbeatAt)
    : session.startedAt;
  return now > hardExpiry || now - lastHeartbeatAt > SESSION_LEASE_TIMEOUT_MS;
}

function cleanStaleSessions(record: GuardRecord, now: number): void {
  for (const [sessionId, session] of Object.entries(record.sessions)) {
    if (!isSessionStale(session, now)) continue;

    delete record.sessions[sessionId];
    // Refund unused reserved time for abandoned sessions; retain elapsed time
    // so a lost connection cannot repeatedly obtain free voice usage.
    if (record.usageDate === session.usageDate) {
      const elapsed = Math.min(
        session.reservedSeconds,
        Math.max(0, Math.ceil((now - session.startedAt) / 1_000)),
      );
      record.dailySeconds = Math.max(0, record.dailySeconds - session.reservedSeconds + elapsed);
    }
  }
}

export class UserState {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/session/status") {
      let input: {
        now?: number;
        maxDailySeconds?: number;
        maxConcurrentSessions?: number;
        enforceRateLimit?: boolean;
        enforceDailyLimit?: boolean;
      };
      try {
        input = (await request.json()) as typeof input;
      } catch {
        return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
      }

      const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
      const maxDailySeconds = positiveInt(input.maxDailySeconds, 1_800, MAX_SUPPORTED_DAILY_SECONDS);
      const maxConcurrentSessions = positiveInt(
        input.maxConcurrentSessions,
        1,
        MAX_SUPPORTED_CONCURRENT_SESSIONS,
      );
      const record = await this.state.storage.transaction(async (transaction) => {
        const stored = await transaction.get<GuardRecord>(STORAGE_KEY);
        if (!stored) return newRecord(now);
        const current = stored;
        const sessionCountBefore = Object.keys(current.sessions).length;
        cleanStaleSessions(current, now);
        if (Object.keys(current.sessions).length !== sessionCountBefore) {
          await transaction.put(STORAGE_KEY, current);
        }
        return current;
      });
      const currentDate = indiaDate(now);
      const sameDay = record.usageDate === currentDate;
      const rateWindowActive = now >= record.windowStart && now - record.windowStart < RATE_WINDOW_MS;
      const currentRequestCount = rateWindowActive ? record.requestCount : 0;
      const activeSessions = Object.values(record.sessions).filter((session) => !isSessionStale(session, now)).length;
      const enforceDailyLimit = input.enforceDailyLimit !== false;
      const dailySecondsRemaining = enforceDailyLimit
        ? Math.max(0, maxDailySeconds - (sameDay ? record.dailySeconds : 0))
        : maxDailySeconds;
      const requestsRemaining = input.enforceRateLimit
        ? Math.max(0, IP_REQUESTS_PER_MINUTE - currentRequestCount)
        : null;
      const rateLimited = Boolean(
        input.enforceRateLimit && rateWindowActive && currentRequestCount >= IP_REQUESTS_PER_MINUTE,
      );
      const retryAfterSeconds = rateLimited
        ? Math.max(1, Math.ceil((record.windowStart + RATE_WINDOW_MS - now) / 1_000))
        : 0;

      return Response.json({
        ok: true,
        dailySecondsRemaining,
        activeSessions,
        requestsRemaining,
        retryAfterSeconds,
        rateLimited,
        concurrencyLimited: activeSessions >= maxConcurrentSessions,
        dailyLimitReached: enforceDailyLimit && dailySecondsRemaining <= 0,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "POST" && url.pathname === "/session/acquire") {
      let input: {
        sessionId?: string;
        now?: number;
        maxSessionSeconds?: number;
        maxDailySeconds?: number;
        maxConcurrentSessions?: number;
        enforceRateLimit?: boolean;
        enforceDailyLimit?: boolean;
        rateLimitOnly?: boolean;
      };
      try {
        input = (await request.json()) as typeof input;
      } catch {
        return Response.json({ allowed: false, reason: "invalid_request" }, { status: 400 });
      }

      const sessionId = input.sessionId;
      if (!sessionId || sessionId.length > 100) {
        return Response.json({ allowed: false, reason: "invalid_request" }, { status: 400 });
      }

      const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
      const maxSessionSeconds = positiveInt(
        input.maxSessionSeconds,
        540,
        MAX_SUPPORTED_SESSION_SECONDS,
      );
      const maxDailySeconds = positiveInt(
        input.maxDailySeconds,
        1_800,
        MAX_SUPPORTED_DAILY_SECONDS,
      );
      const maxConcurrentSessions = positiveInt(
        input.maxConcurrentSessions,
        1,
        MAX_SUPPORTED_CONCURRENT_SESSIONS,
      );

      const result = await this.state.storage.transaction(async (transaction) => {
        const stored = await transaction.get<GuardRecord>(STORAGE_KEY);
        const record = stored ?? newRecord(now);
        const currentDate = indiaDate(now);

        if (record.usageDate !== currentDate) {
          record.usageDate = currentDate;
          record.dailySeconds = 0;
        }
        if (now - record.windowStart >= RATE_WINDOW_MS || now < record.windowStart) {
          record.windowStart = now;
          record.requestCount = 0;
        }
        cleanStaleSessions(record, now);

        if (input.enforceRateLimit) {
          record.requestCount += 1;
          if (record.requestCount > IP_REQUESTS_PER_MINUTE) {
            await transaction.put(STORAGE_KEY, record);
            return { allowed: false, reason: "rate_limited" as const };
          }
        }

        if (input.rateLimitOnly) {
          await transaction.put(STORAGE_KEY, record);
          return { allowed: true, reason: "rate_limit_checked" as const, reservedSeconds: maxSessionSeconds };
        }

        if (Object.keys(record.sessions).length >= maxConcurrentSessions) {
          await transaction.put(STORAGE_KEY, record);
          return { allowed: false, reason: "concurrent_session_limit" as const };
        }

        if (input.enforceDailyLimit !== false && record.dailySeconds >= maxDailySeconds) {
          await transaction.put(STORAGE_KEY, record);
          return { allowed: false, reason: "daily_session_limit" as const };
        }

        const reservedSeconds = input.enforceDailyLimit === false
          ? maxSessionSeconds
          : Math.min(maxSessionSeconds, maxDailySeconds - record.dailySeconds);
        record.sessions[sessionId] = {
          startedAt: now,
          lastHeartbeatAt: now,
          reservedSeconds,
          usageDate: currentDate,
        };
        record.dailySeconds += reservedSeconds;
        await transaction.put(STORAGE_KEY, record);
        return { allowed: true, reason: "reserved" as const, reservedSeconds };
      });

      return Response.json(result, {
        status: result.allowed ? 200 : 429,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (request.method === "POST" && url.pathname === "/session/heartbeat") {
      let input: { sessionId?: string; now?: number };
      try {
        input = (await request.json()) as typeof input;
      } catch {
        return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
      }
      if (!input.sessionId || input.sessionId.length > 100) {
        return Response.json({ ok: false, reason: "invalid_request" }, { status: 400 });
      }
      const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();

      const renewed = await this.state.storage.transaction(async (transaction) => {
        const record = await transaction.get<GuardRecord>(STORAGE_KEY);
        if (!record) return false;
        cleanStaleSessions(record, now);
        const session = record.sessions[input.sessionId!];
        if (!session) {
          await transaction.put(STORAGE_KEY, record);
          return false;
        }
        const hardExpiry = session.startedAt + session.reservedSeconds * 1_000 + STALE_SESSION_GRACE_MS;
        if (now > hardExpiry) {
          cleanStaleSessions(record, now);
          await transaction.put(STORAGE_KEY, record);
          return false;
        }
        session.lastHeartbeatAt = now;
        await transaction.put(STORAGE_KEY, record);
        return true;
      });

      return Response.json(
        { ok: renewed, reason: renewed ? "renewed" : "session_not_found" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (request.method === "POST" && url.pathname === "/session/release") {
      let input: { sessionId?: string; now?: number };
      try {
        input = (await request.json()) as typeof input;
      } catch {
        return Response.json({ ok: false }, { status: 400 });
      }
      if (!input.sessionId) return Response.json({ ok: false }, { status: 400 });
      const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();

      await this.state.storage.transaction(async (transaction) => {
        const record = await transaction.get<GuardRecord>(STORAGE_KEY);
        const session = record?.sessions[input.sessionId!];
        if (!record || !session) return;

        delete record.sessions[input.sessionId!];
        if (record.usageDate === session.usageDate) {
          const elapsed = Math.min(
            session.reservedSeconds,
            Math.max(0, Math.ceil((now - session.startedAt) / 1_000)),
          );
          record.dailySeconds = Math.max(
            0,
            record.dailySeconds - session.reservedSeconds + elapsed,
          );
        }
        await transaction.put(STORAGE_KEY, record);
      });

      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        component: "user-state",
        environment: this.env.ENVIRONMENT || "unknown",
      });
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  }
}
