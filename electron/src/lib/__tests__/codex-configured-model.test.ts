import { describe, expect, it } from "vitest";
import { mergeConfiguredCodexModel } from "@shared/lib/codex-configured-model";
import type { CodexModel } from "@shared/types/codex";

const MODEL: CodexModel = {
  id: "gpt-5",
  model: "gpt-5",
  upgrade: null,
  displayName: "GPT-5",
  description: "Default",
  hidden: false,
  supportedReasoningEfforts: [],
  defaultReasoningEffort: "medium",
  inputModalities: ["text"],
  supportsPersonality: false,
  isDefault: true,
};

describe("configured Codex model fallback", () => {
  it("prepends a conservative configured model", () => {
    const result = mergeConfiguredCodexModel([MODEL], "custom-model");
    expect(result.map((model) => model.id)).toEqual(["custom-model", "gpt-5"]);
    expect(result[0]).toMatchObject({
      inputModalities: ["text"],
      supportedReasoningEfforts: [],
      supportsPersonality: false,
    });
  });

  it("does not duplicate an existing or empty model", () => {
    expect(mergeConfiguredCodexModel([MODEL], "gpt-5")).toEqual([MODEL]);
    expect(mergeConfiguredCodexModel([MODEL], "  ")).toEqual([MODEL]);
  });
});
