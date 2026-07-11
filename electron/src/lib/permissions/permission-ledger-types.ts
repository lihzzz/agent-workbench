import type { EngineId } from "@shared/types/engine";
import type { RemotePermissionAction } from "@shared/types/remote";

export type PermissionRisk = "low" | "medium" | "high";

export interface PermissionLedgerEntry {
  requestId: string;
  sessionId: string;
  engine: EngineId;
  createdAt: number;
  expiresAt: number;
  claimedAt?: number;
  claimedByCommandId?: string;
  resolvedAt?: number;
  toolName: string;
  cwd?: string;
  risk: PermissionRisk;
  summary: string;
  rawPreview: string;
  allowedActions: RemotePermissionAction[];
  originalRef: unknown;
}

export type PermissionLedgerAddInput = Omit<
  PermissionLedgerEntry,
  "createdAt" | "claimedAt" | "claimedByCommandId" | "resolvedAt"
> & {
  createdAt?: number;
};
