import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../migrations/0006_conversation_history.sql", import.meta.url), "utf8");

describe("conversation history migration contract", () => {
  it("scopes stored conversations to real accounts and cascades deletion", () => {
    expect(sql).toContain("owner_id TEXT NOT NULL REFERENCES account_users(user_id) ON DELETE CASCADE");
    expect(sql).toContain("FOREIGN KEY (conversation_id, owner_id)");
    expect(sql.match(/ON DELETE CASCADE/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("enforces ordered, idempotent, finalized text turns and bounded task state", () => {
    expect(sql).toContain("next_turn_sequence INTEGER NOT NULL DEFAULT 1");
    expect(sql).toContain("UNIQUE (conversation_id, owner_id, sequence)");
    expect(sql).toContain("UNIQUE (conversation_id, owner_id, idempotency_key)");
    expect(sql).toContain("role IN ('user', 'assistant')");
    expect(sql).toContain("json_type(task_progress_json) = 'object'");
    expect(sql).toContain("length(task_progress_json) <= 12000");
    expect(sql).toContain("length(trim(text)) BETWEEN 1 AND 20000");
  });

  it("does not define raw audio or video storage and defines owner-oriented indexes", () => {
    expect(sql).not.toMatch(/audio_blob|video_blob|raw_audio|raw_video|base64_media/i);
    expect(sql).toContain("idx_conversations_owner_activity");
    expect(sql).toContain("idx_conversation_turns_owner_order");
  });
});
