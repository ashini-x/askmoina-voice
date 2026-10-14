import { describe, expect, it } from "vitest";
import {
  buildGroundedListCard,
  extractGroundedRankedRows,
  getRequestedRankedListCount,
  mergeGroundedRankedListAttempts
} from "../src/sessions/grounded-list-card";

describe("grounded ranked-list fallback cards", () => {
  it("recognizes top-N and natural-language all-N requests across topics", () => {
    expect(getRequestedRankedListCount("top 10 IPL run scorers")).toBe(10);
    expect(getRequestedRankedListCount("show the top-ten rankers")).toBe(10);
    expect(getRequestedRankedListCount("show me all 10")).toBe(10);
    expect(getRequestedRankedListCount("show me every ten players")).toBe(10);
    expect(getRequestedRankedListCount("show the whole list of ten")).toBe(10);
    expect(getRequestedRankedListCount("list 3 results")).toBe(3);
    expect(getRequestedRankedListCount("what is the latest IPL score")).toBeNull();
  });

  it("extracts complete numbered lists with stats", () => {
    const text = Array.from({ length: 10 }, (_, i) =>
      (i + 1) + ". Person " + (i + 1) + " — Group " + (i + 1) + " — " + (700 - i * 10) + " points"
    ).join("\n");
    const rows = extractGroundedRankedRows(text, 10);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({ rank: 1, label: "1. Person 1 — Group 1", value: "700 points" });
    expect(rows[9]).toEqual({ rank: 10, label: "10. Person 10 — Group 10", value: "610 points" });
  });

  it("extracts ranked Markdown table rows and ignores a header", () => {
    const rows = extractGroundedRankedRows([
      "| Rank | Name | Team | Points |",
      "| --- | --- | --- | --- |",
      "| 1 | Person One | Group A | 700 points |",
      "| 2 | Person Two | Group B | 650 points |"
    ].join("\n"), 10);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ rank: 1, label: "1. Person One — Group A", value: "700 points" });
  });

  it("merges a targeted retry with earlier source-backed ranks and prefers retry duplicates", () => {
    const first = [
      "1. First attempt winner — Team A — 759 runs",
      "2. Player Two — Team B — 717 runs",
      "3. Player Three — Team C — 657 runs",
      "4. Player Four — Team D — 650 runs",
      "5. Player Five — Team E — 600 runs",
      "",
      "Sources:",
      "- First source: https://example.com/first"
    ].join("\n");
    const retry = [
      "5. Retry player five — Team E — 600 runs",
      "6. Player Six — Team F — 590 runs",
      "7. Player Seven — Team G — 580 runs",
      "8. Player Eight — Team H — 570 runs",
      "9. Player Nine — Team I — 560 runs",
      "10. Player Ten — Team J — 550 runs",
      "",
      "Sources:",
      "- Retry source: https://example.com/retry"
    ].join("\n");
    const merged = mergeGroundedRankedListAttempts(first, retry);
    const rows = extractGroundedRankedRows(merged, 10);
    expect(rows).toHaveLength(10);
    expect(rows[4].label).toContain("Retry player five");
    expect(rows[9].label).toContain("Player Ten");
    expect(merged).not.toContain("Sources:");

    const card = buildGroundedListCard(
      "top 10 IPL 2025 most runs",
      merged + "\n\nSources:\n- IPL leaderboard: https://example.com/ipl"
    );
    expect(card?.details).toHaveLength(10);
    expect(card?.details.every((row) => !row.label.endsWith("Not verified"))).toBe(true);
    expect(card?.summary).toContain("Complete ranked list");
    expect(card?.sources?.[0].url).toBe("https://example.com/ipl");
  });

  it("preserves the top-ten count when the Live model shortens the tool query", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      (index + 1) + ". Player " + (index + 1) + " — Team " + String.fromCharCode(65 + index) + " — " + (700 - index * 10) + " runs"
    ).join("\n");
    const result = buildGroundedListCard(
      "IPL 2025 most runs",
      rows + "\n\nSources:\n- Complete IPL leaderboard: https://example.com/ipl-2025-runs",
      10
    );
    expect(result).not.toBeNull();
    expect(result?.title).toBe("Top 10 results");
    expect(result?.details).toHaveLength(10);
    expect(result?.details.every((item) => !item.label.endsWith("Not verified"))).toBe(true);
    expect(result?.summary).toContain("Complete ranked list");
    expect(result?.sources?.[0].url).toBe("https://example.com/ipl-2025-runs");
  });

  it("creates a ten-row visual card while honestly identifying missing source-backed ranks", () => {
    const result = buildGroundedListCard(
      "show me all 10",
      "1. Person One — Group A — 700 points\n2. Person Two — Group B — 650 points\n\nSources:\n- Official table: https://example.com/stats"
    );
    expect(result).not.toBeNull();
    expect(result?.details).toHaveLength(10);
    expect(result?.details[0]).toEqual({ label: "1. Person One — Group A", value: "700 points" });
    expect(result?.details[1]).toEqual({ label: "2. Person Two — Group B", value: "650 points" });
    expect(result?.details[2]).toEqual({ label: "3. Not verified", value: "No source-backed entry returned" });
    expect(result?.summary).toContain("Only 2 of 10");
    expect(result?.sources[0].url).toBe("https://example.com/stats");
  });

  it("does not create a data card without an HTTPS source or parsable ranked row", () => {
    expect(buildGroundedListCard("top 10 test", "1. Person One — 700 points")).toBeNull();
    expect(buildGroundedListCard(
      "top 10 test",
      "No useful rows.\n\nSources:\n- Official table: https://example.com/stats"
    )).toBeNull();
  });
});
