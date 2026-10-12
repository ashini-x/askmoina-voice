import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COPILOT_JS } from "../src/copilot-assets";

function extractFunction(source, functionName) {
  const marker = "function " + functionName + "(";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("Missing spatial-track helper: " + functionName);
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

const createPersistentSpatialTrack = new Function(extractFunction(COPILOT_JS, "createPersistentSpatialTrack") + "; return createPersistentSpatialTrack;")();
const updatePersistentSpatialTrack = new Function(extractFunction(COPILOT_JS, "updatePersistentSpatialTrack") + "; return updatePersistentSpatialTrack;")();
const initialContext = { frameSequence: 12, viewGeneration: 4 };

describe("M26 persistent local spatial target tracking", () => {
  it("anchors identity to a user-selected image patch without claiming semantics or world lock", () => {
    const track = createPersistentSpatialTrack("local-patch-1", "blue cup", { x: 88, y: 112 }, initialContext, 20_000);
    expect(track).toMatchObject({
      trackId: "local-patch-1",
      targetKey: "blue cup",
      status: "anchored-by-user-tap",
      anchorType: "local-image-patch",
      identitySource: "user-tap",
      semanticIdentityVerified: false,
      worldLocked: false,
      lastPoint: { x: 88, y: 112 },
      lastFrameSequence: 12,
      viewGeneration: 4
    });
  });

  it("preserves one track id while applying match and confirmed reacquisition evidence", () => {
    const initial = createPersistentSpatialTrack("local-patch-2", "power button", { x: 80, y: 90 }, initialContext, 30_000);
    const matched = updatePersistentSpatialTrack(initial, {
      type: "match", score: 0.93, point: { x: 98, y: 110 }, frameSequence: 13,
      viewGeneration: 4, now: 30_100
    });
    expect(matched).toMatchObject({ trackId: "local-patch-2", status: "visible", confidence: 0.93, evidenceFrames: 1, lastPoint: { x: 98, y: 110 } });

    const missed = updatePersistentSpatialTrack(matched, { type: "miss", viewGeneration: 4, now: 30_200 });
    expect(missed).toMatchObject({ trackId: "local-patch-2", status: "reacquiring", missedFrames: 1 });
    expect(missed.confidence).toBeCloseTo(0.651);

    const reacquired = updatePersistentSpatialTrack(missed, {
      type: "match", score: 0.96, point: { x: 101, y: 111 }, frameSequence: 18,
      viewGeneration: 4, now: 31_000, reacquired: true
    });
    expect(reacquired).toMatchObject({
      trackId: "local-patch-2", status: "reacquired", confidence: 0.96,
      missedFrames: 0, reacquisitions: 1, evidenceFrames: 2, lastFrameSequence: 18
    });
  });

  it("invalidates the track instead of reprojecting a stale patch across a camera-view change", () => {
    const track = createPersistentSpatialTrack("local-patch-3", "remote power button", { x: 50, y: 75 }, initialContext, 40_000);
    const invalidated = updatePersistentSpatialTrack(track, {
      type: "match", score: 0.98, point: { x: 51, y: 76 }, frameSequence: 14,
      viewGeneration: 5, now: 40_100
    });
    expect(invalidated).toMatchObject({ trackId: "local-patch-3", status: "invalidated", confidence: 0, worldLocked: false });
  });

  it("requires repeated high-scoring evidence before a lost template is restored and clears stale markers", () => {
    const client = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
    expect(client).toContain("trackingReacquireCandidateFrames >= 2");
    expect(client).toContain("const reacquireThreshold = trackingTemplate && trackingTemplate.variance < 1800 ? 0.90 : 0.76");
    expect(client).toContain("now - trackingLostAt >= 1_300");
    expect(client).toContain("now - trackingLostAt >= 8_000");
    expect(client).toContain("focusMarker.dataset.trackId = persistentSpatialTrack.trackId");
    expect(client).toContain('delete focusMarker.dataset.trackId');
    expect(client).toContain("Local visual tracking · not world-locked AR");
  });

  it("invalidates tracks and scene evidence when zoom, camera source, or tab visibility changes", () => {
    expect(COPILOT_JS).toContain('invalidateSceneEvidence("zoom-change")');
    expect(COPILOT_JS).toContain('invalidateSceneEvidence("camera-switch")');
    expect(COPILOT_JS).toContain('invalidateSceneEvidence("tab-hidden")');
    expect(COPILOT_JS).toContain('invalidateSceneEvidence("video-frame-resize")');
    expect(COPILOT_JS).toContain("persistentSpatialTrack = null;");
  });
});
