import type { OpencodeClient, Provider } from "@opencode-ai/sdk";
import type { OpenCodeModelCatalog, OpenCodeModelInfo } from "@shared/types/opencode";

export interface ModelSelection {
  providerIds: Set<string>;
  modelIds: Set<string>;
  defaultModel?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function addModel(selection: ModelSelection, value: unknown): void {
  if (typeof value !== "string") return;
  const model = value.trim();
  if (!model.includes("/")) return;
  selection.modelIds.add(model);
}

function collectReferencedModels(selection: ModelSelection, value: unknown): void {
  const record = asRecord(value);
  if (!record) return;
  for (const entry of Object.values(record)) {
    addModel(selection, asRecord(entry)?.model);
  }
}

function collectProviderIds(value: unknown, target: Set<string>): void {
  if (Array.isArray(value)) {
    for (const provider of value) {
      if (typeof provider === "string" && provider.trim()) target.add(provider.trim());
    }
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const providerId of Object.keys(record)) {
    if (providerId.trim()) target.add(providerId.trim());
  }
}

export function collectOpenCodeModelSelection(config: unknown): ModelSelection {
  const selection: ModelSelection = {
    providerIds: new Set(),
    modelIds: new Set(),
  };
  const configs = Array.isArray(config) ? config : [config];
  const configuredProviderIds = new Set<string>();
  let enabledProviderIds: Set<string> | undefined;

  for (const entry of configs) {
    const record = asRecord(entry);
    if (!record) continue;

    addModel(selection, record.model);
    addModel(selection, record.small_model);
    if (typeof record.model === "string" && record.model.trim()) {
      selection.defaultModel = record.model.trim();
    }

    collectReferencedModels(selection, record.agent);
    collectReferencedModels(selection, record.mode);
    collectReferencedModels(selection, record.command);

    collectProviderIds(record.provider, configuredProviderIds);
    collectProviderIds(record.providers, configuredProviderIds);

    if (Array.isArray(record.enabled_providers)) {
      enabledProviderIds = new Set<string>();
      collectProviderIds(record.enabled_providers, enabledProviderIds);
    }
  }

  selection.providerIds = enabledProviderIds ?? configuredProviderIds;
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
  if (selection.providerIds.size === 0 && selection.modelIds.size === 0) return all;
  return all.filter((model) =>
    selection.providerIds.has(model.providerId) || selection.modelIds.has(model.id));
}

export function resolveOpenCodeModelCatalog(
  providers: Provider[],
  config: unknown,
): OpenCodeModelCatalog {
  const selection = collectOpenCodeModelSelection(config);
  const models = filterOpenCodeModels(providers, selection);
  const defaultModel = selection.defaultModel && models.some((model) => model.id === selection.defaultModel)
    ? selection.defaultModel
    : undefined;
  return { models, defaultModel };
}

export async function loadOpenCodeModelCatalog(
  client: OpencodeClient,
  cwd: string,
  signal?: AbortSignal,
): Promise<OpenCodeModelCatalog> {
  const [providerResult, configResult] = await Promise.all([
    client.config.providers({ query: { directory: cwd }, signal }),
    client.config.get({ query: { directory: cwd }, signal }),
  ]);
  if (providerResult.error !== undefined) {
    throw new Error(`OpenCode provider list: ${errorMessage(providerResult.error)}`);
  }
  if (!providerResult.data) throw new Error("OpenCode provider list: empty response");
  if (configResult.error !== undefined) {
    throw new Error(`OpenCode config: ${errorMessage(configResult.error)}`);
  }
  if (!configResult.data) throw new Error("OpenCode config: empty response");
  return resolveOpenCodeModelCatalog(providerResult.data.providers as Provider[], configResult.data);
}
