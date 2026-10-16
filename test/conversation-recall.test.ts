import { describe, expect, it } from "vitest";
import { getHistorySearchTerms } from "../src/conversations";

describe("cross-session history recall search terms", () => {
  it("removes generic recall wording and keeps distinctive terms", () => {
    expect(getHistorySearchTerms("Please remember what I wanted for the laptop repair in our previous session"))
      .toEqual(["laptop", "repair"]);
  });

  it("returns no terms for empty or non-searchable input", () => {
    expect(getHistorySearchTerms("")).toEqual([]);
    expect(getHistorySearchTerms("!! -- ??")).toEqual([]);
  });

  it("supports Assamese/transliterated and Unicode query terms", () => {
    expect(getHistorySearchTerms("Moi Assamese-English replies bhal pau")).toContain("assamese");
    expect(getHistorySearchTerms("অসমীয়া ভাষা")).toContain("অসমীয়া");
  });

  it("limits the number of returned terms and removes control characters", () => {
    expect(getHistorySearchTerms("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda")).toHaveLength(8);
    expect(getHistorySearchTerms("laptop\u0000repair")).toEqual(["laptop", "repair"]);
  });
});
