import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COPILOT_JS } from "../src/copilot-assets";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

function extractFunction(source, functionName) {
  const marker = "function " + functionName + "(";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("Missing scene-model helper: " + functionName);
  const brace = source.indexOf("{", start + marker.length);
  if (brace < 0) throw new Error("Missing function body: " + functionName);
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

const mergeSceneModel = new Function(extractFunction(COPILOT_JS, "mergeSceneModel") + "; return mergeSceneModel;")();
const formatSceneModelSummary = new Function(extractFunction(COPILOT_JS, "formatSceneModelSummary") + "; return formatSceneModelSummary;")();

function context(overrides = {}) {
  return {
    frameSequence: 7,
    sourceFrameAt: 9_950,
    frameViewGeneration: 2,
    viewGeneration: 2,
    ...overrides
  };
}

const observations = [
  { id: "cup_a", label: "blue cup", evidence: "direct", confidence: 0.92, screen_region: "upper-left", visible: true },
  { id: "cup_b", label: "white cup", evidence: "inferred", confidence: 0.64, screen_region: "upper-right", visible: true }
];

describe("M25 live evidence-tagged scene model", () => {
  it("stores source frame, evidence tags, model-reported confidence, regions, and visible relations", () => {
    const model = mergeSceneModel(null, observations, [
      { from_id: "cup_a", relation: "left_of", to_id: "cup_b", evidence: "direct", confidence: 0.88 }
    ], context(), 10_000);

    expect(model.frameSequence).toBe(7);
    expect(model.viewGeneration).toBe(2);
    expect(model.observations).toHaveLength(2);
    expect(model.observations.find(item => item.id === "cup_a")).toMatchObject({
      id: "cup_a", label: "blue cup", evidence: "direct", confidence: 0.92,
      screenRegion: "upper-left", visible: true, frameSequence: 7, viewGeneration: 2
    });
    expect(model.relations[0]).toMatchObject({
      fromId: "cup_a", toId: "cup_b", relation: "left_of", evidence: "direct", confidence: 0.88
    });
    expect(formatSceneModelSummary(model, 10_500)).toContain("not object detection, exact geometry, or world tracking");
    expect(formatSceneModelSummary(model, 10_500)).toContain("model-reported confidence=0.92");
    expect(formatSceneModelSummary(model, 10_500)).toContain("cup_a left_of cup_b");
  });

  it("rejects observations from old frames and frames from a previous camera view generation", () => {
    const stale = mergeSceneModel(null, observations, [], context({ sourceFrameAt: 4_000 }), 10_000);
    expect(stale.observations).toHaveLength(0);
    expect(stale.staleInputRejected).toBe(true);

    const switchedView = mergeSceneModel(null, observations, [], context({ frameViewGeneration: 1, viewGeneration: 2 }), 10_000);
    expect(switchedView.observations).toHaveLength(0);
    expect(switchedView.staleInputRejected).toBe(true);
  });

  it("keeps recent candidates across tool calls but expires them rather than treating old evidence as current", () => {
    const first = mergeSceneModel(null, observations, [], context(), 10_000);
    const second = mergeSceneModel(first, [
      { id: "cup_a", label: "blue cup", evidence: "direct", confidence: 0.89, screen_region: "center", visible: true }
    ], [], context({ frameSequence: 8, sourceFrameAt: 10_500 }), 10_600);

    expect(second.observations.find(item => item.id === "cup_a")).toMatchObject({ confidence: 0.89, screenRegion: "center", frameSequence: 8 });
    expect(second.observations.some(item => item.id === "cup_b")).toBe(true);
    expect(formatSceneModelSummary(second, 18_000)).toContain("no fresh structured observations");
  });

  it("does not silently merge a reused candidate id when its label changes", () => {
    const first = mergeSceneModel(null, [
      { id: "item_1", label: "blue cup", evidence: "direct", confidence: 0.96, screen_region: "center", visible: true }
    ], [], context(), 10_000);
    const second = mergeSceneModel(first, [
      { id: "item_1", label: "black remote", evidence: "direct", confidence: 0.9, screen_region: "lower-right", visible: true }
    ], [], context({ frameSequence: 8, sourceFrameAt: 10_500 }), 10_600);

    expect(second.observations.some(item => item.id === "item_1" && item.label === "blue cup")).toBe(true);
    expect(second.observations.some(item =>
      item.id === "item_1@8" && item.label === "black remote" &&
      item.identityConflict === true && item.confidence <= 0.35
    )).toBe(true);
    expect(formatSceneModelSummary(second, 10_600)).toContain("ID/label conflict: treat identity as uncertain");
  });

  it("limits storage to a small number of candidates and relations", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: "obj_" + i, label: "object " + i, evidence: "inferred", confidence: 0.5,
      screen_region: "center", visible: true
    }));
    const model = mergeSceneModel(null, many, [], context(), 10_000);
    expect(model.observations.length).toBeLessThanOrEqual(8);
  });

  it("defines optional structured observations and clear continuity rules in the Worker prompt", () => {
    expect(COPILOT_JS).toContain("function updateSceneModel(rawObservations, rawRelations)");
    expect(COPILOT_JS).toContain("lastSentCameraFrameSequence += 1");
    expect(COPILOT_JS).toContain("identityConflict: labelConflict");
    expect(COPILOT_JS).toContain("model-reported, not measured");
    expect(workerSource).toContain("scene_observations:");
    expect(workerSource).toContain("scene_relations:");
    expect(workerSource).toContain("Confidence is descriptive, not calibrated probability.");
    expect(workerSource).toContain("Screen regions and relations are approximate reports");
    expect(workerSource).toContain("PERSISTENT SPATIAL TRACKING — HONEST CONTINUITY:");
  });
});
