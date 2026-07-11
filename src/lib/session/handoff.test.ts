import { describe, expect, it } from "vitest";
import type { ChatSession, UIMessage } from "@/types";
import {
  RELAY_RECIPES,
  buildHandoffPrompt,
  extractRelayAssistantText,
  getNextRelayRole,
  truncateRelayText,
} from "./handoff";
import { buildRelayGroups, mergePendingRelayLane } from "./relay-groups";

function lane(id: string, stageIndex: number): ChatSession {
  return {
    id,
    projectId: "project-1",
    title: id,
    createdAt: stageIndex,
    totalCost: 0,
    isActive: false,
    engine: stageIndex % 2 === 0 ? "codex" : "claude",
    workflowGroupId: "group-1",
    workflowGroupName: "Plan",
    stageRole: RELAY_RECIPES[stageIndex]?.role ?? "plan",
    stageIndex,
  };
}

describe("Relay handoff", () => {
  it("defines the five-stage default recipe in order", () => {
    expect(RELAY_RECIPES.map((recipe) => recipe.role)).toEqual([
      "plan",
      "review-plan",
      "fix-plan",
      "implement",
      "code-review",
    ]);
    expect(getNextRelayRole("implement")).toBe("code-review");
    expect(getNextRelayRole("code-review")).toBeNull();
  });

  it("limits injected assistant text to 4,000 characters", () => {
    const truncated = truncateRelayText("x".repeat(4_500));
    expect(truncated).toHaveLength(4_000);
    expect(truncated.endsWith("\u2026(truncated)")).toBe(true);
  });

  it("fills all handoff template variables", () => {
    const prompt = buildHandoffPrompt({
      targetRole: "review-plan",
      prevRole: "Plan",
      prevEngine: "codex",
      prevText: "Plan completed.",
      artifacts: "PLAN.md",
    });
    expect(prompt).toContain("Plan (codex)");
    expect(prompt).toContain("Plan completed.");
    expect(prompt).toContain("PLAN.md");
    expect(prompt).not.toMatch(/\{\w+\}/);
  });

  it("extracts the last non-empty assistant message", () => {
    const messages: UIMessage[] = [
      { id: "a", role: "assistant", content: "first", timestamp: 1 },
      { id: "b", role: "assistant", content: "  ", timestamp: 2 },
      { id: "c", role: "assistant", content: "last", timestamp: 3 },
    ];
    expect(extractRelayAssistantText(messages)).toBe("last");
  });
});

describe("Relay groups", () => {
  it("sorts lanes and replaces a pending draft after materialization", () => {
    const groups = buildRelayGroups([lane("lane-2", 2), lane("lane-0", 0)]);
    expect(groups[0].lanes.map((entry) => entry.id)).toEqual(["lane-0", "lane-2"]);

    const pending = { ...lane("__draft__", 1), isActive: true };
    expect(mergePendingRelayLane(groups[0].lanes, pending).map((entry) => entry.stageIndex)).toEqual([0, 1, 2]);
    expect(mergePendingRelayLane([...groups[0].lanes, lane("lane-1", 1)], pending).some((entry) => entry.id === "__draft__")).toBe(false);
  });
});
