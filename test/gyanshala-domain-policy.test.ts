import { describe, expect, it } from "vitest";
import { isAllowedDomain } from "../src/gyanshala-demo/index";

describe("Gyanshala institutional email domain policy", () => {
  const roots = ["nits.ac.in"];

  it("accepts the institutional root itself", () => {
    expect(isAllowedDomain("nits.ac.in", roots)).toBe(true);
    expect(isAllowedDomain("NITS.AC.IN", roots)).toBe(true);
  });

  it("accepts existing and future department subdomains", () => {
    expect(isAllowedDomain("civil.nits.ac.in", roots)).toBe(true);
    expect(isAllowedDomain("cse.nits.ac.in", roots)).toBe(true);
    expect(isAllowedDomain("future-department.nits.ac.in", roots)).toBe(true);
    expect(isAllowedDomain("a.b.future-department.nits.ac.in", roots)).toBe(true);
  });

  it("rejects lookalike domains that merely contain the text", () => {
    expect(isAllowedDomain("nits.ac.in.example.com", roots)).toBe(false);
    expect(isAllowedDomain("fake-nits.ac.in", roots)).toBe(false);
    expect(isAllowedDomain("notnits.ac.in", roots)).toBe(false);
    expect(isAllowedDomain("nits-ac.in", roots)).toBe(false);
    expect(isAllowedDomain("gmail.com", roots)).toBe(false);
  });

  it("supports only explicitly configured institutional roots", () => {
    expect(isAllowedDomain("student.othercollege.edu", roots)).toBe(false);
    expect(isAllowedDomain("students.othercollege.edu", [...roots, "othercollege.edu"])).toBe(true);
  });
});
