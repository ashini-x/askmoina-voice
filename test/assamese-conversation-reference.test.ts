import { describe, expect, it, vi } from "vitest";
import {
  buildAssameseConversationReferenceInstruction,
  type AssameseConversationReferenceRow,
} from "../src/sessions/assamese-conversation-reference";

function approvedRow(overrides: Partial<AssameseConversationReferenceRow> = {}): AssameseConversationReferenceRow {
  return {
    entry_id: "ascr-test-001",
    interaction_intent: "empathy",
    language_mode: "assamese_english",
    dialect_scope: "Upper Assam candidate",
    register: "casual",
    context_summary: "The user shares a small frustration.",
    user_example: "Aji mood tu bhal nai yaar.",
    response_example: "Aww, ki hol? Kotha patibo mon hole moi hunisu.",
    usage_notes: "Acknowledge first; ask at most one gentle question.",
    avoid_when: "Do not use for crisis or serious distress.",
    source_title: "Native-reviewed internal reference",
    source_license: "AskMoina use only",
    rights_confirmed: 1,
    native_verified: 1,
    review_status: "approved",
    enabled: 1,
    approved_native_review_count: 2,
    priority: 10,
    ...overrides,
  };
}

function mockDb(rows: unknown[], sqlCheck?: (sql: string) => void): Pick<D1Database, "prepare"> {
  return {
    prepare(sql: string) {
      sqlCheck?.(sql);
      return {
        all: vi.fn(async () => ({ results: rows })),
      };
    },
  } as unknown as Pick<D1Database, "prepare">;
}

describe("approved Assamese conversation reference", () => {
  it("includes only bounded, eligible, source-attributed native-reviewed examples", async () => {
    const instruction = await buildAssameseConversationReferenceInstruction(
      mockDb([approvedRow()]),
    );

    expect(instruction).toContain("APPROVED ASSAMESE-ENGLISH CONVERSATION REFERENCE");
    expect(instruction).toContain("Reviewed response example");
    expect(instruction).toContain("Native-reviewed internal reference");
    expect(instruction).toContain("two distinct");
    expect(instruction).toContain("Aww, ki hol?");
    expect(instruction.length).toBeLessThanOrEqual(3000);
  });

  it("does not emit draft, disabled, rights-unconfirmed or singly reviewed rows", async () => {
    const rows = [
      approvedRow({ review_status: "native_review_pending" }),
      approvedRow({ enabled: 0 }),
      approvedRow({ rights_confirmed: 0 }),
      approvedRow({ native_verified: 0 }),
      approvedRow({ approved_native_review_count: 1 }),
    ];
    const instruction = await buildAssameseConversationReferenceInstruction(mockDb(rows));
    expect(instruction).toBe("");
  });

  it("queries the eligible view and applies an additional application-side gate", async () => {
    let sql = "";
    await buildAssameseConversationReferenceInstruction(
      mockDb([approvedRow()], (query) => { sql = query; }),
    );
    expect(sql).toContain("assamese_conversation_reference_eligible");
    expect(sql).toContain("ORDER BY priority ASC");
    expect(sql).toContain("LIMIT 8");
  });

  it("returns an empty appendix when D1 is missing or the table has not been migrated", async () => {
    expect(await buildAssameseConversationReferenceInstruction(undefined)).toBe("");
    const broken = {
      prepare() {
        return { all: async () => { throw new Error("missing table"); } };
      },
    } as unknown as Pick<D1Database, "prepare">;
    expect(await buildAssameseConversationReferenceInstruction(broken)).toBe("");
  });

  it("drops control characters from any content returned by the reference query", async () => {
    const instruction = await buildAssameseConversationReferenceInstruction(
      mockDb([approvedRow({ response_example: "Aww,\u0000 ki hol?\nKotha patibo mon hole moi hunisu." })]),
    );
    expect(instruction).toContain("Aww, ki hol?");
    expect(instruction).not.toContain("\u0000");
  });
});
