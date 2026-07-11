import { describe, expect, it } from "vitest";
import type { SlashCommand } from "@/types";
import {
  LOCAL_CLEAR_COMMAND,
  LOCAL_COMPACT_COMMAND,
  getAvailableSlashCommands,
  getCommandPrefix,
  getSlashCommandReplacement,
  isCompactCommandText,
  isClearCommandText,
} from "./input-bar";
import {
  getMentionResults,
  type IndexedMentionEntry,
} from "./input-bar/useMentionAutocomplete";
import { getCommandAutocompleteResults } from "./input-bar/CommandPicker";

describe("InputBar slash command helpers", () => {
  it("always includes the local clear command first", () => {
    const commands: SlashCommand[] = [
      { name: "compact", description: "Compact context", source: "claude" },
    ];

    expect(getAvailableSlashCommands(commands)).toEqual([
      LOCAL_CLEAR_COMMAND,
      commands[0],
    ]);
  });

  it("deduplicates engine-provided clear commands in favor of the local one", () => {
    const commands: SlashCommand[] = [
      { name: "clear", description: "Engine clear", source: "claude" },
      { name: "help", description: "Help", source: "claude" },
    ];

    expect(getAvailableSlashCommands(commands)).toEqual([
      LOCAL_CLEAR_COMMAND,
      commands[1],
    ]);
  });

  it("adds local compact when supported and deduplicates slash commands only", () => {
    const commands: SlashCommand[] = [
      { name: "compact", description: "Engine compact", source: "codex" },
      { name: "compact", description: "Skill compact", source: "codex-skill" },
    ];

    expect(getAvailableSlashCommands(commands, { includeCompact: true })).toEqual([
      LOCAL_CLEAR_COMMAND,
      LOCAL_COMPACT_COMMAND,
      commands[1],
    ]);
  });

  it("detects the exact /clear command text", () => {
    expect(isClearCommandText("/clear")).toBe(true);
    expect(isClearCommandText("  /clear  ")).toBe(true);
    expect(isClearCommandText("/clear now")).toBe(false);
    expect(isClearCommandText("/compact")).toBe(false);
  });

  it("detects the exact /compact command text", () => {
    expect(isCompactCommandText("/compact")).toBe(true);
    expect(isCompactCommandText("  /compact  ")).toBe(true);
    expect(isCompactCommandText("/compact now")).toBe(false);
  });

  it("builds replacement text for local and engine commands", () => {
    expect(getSlashCommandReplacement(LOCAL_CLEAR_COMMAND)).toBe("/clear");
    expect(getSlashCommandReplacement({ name: "compact", description: "", source: "claude" })).toBe("/compact ");
    expect(getSlashCommandReplacement({ name: "compact", description: "", source: "codex" })).toBe("/compact ");
    expect(getSlashCommandReplacement({ name: "open", description: "", source: "codex-app", appSlug: "jira" })).toBe("$jira ");
    expect(
      getSlashCommandReplacement({ name: "fix", description: "", source: "codex-skill", defaultPrompt: "bug" }),
    ).toBe("$fix bug");
  });

  it("uses dollar prefix only for Codex skills and apps", () => {
    expect(getCommandPrefix({ name: "compact", description: "", source: "codex" })).toBe("/");
    expect(getCommandPrefix({ name: "fix", description: "", source: "codex-skill" })).toBe("$");
    expect(getCommandPrefix({ name: "jira", description: "", source: "codex-app" })).toBe("$");
  });

  it("filters slash and dollar commands by the typed prefix", () => {
    const commands: SlashCommand[] = [
      LOCAL_CLEAR_COMMAND,
      { name: "compact", description: "Compact context", source: "local" },
      { name: "bananapro-image-gen", description: "Logo design", source: "codex-skill" },
    ];

    expect(getCommandAutocompleteResults(commands, "/", "go")).toEqual([]);
    expect(getCommandAutocompleteResults(commands, "$", "go")).toEqual([commands[2]]);
  });
});

function entry(path: string, isDir = false): IndexedMentionEntry {
  return {
    path,
    isDir,
    lowerPath: path.toLowerCase(),
    depth: path.split("/").length,
  };
}

describe("InputBar mention search helpers", () => {
  it("returns the pre-sorted default results while filtering selected mentions", () => {
    const entries = [
      entry("src", true),
      entry("README.md"),
      entry("src/components", true),
      entry("src/App.tsx"),
    ];

    expect(
      getMentionResults(entries, "", new Set(["README.md"])),
    ).toEqual([
      { path: "src", isDir: true },
      { path: "src/components", isDir: true },
      { path: "src/App.tsx", isDir: false },
    ]);
  });

  it("keeps only the highest scoring fuzzy matches", () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      entry(i === 19 ? "app.tsx" : `src/a/path/prompt-${i}.tsx`),
    );

    const results = getMentionResults(entries, "app");

    expect(results).toHaveLength(12);
    expect(results[0]).toEqual({ path: "app.tsx", isDir: false });
  });
});
