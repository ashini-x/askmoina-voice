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

  it("rejects the sixth handshake request in one minute", async () => {
    const { userState } = makeState();
    const responses = [];

    for (let index = 0; index < 6; index += 1) {
      responses.push(await acquire(userState, {
        sessionId: "session-" + index,
        now: TODAY + index * 1000,
        maxSessionSeconds: 30,
        maxDailySeconds: 3600,
        maxConcurrentSessions: 10,
        enforceRateLimit: true,
      }));
    }

    expect(responses.slice(0, 5).every((response) => response.status === 200)).toBe(true);
    expect(responses[5].status).toBe(429);
    expect((await responses[5].json()).reason).toBe("rate_limited");
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
