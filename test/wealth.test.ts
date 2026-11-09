import { describe, expect, it } from "vitest";
import { wealthMath } from "../src/wealth";

describe("AskMoina Wealth historical simulation math", () => {
  it("parses MFAPI NAV dates strictly", () => {
    expect(wealthMath.parseNavDate("05-01-2023")).toBe("2023-01-05");
    expect(wealthMath.parseNavDate("31-02-2023")).toBeNull();
    expect(wealthMath.parseNavDate("2023-01-05")).toBeNull();
  });

  it("generates monthly SIP dates without drifting across months", () => {
    expect(wealthMath.buildSipSchedule("2023-01-01", "2023-03-31", 5)).toEqual([
      "2023-01-05", "2023-02-05", "2023-03-05",
    ]);
  });

  it("uses the first actual NAV on or after the scheduled date within seven days", () => {
    const points = [
      { date: "2023-01-04", nav: 10 },
      { date: "2023-01-06", nav: 11 },
      { date: "2023-01-14", nav: 12 },
    ];
    expect(wealthMath.pickNextNav(points, "2023-01-05")).toEqual({ date: "2023-01-06", nav: 11 });
    expect(wealthMath.pickNextNav(points, "2023-01-07")).toBeNull();
  });

  it("validates returned scheme identity and NAV values", () => {
    const result = wealthMath.normalizeNavHistory({
      status: "SUCCESS",
      meta: { scheme_code: 123, scheme_name: "Example" },
      data: [
        { date: "06-01-2023", nav: "11.00000" },
        { date: "05-01-2023", nav: "10.00000" },
        { date: "07-01-2023", nav: "-1" },
      ],
    }, 123);
    expect(result.points).toEqual([
      { date: "2023-01-05", nav: 10 },
      { date: "2023-01-06", nav: 11 },
    ]);
    expect(() => wealthMath.normalizeNavHistory({
      status: "SUCCESS", meta: { scheme_code: 456 }, data: [{ date: "05-01-2023", nav: "1" }],
    }, 123)).toThrow("nav_provider_response_invalid");
  });

  it("calculates an XIRR-like annualized return from dated cash flows", () => {
    const rate = wealthMath.xirr([
      { date: "2023-01-01", amount: -100 },
      { date: "2024-01-01", amount: 110 },
    ]);
    expect(rate).not.toBeNull();
    expect(rate as number).toBeCloseTo(0.1, 2);
  });

  it("does not fabricate an annualized return when cash flows do not have both signs", () => {
    expect(wealthMath.xirr([{ date: "2023-01-01", amount: -100 }])).toBeNull();
  });
});
