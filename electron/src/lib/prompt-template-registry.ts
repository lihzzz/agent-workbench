import fs from "fs";
import path from "path";
import { app } from "electron";
import type { PromptTemplate } from "@shared/types/prompt-template";
import { BUILTIN_PROMPT_TEMPLATES, BUILTIN_TEMPLATE_IDS } from "@shared/types/builtin-prompt-templates";

export type { PromptTemplate } from "@shared/types/prompt-template";

/**
 * Persistence for prompt templates. Mirrors subagent-registry.ts: a flat JSON
 * array on disk, an in-memory Map at runtime, app-shipped built-ins seeded at
 * load. Deleting a built-in resets it; only user-created templates and modified
 * built-ins are written, so deleting the file restores all defaults.
 */

const templates = new Map<string, PromptTemplate>();

function getConfigPath(): string {
  return path.join(app.getPath("userData"), "openacpui-data", "prompt-templates.json");
}

function seedBuiltins(): void {
  for (const t of BUILTIN_PROMPT_TEMPLATES) templates.set(t.id, { ...t });
}

seedBuiltins();

export function loadTemplates(): void {
  templates.clear();
  seedBuiltins();
  try {
    const data = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    if (Array.isArray(data)) {
      for (const t of data) {
        if (t && typeof t.id === "string") {
          templates.set(t.id, { ...t, builtIn: BUILTIN_TEMPLATE_IDS.has(t.id) });
        }
      }
    }
  } catch {
    /* no config yet */
  }
}

export function listTemplates(): PromptTemplate[] {
  return Array.from(templates.values());
}

export function saveTemplate(template: PromptTemplate): void {
  if (!template.id?.trim() || !template.name?.trim()) {
    throw new Error("Template must have an id and a name");
  }
  if (!template.body?.trim()) {
    throw new Error("Template must have a body");
  }
  templates.set(template.id, { ...template, builtIn: BUILTIN_TEMPLATE_IDS.has(template.id) });
  persist();
}

export function deleteTemplate(id: string): void {
  const builtin = BUILTIN_PROMPT_TEMPLATES.find((t) => t.id === id);
  if (builtin) {
    templates.set(id, { ...builtin });
  } else {
    templates.delete(id);
  }
  persist();
}

function persist(): void {
  const toWrite = listTemplates().filter((t) => {
    if (!t.builtIn) return true;
    const shipped = BUILTIN_PROMPT_TEMPLATES.find((b) => b.id === t.id);
    return !shipped || !isSame(t, shipped);
  });
  const dir = path.dirname(getConfigPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(toWrite, null, 2));
}

function isSame(a: PromptTemplate, b: PromptTemplate): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(t: PromptTemplate): PromptTemplate {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    body: t.body,
    icon: t.icon ?? "",
    enabled: t.enabled !== false,
    builtIn: t.builtIn === true,
  };
}
