import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let tmpDir = "";
vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => tmpDir) },
}));

import {
  loadTemplates,
  listTemplates,
  saveTemplate,
  deleteTemplate,
} from "../prompt-template-registry";
import type { PromptTemplate } from "../prompt-template-registry";
import { BUILTIN_PROMPT_TEMPLATES } from "@shared/types/builtin-prompt-templates";

const BUILTIN_COUNT = BUILTIN_PROMPT_TEMPLATES.length;

function make(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return { id: "my-tmpl", name: "My Template", description: "d", body: "Do {{x}}", ...overrides };
}

describe("prompt-template-registry", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tmpl-test-"));
    loadTemplates();
  });
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("seeds built-in templates", () => {
    const list = listTemplates();
    expect(list).toHaveLength(BUILTIN_COUNT);
    expect(list.every((t) => t.builtIn === true)).toBe(true);
  });

  it("validates name and body", () => {
    expect(() => saveTemplate(make({ name: "" }))).toThrow(/id and a name/);
    expect(() => saveTemplate(make({ body: "" }))).toThrow(/body/);
  });

  it("saves and deletes a user template", () => {
    saveTemplate(make());
    expect(listTemplates().find((t) => t.id === "my-tmpl")).toBeTruthy();
    deleteTemplate("my-tmpl");
    expect(listTemplates().find((t) => t.id === "my-tmpl")).toBeUndefined();
    expect(listTemplates()).toHaveLength(BUILTIN_COUNT);
  });

  it("does not persist unmodified built-ins", () => {
    saveTemplate(make());
    deleteTemplate("my-tmpl");
    const file = path.join(tmpDir, "openacpui-data", "prompt-templates.json");
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toHaveLength(0);
  });

  it("resets a built-in on delete", () => {
    const b = BUILTIN_PROMPT_TEMPLATES[0];
    saveTemplate({ ...b, body: "changed" });
    expect(listTemplates().find((t) => t.id === b.id)?.body).toBe("changed");
    deleteTemplate(b.id);
    expect(listTemplates().find((t) => t.id === b.id)?.body).toBe(b.body);
    expect(listTemplates()).toHaveLength(BUILTIN_COUNT);
  });
});
