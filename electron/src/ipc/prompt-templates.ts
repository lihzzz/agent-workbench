import { ipcMain } from "electron";
import {
  loadTemplates,
  listTemplates,
  saveTemplate,
  deleteTemplate,
} from "../lib/prompt-template-registry";
import type { PromptTemplate } from "../lib/prompt-template-registry";
import { reportError } from "../lib/error-utils";

export function register(): void {
  loadTemplates();

  ipcMain.handle("prompt-templates:list", () => listTemplates());

  ipcMain.handle("prompt-templates:save", (_e, template: PromptTemplate) => {
    try {
      saveTemplate(template);
      return { ok: true };
    } catch (err) {
      return { error: reportError("PROMPT_TEMPLATE_SAVE", err) };
    }
  });

  ipcMain.handle("prompt-templates:delete", (_e, id: string) => {
    try {
      deleteTemplate(id);
      return { ok: true };
    } catch (err) {
      return { error: reportError("PROMPT_TEMPLATE_DELETE", err) };
    }
  });
}
