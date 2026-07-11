import { Buffer } from "buffer";
import { readTerminalHistory } from "../terminal-history";
import { onTerminalData, terminals } from "../../ipc/terminal";
import { RemoteTerminalLeaseStore } from "../remote/remote-terminal-lease";
import type {
  RemoteTerminalSnapshot,
  RemoteTerminalSummary,
} from "@shared/types/remote";

const DEFAULT_MAX_FRAME_BYTES = 64 * 1024;
const DEFAULT_MAX_WRITE_BYTES = 4 * 1024;

function truncateUtf8Tail(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const size = Buffer.byteLength(value, "utf-8");
  if (size <= maxBytes) return { value, truncated: false };
  let bytes = 0;
  let result = "";
  for (let i = value.length - 1; i >= 0; i--) {
    const char = value[i];
    const nextBytes = Buffer.byteLength(char, "utf-8");
    if (bytes + nextBytes > maxBytes) break;
    result = char + result;
    bytes += nextBytes;
  }
  return { value: result, truncated: true };
}

export interface RestrictedTerminalServiceOptions {
  maxFrameBytes?: number;
  maxWriteBytes?: number;
}

export class RestrictedTerminalService {
  private readonly subscriptions = new Set<string>();
  private disposeTerminalData?: () => void;
  onTerminalData?: (event: { terminalId: string; data: string; seq: number }) => void;

  constructor(
    private readonly leases = new RemoteTerminalLeaseStore(),
    private readonly options: RestrictedTerminalServiceOptions = {},
  ) {}

  list(): RemoteTerminalSummary[] {
    return Array.from(terminals.entries())
      .map(([terminalId, terminal]) => ({
        terminalId,
        spaceId: terminal.spaceId,
        cwd: terminal.cwd,
        createdAt: terminal.createdAt,
        lastActivityAt: terminal.lastActivityAt,
        exited: terminal.exited,
        exitCode: terminal.exitCode,
      }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  snapshot(terminalId: string): RemoteTerminalSnapshot {
    const terminal = terminals.get(terminalId);
    if (!terminal) throw new Error("Terminal not found");
    const output = readTerminalHistory(terminal.history);
    const truncated = truncateUtf8Tail(output, this.options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES);
    return {
      terminalId,
      output: truncated.value,
      seq: terminal.seq,
      cols: terminal.cols,
      rows: terminal.rows,
      exited: terminal.exited,
      exitCode: terminal.exitCode,
      truncated: truncated.truncated,
    };
  }

  subscribe(terminalId: string): void {
    if (!terminals.has(terminalId)) throw new Error("Terminal not found");
    this.subscriptions.add(terminalId);
    if (this.disposeTerminalData) return;
    this.disposeTerminalData = onTerminalData((event) => {
      if (!this.subscriptions.has(event.terminalId)) return;
      const truncated = truncateUtf8Tail(event.data, this.options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES);
      this.onTerminalData?.({
        terminalId: event.terminalId,
        data: truncated.value,
        seq: event.seq,
      });
    });
  }

  unsubscribe(terminalId: string): void {
    this.subscriptions.delete(terminalId);
    if (this.subscriptions.size === 0 && this.disposeTerminalData) {
      this.disposeTerminalData();
      this.disposeTerminalData = undefined;
    }
  }

  requestLease(terminalId: string, ttlMs: number): { leaseId: string; expiresAt: number } {
    if (!terminals.has(terminalId)) throw new Error("Terminal not found");
    const lease = this.leases.create(terminalId, ttlMs);
    return { leaseId: lease.leaseId, expiresAt: lease.expiresAt };
  }

  revokeLease(leaseId: string): void {
    this.leases.revoke(leaseId);
  }

  revokeAllLeases(): void {
    this.leases.revokeAll();
  }

  write(terminalId: string, leaseId: string, data: string): void {
    const terminal = terminals.get(terminalId);
    if (!terminal) throw new Error("Terminal not found");
    if (terminal.exited) throw new Error("Terminal has exited");

    const sizeBytes = Buffer.byteLength(data, "utf-8");
    if (sizeBytes > (this.options.maxWriteBytes ?? DEFAULT_MAX_WRITE_BYTES)) {
      throw new Error("Terminal write exceeds the maximum frame size");
    }

    const lease = this.leases.validate(leaseId, terminalId);
    if (!lease.ok) {
      throw new Error(lease.reason === "expired" ? "Terminal lease expired" : "Terminal lease required");
    }

    terminal.pty.write(data);
    terminal.lastActivityAt = Date.now();
  }

  ctrlC(terminalId: string, leaseId: string): void {
    this.write(terminalId, leaseId, "\x03");
  }

  dispose(): void {
    this.subscriptions.clear();
    this.disposeTerminalData?.();
    this.disposeTerminalData = undefined;
    this.revokeAllLeases();
  }
}
