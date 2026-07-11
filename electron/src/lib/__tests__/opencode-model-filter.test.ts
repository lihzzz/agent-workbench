import { describe, expect, it } from "vitest";
import type { Model, Provider } from "@opencode-ai/sdk";
import { collectOpenCodeModelSelection, filterOpenCodeModels } from "../opencode-model-filter";

function model(providerID: string, id: string): Model {
  return {
    id,
    providerID,
    api: { id, url: "https://example.test", npm: "test" },
    name: id.toUpperCase(),
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 100_000, output: 8_000 },
    status: "active",
    options: {},
    headers: {},
  };
}

const providers: Provider[] = [
  { id: "openai", name: "OpenAI", source: "config", env: [], options: {}, models: { gpt: model("openai", "gpt") } },
  { id: "anthropic", name: "Anthropic", source: "config", env: [], options: {}, models: { sonnet: model("anthropic", "sonnet") } },
];

describe("OpenCode model filtering", () => {
  it("reads top-level and provider model declarations", () => {
    const selection = collectOpenCodeModelSelection([
      { model: "openai/gpt", provider: { anthropic: { models: { sonnet: {} } } } },
    ]);
    expect(selection.modelIds).toEqual(new Set(["openai/gpt", "sonnet", "anthropic/sonnet"]));
  });

  it("filters configured models and falls back when nothing matches", () => {
    const selected = collectOpenCodeModelSelection([{ model: "anthropic/sonnet" }]);
    expect(filterOpenCodeModels(providers, selected).map((entry) => entry.id)).toEqual(["anthropic/sonnet"]);
    const missing = collectOpenCodeModelSelection([{ model: "missing/model" }]);
    expect(filterOpenCodeModels(providers, missing)).toHaveLength(2);
  });

  it("returns the full catalog without usable config", () => {
    expect(filterOpenCodeModels(providers, collectOpenCodeModelSelection([]))).toHaveLength(2);
    expect(filterOpenCodeModels(providers, collectOpenCodeModelSelection([null, "bad"]))).toHaveLength(2);
  });
});
