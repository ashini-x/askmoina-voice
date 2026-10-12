import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COPILOT_JS } from "../src/copilot-assets";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

function extractFunction(source, functionName) {
  const marker = "function " + functionName + "(";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("Missing task-world-model helper: " + functionName);
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

const createTaskWorldModel = new Function(
  extractFunction(COPILOT_JS, "createTaskWorldModel") + "; return createTaskWorldModel;"
)();
const mergeTaskWorldModel = new Function(
  extractFunction(COPILOT_JS, "mergeTaskWorldModel") + "; return mergeTaskWorldModel;"
)();
const formatTaskWorldModelSummary = new Function(
  extractFunction(COPILOT_JS, "formatTaskWorldModelSummary") + "; return formatTaskWorldModelSummary;"
)();

describe("M29 session-local task world model", () => {
  it("starts and preserves goal, current state, next action, evidence, and constraints", () => {
    const initial = createTaskWorldModel();
    const state = mergeTaskWorldModel(initial, {
      task_goal: "Place the blue cup inside the outlined area",
      current_state: "Cup is left of the empty area",
      intended_action: "Move the cup into the outlined area",
      expected_evidence: "Same cup is visibly inside the outline",
      constraints: ["Do not move the white cup"],
      uncertainties: ["Camera angle is slightly oblique"],
      user_report: "none"
    }, null, null, 1_000);
    expect(state).toMatchObject({
      goal: "Place the blue cup inside the outlined area",
      currentState: "Cup is left of the empty area",
      intendedAction: "Move the cup into the outlined area",
      expectedEvidence: "Same cup is visibly inside the outline",
      constraints: ["Do not move the white cup"],
      uncertainties: ["Camera angle is slightly oblique"]
    });
    const summary = formatTaskWorldModelSummary(state, null, 1_000);
    expect(summary).toContain("Goal: Place the blue cup");
    expect(summary).toContain("Expected evidence:");
    expect(summary).toContain("model notes are not proof");
  });

  it("keeps a user-reported completion distinct from visual verification", () => {
    const state = mergeTaskWorldModel(createTaskWorldModel(), {
      task_goal: "Organize the desk",
      current_state: "User says they finished",
      user_report: "says_done"
    }, null, null, 2_000);
    expect(state.lastOutcome).toMatchObject({ kind: "user_reports_done", source: "user_report" });
    expect(formatTaskWorldModelSummary(state, null, 2_000)).toContain("user report, not visual verification");
    expect(state.lastOutcome.kind).not.toBe("visually_supported_success");
  });

  it("only labels visual support when the M27 guarded result is supplied", () => {
    let state = mergeTaskWorldModel(createTaskWorldModel(), {
      task_goal: "Move the cup", user_report: "says_done"
    }, null, null, 3_000);
    expect(state.lastOutcome.kind).toBe("user_reports_done");
    state = mergeTaskWorldModel(state, { current_state: "The camera-visible criterion was met" }, {
      status: "supported_success",
      reason: "Fresh direct evidence supports the visible criterion."
    }, null, 3_500);
    expect(state.lastOutcome).toMatchObject({ kind: "visually_supported_success", source: "m27_visual_gate" });
  });

  it("resets task-specific outcome when the user changes goals", () => {
    const first = mergeTaskWorldModel(createTaskWorldModel(), {
      task_goal: "Align two books", current_state: "One book is tilted", intended_action: "Straighten the left book"
    }, null, null, 4_000);
    const second = mergeTaskWorldModel(first, {
      task_goal: "Set up the laptop", current_state: "Laptop is closed", intended_action: "Ask which setup outcome is wanted",
      user_report: "says_done"
    }, null, null, 5_000);
    expect(second.goal).toBe("Set up the laptop");
    expect(second.lastOutcome.kind).toBe("reset_for_new_goal");
    expect(second.events.some(event => event.kind === "goal_changed")).toBe(true);
    expect(formatTaskWorldModelSummary(second, null, 5_000)).toContain("Earlier task outcome does not establish progress");
  });

  it("bounds history and strips control characters from model-provided state", () => {
    let state = createTaskWorldModel();
    for (let n = 0; n < 12; n += 1) {
      state = mergeTaskWorldModel(state, {
        task_goal: "Test a task",
        current_state: "State\u0000 " + n,
        update_reason: "New evidence " + n
      }, null, null, 10_000 + n);
    }
    expect(state.events.length).toBeLessThanOrEqual(6);
    expect(state.currentState).not.toContain("\u0000");
  });

  it("declares task state in the tool contract and prevents model notes alone from confirming success", () => {
    expect(workerSource).toContain("task_world_state: {");
    expect(workerSource).toContain('enum: ["none", "says_done", "says_failed", "unsure"]');
    expect(workerSource).toContain("M29 — TASK WORLD MODEL CONTINUITY");
    expect(workerSource).toContain("a model-supplied state field alone must never confirm completion");
    expect(COPILOT_JS).toContain("function mergeTaskWorldModel");
    expect(COPILOT_JS).toContain("formatTaskWorldModelSummary(taskWorldModel");
  });
});
