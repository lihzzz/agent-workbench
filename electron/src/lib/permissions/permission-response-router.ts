import type { RemotePermissionAction } from "@shared/types/remote";
import { respondAcpPermissionDirect } from "../../ipc/acp-sessions";
import {
  codexAnswersFromRemoteAction,
  respondCodexApprovalDirect,
  respondCodexServerRequestErrorDirect,
  respondCodexUserInputDirect,
} from "../../ipc/codex-sessions";
import { respondClaudePermissionDirect } from "../../ipc/claude-sessions";
import { respondOpenCodePermissionDirect } from "../../ipc/opencode-sessions";
import type { PermissionLedgerEntry } from "./permission-ledger-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOriginalRef(entry: PermissionLedgerEntry): Record<string, unknown> {
  return isRecord(entry.originalRef) ? entry.originalRef : {};
}

function getToolInput(entry: PermissionLedgerEntry): Record<string, unknown> | undefined {
  const originalRef = getOriginalRef(entry);
  return isRecord(originalRef.toolInput) ? originalRef.toolInput : undefined;
}

function getCodexMethod(entry: PermissionLedgerEntry): string | undefined {
  const method = getOriginalRef(entry).method;
  return typeof method === "string" ? method : undefined;
}

async function throwOnError(result: Promise<{ ok?: boolean; error?: string }>): Promise<void> {
  const resolved = await result;
  if (resolved.error) throw new Error(resolved.error);
}

export async function respondPermissionFromLedger(
  entry: PermissionLedgerEntry,
  action: RemotePermissionAction,
): Promise<void> {
  switch (entry.engine) {
    case "claude": {
      if (action.kind === "answer") {
        throw new Error("Claude permissions do not support answer actions");
      }
      await throwOnError(respondClaudePermissionDirect({
        sessionId: entry.sessionId,
        requestId: entry.requestId,
        behavior: action.kind === "deny" ? "deny" : "allow",
        toolInput: getToolInput(entry),
      }));
      return;
    }
    case "acp": {
      if (action.kind !== "answer") {
        throw new Error("ACP permissions require an answer option");
      }
      await throwOnError(respondAcpPermissionDirect({
        sessionId: entry.sessionId,
        requestId: entry.requestId,
        optionId: action.optionId,
      }));
      return;
    }
    case "codex": {
      const method = getCodexMethod(entry);
      if (method === "item/tool/requestUserInput") {
        if (action.kind === "deny") {
          await throwOnError(respondCodexServerRequestErrorDirect({
            sessionId: entry.sessionId,
            rpcId: entry.requestId,
            code: -32001,
            message: "Remote user declined requestUserInput",
          }));
          return;
        }
        if (action.kind !== "answer") {
          throw new Error("Codex user-input requests require an answer action");
        }
        await throwOnError(respondCodexUserInputDirect({
          sessionId: entry.sessionId,
          rpcId: entry.requestId,
          answers: codexAnswersFromRemoteAction(action),
        }));
        return;
      }
      if (action.kind === "answer") {
        throw new Error("Codex approval requests do not support answer actions");
      }
      await throwOnError(respondCodexApprovalDirect({
        sessionId: entry.sessionId,
        rpcId: entry.requestId,
        decision: action.kind === "deny" ? "decline" : "accept",
      }));
      return;
    }
    case "opencode": {
      if (action.kind === "answer") {
        throw new Error("OpenCode permissions do not support answer actions");
      }
      await throwOnError(respondOpenCodePermissionDirect({
        sessionId: entry.sessionId,
        requestId: entry.requestId,
        reply: action.kind === "deny" ? "reject" : "once",
      }));
      return;
    }
  }
}
