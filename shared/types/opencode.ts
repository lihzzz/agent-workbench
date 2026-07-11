import type { Event as OpenCodeNativeEvent } from "@opencode-ai/sdk";

export interface OpenCodeModelInfo {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  supportsImages: boolean;
}

export interface OpenCodeStartOptions {
  cwd: string;
  model?: string;
  resumeSessionId?: string;
}

export interface OpenCodeStartResult {
  sessionId?: string;
  opencodeSessionId?: string;
  models?: OpenCodeModelInfo[];
  selectedModel?: string;
  error?: string;
}

export interface OpenCodeSessionEvent {
  _sessionId: string;
  event: OpenCodeNativeEvent;
}

export interface OpenCodePermissionRequest {
  _sessionId: string;
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId?: string;
  title: string;
}

export interface OpenCodeExitEvent {
  _sessionId: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
}

export type OpenCodePermissionReply = "once" | "always" | "reject";
