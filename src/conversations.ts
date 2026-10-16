import type { Env } from "./config/env";
import { getAuthenticatedUserId } from "./auth/accounts";
import { observeUserPreferenceFromTurn } from "./user-memory";

type Speaker = "user" | "assistant";
type TaskProgress = {
  goal?: string;
  currentState?: string;
  nextAction?: string;
  expectedEvidence?: string;
  uncertainty?: string;
  constraints?: string[];
  recentEvents?: Array<{ kind?: string; text: string; at?: string }>;
};
type ConversationRow = {
  conversation_id: string;
  owner_id: string;
  title: string;
  summary: string;
  task_progress_json: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  next_turn_sequence: number;
};
type TurnRow = {
  turn_id: string;
  conversation_id: string;
  owner_id: string;
  sequence: number;
  role: Speaker;
  text: string;
  idempotency_key: string;
  created_at: string;
};
type BodyRead = { body: Record<string, unknown> } | { response: Response };

const ROOT = "/api/conversations";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TITLE_CHARS = 120;
const MAX_SUMMARY_CHARS = 4_000;
const MAX_TASK_PROGRESS_BYTES = 12_000;
const MAX_TURN_CHARS = 20_000;
const MAX_TURN_BYTES = 48_000;
const MAX_IDEMPOTENCY_KEY_CHARS = 128;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const MAX_APPEND_RETRIES = 5;

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(body: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(body).every((key) => allowed.includes(key));
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return false;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

async function readJsonObject(request: Request): Promise<BodyRead> {
  const contentType = request.headers.get("Content-Type") || "";
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
    return { response: json({ error: "application_json_required" }, 415) };
  }
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { response: json({ error: "request_body_too_large" }, 413) };
  }

  const reader = request.body?.getReader();
  if (!reader) return { response: json({ error: "invalid_json_body" }, 400) };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { response: json({ error: "request_body_too_large" }, 413) };
      }
      chunks.push(part.value);
    }
  } catch {
    return { response: json({ error: "invalid_json_body" }, 400) };
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { response: json({ error: "invalid_json_body" }, 400) };
  }
  if (!isRecord(value)) return { response: json({ error: "json_object_required" }, 400) };
  return { body: value };
}

function parseTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_TITLE_CHARS) return null;
  return normalized;
}

function parseSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length > MAX_SUMMARY_CHARS || new TextEncoder().encode(value).byteLength > 16_000) return null;
  return value;
}

function parseTaskProgress(value: unknown): TaskProgress | null {
  if (!isRecord(value)) return null;
  const allowed = ["goal", "currentState", "nextAction", "expectedEvidence", "uncertainty", "constraints", "recentEvents"];
  if (!hasOnlyKeys(value, allowed)) return null;

  const result: TaskProgress = {};
  const fields: Array<[keyof Pick<TaskProgress, "goal" | "currentState" | "nextAction" | "expectedEvidence" | "uncertainty">, number]> = [
    ["goal", 1_000],
    ["currentState", 2_000],
    ["nextAction", 1_000],
    ["expectedEvidence", 1_000],
    ["uncertainty", 1_000],
  ];
  for (const [key, max] of fields) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const field = value[key];
      if (typeof field !== "string" || field.length > max) return null;
      result[key] = field;
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "constraints")) {
    const constraints = value.constraints;
    if (!Array.isArray(constraints) || constraints.length > 12 ||
        !constraints.every((item) => typeof item === "string" && item.length <= 300)) return null;
    result.constraints = constraints as string[];
  }
  if (Object.prototype.hasOwnProperty.call(value, "recentEvents")) {
    const events = value.recentEvents;
    if (!Array.isArray(events) || events.length > 12) return null;
    const normalized: Array<{ kind?: string; text: string; at?: string }> = [];
    for (const event of events) {
      if (!isRecord(event) || !hasOnlyKeys(event, ["kind", "text", "at"])) return null;
      if (typeof event.text !== "string" || !event.text.trim() || event.text.length > 300) return null;
      const item: { kind?: string; text: string; at?: string } = { text: event.text.trim() };
      if (Object.prototype.hasOwnProperty.call(event, "kind")) {
        if (typeof event.kind !== "string" || event.kind.length > 50) return null;
        item.kind = event.kind;
      }
      if (Object.prototype.hasOwnProperty.call(event, "at")) {
        if (typeof event.at !== "string" || event.at.length > 40 || !Number.isFinite(Date.parse(event.at))) return null;
        item.at = event.at;
      }
      normalized.push(item);
    }
    result.recentEvents = normalized;
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_TASK_PROGRESS_BYTES) return null;
  return result;
}

