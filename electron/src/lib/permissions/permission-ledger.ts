import type {
  PermissionLedgerAddInput,
  PermissionLedgerEntry,
} from "./permission-ledger-types";

function actionKey(action: PermissionLedgerEntry["allowedActions"][number]): string {
  if (action.kind === "answer") return `answer:${action.optionId}`;
  return action.kind;
}

export class PermissionLedger {
  private entries = new Map<string, PermissionLedgerEntry>();

  add(input: PermissionLedgerAddInput): PermissionLedgerEntry {
    const now = input.createdAt ?? Date.now();
    const entry: PermissionLedgerEntry = {
      ...input,
      createdAt: now,
    };
    this.entries.set(entry.requestId, entry);
    return entry;
  }

  get(requestId: string): PermissionLedgerEntry | undefined {
    const entry = this.entries.get(requestId);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(requestId);
      return undefined;
    }
    return { ...entry, allowedActions: entry.allowedActions.map((action) => ({ ...action })) };
  }

  list(): PermissionLedgerEntry[] {
    const now = Date.now();
    const entries: PermissionLedgerEntry[] = [];
    for (const [requestId, entry] of this.entries) {
      if (entry.expiresAt <= now || entry.resolvedAt) {
        this.entries.delete(requestId);
        continue;
      }
      entries.push({ ...entry, allowedActions: entry.allowedActions.map((action) => ({ ...action })) });
    }
    return entries;
  }

  claim(
    requestId: string,
    commandId: string,
    action: PermissionLedgerEntry["allowedActions"][number],
  ): { ok: true; entry: PermissionLedgerEntry } | { ok: false; reason: "not_found" | "expired" | "already_resolved" | "action_not_allowed" } {
    const entry = this.entries.get(requestId);
    if (!entry) return { ok: false, reason: "not_found" };
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(requestId);
      return { ok: false, reason: "expired" };
    }
    if (entry.resolvedAt || entry.claimedAt) {
      return { ok: false, reason: "already_resolved" };
    }
    const requestedAction = actionKey(action);
    const allowed = entry.allowedActions.some((candidate) => actionKey(candidate) === requestedAction);
    if (!allowed) return { ok: false, reason: "action_not_allowed" };

    entry.claimedAt = Date.now();
    entry.claimedByCommandId = commandId;
    return { ok: true, entry: { ...entry, allowedActions: entry.allowedActions.map((item) => ({ ...item })) } };
  }

  claimLocal(
    requestId: string,
    claimId: string,
  ): { ok: true; entry: PermissionLedgerEntry } | { ok: false; reason: "not_found" | "expired" | "already_resolved" } {
    const entry = this.entries.get(requestId);
    if (!entry) return { ok: false, reason: "not_found" };
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(requestId);
      return { ok: false, reason: "expired" };
    }
    if (entry.resolvedAt || entry.claimedAt) {
      return { ok: false, reason: "already_resolved" };
    }
    entry.claimedAt = Date.now();
    entry.claimedByCommandId = claimId;
    return { ok: true, entry: { ...entry, allowedActions: entry.allowedActions.map((item) => ({ ...item })) } };
  }

  resolve(requestId: string): void {
    const entry = this.entries.get(requestId);
    if (!entry) return;
    entry.resolvedAt = Date.now();
    this.entries.delete(requestId);
  }

  releaseClaim(requestId: string, commandId: string): void {
    const entry = this.entries.get(requestId);
    if (!entry || entry.claimedByCommandId !== commandId) return;
    delete entry.claimedAt;
    delete entry.claimedByCommandId;
  }

  deleteSession(sessionId: string): void {
    for (const [requestId, entry] of this.entries) {
      if (entry.sessionId === sessionId) this.entries.delete(requestId);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export const permissionLedger = new PermissionLedger();
