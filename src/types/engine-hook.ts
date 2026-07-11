import type { Dispatch, SetStateAction } from "react";
import type { UIMessage, SessionInfo } from "./session";
import type { PermissionRequest } from "./permissions";
import type { ContextUsage } from "./mcp";
import type { SessionModelUsage } from "../lib/session/model-usage";
import type { RespondPermissionFn } from "../../shared/types/engine";

/** Metadata snapshot for restoring a session from the background store. */
export interface BackgroundSessionSnapshot {
  isProcessing: boolean;
  isConnected: boolean;
  sessionInfo: SessionInfo | null;
  totalCost: number;
  contextUsage: ContextUsage | null;
  /** Cumulative per-model usage (Claude only). Optional for back-compat with older snapshots. */
  modelUsage?: SessionModelUsage;
  isCompacting?: boolean;
}

/**
 * The contract every engine hook must fulfill.
 * useSessionManager consumes this interface — it never touches engine internals directly.
 */
export interface EngineHookState {
  messages: UIMessage[];
  setMessages: Dispatch<SetStateAction<UIMessage[]>>;
  isProcessing: boolean;
  setIsProcessing: Dispatch<SetStateAction<boolean>>;
  isConnected: boolean;
  setIsConnected: Dispatch<SetStateAction<boolean>>;
  sessionInfo: SessionInfo | null;
  setSessionInfo: Dispatch<SetStateAction<SessionInfo | null>>;
  totalCost: number;
  setTotalCost: Dispatch<SetStateAction<number>>;
  contextUsage: ContextUsage | null;
  modelUsage: SessionModelUsage;
  isCompacting?: boolean;
  pendingPermission: PermissionRequest | null;
  respondPermission: RespondPermissionFn;
}
