import { afterEach, describe, expect, it } from "vitest";
import { handleConversationRequest, mergeConversationSummary } from "../src/conversations";
import type { Env } from "../src/config/env";

describe("rolling conversation summary", () => {
  it("keeps the original goal and prior exchanges when later turns are saved", () => {
    const first = mergeConversationSummary("", [
      "Goal: Repair the laptop without losing data",
      "Latest user request: The fan is loud and Windows will not start.",
      "Latest Moina response: First, unplug power and check the vent.",
      "Current state: Device is powered down",
      "Next action: Check the charger and ventilation",
      "Constraints: Do not erase the drive",
    ].join("\n"));
    const second = mergeConversationSummary(first, [
      "Goal: Repair the laptop without losing data",
      "Latest user request: The charging light is now on.",
      "Latest Moina response: Good. Try the power button once and tell me whether the logo appears.",
      "Current state: Charging light is on",
      "Next action: Observe the boot logo",
      "Constraints: Do not erase the drive",
    ].join("\n"));

    expect(second).toContain("Original goal: Repair the laptop without losing data");
    expect(second).toContain("Earlier context:");
    expect(second).toContain("User: The fan is loud and Windows will not start.");
    expect(second).toContain("Moina: First, unplug power and check the vent.");
    expect(second).toContain("User: The charging light is now on.");
    expect(second).toContain("Moina: Good. Try the power button once");
    expect(second).toContain("Current state: Device is powered down");
    expect(second).toContain("Current state: Charging light is on");
    expect(second).toContain("Next action: Observe the boot logo");
    expect(second.length).toBeLessThanOrEqual(4_000);
  });

  it("bounds the rolling summary while retaining earlier and latest notes", () => {
    let summary = mergeConversationSummary("", [
      "Goal: Keep the synthetic device safe",
      "Latest user request: " + "early-detail ".repeat(250),
      "Latest Moina response: First guidance",
      "Current state: Initial state",
    ].join("\n"));
    for (let index = 0; index < 12; index += 1) {
      summary = mergeConversationSummary(summary, [
        "Goal: Keep the synthetic device safe",
        "Latest user request: New request " + index + " " + "recent-detail ".repeat(100),
        "Latest Moina response: New response " + index,
        "Current state: State " + index,
        "Next action: Action " + index,
      ].join("\n"));
    }
    expect(summary.length).toBeLessThanOrEqual(4_000);
    expect(summary).toContain("Original goal: Keep the synthetic device safe");
    expect(summary).toContain("Latest exchange:");
    expect(summary).toContain("User: New request 11");
    expect(summary).toContain("Moina: New response 11");
  });

  it("adopts the incoming summary when there is no saved summary", () => {
    const summary = mergeConversationSummary("", "Goal: Set up the router\nLatest user request: The light is blinking\nLatest Moina response: Check the cable");
    expect(summary).toContain("Original goal: Set up the router");
    expect(summary).toContain("User: The light is blinking");
    expect(summary).toContain("Moina: Check the cable");
  });
});

type AnyRow = Record<string, any>;
type Session = { userId: string; expiresAt: string };

class MemoryStatement {
  args: unknown[] = [];
  constructor(private readonly db: MemoryD1, readonly sql: string) {}
  bind(...args: unknown[]) { this.args = args; return this; }
  async first<T>() { return this.db.first(this.sql, this.args) as T | null; }
  async all<T>() { return { results: this.db.all(this.sql, this.args) as T[], success: true, meta: { changes: 0 } } as any; }
  async run() { return this.db.run(this.sql, this.args); }
}

