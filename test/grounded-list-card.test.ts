import { describe, expect, it } from "vitest";
import {
  buildGroundedListCard,
  extractGroundedRankedRows,
  getRequestedRankedListCount
} from "../src/sessions/grounded-list-card";

describe("grounded ranked-list fallback cards", () => {
  it("recognizes top-N requests from natural query text", () => {
    expect(getRequestedRankedListCount("top 10 IPL run scorers")).toBe(10);
    expect(getRequestedRankedListCount("show the top-ten rankers")).toBe(10);
    expect(getRequestedRankedListCount("top 3 results")).toBeNull();
    expect(getRequestedRankedListCount("what is the latest IPL score")).toBeNull();
  });

  it("extracts ten numbered entries and their values without dropping rows", () => {
    const text = Array.from({ length: 10 }, (_, i) =>
      (i + 1) + ". Player " + (i + 1) + " — " + (700 - i * 10) + " runs"
    ).join("\n");
    const rows = extractGroundedRankedRows(text, 10);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({ rank: 1, label: "1. Player 1", value: "700 runs" });
    expect(rows[9]).toEqual({ rank: 10, label: "10. Player 10", value: "610 runs" });
  });

  it("extracts ranked markdown table rows and ignores the header", () => {
    const rows = extractGroundedRankedRows([
      "| Rank | Player | Team | Runs |",
      "| --- | --- | --- | --- |",
      "| 1 | Player One | Team A | 700 runs |",
      "| 2 | Player Two | Team B | 650 runs |"
    ].join("\n"), 10);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ rank: 1, label: "1. Player One — Team A", value: "700 runs" });
  });

  it("returns a ten-slot card and clearly marks unverified entries instead of fabricating them", () => {
    const result = buildGroundedListCard(
      "top 10 IPL 2025 run scorers",
      "1. Player One — 700 runs\n2. Player Two — 650 runs\n\nSources:\n- Official table: https://example.com/stats"
    );
    expect(result).not.toBeNull();
    expect(result?.details).toHaveLength(10);
    expect(result?.details[0]).toEqual({ label: "1. Player One", value: "700 runs" });
    expect(result?.details[1]).toEqual({ label: "2. Player Two", value: "650 runs" });
    expect(result?.details[2]).toEqual({ label: "3. Not verified", value: "No source-backed entry returned" });
    expect(result?.summary).toContain("Only 2 of 10");
    expect(result?.sources[0].url).toBe("https://example.com/stats");
  });

  it("does not produce a card without verified HTTPS source links or recoverable ranked rows", () => {
    expect(buildGroundedListCard("top 10 IPL 2025", "1. Player One — 700 runs")).toBeNull();
    expect(buildGroundedListCard(
      "top 10 IPL 2025",
      "No useful rows.\n\nSources:\n- Official table: https://example.com/stats"
    )).toBeNull();
  });
});
