import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

describe("Milestone 14 scene-understanding instruction contract", () => {
  it("requires observations to be separated from interpretation", () => {
    expect(workerSource).toContain("SCENE UNDERSTANDING — EVIDENCE FIRST:");
    expect(workerSource).toContain("Separate direct visual observations from interpretations");
    expect(workerSource).toContain("likely or possible when the image does not establish it");
  });

  it("limits text reading to legible evidence and prevents invented identifiers", () => {
    expect(workerSource).toContain("Read labels and other text only when legible");
    expect(workerSource).toContain("never invent a full model number, serial number, rating, or label");
  });

  it("requires targeted clarification when image quality or target identity is uncertain", () => {
    expect(workerSource).toContain("blur, glare, low light, motion, distance, perspective, or occlusion");
    expect(workerSource).toContain("ask for one specific improvement");
    expect(workerSource).toContain("If a spoken reference like this one could point to more than one candidate");
  });

  it("blocks claims about hidden or hazardous states from appearance alone", () => {
    expect(workerSource).toContain("Do not infer hidden conditions from appearance alone");
    expect(workerSource).toContain("electrical power state, gas presence, structural integrity, component compatibility");
  });

  it("keeps overlays approximate and does not treat web results as visual evidence", () => {
    expect(workerSource).toContain("not a detected bounding box or a guarantee that the named object was identified correctly");
    expect(workerSource).toContain("it is never evidence that the model or component in the camera frame has been identified");
  });

  it("preserves a concise user-facing response instead of dumping a scene inventory", () => {
    expect(workerSource).toContain("give at most three useful observations, then answer the actual question");
    expect(workerSource).toContain("Do not narrate every object");
  });
});
