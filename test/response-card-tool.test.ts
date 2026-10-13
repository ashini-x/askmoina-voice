import { describe, expect, it } from "vitest";
import { DISPLAY_RESPONSE_CARD_FUNCTION, validateResponseCard } from "../src/sessions/response-card";


describe("RC2 bounded response-card contract", () => {
  it("accepts and normalizes ordered steps", () => {
    expect(validateResponseCard({
      type: "steps", title: "  Organize the desk  ", summary: "Keep it simple.",
      steps: [
        { label: "Clear space", instruction: "Move unrelated objects aside." },
        { label: "Group items", instruction: "Place similar items together." },
        { label: "Check layout", instruction: "Leave frequent-use items within reach." }
      ]
    })).toEqual({
      valid: true, card: {
        type: "steps", title: "Organize the desk", summary: "Keep it simple.",
        steps: [
          { label: "Clear space", instruction: "Move unrelated objects aside." },
          { label: "Group items", instruction: "Place similar items together." },
          { label: "Check layout", instruction: "Leave frequent-use items within reach." }
        ]
      }
    });
  });

  it("accepts exact key details with optional units", () => {
    const result = validateResponseCard({
      type: "key_details", title: "Timer settings",
      details: [{ label: "Duration", value: "15", unit: "minutes" }, { label: "Mode", value: "Quiet" }]
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.card.type).toBe("key_details");
  });

  it("accepts a complete ten-row ranked leaderboard", () => {
    const result = validateResponseCard({
      type: "key_details",
      title: "IPL 2025 — Top 10 run scorers",
      details: Array.from({ length: 10 }, (_, i) => ({
        label: String(i + 1) + ". Player " + (i + 1),
        value: String(759 - i * 20) + " runs"
      }))
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.card.type).toBe("key_details");
      if (result.card.type === "key_details") expect(result.card.details).toHaveLength(10);
    }
  });

  it("accepts aligned comparison attributes and an optional takeaway", () => {
    const result = validateResponseCard({
      type: "comparison", title: "Two choices",
      options: [
        { name: "Option A", attributes: [{ label: "Weight", value: "Light" }] },
        { name: "Option B", attributes: [{ label: "Weight", value: "Heavier" }] }
      ],
      takeaway: "Option A is easier to carry."
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.card.type).toBe("comparison");
  });

  it("rejects unsupported types, mixed layouts, unknown keys and malformed nested items", () => {
    expect(validateResponseCard({ type: "html", title: "Bad" }).valid).toBe(false);
    expect(validateResponseCard({
      type: "steps", title: "Steps",
      steps: [{ label: "One", instruction: "Do one" }, { label: "Two", instruction: "Do two" }],
      options: []
    }).valid).toBe(false);
    expect(validateResponseCard({
      type: "key_details", title: "Details",
      details: [{ label: "Mode", value: "On", onclick: "run()" }]
    }).valid).toBe(false);
    expect(validateResponseCard({
      type: "comparison", title: "Bad attribute",
      options: [
        { name: "A", attributes: [{ label: "Cost", value: "$1" }] },
        { name: "B", attributes: [{ label: "Cost", value: "$2", extra: true }] }
      ]
    }).valid).toBe(false);
  });

  it("rejects missing, excessive, oversized, or control-character values", () => {
    expect(validateResponseCard({ type: "steps", title: "Too few", steps: [{ label: "One", instruction: "Do one" }] }).valid).toBe(false);
    expect(validateResponseCard({
      type: "steps", title: "Too many",
      steps: Array.from({ length: 6 }, (_, i) => ({ label: "Step " + i, instruction: "Do it" }))
    }).valid).toBe(false);
    expect(validateResponseCard({ type: "key_details", title: "Bad", details: [{ label: "  ", value: "x" }] }).valid).toBe(false);
    expect(validateResponseCard({ type: "key_details", title: "Bad\nTitle", details: [{ label: "A", value: "B" }] }).valid).toBe(false);
    expect(validateResponseCard({
      type: "steps", title: "Large",
      steps: [{ label: "One", instruction: "x".repeat(181) }, { label: "Two", instruction: "Do two" }]
    }).valid).toBe(false);
    expect(validateResponseCard({
      type: "key_details", title: "Large",
      details: Array.from({ length: 11 }, (_, i) => ({ label: "Label" + i, value: "Value" }))
    }).valid).toBe(false);
  });

  it("exports a distinct function declaration with exactly the supported layouts", () => {
    expect(DISPLAY_RESPONSE_CARD_FUNCTION.name).toBe("display_response_card");
    expect(DISPLAY_RESPONSE_CARD_FUNCTION.parameters.properties.type.enum).toEqual(["steps", "key_details", "comparison"]);
    expect(DISPLAY_RESPONSE_CARD_FUNCTION.parameters.required).toEqual(["type", "title"]);
  });
});
