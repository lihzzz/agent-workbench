import type { RemoteCommandEnvelope, RemoteCommandKind } from "@shared/types/remote";

const HIGH_RISK_COMMANDS = new Set<RemoteCommandKind>([
  "permission.respond",
  "terminal.write",
  "terminal.ctrl_c",
  "terminal.lease.request",
  "task.start",
  "turn.stop",
]);

const RECEIPT_ID_RE = /^[A-Za-z0-9._:-]{8,256}$/;

export function isRemoteHighRiskCommand(kind: RemoteCommandKind): boolean {
  return HIGH_RISK_COMMANDS.has(kind);
}

export function validateRemoteStepUp(
  envelope: RemoteCommandEnvelope,
): { ok: true } | { ok: false; message: string } {
  if (!isRemoteHighRiskCommand(envelope.kind)) return { ok: true };
  const receiptId = envelope.stepUpReceiptId?.trim();
  if (!receiptId) {
    return { ok: false, message: "Step-up is required for this remote command" };
  }
  if (!RECEIPT_ID_RE.test(receiptId)) {
    return { ok: false, message: "Invalid step-up receipt" };
  }
  return { ok: true };
}
