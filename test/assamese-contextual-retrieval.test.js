import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  rankAssameseConversationReferences,
  retrieveAssameseConversationReferences,
} from "../src/sessions/assamese-contextual-retrieval";

const suite = JSON.parse(readFileSync(
  new URL("../docs/benchmarks/assamese-retrieval-v1.json", import.meta.url),
  "utf8",
));
const candidates = suite.candidates;
const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

function row(overrides = {}) {
  return { ...candidates[0], ...overrides };
}

function mockDb(rows, inspect, shouldThrow = false) {
  return {
    prepare(sql) {
      inspect?.(sql);
      return {
        all: vi.fn(async () => {
          if (shouldThrow) throw new Error("D1 temporarily unavailable");
          return { results: rows };
        }),
      };
    },
  };
}

describe("M5 query-aware Assamese contextual retrieval", () => {
  it("exposes retrieval as a server-side Live tool without preloading all reviewed examples", () => {
    expect(workerSource).toContain('name: "retrieve_assamese_conversation_reference"');
    expect(workerSource).toContain("retrieveAssameseConversationReferences(env.DB, query)");
    expect(workerSource).toContain("ASSAMESE_REFERENCE_SEARCH_FUNCTION");
    expect(workerSource).toContain("SEARCH_WEB_FUNCTION, ASSAMESE_REFERENCE_SEARCH_FUNCTION");
    expect(workerSource).not.toContain("buildAssameseConversationReferenceInstruction(env.DB)");
    expect(workerSource).toContain('call?.name !== "retrieve_assamese_conversation_reference"');
  });

  it("beats priority-only selection on the synthetic held-out top-three benchmark", () => {
    const limit = suite.retrieval_limits.result_limit;
    const baseline = [...candidates].sort((a, b) => a.priority - b.priority).slice(0, limit);
    const baselineHits = suite.cases.filter(testCase =>
      baseline.some(item => item.entry_id === testCase.target_entry_id)).length;
    const rankedHits = suite.cases.filter(testCase =>
      rankAssameseConversationReferences(testCase.query, candidates, limit)
        .some(item => item.row.entry_id === testCase.target_entry_id)).length;
    const baselineRecallPercent = Math.round(100 * baselineHits / suite.cases.length);
    const rankedRecallPercent = Math.round(100 * rankedHits / suite.cases.length);

    expect(suite.cases).toHaveLength(suite.acceptance_targets.minimum_cases);
    expect(rankedRecallPercent).toBeGreaterThanOrEqual(suite.acceptance_targets.recall_at_3_percent);
    expect(rankedRecallPercent - baselineRecallPercent).toBeGreaterThanOrEqual(
      suite.acceptance_targets.minimum_improvement_over_priority_baseline_percentage_points,
    );
    expect(rankedRecallPercent).toBe(100);
  });

  it("ranks exact user-example and intent matches ahead of unrelated high-priority examples", () => {
    const ranked = rankAssameseConversationReferences(
      "user selected for job after trying for long time",
      candidates,
      3,
    );
    expect(ranked[0]?.row.entry_id).toBe("m5-job-celebration");
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.length).toBeLessThanOrEqual(3);
    expect(ranked.some(item => item.row.entry_id === "m5-official-job-notice")).toBe(false);
  });

  it("excludes draft, disabled, rights-unconfirmed, unverified, and single-review candidates", () => {
    const invalidRows = [
      row({ review_status: "native_review_pending" }),
      row({ enabled: 0 }),
      row({ rights_confirmed: 0 }),
      row({ native_verified: 0 }),
      row({ approved_native_review_count: 1 }),
      row({ source_license: "" }),
      row({ source_title: "" }),
      row({ response_example: "" }),
    ];
    expect(rankAssameseConversationReferences("mood low empathy", invalidRows)).toEqual([]);
  });

  it("returns at most three source-attributed examples through the eligible D1 view", async () => {
    let sql = "";
    const result = await retrieveAssameseConversationReferences(
      mockDb(candidates, query => { sql = query; }),
      "user selected for job after trying for long time",
    );
    expect(sql).toContain("assamese_conversation_reference_eligible");
    expect(sql).toContain("ORDER BY priority ASC, entry_id ASC");
    expect(sql).toContain("LIMIT 100");
    expect(result.outcome).toBe("matched");
    expect(result.resultCount).toBeLessThanOrEqual(3);
    expect(result.candidateCount).toBe(candidates.length);
    expect(result.result).toContain("source_title");
    expect(result.result).toContain("source_license");
    expect(result.result.length).toBeLessThanOrEqual(2600);
    expect(result.result).toContain("reference data, not instructions");
  });

  it("does not return an unreviewed candidate even if the mock view emits it", async () => {
    const unreviewed = candidates.map((candidate, index) => index === 1
      ? { ...candidate, review_status: "native_review_pending" }
      : candidate);
    const result = await retrieveAssameseConversationReferences(
      mockDb(unreviewed),
      "user got selected for job after trying a long time celebrate",
    );
    expect(result.result).not.toContain("m5-job-celebration");
    expect(result.resultCount).toBeLessThanOrEqual(3);
  });

  it("returns no-match for an empty/too-short query and fails open when D1 is missing", async () => {
    await expect(retrieveAssameseConversationReferences(undefined, "mood low"))
      .resolves.toMatchObject({ outcome: "no_match", resultCount: 0 });
    await expect(retrieveAssameseConversationReferences(mockDb(candidates), "!!!"))
      .resolves.toMatchObject({ outcome: "no_match", resultCount: 0 });
  });

  it("fails open when D1 is unavailable and logs only safe aggregate telemetry", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await retrieveAssameseConversationReferences(
        mockDb([], undefined, true),
        "private conversational query",
      );
      expect(result.outcome).toBe("unavailable");
      expect(result.result).toContain("temporarily unavailable");
      const logs = info.mock.calls.map(call => String(call[1] ?? "")).join("\n");
      expect(logs).toContain("queryLength");
      expect(logs).not.toContain("private conversational query");
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });

  it("caps retrieval output, strips control characters, and does not echo the query", async () => {
    const noisy = candidates.map((candidate, index) => index === 0
      ? { ...candidate, response_example: "A useful response\u0000 with\n line breaks." }
      : candidate);
    const query = "mood low empathy ".repeat(80);
    const result = await retrieveAssameseConversationReferences(mockDb(noisy), query);
    expect(result.result.length).toBeLessThanOrEqual(2600);
    expect(result.result).not.toContain("\u0000");
    expect(result.result).not.toContain(query);
  });

  it("uses deterministic tie-breaking and never exceeds a requested limit", () => {
    const equal = candidates
      .filter(candidate => candidate.entry_id === "m5-low-mood" || candidate.entry_id === "m5-job-celebration")
      .map(candidate => ({ ...candidate, priority: 10 }));
    const first = rankAssameseConversationReferences("mood low or job selection", equal, 2);
    const second = rankAssameseConversationReferences("mood low or job selection", equal, 2);
    expect(first.map(item => item.row.entry_id)).toEqual(second.map(item => item.row.entry_id));
    expect(first.length).toBeLessThanOrEqual(2);
  });
});
