import { describe, expect, it } from "vitest";
import { UserState } from "../src/sessions/user-state";

class MemoryStorage {
  values = new Map();

  async get(key) {
    return this.values.get(key);
  }

  async put(key, value) {
    this.values.set(key, structuredClone(value));
  }

  async transaction(callback) {
    // This mock executes sequentially; the production Durable Object provides atomic storage transactions.
    return callback(this);
  }
}

function makeState() {
  const storage = new MemoryStorage();
  const state = { storage };
  return { userState: new UserState(state, { ENVIRONMENT: "test" }), storage };
}

async function acquire(userState, input) {
  return userState.fetch(
    new Request("https://user-state/session/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

async function status(userState, input) {
  return userState.fetch(
    new Request("https://user-state/session/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

async function release(userState, sessionId, now) {
  return userState.fetch(
    new Request("https://user-state/session/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, now }),
    }),
  );
}

const TODAY = Date.UTC(2026, 9, 9, 1, 0, 0);

describe("AskMoina voice session guard", () => {
  it("allows only one active session per IP object and releases its reservation", async () => {
    const { userState } = makeState();

    const first = await acquire(userState, {
      sessionId: "first",
      now: TODAY,
      maxSessionSeconds: 300,
      maxDailySeconds: 1800,
      maxConcurrentSessions: 1,
      enforceRateLimit: true,
    });
    expect(first.status).toBe(200);
    expect((await first.json()).allowed).toBe(true);

    const secondWhileActive = await acquire(userState, {
      sessionId: "second",
      now: TODAY + 1000,
      maxSessionSeconds: 300,
      maxDailySeconds: 1800,
      maxConcurrentSessions: 1,
      enforceRateLimit: true,
    });
    expect(secondWhileActive.status).toBe(429);
    expect((await secondWhileActive.json()).reason).toBe("concurrent_session_limit");

    const released = await release(userState, "first", TODAY + 60_000);
    expect(released.status).toBe(200);

    const secondAfterRelease = await acquire(userState, {
      sessionId: "second",
      now: TODAY + 61_000,
      maxSessionSeconds: 300,
      maxDailySeconds: 1800,
      maxConcurrentSessions: 1,
      enforceRateLimit: true,
    });
    expect(secondAfterRelease.status).toBe(200);
    expect((await secondAfterRelease.json()).allowed).toBe(true);
  });

  it("reports active sessions and daily time without reserving usage", async () => {
    const { userState, storage } = makeState();
    const limits = {
      now: TODAY,
      maxDailySeconds: 1800,
      maxConcurrentSessions: 1,
      enforceRateLimit: true,
    };

    const before = await status(userState, limits);
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({
      ok: true,
      dailySecondsRemaining: 1800,
      activeSessions: 0,
      requestsRemaining: 20,
      rateLimited: false,
      concurrencyLimited: false,
      dailyLimitReached: false,
    });
    expect(storage.values.size).toBe(0);

    await acquire(userState, {
      sessionId: "active",
      now: TODAY,
      maxSessionSeconds: 300,
      maxDailySeconds: 1800,
      maxConcurrentSessions: 1,
      enforceRateLimit: true,
    });
    const during = await status(userState, limits);
    expect(await during.json()).toMatchObject({ activeSessions: 1, concurrencyLimited: true });
  });

  it("explains how long until the connection-attempt limit resets", async () => {
    const { userState } = makeState();
    for (let index = 0; index < 21; index += 1);
      await acquire(userState, {
        sessionId: "limited-" + index,
        now: TODAY + index * 1000,
        maxSessionSeconds: 30,
        maxDailySeconds: 3600,
        maxConcurrentSessions: 10,
        enforceRateLimit: true,
      });
    }
    const response = await status(userState, {
      now: TODAY + 21_000,
      maxDailySeconds: 3600,
      maxConcurrentSessions: 10,
      enforceRateLimit: true,
    });
    expect(await response.json()).toMatchObject({
      rateLimited: true,
      retryAfterSeconds: 39,
      requestsRemaining: 0,
    });
  });

  it("rejects the 21st handshake request in one minute", async () => {
    const { userState } = makeState();
    const responses = [];

    for (let index = 0; index < 21; index += 1) {
      responses.push(await acquire(userState, {
        sessionId: "session-" + index,
        now: TODAY + index * 1000,
        maxSessionSeconds: 30,
        maxDailySeconds: 3600,
        maxConcurrentSessions: 10,
        enforceRateLimit: true,
      }));
    }

    expect(responses.slice(0, 20).every((response) => response.status === 200)).toBe(true);
    expect(responses[20].status).toBe(429);
    expect((await responses[20].json()).reason).toBe("rate_limited");
  });

  it("never bypasses the daily budget even if a caller sends the old testing flag", async () => {
    const { userState, storage } = makeState();
    const first = await acquire(userState, {
      sessionId: "old-test-flag",
      now: TODAY,
      maxSessionSeconds: 300,
      maxDailySeconds: 100,
      maxConcurrentSessions: 5,
      enforceRateLimit: false,
      bypassDailyLimit: true,
    });
    expect(first.status).toBe(200);
    expect((await first.json()).reservedSeconds).toBe(100);
    await release(userState, "old-test-flag", TODAY + 100_000);
    expect(storage.values.get("voice-guard").dailySeconds).toBe(100);

    const next = await acquire(userState, {
      sessionId: "after-budget",
      now: TODAY + 101_000,
      maxSessionSeconds: 300,
      maxDailySeconds: 100,
      maxConcurrentSessions: 5,
      enforceRateLimit: false,
      bypassDailyLimit: true,
    });
    expect(next.status).toBe(429);
    expect((await next.json()).reason).toBe("daily_session_limit");
  });

  it("bypasses the daily budget only when the trusted caller explicitly disables it", async () => {
    const { userState } = makeState();
    const first = await acquire(userState, {
      sessionId: "daily-cap-first",
      now: TODAY,
      maxSessionSeconds: 100,
      maxDailySeconds: 100,
      maxConcurrentSessions: 1,
      enforceRateLimit: true,
    });
    expect(first.status).toBe(200);
    await release(userState, "daily-cap-first", TODAY + 100_000);

    const adminTestingSession = await acquire(userState, {
      sessionId: "admin-test-second",
      now: TODAY + 101_000,
      maxSessionSeconds: 300,
      maxDailySeconds: 100,
      maxConcurrentSessions: 1,
      enforceRateLimit: true,
      enforceDailyLimit: false,
    });
    expect(adminTestingSession.status).toBe(200);
    expect(await adminTestingSession.json()).toMatchObject({ allowed: true, reservedSeconds: 300 });

    const statusForAdmin = await status(userState, {
      now: TODAY + 101_000,
      maxDailySeconds: 100,
      maxConcurrentSessions: 1,
      enforceRateLimit: true,
      enforceDailyLimit: false,
    });
    expect(await statusForAdmin.json()).toMatchObject({
      dailyLimitReached: false,
      activeSessions: 1,
      concurrencyLimited: true,
    });

    const concurrentAttempt = await acquire(userState, {
      sessionId: "admin-test-third",
      now: TODAY + 102_000,
      maxSessionSeconds: 300,
      maxDailySeconds: 100,
      maxConcurrentSessions: 1,
      enforceRateLimit: true,
      enforceDailyLimit: false,
    });
    expect(concurrentAttempt.status).toBe(429);
    expect((await concurrentAttempt.json()).reason).toBe("concurrent_session_limit");
  });

  it("does not allow reservations to exceed the daily budget", async () => {
    const { userState } = makeState();

    const first = await acquire(userState, {
      sessionId: "a",
      now: TODAY,
      maxSessionSeconds: 300,
      maxDailySeconds: 500,
      maxConcurrentSessions: 5,
      enforceRateLimit: true,
    });
    expect(first.status).toBe(200);
    await release(userState, "a", TODAY + 300_000);

    const second = await acquire(userState, {
      sessionId: "b",
      now: TODAY + 301_000,
      maxSessionSeconds: 300,
      maxDailySeconds: 500,
      maxConcurrentSessions: 5,
      enforceRateLimit: true,
    });
    expect(second.status).toBe(200);
    await release(userState, "b", TODAY + 501_000);

    const exhausted = await status(userState, {
      now: TODAY + 502_000,
      maxDailySeconds: 500,
      maxConcurrentSessions: 5,
      enforceRateLimit: false,
    });
    expect(await exhausted.json()).toMatchObject({
      dailySecondsRemaining: 0,
      dailyLimitReached: true,
    });

    const third = await acquire(userState, {
      sessionId: "c",
      now: TODAY + 502_000,
      maxSessionSeconds: 300,
      maxDailySeconds: 500,
      maxConcurrentSessions: 5,
      enforceRateLimit: true,
    });
    expect(third.status).toBe(429);
    expect((await third.json()).reason).toBe("daily_session_limit");
  });
});
