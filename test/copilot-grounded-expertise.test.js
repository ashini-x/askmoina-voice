import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { assessGroundedSource, normalizeGroundedDeviceContext } from "../src/grounded-expertise";

const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

describe("M30 model-aware grounded expertise", () => {
  it("bounds and sanitizes device context without inventing missing model identifiers", () => {
    expect(normalizeGroundedDeviceContext({
      manufacturer: " Samsung\u0000 ",
      model_id: " SM-A556E ",
      variant: " 2025 rev. 2 ",
      part_number: "ABC-1234",
      requested_material: "manual",
      unused: "ignore"
    })).toEqual({
      manufacturer: "Samsung",
      model_id: "SM-A556E",
      variant: "2025 rev. 2",
      part_number: "ABC-1234",
      requested_material: "manual"
    });
    expect(normalizeGroundedDeviceContext({ model_id: "unknown", requested_material: "make-up" })).toEqual({
      manufacturer: "", model_id: "unknown", variant: "", part_number: "", requested_material: ""
    });
    expect(normalizeGroundedDeviceContext(null)).toEqual({
      manufacturer: "", model_id: "", variant: "", part_number: "", requested_material: ""
    });
  });

  it("only reports model text as present when all provided identifiers appear in title or URL", () => {
    const context = { manufacturer: "Samsung", model_id: "SM-A556E", variant: "Rev 2" };
    const matched = assessGroundedSource("Galaxy A55 SM-A556E Rev 2 user guide", "https://www.samsung.com/support/SM-A556E", context);
    expect(matched.modelTextMatch).toBe("visible_in_title_or_url");
    expect(matched.manufacturerHostHint).toBe(true);
    expect(matched.note).toContain("page content still requires inspection");

    const mismatch = assessGroundedSource("Galaxy A55 general support", "https://example.com/help", context);
    expect(mismatch.modelTextMatch).toBe("not_established");
    expect(mismatch.manufacturerHostHint).toBe(false);
    expect(mismatch.note).toContain("exact model/variant match is not established");
  });

  it("does not imply an exact model match when no model identifier was given", () => {
    const result = assessGroundedSource("Laptop setup guide", "https://example.com/laptop", { manufacturer: "Acme" });
    expect(result.modelTextMatch).toBe("not_established");
    expect(result.note).toContain("no exact model identifier was provided");
  });

  it("keeps a manufacturer-host match explicitly heuristic and accepts only HTTP(S) URLs", () => {
    const hint = assessGroundedSource("Official-looking page", "https://support.samsung.com/help", { manufacturer: "Samsung" });
    expect(hint.manufacturerHostHint).toBe(true);
    expect(hint.note).toContain("heuristic only");
    const invalid = assessGroundedSource("Result", "javascript:alert(1)", { manufacturer: "Samsung", model_id: "SM-A556E" });
    expect(invalid.manufacturerHostHint).toBe(false);
    expect(invalid.modelTextMatch).toBe("not_established");
  });

  it("passes explicit context into grounded search and warns when exact model match is unverified", () => {
    expect(workerSource).toContain("device_context: {");
    expect(workerSource).toContain("await performGroundedWebSearch(env, query, deviceContext)");
    expect(workerSource).toContain("MODEL MATCH NOT ESTABLISHED");
    expect(workerSource).toContain("Prefer the manufacturer's official manual");
    expect(workerSource).toContain("A source or web search is not proof that the camera identified the physical device");
    expect(workerSource).toContain("M30 — MODEL-AWARE GROUNDING:");
  });
});
