import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetDataDir } = vi.hoisted(() => ({
  mockGetDataDir: vi.fn<() => string>(),
}));

vi.mock("../data-dir", () => ({
  getDataDir: mockGetDataDir,
}));

import { getClaudeModelsCache, setClaudeModelsCache } from "../claude-model-cache";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-model-cache-"));
  mockGetDataDir.mockReturnValue(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const RAW_MODELS = [
  { value: "default", displayName: "Default (recommended)", description: "Opus 4.8 with 1M context" },
  { value: "claude-opus-4-8", displayName: "Opus 4.8", description: "claude-opus-4-8" },
  { value: "sonnet", displayName: "Sonnet", description: "Sonnet 4.6" },
];

describe("claude-model-cache", () => {
  it("drops the SDK 'default' alias when normalizing", () => {
    const result = setClaudeModelsCache(RAW_MODELS);
    expect(result.models.map((m) => m.value)).toEqual(["claude-opus-4-8", "sonnet"]);
  });

  it("does not persist 'default' to disk", () => {
    setClaudeModelsCache(RAW_MODELS);
    const reloaded = getClaudeModelsCache();
    expect(reloaded.models.some((m) => m.value === "default")).toBe(false);
    expect(reloaded.models).toHaveLength(2);
  });

  it("is case-insensitive and ignores surrounding whitespace for the alias", () => {
    const result = setClaudeModelsCache([
      { value: "  Default  ", displayName: "Default", description: "" },
      { value: "haiku", displayName: "Haiku", description: "" },
    ]);
    expect(result.models.map((m) => m.value)).toEqual(["haiku"]);
  });
});
