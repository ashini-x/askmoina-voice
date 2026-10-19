import { describe, expect, it } from "vitest";
import {
  addPendingGroundedSearches,
  completePendingGroundedSearch,
} from "../src/sessions/grounded-search-pending";

describe("pending grounded-search state", () => {
  it("marks valid search calls pending before retrieval in standard voice or Co-Pilot mode", () => {
    const calls = [
      { name: "search_current_web", id: "search-1" },
      { name: "display_response_card", id: "card-1" },
      { name: "search_current_web", id: "search-2" },
    ];

    expect(addPendingGroundedSearches(0, calls)).toBe(2);
  });

  it("ignores unrelated tools and search calls without valid IDs", () => {
    expect(addPendingGroundedSearches(1, [
      { name: "search_current_web", id: "" },
      { name: "search_current_web" },
      { name: "search_past_conversations", id: "history-1" },
    ])).toBe(1);
  });

  it("tracks concurrent lookups until each finishes", () => {
    const twoPending = addPendingGroundedSearches(0, [
      { name: "search_current_web", id: "one" },
      { name: "search_current_web", id: "two" },
    ]);
    expect(completePendingGroundedSearch(twoPending)).toBe(1);
    expect(completePendingGroundedSearch(1)).toBe(0);
  });

  it("does not allow an invalid or zero count to become negative", () => {
    expect(completePendingGroundedSearch(0)).toBe(0);
    expect(completePendingGroundedSearch(Number.NaN)).toBe(0);
  });
});
