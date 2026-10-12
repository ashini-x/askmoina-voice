import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COPILOT_JS } from "../src/copilot-assets";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

function extractFunction(source, functionName) {
  const marker = "function " + functionName + "(";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("Missing spatial-language helper: " + functionName);
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

const visualCoord = new Function(extractFunction(COPILOT_JS, "visualCoord") + "; return visualCoord;")();
const normalizeSpatialCues = new Function(
  "visualCoord", extractFunction(COPILOT_JS, "normalizeSpatialCues") + "; return normalizeSpatialCues;"
)(visualCoord);

describe("M28 generative spatial language", () => {
  it("composes alignment, directional motion paths, and placement regions from points", () => {
    const cues = normalizeSpatialCues([
      { kind: "alignment", points: [{ x: 100, y: 300 }, { x: 900, y: 300 }] },
      { kind: "motion_path", points: [{ x: 200, y: 800 }, { x: 400, y: 600 }, { x: 800, y: 400 }] },
      { kind: "placement_region", points: [{ x: 600, y: 200 }, { x: 850, y: 220 }, { x: 830, y: 450 }, { x: 620, y: 430 }] }
    ]);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toMatchObject({ type: "line", x1: 100, y1: 300, x2: 900, y2: 300 });
    expect(cues[1]).toMatchObject({ type: "polyline", directional: true });
    expect(cues[1].points).toHaveLength(3);
    expect(cues[2]).toMatchObject({ type: "polygon" });
    expect(cues[2].points).toHaveLength(4);
  });

  it("maps target points, orientation arrows, and short labels to reusable primitives", () => {
    const cues = normalizeSpatialCues([
      { kind: "target_point", points: [{ x: 400, y: 500 }] },
      { kind: "orientation", points: [{ x: 200, y: 400 }, { x: 600, y: 400 }] },
      { kind: "label", points: [{ x: 500, y: 250 }], label: "Align here" }
    ]);
    expect(cues[0]).toMatchObject({ type: "circle", x: 400, y: 500, radius: 20 });
    expect(cues[1]).toMatchObject({ type: "arrow", x1: 200, x2: 600 });
    expect(cues[2]).toMatchObject({ type: "label", text: "Align here" });
  });

  it("rejects out-of-frame, malformed, and under-specified geometry", () => {
    const cues = normalizeSpatialCues([
      { kind: "motion_path", points: [{ x: 10, y: 10 }, { x: 1001, y: 20 }] },
      { kind: "placement_region", points: [{ x: 20, y: 20 }, { x: 80, y: 80 }] },
      { kind: "target_point", points: [{ x: -1, y: 50 }] },
      { kind: "label", points: [{ x: 100, y: 200 }], label: " " },
      { kind: "not-a-kind", points: [{ x: 100, y: 100 }] }
    ]);
    expect(cues).toEqual([]);
  });

  it("bounds the number of cues and rejects oversized point lists without inventing geometry", () => {
    const points = Array.from({ length: 9 }, (_, i) => ({ x: i * 100, y: i * 80 }));
    const cues = normalizeSpatialCues([
      ...Array.from({ length: 6 }, () => ({ kind: "target_point", points: [{ x: 500, y: 500 }] })),
      { kind: "motion_path", points }
    ]);
    expect(cues).toHaveLength(5);
    expect(cues.every(item => item.type === "circle")).toBe(true);
  });

  it("has a bounded SVG renderer and a visibly light placement-region fill", () => {
    expect(COPILOT_JS).toContain('new Set(["line", "arrow", "circle", "rect", "tick", "label", "polyline", "polygon"])');
    expect(COPILOT_JS).toContain('shape.classList.add("ai-guide-region")');
    expect(COPILOT_JS).toContain('shape.setAttribute("marker-end", "url(#moina-guide-arrow-" + tone + ")")');
    expect(COPILOT_JS).toContain('const visualElements = spatialElements.concat(explicitElements).slice(0, 8)');
    expect(COPILOT_JS).toContain("not world-locked AR");
    expect(readFileSync(new URL("../public/copilot.css", import.meta.url), "utf8")).toContain(".ai-guide-region{fill:currentColor;fill-opacity:.12}");
  });

  it("declares semantic cue kinds and their safety limitations in the Worker schema", () => {
    expect(workerSource).toContain("spatial_cues: {");
    expect(workerSource).toContain('enum: ["alignment", "motion_path", "placement_region", "target_point", "orientation", "label"]');
    expect(workerSource).toContain("M28 — GENERATIVE SPATIAL LANGUAGE");
    expect(workerSource).toContain("not detected boundaries or world anchors");
  });
});