class MemoryD1 {
  sessions = new Map<string, Session>();
  conversations = new Map<string, AnyRow>();
  turns = new Map<string, AnyRow>();
  prepare(sql: string) { return new MemoryStatement(this, sql); }
  async batch(statements: MemoryStatement[]) {
    return statements.map((statement) => this.runSync(statement.sql, statement.args));
  }
  async register(token: string, userId: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
    this.sessions.set(hash, { userId, expiresAt: "2999-01-01T00:00:00.000Z" });
  }
  first(sql: string, args: unknown[]): AnyRow | null {
    if (sql.includes("FROM account_sessions s JOIN account_users u")) {
      const session = this.sessions.get(String(args[0]));
      if (!session || session.expiresAt <= String(args[1])) return null;
      return { user_id: session.userId, role: "user", status: "active" };
    }
    if (sql.includes("SELECT COUNT(*) AS total FROM conversation_turns")) {
      const [conversationId, ownerId] = args.map(String);
      return { total: Array.from(this.turns.values()).filter((turn) =>
        turn.conversation_id === conversationId && turn.owner_id === ownerId).length };
    }
    if (sql.includes("FROM conversation_turns") && sql.includes("idempotency_key = ?")) {
      const [conversationId, ownerId, key] = args.map(String);
      return Array.from(this.turns.values()).find((turn) =>
        turn.conversation_id === conversationId && turn.owner_id === ownerId && turn.idempotency_key === key) || null;
    }
    if (sql.includes("FROM conversation_turns") && sql.includes("sequence < ?")) {
      const [conversationId, ownerId, before] = args;
      return Array.from(this.turns.values()).filter((turn) =>
        turn.conversation_id === conversationId && turn.owner_id === ownerId && turn.sequence < Number(before))
        .sort((a, b) => b.sequence - a.sequence)[0] || null;
    }
    if (sql.includes("FROM conversations") && sql.includes("WHERE conversation_id = ? AND owner_id = ?")) {
      const [conversationId, ownerId] = args.map(String);
      const row = this.conversations.get(conversationId);
      return row && row.owner_id === ownerId ? { ...row } : null;
    }
    return null;
  }
  all(sql: string, args: unknown[]): AnyRow[] {
    if (sql.includes("FROM conversations") && sql.includes("WHERE owner_id = ?")) {
      const ownerId = String(args[0]);
      const statusClause = sql.includes("AND status = ?");
      const status = statusClause ? String(args[1]) : "all";
      const limit = Number(args[statusClause ? 2 : 1]);
      return Array.from(this.conversations.values()).filter((row) =>
        row.owner_id === ownerId && (status === "all" || row.status === status))
        .sort((a, b) => b.last_activity_at.localeCompare(a.last_activity_at) ||
          b.conversation_id.localeCompare(a.conversation_id)).slice(0, limit).map((row) => ({ ...row }));
    }
    if (sql.includes("FROM conversation_turns") && sql.includes("ORDER BY sequence DESC LIMIT ?")) {
      const [conversationId, ownerId, before, limit] = args;
      return Array.from(this.turns.values()).filter((turn) =>
        turn.conversation_id === String(conversationId) && turn.owner_id === String(ownerId) && turn.sequence < Number(before))
        .sort((a, b) => b.sequence - a.sequence).slice(0, Number(limit)).map((turn) => ({ ...turn }));
    }
    return [];
  }
  async run(sql: string, args: unknown[]) { return this.runSync(sql, args); }
  runSync(sql: string, args: unknown[]) {
    let changes = 0;
    if (sql.includes("INSERT INTO conversations")) {
      const [id, ownerId, title, created, updated, activity] = args.map(String);
      this.conversations.set(id, {
        conversation_id: id, owner_id: ownerId, title, summary: "", task_progress_json: "{}",
        status: "active", created_at: created, updated_at: updated, last_activity_at: activity, next_turn_sequence: 1,
      });
      changes = 1;
    } else if (sql.includes("INSERT INTO conversation_turns") && sql.includes("SELECT ?, c.conversation_id")) {
      const [turnId, role, text, key, createdAt, conversationId, ownerId, nextSequence, duplicateKey] = args;
      const conversation = this.conversations.get(String(conversationId));
      const hasKey = Array.from(this.turns.values()).some((turn) =>
        turn.conversation_id === String(conversationId) && turn.owner_id === String(ownerId) && turn.idempotency_key === String(duplicateKey));
      if (conversation && conversation.owner_id === String(ownerId) &&
          conversation.next_turn_sequence === Number(nextSequence) && !hasKey) {
        this.turns.set(String(turnId), {
          turn_id: String(turnId), conversation_id: String(conversationId), owner_id: String(ownerId),
          sequence: conversation.next_turn_sequence, role, text, idempotency_key: key, created_at: createdAt,
        });
        changes = 1;
      }
    } else if (sql.includes("UPDATE conversations SET next_turn_sequence")) {
      const [updatedAt, activityAt, summary, progress, conversationId, ownerId, sequence, turnId] = args;
      const conversation = this.conversations.get(String(conversationId));
      if (conversation && conversation.owner_id === String(ownerId) &&
          conversation.next_turn_sequence === Number(sequence) && this.turns.has(String(turnId))) {
        conversation.next_turn_sequence += 1;
        conversation.updated_at = String(updatedAt);
        conversation.last_activity_at = String(activityAt);
        if (summary !== null) conversation.summary = summary;
        if (progress !== null) conversation.task_progress_json = progress;
        changes = 1;
      }
    } else if (sql.includes("UPDATE conversations SET ") && sql.includes("WHERE conversation_id = ? AND owner_id = ?")) {
      const setClause = sql.slice(sql.indexOf(" SET ") + 5, sql.indexOf(" WHERE "));
      const columns = setClause.split(",").map((part) => part.split("=")[0].trim());
      const conversationId = String(args[columns.length]);
      const ownerId = String(args[columns.length + 1]);
      const conversation = this.conversations.get(conversationId);
      if (conversation && conversation.owner_id === ownerId) {
        columns.forEach((column, index) => {
          const property = column === "task_progress_json" ? "task_progress_json" : column;
          conversation[property] = args[index];
        });
        changes = 1;
      }
    } else if (sql.includes("DELETE FROM conversation_turns")) {
      const [conversationId, ownerId] = args.map(String);
      for (const [turnId, turn] of this.turns.entries()) {
        if (turn.conversation_id === conversationId && turn.owner_id === ownerId) {
          this.turns.delete(turnId);
          changes += 1;
        }
      }
    } else if (sql.includes("DELETE FROM conversations")) {
      const [conversationId, ownerId] = args.map(String);
      const conversation = this.conversations.get(conversationId);
      if (conversation && conversation.owner_id === ownerId) {
        this.conversations.delete(conversationId);
        changes = 1;
      }
    }
    return { success: true, meta: { changes } };
  }
}

