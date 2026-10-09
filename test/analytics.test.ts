import { describe, expect, it } from "vitest";
import { readVisitorId } from "../src/analytics";

describe("pseudonymous visitor identity", () => {
  it("accepts a valid random UUID cookie", () => {
    const request = new Request("https://askmoina.example/", {
      headers: { Cookie: "theme=dark; askmoina_visitor=123e4567-e89b-42d3-a456-426614174000" },
    });
    expect(readVisitorId(request)).toBe("123e4567-e89b-42d3-a456-426614174000");
  });

  it("rejects malformed and absent visitor identifiers", () => {
    expect(readVisitorId(new Request("https://askmoina.example/", {
      headers: { Cookie: "askmoina_visitor=not-a-uuid" },
    }))).toBeNull();
    expect(readVisitorId(new Request("https://askmoina.example/"))).toBeNull();
  });

  it("does not treat a visitor identifier as an account credential", () => {
    expect(readVisitorId(new Request("https://askmoina.example/", {
      headers: { Cookie: "askmoina_visitor=123e4567-e89b-42d3-a456-426614174000" },
    }))).not.toBeNull();
  });
});