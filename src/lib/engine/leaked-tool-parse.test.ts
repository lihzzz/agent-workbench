import { describe, expect, it } from "vitest";
import {
  parseLeakedToolCalls,
  hasLeakedToolCall,
  stripStreamingLeak,
} from "./leaked-tool-parse";

// Assemble markup from variables so the literal tag tokens never appear in this
// source file (they confuse upstream tooling). The runtime strings are real.
const INV = "invoke";
const PARAM = "parameter";
const inv = (name: string, body: string, ns = "") =>
  `<${ns}${INV} name="${name}">${body}</${ns}${INV}>`;
const param = (name: string, value: string) =>
  `<${PARAM} name="${name}">${value}</${PARAM}>`;
const openInvoke = (name: string) => `<${INV} name="${name}">`;

describe("hasLeakedToolCall", () => {
  it("returns false for ordinary text", () => {
    expect(hasLeakedToolCall("Let me list the files.")).toBe(false);
    expect(hasLeakedToolCall("")).toBe(false);
  });

  it("detects invoke markup", () => {
    expect(hasLeakedToolCall(`foo ${openInvoke("Bash")}`)).toBe(true);
  });

  it("does not false-positive on the word invoke without a name attr", () => {
    expect(hasLeakedToolCall("I will invoke the function later.")).toBe(false);
  });
});

describe("parseLeakedToolCalls", () => {
  it("returns text unchanged when no markup is present", () => {
    const text = "Just a normal reply.";
    const result = parseLeakedToolCalls(text);
    expect(result.cleanedText).toBe(text);
    expect(result.calls).toEqual([]);
  });

  it("parses a single invoke block with parameters", () => {
    const text =
      "Here goes.\n" +
      inv("Bash", param("command", "ls scripts/") + param("description", "List scripts directory"));
    const result = parseLeakedToolCalls(text);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toEqual({
      name: "Bash",
      input: { command: "ls scripts/", description: "List scripts directory" },
    });
    expect(result.cleanedText).toBe("Here goes.");
    expect(result.cleanedText).not.toContain(INV);
  });

  it("strips a dangling 'call' lead-in word", () => {
    const text = "call " + inv("Bash", param("command", "pwd"));
    const result = parseLeakedToolCalls(text);
    expect(result.cleanedText).toBe("");
    expect(result.calls[0].name).toBe("Bash");
  });

  it("tolerates a namespace prefix on tags", () => {
    const text = inv("Read", param("file_path", "/tmp/a.txt"), "antml:");
    const result = parseLeakedToolCalls(text);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toEqual({
      name: "Read",
      input: { file_path: "/tmp/a.txt" },
    });
    expect(result.cleanedText).toBe("");
  });

  it("parses multiple invoke blocks in order", () => {
    const text =
      inv("Bash", param("command", "echo a")) +
      "\nthen\n" +
      inv("Read", param("file_path", "b.txt"));
    const result = parseLeakedToolCalls(text);
    expect(result.calls.map((c) => c.name)).toEqual(["Bash", "Read"]);
    expect(result.cleanedText).toBe("then");
  });

  it("coerces JSON-shaped parameter values", () => {
    const text = inv("TodoWrite", param("todos", '[{"content":"x"}]'));
    const result = parseLeakedToolCalls(text);
    expect(result.calls[0].input.todos).toEqual([{ content: "x" }]);
  });

  it("keeps plain prose values as strings", () => {
    const text = inv("Bash", param("command", "cd /tmp && ls"));
    const result = parseLeakedToolCalls(text);
    expect(result.calls[0].input.command).toBe("cd /tmp && ls");
  });

  it("leaves surrounding prose intact", () => {
    const text = "Before. " + inv("Bash", param("command", "ls")) + " After.";
    const result = parseLeakedToolCalls(text);
    expect(result.cleanedText).toContain("Before.");
    expect(result.cleanedText).toContain("After.");
    expect(result.cleanedText).not.toContain(INV);
  });
});

describe("stripStreamingLeak", () => {
  it("passes through text with no markup", () => {
    expect(stripStreamingLeak("hello")).toBe("hello");
  });

  it("hides a trailing unclosed invoke block mid-stream", () => {
    const text = "Working on it.\n" + openInvoke("Bash") + "<" + PARAM + ' name="command">ls scr';
    const result = stripStreamingLeak(text);
    expect(result).toBe("Working on it.");
    expect(result).not.toContain(INV);
  });

  it("hides a trailing dangling 'call' lead-in", () => {
    const text = "Done.\ncall " + openInvoke("Bash");
    const result = stripStreamingLeak(text);
    expect(result).toBe("Done.");
  });

  it("strips fully-closed blocks while streaming too", () => {
    const text = "A " + inv("Bash", param("command", "ls")) + " " + openInvoke("Read");
    const result = stripStreamingLeak(text);
    expect(result).toBe("A");
  });
});
