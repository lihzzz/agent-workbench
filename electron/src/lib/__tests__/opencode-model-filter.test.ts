import { describe, expect, it, vi } from "vitest";
import type { Model, OpencodeClient, Provider } from "@opencode-ai/sdk";
import {
  collectOpenCodeModelSelection,
  filterOpenCodeModels,
  loadOpenCodeModelCatalog,
  resolveOpenCodeModelCatalog,
} from "../opencode-model-filter";

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
  {
    id: "openai",
    name: "OpenAI",
    source: "api",
    env: [],
    options: {},
    models: {
      gpt: model("openai", "gpt"),
      shared: model("openai", "shared"),
    },
  },
  {
    id: "anthropic",
    name: "Anthropic",
    source: "config",
    env: [],
    options: {},
    models: {
      sonnet: model("anthropic", "sonnet"),
      shared: model("anthropic", "shared"),
    },
  },
];

describe("OpenCode model filtering", () => {
  it("reads provider scope, defaults, and explicit model references", () => {
    const selection = collectOpenCodeModelSelection({
      model: "openai/gpt",
      small_model: "anthropic/sonnet",
      provider: { anthropic: { models: { sonnet: {} } } },
      agent: { plan: { model: "anthropic/shared" } },
      command: { review: { model: "openai/shared" } },
    });

    expect(selection.providerIds).toEqual(new Set(["anthropic"]));
    expect(selection.modelIds).toEqual(new Set([
      "openai/gpt",
      "anthropic/sonnet",
      "anthropic/shared",
      "openai/shared",
    ]));
    expect(selection.defaultModel).toBe("openai/gpt");
  });

  it("combines configured providers with explicitly referenced models", () => {
    const selected = collectOpenCodeModelSelection({
      provider: { anthropic: {} },
      model: "openai/gpt",
    });

    expect(filterOpenCodeModels(providers, selected).map((entry) => entry.id)).toEqual([
      "openai/gpt",
      "anthropic/sonnet",
      "anthropic/shared",
    ]);
  });

  it("uses enabled_providers as the effective provider allowlist", () => {
    const selected = collectOpenCodeModelSelection({
      enabled_providers: ["openai"],
      provider: { anthropic: {} },
    });

    expect(filterOpenCodeModels(providers, selected).map((entry) => entry.id)).toEqual([
      "openai/gpt",
      "openai/shared",
    ]);
  });

  it("matches qualified model references without leaking across providers", () => {
    const selected = collectOpenCodeModelSelection({ model: "openai/shared" });
    expect(filterOpenCodeModels(providers, selected).map((entry) => entry.id)).toEqual([
      "openai/shared",
    ]);
  });

  it("does not fall back to the full catalog when an explicit scope has no match", () => {
    const missing = collectOpenCodeModelSelection({ model: "missing/model" });
    expect(filterOpenCodeModels(providers, missing)).toEqual([]);
  });

  it("returns the effective catalog without a personal model scope", () => {
    expect(filterOpenCodeModels(providers, collectOpenCodeModelSelection({ theme: "dark" }))).toHaveLength(4);
    expect(filterOpenCodeModels(providers, collectOpenCodeModelSelection([null, "bad"]))).toHaveLength(4);
  });

  it("returns the configured default only when it remains selectable", () => {
    expect(resolveOpenCodeModelCatalog(providers, {
      model: "openai/gpt",
      provider: { openai: {} },
    }).defaultModel).toBe("openai/gpt");

    expect(resolveOpenCodeModelCatalog(providers, {
      model: "missing/model",
    })).toEqual({ models: [], defaultModel: undefined });
  });

  it("loads the provider catalog and resolved config from OpenCode", async () => {
    const providerRequest = vi.fn().mockResolvedValue({
      data: { providers, default: {} },
    });
    const configRequest = vi.fn().mockResolvedValue({
      data: { model: "anthropic/sonnet", provider: { anthropic: {} } },
    });
    const client = {
      config: { providers: providerRequest, get: configRequest },
    } as unknown as OpencodeClient;

    await expect(loadOpenCodeModelCatalog(client, "/project")).resolves.toMatchObject({
      defaultModel: "anthropic/sonnet",
      models: [
        { id: "anthropic/sonnet" },
        { id: "anthropic/shared" },
      ],
    });
    expect(providerRequest).toHaveBeenCalledWith({ query: { directory: "/project" }, signal: undefined });
    expect(configRequest).toHaveBeenCalledWith({ query: { directory: "/project" }, signal: undefined });
  });
});
