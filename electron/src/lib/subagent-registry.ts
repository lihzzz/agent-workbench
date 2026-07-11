import fs from "fs";
import path from "path";
import { app } from "electron";
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { CustomSubagent } from "@shared/types/subagent";
import { BUILTIN_SUBAGENTS, BUILTIN_SUBAGENT_IDS } from "@shared/types/builtin-subagents";

// Re-export shared type so IPC consumers can import from this file
export type { CustomSubagent } from "@shared/types/subagent";

/**
 * Persistence + SDK assembly for custom subagents.
 *
 * Mirrors the single-file-array strategy of `agent-registry.ts` (a flat JSON
 * array on disk, an in-memory Map at runtime). App-shipped built-ins are seeded
 * at load; users may edit or disable them but not remove them — deleting a
 * built-in resets it to its shipped definition. Only user-created subagents and
 * built-ins the user has modified are written to disk, so deleting the file
 * restores all defaults.
 */

const subagents = new Map<string, CustomSubagent>();

function getConfigPath(): string {
  return path.join(app.getPath("userData"), "openacpui-data", "subagents.json");
}

/** Seed the in-memory map with fresh copies of the built-in definitions. */
function seedBuiltins(): void {
  for (const builtin of BUILTIN_SUBAGENTS) {
    subagents.set(builtin.id, { ...builtin });
  }
}

seedBuiltins();

export function loadSubagents(): void {
  // Reset to shipped defaults, then layer persisted entries on top so that an
  // updated built-in definition propagates while user overrides are preserved.
  subagents.clear();
  seedBuiltins();
  try {
    const data = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    if (Array.isArray(data)) {
      for (const s of data) {
        if (s && typeof s.id === "string") {
          // Keep the builtIn flag authoritative from the shipped set.
          subagents.set(s.id, { ...s, builtIn: BUILTIN_SUBAGENT_IDS.has(s.id) });
        }
      }
    }
  } catch {
    /* no config yet */
  }
}

export function listSubagents(): CustomSubagent[] {
  return Array.from(subagents.values());
}

export function saveSubagent(subagent: CustomSubagent): void {
  if (!subagent.id?.trim() || !subagent.name?.trim()) {
    throw new Error("Subagent must have an id and a name");
  }
  if (!subagent.description?.trim()) {
    throw new Error("Subagent must have a description (used to decide when to delegate)");
  }
  if (!subagent.prompt?.trim()) {
    throw new Error("Subagent must have a prompt");
  }
  subagents.set(subagent.id, { ...subagent, builtIn: BUILTIN_SUBAGENT_IDS.has(subagent.id) });
  persist();
}

export function deleteSubagent(id: string): void {
  // Deleting a built-in resets it to its shipped definition rather than removing it.
  const builtin = BUILTIN_SUBAGENTS.find((s) => s.id === id);
  if (builtin) {
    subagents.set(id, { ...builtin });
  } else {
    subagents.delete(id);
  }
  persist();
}

/**
 * Persist user-created subagents plus any built-in the user has modified from
 * its shipped definition. Unmodified built-ins are omitted so the file stays
 * small and deleting it restores all defaults.
 */
function persist(): void {
  const toWrite = listSubagents().filter((s) => {
    if (!s.builtIn) return true;
    const shipped = BUILTIN_SUBAGENTS.find((b) => b.id === s.id);
    return !shipped || !isSameSubagent(s, shipped);
  });
  const dir = path.dirname(getConfigPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(toWrite, null, 2));
}

/** Structural equality check used to detect whether a built-in was modified. */
function isSameSubagent(a: CustomSubagent, b: CustomSubagent): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(s: CustomSubagent): CustomSubagent {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    prompt: s.prompt,
    tools: s.tools ?? [],
    disallowedTools: s.disallowedTools ?? [],
    model: s.model ?? "inherit",
    icon: s.icon ?? "",
    enabled: s.enabled !== false,
    builtIn: s.builtIn === true,
  };
}

/**
 * Build the SDK `agents` record from all enabled subagents. Strips UI-only
 * fields (id/name/icon/enabled) and omits undefined SDK fields so the record
 * matches what `query({ options: { agents } })` expects.
 *
 * Disabled subagents (`enabled === false`) are excluded entirely — they never
 * reach the Task tool's subagent_type enum, so the main agent can't see them.
 */
export function buildAgentsRecord(): Record<string, AgentDefinition> {
  const record: Record<string, AgentDefinition> = {};
  for (const s of subagents.values()) {
    if (s.enabled === false) continue;
    const def: AgentDefinition = {
      description: s.description,
      prompt: s.prompt,
    };
    if (s.tools && s.tools.length > 0) def.tools = s.tools;
    if (s.disallowedTools && s.disallowedTools.length > 0) def.disallowedTools = s.disallowedTools;
    if (s.model && s.model !== "inherit") def.model = s.model;
    record[s.id] = def;
  }
  return record;
}
