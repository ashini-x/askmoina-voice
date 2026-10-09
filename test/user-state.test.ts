import { describe, expect, it } from "vitest";
import type { DurableObjectState } from "@cloudflare/workers-types";
import type { Env } from "../src/config/env";
import { UserState } from "../src/sessions/user-state";

class MemoryStorage {
  private values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async transaction<T>(callback: (transaction: unknown) => Promise<T>): Promise<T> {
    // A single test instance is sequential, so this mock is sufficient for contract tests.
    return callback(this);
  }
}

function makeState() {
  const storage = new MemoryStorage();
  const state = { storage } as unknown as DurableObjectState;
  const env = { ENVIRONMENT: "test" } as Env;
  return { userState: new UserState(state, env), storage };
}

async function acquire(
  userState: UserState,
  input: {
    sessionId: string;
    now: number;
    maxSessionSeconds?: number;
    maxDailySeconds?: number;
    maxConcurrentSessions?: number;
    enforceRateLimit?: boolean;
  },
) {
  return userState.fetch(
    new Request("https://user-state/session/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

async function release(userState: UserState, sessionId: string, now: number) {
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
      maxDailySeconds: 1_800,
      maxConcurrentSessions: 1,
      enforceRateLimit: true,
    });
    expect(first.status).toBe(200);
    expect((await first.json() as { allowed: boolean }).allowed).toBe(true);

    const secondWhileActive = await acquire(userState, {
      sessionId: "second",
      now: TODAY + 1_000,
      maxSessionSeconds: 300,
      maxDailySeconds: 1_800,
      maxConcurrentSessions: 1,
      enforceRateLimit: true,
    });
    expect(secondWhileActive.status).toBe(429);
    expect((await secondWhileActive.json() as { reason: string }).reason).toBe("concurrent_session_limit");

    const released = await release(userState, "first", TODAY + 60_000);
    expect(released.status).toBe(200);

    const secondAfterRelease = await acquire(userState, {
      sessionId: "second",
      now: TODAY + 61_000,
      maxSessionSeconds: 300,
      maxDailySeconds: 1_800,
      maxConcurrentSessions: 1,
      enforceRateLimit: true,
    });
    expect(secondAfterRelease.status).toBe(200);
    expect((await secondAfterRelease.json() as { allowed: boolean }).allowed).toBe(true);
  });

  it("rejects the sixth handshake request in a rolling one-minute window", async () => {
    const { userState } = makeState();
    const responses = [];
    for (let index = 0; index < 6; index += 1) {
      responses.push(await acquire(userState, {
        sessionId: "session-" + index,
        now: TODAY + index * 1_000,
        maxSessionSeconds: 30,
        maxDailySeconds: 3_600,
        maxConcurrentSessions: 10,
        enforceRateLimit: true,
      }));
    }

    expect(responses.slice(0, 5).every((response) => response.status === 200)).toBe(true);
    expect(responses[5].status).toBe(429);
    expect((await responses[5].json() as { reason: string }).reason).toBe("rate_limited");
  });

  it("does not allow session reservations to exceed the daily budget", async () => {
    const { userState, storage } = makeState();
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
    expect((await third.json() as { reason: string }).reason).toBe("daily_session_limit");

    // All stored values are internal and contain only counters/session metadata.
    expect([...((storage as any).values as Map<string, unknown>).values()].length).toBe(1);
  });
});
