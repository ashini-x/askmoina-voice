import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COPILOT_JS } from "../src/copilot-assets";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

function extractFunction(source, functionName) {
  const marker = "function " + functionName + "(";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("Missing helper: " + functionName);
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

const { assessSafetyAndUncertainty, formatSafetyAssessmentSummary } = new Function(
  extractFunction(COPILOT_JS, "assessSafetyAndUncertainty") + "\n" +
  extractFunction(COPILOT_JS, "formatSafetyAssessmentSummary") +
  "; return { assessSafetyAndUncertainty, formatSafetyAssessmentSummary };"
)();
const { createRealityLoopState, transitionRealityLoopState, realityLoopBlocksVisualUpdate, formatRealityLoopSummary } = new Function(
  extractFunction(COPILOT_JS, "createRealityLoopState") + "\n" +
  extractFunction(COPILOT_JS, "transitionRealityLoopState") + "\n" +
  extractFunction(COPILOT_JS, "realityLoopBlocksVisualUpdate") + "\n" +
  extractFunction(COPILOT_JS, "formatRealityLoopSummary") +
  "; return { createRealityLoopState, transitionRealityLoopState, realityLoopBlocksVisualUpdate, formatRealityLoopSummary };"
)();

describe("M31 safety and uncertainty engine", () => {
  it("blocks procedural visual instructions for immediate danger", () => {
    const result = assessSafetyAndUncertainty({
      taskGoal: "Fix the sparking wall outlet",
      instruction: "Touch the exposed wire and reconnect it"
    });
    expect(result).toMatchObject({ level: "critical", blocksVisuals: true, requiresPause: true });
    expect(result.notice).toContain("move away");
    expect(formatSafetyAssessmentSummary(result)).toContain("visual guidance BLOCKED");
  });

  it("does not let a model-reported low risk downgrade deterministic hazard matches", () => {
    const result = assessSafetyAndUncertainty({
      taskGoal: "Repair this power outlet",
      instruction: "Adjust the exposed mains wiring",
      safetyAssessment: { consequence: "low", reversibility: "reversible", requires_pause: false }
    });
    expect(result.level).toBe("high");
    expect(result.blocksVisuals).toBe(true);
    expect(result.codes).toContain("mains_electrical");
  });

  it("honours an explicit pause and irreversible action when hazard words are absent", () => {
    const result = assessSafetyAndUncertainty({
      taskGoal: "Complete the procedure",
      instruction: "Make the final irreversible change",
      safetyAssessment: { consequence: "moderate", reversibility: "irreversible", requires_pause: true, uncertainty: "The exact model is not confirmed." }
    });
    expect(result.blocksVisuals).toBe(true);
    expect(result.reversibility).toBe("irreversible");
    expect(result.notice).toContain("exact model");
  });

  it("keeps reversible low-risk tasks eligible and ordinary tool work at caution", () => {
    const low = assessSafetyAndUncertainty({ taskGoal: "Place the blue cup on the tray", instruction: "Move the cup gently." });
    expect(low).toMatchObject({ level: "low", blocksVisuals: false });
    const caution = assessSafetyAndUncertainty({ taskGoal: "Drill a pilot hole in wood", instruction: "Hold the board steady." });
    expect(caution.level).toBe("caution");
    expect(caution.blocksVisuals).toBe(false);
    expect(caution.notice).toContain("protection");
  });

  it("declares safety fields and M31/M32 instructions in the Worker contract", () => {
    expect(workerSource).toContain("safety_assessment: {");
    expect(workerSource).toContain('enum: ["low", "moderate", "high", "critical", "unknown"]');
    expect(workerSource).toContain("M31 — SAFETY AND UNCERTAINTY ENGINE");
    expect(workerSource).toContain("M32 — ONE CONTINUOUS REALITY LOOP");
    expect(workerSource).toContain("do not claim fresh camera observation or visual verification");
    expect(COPILOT_JS).toContain("if (safety.blocksVisuals)");
    expect(COPILOT_JS).toContain('invalidateSceneEvidence("m31-safety-pause")');
  });
});

describe("M32 continuous reality loop state machine", () => {
  it("requires a fresh camera frame before observation becomes current", () => {
    let state = createRealityLoopState();
    state = transitionRealityLoopState(state, { type: "session_starting" }, 100);
    state = transitionRealityLoopState(state, { type: "camera_ready" }, 110);
    state = transitionRealityLoopState(state, { type: "voice_ready" }, 120);
    expect(state.awaitingFreshFrame).toBe(true);
    expect(realityLoopBlocksVisualUpdate(state)).toBe(true);
    state = transitionRealityLoopState(state, { type: "frame_sent" }, 130);
    expect(state).toMatchObject({ mode: "camera_live", observationSource: "camera", awaitingFreshFrame: false, frameSequence: 1 });
    expect(realityLoopBlocksVisualUpdate(state)).toBe(false);
  });

  it("marks immersive AR as local XR evidence, not live camera vision", () => {
    let state = createRealityLoopState();
    for (const [type, at] of [["session_starting", 100], ["camera_ready", 110], ["voice_ready", 120], ["frame_sent", 130], ["spatial_ar_start", 140]]) {
      state = transitionRealityLoopState(state, { type }, at);
    }
    expect(state).toMatchObject({ mode: "spatial_ar", camera: "suspended", spatialAr: "active", observationSource: "xr_pose", awaitingFreshFrame: true });
    expect(realityLoopBlocksVisualUpdate(state)).toBe(true);
    expect(formatRealityLoopSummary(state)).toContain("receives no new camera images");
  });

  it("holds camera-dependent overlays after AR ends until a new frame is sent", () => {
    let state = createRealityLoopState();
    for (const [type, at] of [["session_starting", 100], ["camera_ready", 110], ["voice_ready", 120], ["frame_sent", 130], ["spatial_ar_start", 140], ["spatial_ar_ended", 150], ["camera_resumed", 160]]) {
      state = transitionRealityLoopState(state, { type }, at);
    }
    expect(state).toMatchObject({ mode: "awaiting_frame", camera: "live", spatialAr: "inactive", observationSource: "none", awaitingFreshFrame: true });
    expect(realityLoopBlocksVisualUpdate(state)).toBe(true);
    state = transitionRealityLoopState(state, { type: "frame_sent" }, 170);
    expect(state.mode).toBe("camera_live");
    expect(state.awaitingFreshFrame).toBe(false);
    expect(realityLoopBlocksVisualUpdate(state)).toBe(false);
  });

  it("invalidates evidence on background/foreground changes and resets cleanly", () => {
    let state = createRealityLoopState();
    for (const [type, at] of [["session_starting", 1], ["camera_ready", 2], ["voice_ready", 3], ["frame_sent", 4], ["visibility_hidden", 5], ["visibility_visible", 6]]) {
      state = transitionRealityLoopState(state, { type }, at);
    }
    expect(state).toMatchObject({ mode: "awaiting_frame", awaitingFreshFrame: true, observationSource: "none" });
    state = transitionRealityLoopState(state, { type: "session_stopped" }, 7);
    expect(state).toMatchObject({ mode: "idle", camera: "idle", voice: "idle", spatialAr: "inactive", observationSource: "none" });
  });

  it("rejects impossible frame updates when the camera is suspended or tab is backgrounded", () => {
    let state = createRealityLoopState();
    for (const [type, at] of [["session_starting", 1], ["camera_ready", 2], ["voice_ready", 3], ["spatial_ar_start", 4]]) {
      state = transitionRealityLoopState(state, { type }, at);
    }
    expect(transitionRealityLoopState(state, { type: "frame_sent" }, 5)).toBe(state);
    state = transitionRealityLoopState(state, { type: "visibility_hidden" }, 6);
    expect(transitionRealityLoopState(state, { type: "frame_sent" }, 7)).toBe(state);
  });

  it("returns the reality-loop state with tool feedback and wires AR/camera lifecycle transitions", () => {
    expect(COPILOT_JS).toContain("formatRealityLoopSummary(realityLoopState)");
    expect(COPILOT_JS).toContain("realityLoopBlocksVisualUpdate(realityLoopState)");
    expect(COPILOT_JS).toContain('recordRealityLoopEvent("spatial_ar_start")');
    expect(COPILOT_JS).toContain('recordRealityLoopEvent("camera_resumed")');
  });
});
