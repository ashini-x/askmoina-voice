import { describe, expect, it } from "vitest";
import {
  buildGroundedListCard,
  extractGroundedRankedRows,
  getRequestedRankedListCount
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
