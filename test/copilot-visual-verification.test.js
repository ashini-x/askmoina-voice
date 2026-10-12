import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COPILOT_JS } from "../src/copilot-assets";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

function extractFunction(source, functionName) {
  const marker = "function " + functionName + "(";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("Missing visual-verification helper: " + functionName);
  const brace = source.indexOf("{", start + marker.length);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("Unclosed function body: " + functionName);
}

const classifyVisualVerification = new Function(
  extractFunction(COPILOT_JS, "classifyVisualVerification") + "; return classifyVisualVerification;"
)();
const formatVisualVerificationSummary = new Function(
  extractFunction(COPILOT_JS, "formatVisualVerificationSummary") + "; return formatVisualVerificationSummary;"
)();

function pair(overrides = {}) {
  const before = {
    viewGeneration: 3, frameSequence: 20,
    observations: [{
      id: "cup_a", label: "blue cup", visible: true, identityConflict: false,
      viewGeneration: 3, frameSequence: 20, observedAt: 700
    }]
  };
  const after = {
    viewGeneration: 3, frameSequence: 21,
    observations: [{
      id: "cup_a", label: "blue cup", visible: true, identityConflict: false,
      viewGeneration: 3, frameSequence: 21, observedAt: 940
    }]
  };
  return { before, after: { ...after, ...overrides }, now: 1_000 };
}

function report(overrides = {}) {
  return {
    target_id: "cup_a",
    criterion: "cup inside outlined region",
    criterion_status: "met",
    change_observed: "changed",
    evidence: "direct",
    confidence: 0.91,
    consequence: "low",
    ...overrides
  };
}

describe("M27 guarded automatic visual verification", () => {
  it("supports a low-consequence success only for fresh matching target evidence", () => {
    const p = pair();
    expect(classifyVisualVerification(report(), p.before, p.after, p.now)).toMatchObject({
      status: "supported_success",
      targetId: "cup_a",
      beforeFrameSequence: 20,
      afterFrameSequence: 21
    });
  });

  it("reports supported failure/no change only when the visible criterion remains unmet", () => {
    const p = pair();
    expect(classifyVisualVerification(report({
      criterion_status: "not_met",
      change_observed: "no_change"
    }), p.before, p.after, p.now)).toMatchObject({
      status: "supported_failure_or_no_change",
      beforeFrameSequence: 20,
      afterFrameSequence: 21
    });
  });

  it("keeps high-consequence outcomes ambiguous even with a strong model report", () => {
    const p = pair();
    expect(classifyVisualVerification(report({
      consequence: "high",
      confidence: 1
    }), p.before, p.after, p.now)).toMatchObject({ status: "ambiguous" });
  });

  it("rejects absent, stale, hidden, mismatched, and cross-view baselines", () => {
    const p = pair();
    expect(classifyVisualVerification(report(), null, p.after, p.now).status).toBe("ambiguous");
    const stale = {
      ...p.before,
      observations: p.before.observations.map(item => ({ ...item, observedAt: -10_000 }))
    };
    expect(classifyVisualVerification(report(), stale, p.after, p.now).status).toBe("ambiguous");
    const hidden = {
      ...p.before,
      observations: p.before.observations.map(item => ({ ...item, visible: false }))
    };
    expect(classifyVisualVerification(report(), hidden, p.after, p.now).status).toBe("ambiguous");
    const otherView = { ...p.after, viewGeneration: 4 };
    expect(classifyVisualVerification(report(), p.before, otherView, p.now).status).toBe("ambiguous");
    const lookalike = {
      ...p.after,
      observations: p.after.observations.map(item => ({ ...item, label: "white cup" }))
    };
    expect(classifyVisualVerification(report(), p.before, lookalike, p.now).status).toBe("ambiguous");
  });

  it("refuses inferred, under-threshold, and inconsistent reports", () => {
    const p = pair();
    expect(classifyVisualVerification(report({ evidence: "inferred" }), p.before, p.after, p.now).status).toBe("ambiguous");
    expect(classifyVisualVerification(report({ confidence: 0.5 }), p.before, p.after, p.now).status).toBe("ambiguous");
    expect(classifyVisualVerification(report({ consequence: "moderate", confidence: 0.9 }), p.before, p.after, p.now).status).toBe("ambiguous");
    expect(classifyVisualVerification(report({ criterion_status: "unclear" }), p.before, p.after, p.now).status).toBe("ambiguous");
    expect(classifyVisualVerification(report({ criterion_status: "met", change_observed: "no_change" }), p.before, p.after, p.now).status).toBe("ambiguous");
  });

  it("labels the verdict as model-reported rather than independent sensor proof", () => {
    const p = pair();
    const verdict = classifyVisualVerification(report(), p.before, p.after, p.now);
    expect(formatVisualVerificationSummary(verdict)).toContain("not independent sensor proof");
  });

  it("declares the structured protocol and consequence gates in the Worker prompt", () => {
    expect(workerSource).toContain("visual_verification: {");
    expect(workerSource).toContain('enum: ["met", "not_met", "unclear"]');
    expect(workerSource).toContain("M27 — AUTOMATIC VISUAL VERIFICATION");
    expect(workerSource).toContain("High-consequence outcomes always need stronger independent confirmation");
  });
});
