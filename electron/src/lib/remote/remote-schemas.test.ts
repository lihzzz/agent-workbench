import { describe, expect, it } from "vitest";
import { parseRemotePayload } from "./remote-schemas";

describe("remote command schemas", () => {
  it("parses structured permission answer payloads", () => {
    const payload = parseRemotePayload("permission.respond", {
      sessionId: "session-1",
      requestId: "req-1",
      action: {
        kind: "answer",
        optionId: "codex_user_input",
        label: "Submit answers",
        answers: {
          q1: ["Approve"],
          q2: ["First", "Second"],
        },
      },
    });

    expect(payload).toEqual({
      sessionId: "session-1",
      requestId: "req-1",
      action: {
        kind: "answer",
        optionId: "codex_user_input",
        label: "Submit answers",
        answers: {
          q1: ["Approve"],
          q2: ["First", "Second"],
        },
      },
    });
  });

  it("rejects non-string permission answer values", () => {
    expect(() => parseRemotePayload("permission.respond", {
      sessionId: "session-1",
      requestId: "req-1",
      action: {
        kind: "answer",
        optionId: "codex_user_input",
        label: "Submit answers",
        answers: { q1: [1] },
      },
    })).toThrow("answers.q1 values must be strings");
  });
});
