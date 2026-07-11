import { describe, expect, it } from "vitest";
import { getTodoItems, normalizeTodoStatus } from "./todo-utils";

describe("todo normalization", () => {
  it.each([
    ["completed", "completed"],
    [" complete ", "completed"],
    ["DONE", "completed"],
    ["in-progress", "in_progress"],
    ["inprogress", "in_progress"],
    ["running", "in_progress"],
    ["active", "in_progress"],
    ["pending", "pending"],
    ["queued", "pending"],
    ["todo", "pending"],
  ] as const)("maps %s to %s", (input, expected) => {
    expect(normalizeTodoStatus(input)).toBe(expected);
  });

  it("drops invalid values while preserving arrays, JSON, and markdown", () => {
    expect(getTodoItems([
      { content: "run", status: "running" },
      { content: "bad", status: "unknown" },
    ])).toEqual([{ content: "run", status: "in_progress" }]);
    expect(getTodoItems('[{"content":"ship","status":"done"}]'))
      .toEqual([{ content: "ship", status: "completed" }]);
    expect(getTodoItems("- [ ] pending\n- [x] complete")).toEqual([
      { content: "pending", status: "pending" },
      { content: "complete", status: "completed" },
    ]);
  });
});
