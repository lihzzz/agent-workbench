import os from "os";
import path from "path";
import { promises as fs } from "fs";
import type { Provider } from "@opencode-ai/sdk";
import type { OpenCodeModelInfo } from "@shared/types/opencode";

export interface ModelSelection {
  providerIds: Set<string>;
  modelIds: Set<string>;
  foundConfig: boolean;
}

function addModel(selection: ModelSelection, value: unknown, providerId?: string): void {
  if (typeof value !== "string" || !value.trim()) return;
  const model = value.trim();
  selection.modelIds.add(model);
  if (providerId && !model.includes("/")) selection.modelIds.add(`${providerId}/${model}`);
}

export function collectOpenCodeModelSelection(configs: unknown[]): ModelSelection {
  const selection: ModelSelection = {
    providerIds: new Set(),
    modelIds: new Set(),
    foundConfig: configs.length > 0,
  };

  for (const config of configs) {
    if (!config || typeof config !== "object" || Array.isArray(config)) continue;
    const record = config as Record<string, unknown>;
    addModel(selection, record.model);

    for (const field of [record.provider, record.providers]) {
      if (Array.isArray(field)) {
        for (const provider of field) {
          if (typeof provider === "string" && provider.trim()) selection.providerIds.add(provider.trim());
        }
        continue;
      }
      if (!field || typeof field !== "object") continue;
      for (const [providerId, providerValue] of Object.entries(field)) {
        selection.providerIds.add(providerId);
        if (!providerValue || typeof providerValue !== "object" || Array.isArray(providerValue)) continue;
        const providerRecord = providerValue as Record<string, unknown>;
        const models = providerRecord.models;
        if (Array.isArray(models)) {
          for (const model of models) {
            if (typeof model === "string") addModel(selection, model, providerId);
            else if (model && typeof model === "object") {
              const modelRecord = model as Record<string, unknown>;
              addModel(selection, modelRecord.id ?? modelRecord.model, providerId);
            }
          }
        } else if (models && typeof models === "object") {
          for (const [modelKey, modelValue] of Object.entries(models)) {
            addModel(selection, modelKey, providerId);
            if (modelValue && typeof modelValue === "object") {
              const modelRecord = modelValue as Record<string, unknown>;
              addModel(selection, modelRecord.id ?? modelRecord.model, providerId);
            }
          }
        }
      }
    }
  }
  return selection;
}

function flattenProviders(providers: Provider[]): OpenCodeModelInfo[] {
  return providers.flatMap((provider) => Object.entries(provider.models).map(([key, model]) => ({
    id: `${provider.id}/${model.id || key}`,
    providerId: provider.id,
    modelId: model.id || key,
    displayName: `${model.name || model.id || key} (${provider.name})`,
    contextWindow: model.limit?.context ?? 200_000,
    supportsImages: model.capabilities?.input.image ?? false,
  })));
}

export function filterOpenCodeModels(providers: Provider[], selection: ModelSelection): OpenCodeModelInfo[] {
  const all = flattenProviders(providers);
  if (!selection.foundConfig || (selection.providerIds.size === 0 && selection.modelIds.size === 0)) return all;
  const filtered = all.filter((model) => {
    if (selection.modelIds.size > 0) {
      return selection.modelIds.has(model.id) || selection.modelIds.has(model.modelId);
    }
    return selection.providerIds.has(model.providerId);
  });
  return filtered.length > 0 ? filtered : all;
}

export async function loadFilteredOpenCodeModels(cwd: string, providers: Provider[]): Promise<OpenCodeModelInfo[]> {
  const candidates = [
    path.join(cwd, "opencode.json"),
    path.join(cwd, ".opencode.json"),
    path.join(os.homedir(), ".config", "opencode", "opencode.json"),
    path.join(os.homedir(), ".opencode", "opencode.json"),
    path.join(os.homedir(), ".opencode.json"),
  ];
  const configs: unknown[] = [];
  for (const candidate of candidates) {
    try {
      configs.push(JSON.parse(await fs.readFile(candidate, "utf-8")) as unknown);
    } catch {
      // Missing and malformed files are ignored; an empty selection falls back to all models.
    }
  }
  return filterOpenCodeModels(providers, collectOpenCodeModelSelection(configs));
}
