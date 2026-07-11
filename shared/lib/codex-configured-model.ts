import type { CodexModel } from "../types/codex";

export function mergeConfiguredCodexModel(
  models: CodexModel[],
  configuredModel: string | null | undefined,
): CodexModel[] {
  const modelId = configuredModel?.trim();
  if (!modelId || models.some((model) => model.id === modelId || model.model === modelId)) return models;
  return [{
    id: modelId,
    model: modelId,
    upgrade: null,
    displayName: modelId,
    description: "Configured in Codex config.",
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    inputModalities: ["text"],
    supportsPersonality: false,
    isDefault: false,
  }, ...models];
}
