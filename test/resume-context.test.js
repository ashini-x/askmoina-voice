import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../public/copilot.js", import.meta.url), "utf8");
const start = script.indexOf("  const CONVERSATION_SUMMARY_RECENT_MARKER =");
const end = script.indexOf("  function queueFinalizedConversationTurn(", start);
if (start < 0 || end < 0) throw new Error("Cumulative resume-summary helper not found.");
const helperSource = script.slice(start, end);
const mergeConversationSummary = new Function(
  helperSource + "\nreturn mergeConversationSummary;"
)();

describe("cumulative saved conversation context", () => {
  const progress = {
    goal: "Repair the laptop and confirm the display works",
    constraints: ["Keep the user's files intact"],
    expectedEvidence: "The display turns on"
  };

  it("keeps older interaction notes when a conversation gets another turn", () => {
    const first = mergeConversationSummary("", "User: The display is black\nMoina: Check the power light first.", progress);
    const second = mergeConversationSummary(first, "User: The power light is on\nMoina: Try the brightness shortcut.", progress);
    const third = mergeConversationSummary(second, "User: That fixed it\nMoina: Great; verify the display remains stable.", progress);

    expect(first).toContain("The display is black");
    expect(second).toContain("The display is black");
    expect(second).toContain("Try the brightness shortcut");
    expect(third).toContain("The display is black");
    expect(third).toContain("The power light is on");
    expect(third).toContain("verify the display remains stable");
  });

  it("preserves the ongoing goal, constraints and success evidence in the stable summary", () => {
    const summary = mergeConversationSummary("", "User: Continue the repair", progress);
    expect(summary).toContain("Goal: Repair the laptop");
    expect(summary).toContain("Keep the user's files intact");
    expect(summary).toContain("Success evidence: The display turns on");
  });

  it("bounds the stored summary and includes legacy summaries when migrating in memory", () => {
    const legacy = "Goal: Existing task\nLatest user request: The earlier symptom\nLatest Moina response: The previous diagnostic";
    const merged = mergeConversationSummary(legacy, "User: " + "new evidence ".repeat(500), progress);
    expect(merged).toContain("The earlier symptom");
    expect(merged).toContain("new evidence");
    expect(merged.length).toBeLessThanOrEqual(4_000);
  });

  it("restores the cumulative summary on resume and sends it with recent transcript and task state", () => {
    expect(script).toContain("conversationSummariesByScope.set(conversationScope, String(resumeConversationForNextStart.conversation.summary || \\"\\")");
    expect(script).toContain("Saved cumulative summary and prior interaction notes:");
    expect(script).toContain("Recent saved transcript (chronological; the full history remains available in the History screen)");
    expect(script).toContain("Saved task state:");
  });
});