function taskProgressFromRow(row: ConversationRow): TaskProgress {
  try {
    const value: unknown = JSON.parse(row.task_progress_json);
    return isRecord(value) ? value as TaskProgress : {};
  } catch {
    return {};
  }
}

function conversationFromRow(row: ConversationRow, includeSummary = true) {
  const result: Record<string, unknown> = {
    conversationId: row.conversation_id,
    title: row.title,
    status: row.status,
    taskProgress: taskProgressFromRow(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
  };
  if (includeSummary) result.summary = row.summary;
  else result.summaryPreview = row.summary.slice(0, 240);
  return result;
}

function turnFromRow(row: TurnRow) {
  return {
    turnId: row.turn_id,
    sequence: row.sequence,
    role: row.role,
    text: row.text,
    createdAt: row.created_at,
  };
}

async function getConversation(env: Env, ownerId: string, conversationId: string): Promise<ConversationRow | null> {
  return env.DB.prepare(
    "SELECT conversation_id, owner_id, title, summary, task_progress_json, status, created_at, updated_at, last_activity_at, next_turn_sequence " +
    "FROM conversations WHERE conversation_id = ? AND owner_id = ? LIMIT 1",
  ).bind(conversationId, ownerId).first<ConversationRow>();
}

async function getTurnByKey(env: Env, ownerId: string, conversationId: string, key: string): Promise<TurnRow | null> {
  return env.DB.prepare(
    "SELECT turn_id, conversation_id, owner_id, sequence, role, text, idempotency_key, created_at " +
    "FROM conversation_turns WHERE conversation_id = ? AND owner_id = ? AND idempotency_key = ? LIMIT 1",
  ).bind(conversationId, ownerId, key).first<TurnRow>();
}

function parseLimit(raw: string | null, fallback: number, max: number): number | null {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) return null;
  return value;
}

