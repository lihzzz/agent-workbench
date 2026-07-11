/**
 * Pure helpers shared between Electron and CLI Codex engine implementations.
 */

import type { CodexModel } from "../types/codex";

export const SUPPORTED_SERVER_REQUESTS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
]);

export function isSupportedServerRequestMethod(method: string): boolean {
  return SUPPORTED_SERVER_REQUESTS.has(method);
}

export function normalizeCodexModelOverride(model: string | null | undefined): string | undefined {
  const normalized = model?.trim();
  return normalized ? normalized : undefined;
}

/** Pick a valid model id from model/list, preferring the requested id when available. */
export function pickModelId(
  requestedModel: string | undefined,
  models: CodexModel[],
): string | undefined {
  const requested = typeof requestedModel === "string" ? requestedModel.trim() : "";
  if (requested.length > 0) {
    const hasRequested = models.some((m) => m.id === requested);
    if (hasRequested) return requested;
  }

  const defaultModel = models.find((m) => m.isDefault === true);
  if (defaultModel) return defaultModel.id;

  const first = models[0];
  return first?.id;
}

export function buildCodexThreadResumeParams(options: {
  threadId: string;
  cwd: string;
  model?: string | null;
  approvalPolicy?: string | null;
  sandbox?: string | null;
}): Record<string, unknown> {
  const params: Record<string, unknown> = {
    threadId: options.threadId,
    cwd: options.cwd,
    persistExtendedHistory: false,
  };

  const model = normalizeCodexModelOverride(options.model);
  if (model) params.model = model;
  if (options.approvalPolicy) params.approvalPolicy = options.approvalPolicy;
  if (options.sandbox) params.sandbox = options.sandbox;

  return params;
}
