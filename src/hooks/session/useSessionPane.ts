/**
 * useSessionPane — encapsulates one complete engine set for a single pane.
 * for a single "pane" of the UI.
 *
 * In single mode, only the primary pane is active. In split view, both primary
 * and secondary panes are active simultaneously. The hook is always called
 * unconditionally (satisfying Rules of Hooks); when not in use, all engine hooks
 * receive null sessionIds and hold dormant empty state.
 */

import { useClaude } from "../useClaude";
import { useACP } from "../useACP";
import { useCodex } from "../useCodex";
import { useOpenCode } from "../useOpenCode";
import type { UIMessage, PermissionRequest, EngineId, AcpPermissionBehavior, ContextUsage, SessionInfo, ACPConfigOption, ACPPermissionEvent, SlashCommand } from "@/types";
import type { InitialMeta } from "./types";
import type { SessionModelUsage } from "@/lib/session/model-usage";

export interface UseSessionPaneOptions {
  /** The logical session ID for this pane (or null when the pane is unused). */
  activeSessionId: string | null;
  /** Which engine this pane's session uses. */
  activeEngine: EngineId;

  // ── Per-engine session IDs (pre-computed by the caller) ──
  claudeSessionId: string | null;
  acpSessionId: string | null;
  codexSessionId: string | null;
  codexSessionModel: string | undefined;
  codexPlanModeEnabled: boolean;
  opencodeSessionId: string | null;
  opencodeSessionModel: string | undefined;

  // ── Initial state for session restoration ──
  initialMessages: UIMessage[];
  initialMeta: InitialMeta | null;
  initialPermission: PermissionRequest | null;

  // ── ACP-specific initial state ──
  initialConfigOptions?: ACPConfigOption[];
  initialSlashCommands?: SlashCommand[];
  initialRawAcpPermission?: ACPPermissionEvent | null;
  acpPermissionBehavior: AcpPermissionBehavior;
}

export interface SessionPaneState {
  /** Individual engine hook returns — sub-hooks need direct access. */
  claude: ReturnType<typeof useClaude>;
  acp: ReturnType<typeof useACP>;
  codex: ReturnType<typeof useCodex>;
  opencode: ReturnType<typeof useOpenCode>;

  /** The currently-selected engine for this pane. */
  engine: ReturnType<typeof useClaude> | ReturnType<typeof useACP> | ReturnType<typeof useCodex> | ReturnType<typeof useOpenCode>;

  /** Convenience accessors — derived from the active engine. */
  messages: UIMessage[];
  totalCost: number;
  contextUsage: ContextUsage | null;
  modelUsage: SessionModelUsage;
  isProcessing: boolean;
  isConnected: boolean;
  isCompacting: boolean;
  sessionInfo: SessionInfo | null;
  pendingPermission: PermissionRequest | null;
}

export function useSessionPane({
  activeEngine,
  claudeSessionId,
  acpSessionId,
  codexSessionId,
  codexSessionModel,
  codexPlanModeEnabled,
  opencodeSessionId,
  opencodeSessionModel,
  initialMessages,
  initialMeta,
  initialPermission,
  initialConfigOptions,
  initialSlashCommands,
  initialRawAcpPermission,
  acpPermissionBehavior,
}: UseSessionPaneOptions): SessionPaneState {
  const isACP = activeEngine === "acp";
  const isCodex = activeEngine === "codex";
  const isClaude = activeEngine === "claude";
  const isOpenCode = activeEngine === "opencode";

  // ── Engine hooks (always called — Rules of Hooks) ──
  const claude = useClaude({
    sessionId: claudeSessionId,
    initialMessages: isClaude ? initialMessages : [],
    initialMeta: isClaude ? initialMeta : null,
    initialPermission: isClaude ? initialPermission : null,
  });

  const acp = useACP({
    sessionId: acpSessionId,
    initialMessages: isACP ? initialMessages : [],
    initialConfigOptions: isACP ? initialConfigOptions : undefined,
    initialSlashCommands: isACP ? initialSlashCommands : undefined,
    initialMeta: isACP ? initialMeta : null,
    initialPermission: isACP ? initialPermission : null,
    initialRawAcpPermission: isACP ? initialRawAcpPermission : null,
    acpPermissionBehavior,
  });

  const codex = useCodex({
    sessionId: codexSessionId,
    sessionModel: codexSessionModel,
    planModeEnabled: codexPlanModeEnabled,
    initialMessages: isCodex ? initialMessages : [],
    initialMeta: isCodex ? initialMeta : null,
    initialPermission: isCodex ? initialPermission : null,
  });

  const opencode = useOpenCode({
    sessionId: opencodeSessionId,
    sessionModel: opencodeSessionModel,
    initialMessages: isOpenCode ? initialMessages : [],
    initialMeta: isOpenCode ? initialMeta : null,
    initialPermission: isOpenCode ? initialPermission : null,
  });

  // Pick the active engine's state
  const engine = isOpenCode ? opencode : isCodex ? codex : isACP ? acp : claude;

  return {
    claude,
    acp,
    codex,
    opencode,
    engine,
    messages: engine.messages,
    totalCost: engine.totalCost,
    contextUsage: engine.contextUsage,
    modelUsage: engine.modelUsage,
    isProcessing: engine.isProcessing,
    isConnected: engine.isConnected,
    isCompacting: "isCompacting" in engine ? !!engine.isCompacting : false,
    sessionInfo: engine.sessionInfo,
    pendingPermission: engine.pendingPermission,
  };
}