const tokenA = "A".repeat(43);
const tokenB = "B".repeat(43);
let database: MemoryD1;
let env: Env;

async function setup() {
  database = new MemoryD1();
  await database.register(tokenA, "uid_user_a");
  await database.register(tokenB, "uid_user_b");
  env = { DB: database } as unknown as Env;
}

function request(path: string, method = "GET", token?: string, body?: unknown, origin = "https://askmoina.test") {
  const headers = new Headers();
  if (token) headers.set("Cookie", "moina_session=" + token);
  if (method !== "GET") {
    headers.set("Origin", origin);
    headers.set("Content-Type", "application/json");
  }
  return new Request("https://askmoina.test" + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function call(path: string, method = "GET", token?: string, body?: unknown, origin?: string) {
  const response = await handleConversationRequest(request(path, method, token, body, origin), env);
  if (!response) throw new Error("Conversation route did not match");
  return { response, data: await response.json() as any };
}

afterEach(async () => { database = undefined as unknown as MemoryD1; });

describe("authenticated conversation history API", () => {
  it("denies anonymous requests and requires same-origin writes", async () => {
    await setup();
    const anonymous = await call("/api/conversations");
    expect(anonymous.response.status).toBe(401);
    const wrongOrigin = await call("/api/conversations", "POST", tokenA, { title: "No CSRF" }, "https://attacker.test");
    expect(wrongOrigin.response.status).toBe(403);
  });

  it("stores finalized turns in order and restores summary plus structured task progress", async () => {
    await setup();
    const created = await call("/api/conversations", "POST", tokenA, { title: "Repair context" });
    expect(created.response.status).toBe(201);
    const id = created.data.conversation.conversationId as string;
    const userTurn = { role: "user", text: "The indicator is flashing blue.", idempotencyKey: "turn-user-1" };
    const first = await call("/api/conversations/" + id + "/turns", "POST", tokenA, userTurn);
    const replay = await call("/api/conversations/" + id + "/turns", "POST", tokenA, userTurn);
    expect(first.response.status).toBe(201);
    expect(replay.response.status).toBe(200);
    expect(replay.data.replayed).toBe(true);
    expect(replay.data.turn.turnId).toBe(first.data.turn.turnId);
    expect(replay.data.turn.sequence).toBe(first.data.turn.sequence);

    const progress = {
      goal: "Understand the blue indicator",
      currentState: "Indicator is flashing blue",
      nextAction: "Check the status legend",
      expectedEvidence: "A matching label in the device guide",
      constraints: ["Do not open the device"],
      uncertainty: "Model number not confirmed",
      recentEvents: [{ kind: "observation", text: "Blue indicator flashing" }],
    };
    const assistant = await call("/api/conversations/" + id + "/turns", "POST", tokenA, {
      role: "assistant",
      text: "Check the status legend before taking action.",
      idempotencyKey: "turn-assistant-1",
      summary: "User is checking a flashing blue indicator; confirm the model before procedural steps.",
      taskProgress: progress,
    });
    expect(assistant.response.status).toBe(201);

    const read = await call("/api/conversations/" + id, "GET", tokenA);
    expect(read.response.status).toBe(200);
    expect(read.data.turns.map((turn: any) => turn.role)).toEqual(["user", "assistant"]);
    expect(read.data.turns.map((turn: any) => turn.sequence)).toEqual([1, 2]);
    expect(read.data.conversation.summary).toContain("confirm the model");
    expect(read.data.conversation.taskProgress).toMatchObject({ goal: progress.goal, nextAction: progress.nextAction });
    expect(read.data.totalTurns).toBe(2);
  });

  it("keeps concurrent appends ordered and rejects an idempotency key reused with different content", async () => {
    await setup();
    const created = await call("/api/conversations", "POST", tokenA, {});
    const id = created.data.conversation.conversationId as string;
    const pair = await Promise.all([
      call("/api/conversations/" + id + "/turns", "POST", tokenA, {
        role: "user", text: "First distinct event", idempotencyKey: "concurrent-a",
      }),
      call("/api/conversations/" + id + "/turns", "POST", tokenA, {
        role: "assistant", text: "Second distinct event", idempotencyKey: "concurrent-b",
      }),
    ]);
    expect(pair.every((item) => item.response.status === 201)).toBe(true);
    const read = await call("/api/conversations/" + id, "GET", tokenA);
    expect(read.data.turns.map((turn: any) => turn.sequence)).toEqual([1, 2]);
    const conflict = await call("/api/conversations/" + id + "/turns", "POST", tokenA, {
      role: "user", text: "Different text", idempotencyKey: "concurrent-a",
    });
    expect(conflict.response.status).toBe(409);
  });

  it("hides another owner's conversations from reads, lists and mutations", async () => {
    await setup();
    const created = await call("/api/conversations", "POST", tokenA, { title: "Private topic" });
    const id = created.data.conversation.conversationId as string;
    const listB = await call("/api/conversations?status=all", "GET", tokenB);
    expect(listB.data.conversations).toHaveLength(0);
    expect((await call("/api/conversations/" + id, "GET", tokenB)).response.status).toBe(404);
    expect((await call("/api/conversations/" + id, "PATCH", tokenB, { title: "Hijack" })).response.status).toBe(404);
    expect((await call("/api/conversations/" + id, "DELETE", tokenB)).response.status).toBe(404);
    expect((await call("/api/conversations/" + id + "/turns", "POST", tokenB, {
      role: "user", text: "Intrusion", idempotencyKey: "attacker",
    })).response.status).toBe(404);
    const ownerRead = await call("/api/conversations/" + id, "GET", tokenA);
    expect(ownerRead.response.status).toBe(200);
    expect(ownerRead.data.conversation.title).toBe("Private topic");
  });

  it("validates empty and oversized values, archives, retains old history and deletes it on request", async () => {
    await setup();
    const created = await call("/api/conversations", "POST", tokenA, { title: "Old history" });
    const id = created.data.conversation.conversationId as string;
    expect((await call("/api/conversations/" + id + "/turns", "POST", tokenA, {
      role: "user", text: "   ", idempotencyKey: "empty",
    })).response.status).toBe(400);
    expect((await call("/api/conversations/" + id + "/turns", "POST", tokenA, {
      role: "user", text: "x".repeat(20_001), idempotencyKey: "oversized",
    })).response.status).toBe(400);
    const saved = await call("/api/conversations/" + id + "/turns", "POST", tokenA, {
      role: "user", text: "A finalized event", idempotencyKey: "old-turn",
    });
    expect(saved.response.status).toBe(201);
    const row = database.conversations.get(id);
    if (row) {
      row.created_at = "2000-01-01T00:00:00.000Z";
      row.updated_at = row.created_at;
      row.last_activity_at = row.created_at;
    }
    expect((await call("/api/conversations?status=all", "GET", tokenA)).data.conversations).toHaveLength(1);
    const archived = await call("/api/conversations/" + id, "PATCH", tokenA, {
      title: "Archived topic", status: "archived",
    });
    expect(archived.response.status).toBe(200);
    expect(archived.data.conversation.title).toBe("Archived topic");
    expect((await call("/api/conversations", "GET", tokenA)).data.conversations).toHaveLength(0);
    expect((await call("/api/conversations?status=archived", "GET", tokenA)).data.conversations).toHaveLength(1);
    const deleted = await call("/api/conversations/" + id, "DELETE", tokenA);
    expect(deleted.response.status).toBe(200);
    expect(deleted.data.deleted).toBe(true);
    expect(database.turns.size).toBe(0);
    expect((await call("/api/conversations/" + id, "GET", tokenA)).response.status).toBe(404);
  });

  it("rejects unbounded task state and unknown storage fields", async () => {
    await setup();
    const created = await call("/api/conversations", "POST", tokenA, { title: "Bounded state" });
    const id = created.data.conversation.conversationId as string;
    const progress = await call("/api/conversations/" + id, "PATCH", tokenA, {
      taskProgress: { unknownBlob: "not allowed" },
    });
    expect(progress.response.status).toBe(400);
    const extra = await call("/api/conversations/" + id + "/turns", "POST", tokenA, {
      role: "user", text: "Never store media", idempotencyKey: "media-key", audioBase64: "not-accepted",
    });
    expect(extra.response.status).toBe(400);
  });
});
