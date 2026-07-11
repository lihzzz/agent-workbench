import { describe, expect, it } from "vitest";
import {
  buildCodexThreadResumeParams,
  normalizeCodexModelOverride,
} from "@shared/lib/codex-helpers";

describe("Codex helpers", () => {
  it("builds resume params with model and cwd overrides", () => {
    expect(
      buildCodexThreadResumeParams({
        threadId: "thread-1",
        cwd: "/repo/new-worktree",
        model: "  gpt-5.5  ",
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      }),
    ).toEqual({
      threadId: "thread-1",
      cwd: "/repo/new-worktree",
      persistExtendedHistory: false,
      model: "gpt-5.5",
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
  });

  it("omits an empty model override", () => {
    expect(normalizeCodexModelOverride("  ")).toBeUndefined();
    expect(
      buildCodexThreadResumeParams({
        threadId: "thread-1",
        cwd: "/repo",
        model: "  ",
      }),
    ).toEqual({
      threadId: "thread-1",
      cwd: "/repo",
      persistExtendedHistory: false,
    });
  });
});
