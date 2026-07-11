import { describe, expect, it } from "vitest";
import { PermissionLedger } from "./permission-ledger";

function makeLedger(): PermissionLedger {
  const ledger = new PermissionLedger();
  ledger.add({
    requestId: "req-1",
    sessionId: "session-1",
    engine: "codex",
    expiresAt: Date.now() + 60_000,
    toolName: "AskUserQuestion",
    risk: "high",
    summary: "Question",
    rawPreview: "{}",
    allowedActions: [
      { kind: "answer", optionId: "codex_user_input", label: "Submit answers" },
      { kind: "deny", label: "Deny" },
    ],
    originalRef: { rpcId: "req-1" },
  });
  return ledger;
}

describe("PermissionLedger", () => {
  it("allows only the first claimant to reserve a permission", () => {
    const ledger = makeLedger();

    const remoteClaim = ledger.claim("req-1", "remote-command", {
      kind: "answer",
      optionId: "codex_user_input",
      label: "Submit answers",
      answers: { q1: ["yes"] },
    });
    expect(remoteClaim.ok).toBe(true);

    const localClaim = ledger.claimLocal("req-1", "local:req-1");
    expect(localClaim).toEqual({ ok: false, reason: "already_resolved" });
  });

  it("rejects remote actions that are not in the allowed action set", () => {
    const ledger = makeLedger();

    const claim = ledger.claim("req-1", "remote-command", {
      kind: "answer",
      optionId: "different-option",
      label: "Submit answers",
    });

    expect(claim).toEqual({ ok: false, reason: "action_not_allowed" });
  });

  it("lets local UI reserve a permission before remote commands can claim it", () => {
    const ledger = makeLedger();

    const localClaim = ledger.claimLocal("req-1", "local:req-1");
    expect(localClaim.ok).toBe(true);

    const remoteClaim = ledger.claim("req-1", "remote-command", {
      kind: "deny",
      label: "Deny",
    });
    expect(remoteClaim).toEqual({ ok: false, reason: "already_resolved" });
  });
});
