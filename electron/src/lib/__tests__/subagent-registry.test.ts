import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Mock electron's app.getPath to a per-test temp dir so persist()/load() hit a
// real (disposable) filesystem location.
let tmpDir = "";
vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => tmpDir) },
}));

// Import after the mock is registered.
import {
  loadSubagents,
  listSubagents,
  saveSubagent,
  deleteSubagent,
  buildAgentsRecord,
} from "../subagent-registry";
import type { CustomSubagent } from "../subagent-registry";
import { BUILTIN_SUBAGENTS, BUILTIN_SUBAGENT_IDS } from "@shared/types/builtin-subagents";

const BUILTIN_COUNT = BUILTIN_SUBAGENTS.length;

function makeSubagent(overrides: Partial<CustomSubagent> = {}): CustomSubagent {
  return {
    id: "test-runner",
    name: "Test Runner",
    description: "Runs the test suite and reports failures",
    prompt: "You are a test-running specialist.",
    ...overrides,
  };
}

describe("subagent-registry", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-test-"));
    // Reset in-memory state to shipped defaults (no persisted file in fresh tmpDir).
    loadSubagents();
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("built-ins", () => {
    it("seeds shipped built-in subagents on load", () => {
      const list = listSubagents();
      expect(list).toHaveLength(BUILTIN_COUNT);
      expect(list.every((s) => s.builtIn === true)).toBe(true);
      expect(list.map((s) => s.id).sort()).toEqual([...BUILTIN_SUBAGENT_IDS].sort());
    });

    it("does not persist unmodified built-ins to disk", () => {
      // Trigger a persist via a no-op save of a user subagent, then delete it.
      saveSubagent(makeSubagent());
      deleteSubagent("test-runner");
      const file = path.join(tmpDir, "openacpui-data", "subagents.json");
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      // Only user entries / modified built-ins are written — here, none remain.
      expect(parsed).toHaveLength(0);
    });

    it("persists a built-in only after it is modified", () => {
      const builtin = BUILTIN_SUBAGENTS[0];
      saveSubagent({ ...builtin, prompt: builtin.prompt + " (customized)" });
      const file = path.join(tmpDir, "openacpui-data", "subagents.json");
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe(builtin.id);
    });

    it("resets a built-in to its shipped definition on delete", () => {
      const builtin = BUILTIN_SUBAGENTS[0];
      saveSubagent({ ...builtin, prompt: "changed" });
      expect(listSubagents().find((s) => s.id === builtin.id)?.prompt).toBe("changed");

      deleteSubagent(builtin.id);
      const after = listSubagents().find((s) => s.id === builtin.id);
      expect(after?.prompt).toBe(builtin.prompt); // restored
      expect(listSubagents()).toHaveLength(BUILTIN_COUNT); // still present
    });

    it("keeps the builtIn flag authoritative even if a persisted entry lies", () => {
      // Simulate a tampered file claiming a user agent is built-in and vice-versa.
      const dir = path.join(tmpDir, "openacpui-data");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "subagents.json"),
        JSON.stringify([
          { ...makeSubagent({ id: "code-reviewer" }), builtIn: false },
          { ...makeSubagent({ id: "user-one" }), builtIn: true },
        ]),
      );
      loadSubagents();
      expect(listSubagents().find((s) => s.id === "code-reviewer")?.builtIn).toBe(true);
      expect(listSubagents().find((s) => s.id === "user-one")?.builtIn).toBe(false);
    });
  });

  describe("validation", () => {
    it("rejects a subagent without a name", () => {
      expect(() => saveSubagent(makeSubagent({ name: "" }))).toThrow(/id and a name/);
    });

    it("rejects a subagent without a description", () => {
      expect(() => saveSubagent(makeSubagent({ description: "" }))).toThrow(/description/);
    });

    it("rejects a subagent without a prompt", () => {
      expect(() => saveSubagent(makeSubagent({ prompt: "" }))).toThrow(/prompt/);
    });
  });

  describe("user subagent persistence round-trip", () => {
    it("saves, lists, and deletes a user subagent", () => {
      saveSubagent(makeSubagent());
      expect(listSubagents().find((s) => s.id === "test-runner")).toBeTruthy();

      deleteSubagent("test-runner");
      expect(listSubagents().find((s) => s.id === "test-runner")).toBeUndefined();
      expect(listSubagents()).toHaveLength(BUILTIN_COUNT);
    });

    it("writes user subagents to subagents.json", () => {
      saveSubagent(makeSubagent());
      const file = path.join(tmpDir, "openacpui-data", "subagents.json");
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      expect(parsed.some((s: CustomSubagent) => s.id === "test-runner")).toBe(true);
    });
  });

  describe("buildAgentsRecord", () => {
    it("includes all built-ins by default", () => {
      const record = buildAgentsRecord();
      for (const id of BUILTIN_SUBAGENT_IDS) {
        expect(record).toHaveProperty(id);
      }
    });

    it("maps a subagent to the SDK AgentDefinition shape", () => {
      saveSubagent(
        makeSubagent({
          tools: ["Read", "Grep", "Bash"],
          disallowedTools: ["Write"],
          model: "haiku",
        }),
      );
      const record = buildAgentsRecord();
      expect(record["test-runner"]).toEqual({
        description: "Runs the test suite and reports failures",
        prompt: "You are a test-running specialist.",
        tools: ["Read", "Grep", "Bash"],
        disallowedTools: ["Write"],
        model: "haiku",
      });
    });

    it("omits empty tools / disallowedTools and inherit model", () => {
      saveSubagent(makeSubagent({ tools: [], disallowedTools: [], model: "inherit" }));
      const def = buildAgentsRecord()["test-runner"];
      expect(def).toEqual({
        description: "Runs the test suite and reports failures",
        prompt: "You are a test-running specialist.",
      });
      expect(def).not.toHaveProperty("tools");
      expect(def).not.toHaveProperty("disallowedTools");
      expect(def).not.toHaveProperty("model");
    });

    it("excludes disabled subagents", () => {
      saveSubagent(makeSubagent({ id: "a", name: "A", enabled: true }));
      saveSubagent(makeSubagent({ id: "b", name: "B", enabled: false }));
      const record = buildAgentsRecord();
      expect(record).toHaveProperty("a");
      expect(record).not.toHaveProperty("b");
    });

    it("treats absent enabled as enabled", () => {
      saveSubagent(makeSubagent({ id: "c", name: "C" }));
      expect(buildAgentsRecord()).toHaveProperty("c");
    });

    it("excludes a disabled built-in", () => {
      const builtin = BUILTIN_SUBAGENTS[0];
      saveSubagent({ ...builtin, enabled: false });
      expect(buildAgentsRecord()).not.toHaveProperty(builtin.id);
    });
  });

  describe("loadSubagents", () => {
    it("re-reads user entries from disk on top of built-ins", () => {
      saveSubagent(makeSubagent());
      loadSubagents();
      expect(listSubagents().some((s) => s.id === "test-runner")).toBe(true);
      expect(listSubagents().some((s) => s.id === BUILTIN_SUBAGENTS[0].id)).toBe(true);
    });
  });
});
