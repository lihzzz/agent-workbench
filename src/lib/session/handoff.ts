import type { EngineId, RelayStageRole, UIMessage } from "@/types";

export interface RelayRecipe {
  role: RelayStageRole;
  label: string;
  engine: EngineId;
  artifact: string;
  promptTemplate: string;
}

export const RELAY_RECIPES: readonly RelayRecipe[] = [
  {
    role: "plan",
    label: "Plan",
    engine: "codex",
    artifact: "PLAN.md",
    promptTemplate: "Analyze the task and write an implementation plan to PLAN.md.",
  },
  {
    role: "review-plan",
    label: "Review Plan",
    engine: "claude",
    artifact: "REVIEW.md",
    promptTemplate: [
      "Review PLAN.md critically and write findings to REVIEW.md.",
      "Previous lane: {prevRole} ({prevEngine})",
      "Previous assistant summary:",
      "{prevText}",
      "Expected artifacts: {artifacts}",
    ].join("\n\n"),
  },
  {
    role: "fix-plan",
    label: "Fix Plan",
    engine: "codex",
    artifact: "PLAN.md",
    promptTemplate: [
      "Update PLAN.md using REVIEW.md and the previous lane summary.",
      "Previous lane: {prevRole} ({prevEngine})",
      "Previous assistant summary:",
      "{prevText}",
      "Expected artifacts: {artifacts}",
    ].join("\n\n"),
  },
  {
    role: "implement",
    label: "Implement",
    engine: "codex",
    artifact: "working tree changes",
    promptTemplate: [
      "Implement the approved PLAN.md in the current workspace. Run relevant checks and keep the plan updated if needed.",
      "Previous lane: {prevRole} ({prevEngine})",
      "Previous assistant summary:",
      "{prevText}",
      "Expected artifacts: {artifacts}",
    ].join("\n\n"),
  },
  {
    role: "code-review",
    label: "Code Review",
    engine: "claude",
    artifact: "code review findings",
    promptTemplate: [
      "Review the implementation against PLAN.md and the current Git working tree. Lead with concrete defects and missing tests.",
      "Previous lane: {prevRole} ({prevEngine})",
      "Previous assistant summary:",
      "{prevText}",
      "Expected artifacts: {artifacts}",
    ].join("\n\n"),
  },
] as const;

const NO_PREVIOUS_TEXT = "No assistant summary was captured from the previous lane.";

export function getRelayRecipe(role: RelayStageRole): RelayRecipe {
  return RELAY_RECIPES.find((recipe) => recipe.role === role) ?? RELAY_RECIPES[0];
}

export function getNextRelayRole(role: RelayStageRole): RelayStageRole | null {
  const index = RELAY_RECIPES.findIndex((recipe) => recipe.role === role);
  return index >= 0 ? RELAY_RECIPES[index + 1]?.role ?? null : RELAY_RECIPES[0].role;
}

export function truncateRelayText(text: string, maxLength = 4_000): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  const marker = "\u2026(truncated)";
  return `${normalized.slice(0, Math.max(0, maxLength - marker.length))}${marker}`;
}

export function extractRelayAssistantText(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = message.content.trim();
    if (text) return truncateRelayText(text);
  }
  return NO_PREVIOUS_TEXT;
}

export function buildHandoffPrompt(input: {
  targetRole: RelayStageRole;
  prevRole: string;
  prevEngine: EngineId;
  prevText?: string;
  artifacts?: string;
}): string {
  const recipe = getRelayRecipe(input.targetRole);
  const values: Record<string, string> = {
    prevRole: input.prevRole,
    prevEngine: input.prevEngine,
    prevText: truncateRelayText(input.prevText || NO_PREVIOUS_TEXT),
    artifacts: input.artifacts?.trim() || recipe.artifact,
  };
  return recipe.promptTemplate.replace(/\{(prevRole|prevEngine|prevText|artifacts)\}/g, (_, key: string) => values[key]);
}
