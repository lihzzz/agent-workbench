import crypto from "crypto";

export interface RemoteTerminalLease {
  leaseId: string;
  terminalId: string;
  createdAt: number;
  expiresAt: number;
}

export class RemoteTerminalLeaseStore {
  private leases = new Map<string, RemoteTerminalLease>();

  create(terminalId: string, ttlMs: number): RemoteTerminalLease {
    this.revokeExpired();
    const now = Date.now();
    const lease: RemoteTerminalLease = {
      leaseId: crypto.randomUUID(),
      terminalId,
      createdAt: now,
      expiresAt: now + Math.max(1, ttlMs),
    };
    this.leases.set(lease.leaseId, lease);
    return lease;
  }

  validate(leaseId: string, terminalId: string): { ok: true; lease: RemoteTerminalLease } | { ok: false; reason: "missing" | "expired" | "terminal_mismatch" } {
    const lease = this.leases.get(leaseId);
    if (!lease) return { ok: false, reason: "missing" };
    if (lease.expiresAt <= Date.now()) {
      this.leases.delete(leaseId);
      return { ok: false, reason: "expired" };
    }
    if (lease.terminalId !== terminalId) {
      return { ok: false, reason: "terminal_mismatch" };
    }
    return { ok: true, lease };
  }

  revoke(leaseId: string): boolean {
    return this.leases.delete(leaseId);
  }

  revokeTerminal(terminalId: string): void {
    for (const [leaseId, lease] of this.leases) {
      if (lease.terminalId === terminalId) this.leases.delete(leaseId);
    }
  }

  revokeAll(): void {
    this.leases.clear();
  }

  revokeExpired(): void {
    const now = Date.now();
    for (const [leaseId, lease] of this.leases) {
      if (lease.expiresAt <= now) this.leases.delete(leaseId);
    }
  }
}