async function listConversations(request: Request, env: Env, ownerId: string): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "active";
  if (status !== "active" && status !== "archived" && status !== "all") {
    return json({ error: "invalid_status_filter" }, 400);
  }
  const limit = parseLimit(url.searchParams.get("limit"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  if (limit === null) return json({ error: "invalid_limit" }, 400);

  const statusClause = status === "all" ? "" : " AND status = ?";
  const args: unknown[] = status === "all" ? [ownerId, limit] : [ownerId, status, limit];
  const result = await env.DB.prepare(
    "SELECT conversation_id, owner_id, title, summary, task_progress_json, status, created_at, updated_at, last_activity_at, next_turn_sequence " +
    "FROM conversations WHERE owner_id = ?" + statusClause +
    " ORDER BY last_activity_at DESC, conversation_id DESC LIMIT ?",
  ).bind(...args).all<ConversationRow>();
  return json({
    conversations: (result.results || []).map((row) => conversationFromRow(row, false)),
    limit,
    status,
  });
}

async function createConversation(request: Request, env: Env, ownerId: string): Promise<Response> {
  const parsed = await readJsonObject(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;
  if (!hasOnlyKeys(body, ["title"])) return json({ error: "unsupported_fields" }, 400);
  const title = body.title === undefined ? "New conversation" : parseTitle(body.title);
  if (!title) return json({ error: "invalid_title" }, 400);

  const id = "conv_" + crypto.randomUUID().replace(/-/g, "");
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO conversations (conversation_id, owner_id, title, summary, task_progress_json, status, created_at, updated_at, last_activity_at, next_turn_sequence) " +
    "VALUES (?, ?, ?, '', '{}', 'active', ?, ?, ?, 1)",
  ).bind(id, ownerId, title, now, now, now).run();
  const row = await getConversation(env, ownerId, id);
  if (!row) return json({ error: "conversation_create_failed" }, 500);
  return json({ conversation: conversationFromRow(row) }, 201);
}

async function readConversation(request: Request, env: Env, ownerId: string, conversationId: string): Promise<Response> {
  const row = await getConversation(env, ownerId, conversationId);
  if (!row) return json({ error: "not_found" }, 404);

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"), 200, MAX_PAGE_SIZE);
  if (limit === null) return json({ error: "invalid_limit" }, 400);
  const beforeRaw = url.searchParams.get("before_sequence");
  let beforeSequence = Number.MAX_SAFE_INTEGER;
  if (beforeRaw !== null) {
    if (!/^\d+$/.test(beforeRaw)) return json({ error: "invalid_before_sequence" }, 400);
    beforeSequence = Number(beforeRaw);
    if (!Number.isSafeInteger(beforeSequence) || beforeSequence < 1) {
      return json({ error: "invalid_before_sequence" }, 400);
    }
  }

  const [page, count] = await Promise.all([
    env.DB.prepare(
      "SELECT turn_id, conversation_id, owner_id, sequence, role, text, idempotency_key, created_at " +
      "FROM conversation_turns WHERE conversation_id = ? AND owner_id = ? AND sequence < ? " +
      "ORDER BY sequence DESC LIMIT ?",
    ).bind(conversationId, ownerId, beforeSequence, limit).all<TurnRow>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM conversation_turns WHERE conversation_id = ? AND owner_id = ?",
    ).bind(conversationId, ownerId).first<{ total: number }>(),
  ]);
  const descending = page.results || [];
  const turns = descending.slice().reverse();
  let hasMore = false;
  let nextBeforeSequence: number | null = null;
  if (descending.length === limit && turns.length > 0) {
    const older = await env.DB.prepare(
      "SELECT sequence FROM conversation_turns WHERE conversation_id = ? AND owner_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT 1",
    ).bind(conversationId, ownerId, turns[0].sequence).first<{ sequence: number }>();
    hasMore = Boolean(older);
    if (hasMore) nextBeforeSequence = turns[0].sequence;
  }
  return json({
    conversation: conversationFromRow(row),
    turns: turns.map(turnFromRow),
    totalTurns: Number(count?.total || 0),
    hasMore,
    nextBeforeSequence,
  });
}

async function updateConversation(request: Request, env: Env, ownerId: string, conversationId: string): Promise<Response> {
  const existing = await getConversation(env, ownerId, conversationId);
  if (!existing) return json({ error: "not_found" }, 404);
  const parsed = await readJsonObject(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;
  if (!hasOnlyKeys(body, ["title", "status", "summary", "taskProgress"])) {
    return json({ error: "unsupported_fields" }, 400);
  }
  if (Object.keys(body).length === 0) return json({ error: "empty_update" }, 400);

  const assignments: string[] = [];
  const values: unknown[] = [];
  if (body.title !== undefined) {
    const title = parseTitle(body.title);
    if (!title) return json({ error: "invalid_title" }, 400);
    assignments.push("title = ?");
    values.push(title);
  }
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "archived") return json({ error: "invalid_status" }, 400);
    assignments.push("status = ?");
    values.push(body.status);
  }
  if (body.summary !== undefined) {
    const summary = parseSummary(body.summary);
    if (summary === null) return json({ error: "invalid_summary" }, 400);
    assignments.push("summary = ?");
    values.push(summary);
  }
  if (body.taskProgress !== undefined) {
    const progress = parseTaskProgress(body.taskProgress);
    if (!progress) return json({ error: "invalid_task_progress" }, 400);
    assignments.push("task_progress_json = ?");
    values.push(JSON.stringify(progress));
  }

  // Update only fields explicitly supplied by the caller so concurrent title,
  // summary and task-progress edits do not overwrite one another.
  assignments.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(conversationId, ownerId);
  await env.DB.prepare(
    "UPDATE conversations SET " + assignments.join(", ") + " WHERE conversation_id = ? AND owner_id = ?",
  ).bind(...values).run();
  const updated = await getConversation(env, ownerId, conversationId);
  if (!updated) return json({ error: "not_found" }, 404);
  return json({ conversation: conversationFromRow(updated) });
}

