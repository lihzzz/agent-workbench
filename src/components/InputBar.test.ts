import { describe, expect, it } from "vitest";
import type { SlashCommand } from "@/types";
import {
  LOCAL_CLEAR_COMMAND,
  getAvailableSlashCommands,
  getSlashCommandReplacement,
  isClearCommandText,
} from "./input-bar";
import {
  getMentionResults,
  type IndexedMentionEntry,
} from "./input-bar/useMentionAutocomplete";

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

  it("detects the exact /clear command text", () => {
    expect(isClearCommandText("/clear")).toBe(true);
    expect(isClearCommandText("  /clear  ")).toBe(true);
    expect(isClearCommandText("/clear now")).toBe(false);
    expect(isClearCommandText("/compact")).toBe(false);
  });

  it("builds replacement text for local and engine commands", () => {
    expect(getSlashCommandReplacement(LOCAL_CLEAR_COMMAND)).toBe("/clear");
    expect(getSlashCommandReplacement({ name: "compact", description: "", source: "claude" })).toBe("/compact ");
    expect(getSlashCommandReplacement({ name: "open", description: "", source: "codex-app", appSlug: "jira" })).toBe("$jira ");
    expect(
      getSlashCommandReplacement({ name: "fix", description: "", source: "codex-skill", defaultPrompt: "bug" }),
    ).toBe("$fix bug");
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
