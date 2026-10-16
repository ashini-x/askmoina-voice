import { describe, expect, it } from "vitest";
import { extractPreference } from "../src/user-memory";

describe("automatic preference memory", () => {
  it("captures directly stated, reusable interaction preferences", () => {
    expect(extractPreference("I prefer short answers with clear examples.")).toContain("I prefer short answers");
    expect(extractPreference("Please remember that I prefer Assamese-English replies")).toContain("I prefer Assamese-English replies");
    expect(extractPreference("From now on, answer me in simple words")).toContain("answer me in simple words");
  });

  it("does not treat ordinary questions and conversation topics as preferences", () => {
    expect(extractPreference("Can you explain how a circuit breaker works?")).toBeNull();
    expect(extractPreference("The weather is nice today.")).toBeNull();
  });

  it("does not automatically store explicit sensitive disclosures or credentials", () => {
    expect(extractPreference("I prefer concise answers, and my medical condition is ...")).toBeNull();
    expect(extractPreference("My password is hunter2")).toBeNull();
    expect(extractPreference("I prefer to get OTP codes by text")).toBeNull();
  });
});