async function deleteConversation(env: Env, ownerId: string, conversationId: string): Promise<Response> {
  const existing = await getConversation(env, ownerId, conversationId);
  if (!existing) return json({ error: "not_found" }, 404);
  const result = await env.DB.batch([
    env.DB.prepare("DELETE FROM conversation_turns WHERE conversation_id = ? AND owner_id = ?")
      .bind(conversationId, ownerId),
    env.DB.prepare("DELETE FROM conversations WHERE conversation_id = ? AND owner_id = ?")
      .bind(conversationId, ownerId),
  ]);
  if (Number(result[1]?.meta?.changes || 0) !== 1) return json({ error: "not_found" }, 404);
  return json({ deleted: true, conversationId });
}

async function appendTurn(request: Request, env: Env, ownerId: string, conversationId: string): Promise<Response> {
  const parsed = await readJsonObject(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;
  if (!hasOnlyKeys(body, ["role", "text", "idempotencyKey", "summary", "taskProgress"])) {
    return json({ error: "unsupported_fields" }, 400);
  }
  if (body.role !== "user" && body.role !== "assistant") return json({ error: "invalid_role" }, 400);
  if (typeof body.text !== "string") return json({ error: "invalid_text" }, 400);
  const text = body.text.trim();
  if (!text) return json({ error: "empty_text" }, 400);
  if (text.length > MAX_TURN_CHARS || new TextEncoder().encode(text).byteLength > MAX_TURN_BYTES) {
    return json({ error: "turn_too_large" }, 400);
  }
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() ||
      body.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_CHARS) {
    return json({ error: "invalid_idempotency_key" }, 400);
  }
  const idempotencyKey = body.idempotencyKey.trim();
  const summary = body.summary === undefined ? null : parseSummary(body.summary);
  if (body.summary !== undefined && summary === null) return json({ error: "invalid_summary" }, 400);
  let progressJson: string | null = null;
  if (body.taskProgress !== undefined) {
    const progress = parseTaskProgress(body.taskProgress);
    if (!progress) return json({ error: "invalid_task_progress" }, 400);
    progressJson = JSON.stringify(progress);
  }

  const existingConversation = await getConversation(env, ownerId, conversationId);
  if (!existingConversation) return json({ error: "not_found" }, 404);

  const prior = await getTurnByKey(env, ownerId, conversationId, idempotencyKey);
  if (prior) {
    if (prior.role !== body.role || prior.text !== text) return json({ error: "idempotency_conflict" }, 409);
    return json({ turn: turnFromRow(prior), replayed: true });
  }

  for (let attempt = 0; attempt < MAX_APPEND_RETRIES; attempt += 1) {
    const conversation = await getConversation(env, ownerId, conversationId);
    if (!conversation) return json({ error: "not_found" }, 404);
    const turnId = "turn_" + crypto.randomUUID().replace(/-/g, "");
    const now = new Date().toISOString();
    const inserted = env.DB.prepare(
      "INSERT INTO conversation_turns (turn_id, conversation_id, owner_id, sequence, role, text, idempotency_key, created_at) " +
      "SELECT ?, c.conversation_id, c.owner_id, c.next_turn_sequence, ?, ?, ?, ? " +
      "FROM conversations c WHERE c.conversation_id = ? AND c.owner_id = ? AND c.next_turn_sequence = ? " +
      "AND NOT EXISTS (SELECT 1 FROM conversation_turns t WHERE t.conversation_id = c.conversation_id " +
      "AND t.owner_id = c.owner_id AND t.idempotency_key = ?)",
    ).bind(turnId, body.role, text, idempotencyKey, now, conversationId, ownerId,
      conversation.next_turn_sequence, idempotencyKey);
    const advance = env.DB.prepare(
      "UPDATE conversations SET next_turn_sequence = next_turn_sequence + 1, updated_at = ?, last_activity_at = ?, " +
      "summary = COALESCE(?, summary), task_progress_json = COALESCE(?, task_progress_json) " +
      "WHERE conversation_id = ? AND owner_id = ? AND next_turn_sequence = ? " +
      "AND EXISTS (SELECT 1 FROM conversation_turns WHERE turn_id = ? AND conversation_id = ? AND owner_id = ?)",
    ).bind(now, now, summary, progressJson, conversationId, ownerId, conversation.next_turn_sequence,
      turnId, conversationId, ownerId);

    const batchResult = await env.DB.batch([inserted, advance]);
    if (Number(batchResult[0]?.meta?.changes || 0) === 1) {
      const saved = await getTurnByKey(env, ownerId, conversationId, idempotencyKey);
      if (!saved) return json({ error: "turn_persist_failed" }, 500);
      if (body.role === "user") {
        try {
          await observeUserPreferenceFromTurn(env, ownerId, text);
        } catch (error) {
          console.warn("[AskMoina] Preference memory capture was skipped", error instanceof Error ? error.name : "unknown");
        }
      }
      return json({ turn: turnFromRow(saved), replayed: false }, 201);
    }

    const duplicate = await getTurnByKey(env, ownerId, conversationId, idempotencyKey);
    if (duplicate) {
      if (duplicate.role !== body.role || duplicate.text !== text) return json({ error: "idempotency_conflict" }, 409);
      return json({ turn: turnFromRow(duplicate), replayed: true });
    }
  }
  return json({ error: "concurrent_update_retry" }, 409);
}

/**
 * Stores finalized text and compact task state only. Live sockets, resumption
 * handles, pending audio and replay checkpoints remain in LIVE_SESSION_RELAY.
 * Conversation history is retained until the owner explicitly deletes it or
 * the account is deleted; it is never subject to analytics retention cleanup.
 */
export async function handleConversationRequest(request: Request, env: Env): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== ROOT && !pathname.startsWith(ROOT + "/")) return null;
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
    return json({ error: "method_not_allowed" }, 405);
  }
  const ownerId = await getAuthenticatedUserId(request, env);
  if (!ownerId) return json({ error: "authentication_required" }, 401);

  if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "same_origin_required" }, 403);
  try {
    if (pathname === ROOT) {
      if (request.method === "GET") return await listConversations(request, env, ownerId);
      if (request.method === "POST") return await createConversation(request, env, ownerId);
      return json({ error: "method_not_allowed" }, 405);
    }

    const match = pathname.match(/^\/api\/conversations\/([A-Za-z0-9_-]{1,80})(\/turns)?$/);
    if (!match) return json({ error: "not_found" }, 404);
    const conversationId = match[1];
    const isTurns = Boolean(match[2]);
    if (isTurns) {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      return await appendTurn(request, env, ownerId, conversationId);
    }
    if (request.method === "GET") return await readConversation(request, env, ownerId, conversationId);
    if (request.method === "PATCH") return await updateConversation(request, env, ownerId, conversationId);
    if (request.method === "DELETE") return await deleteConversation(env, ownerId, conversationId);
    return json({ error: "method_not_allowed" }, 405);
  } catch (error) {
    console.error("[AskMoina] Conversation history request failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "conversation_history_unavailable" }, 500);
  }
}
