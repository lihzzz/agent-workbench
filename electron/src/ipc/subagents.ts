import { ipcMain } from "electron";
import {
  loadSubagents,
  listSubagents,
  saveSubagent,
  deleteSubagent,
} from "../lib/subagent-registry";
import type { CustomSubagent } from "../lib/subagent-registry";
import { reportError } from "../lib/error-utils";

export function register(): void {
  loadSubagents();

  ipcMain.handle("subagents:list", () => listSubagents());

  ipcMain.handle("subagents:save", (_e, subagent: CustomSubagent) => {
    try {
      saveSubagent(subagent);
      return { ok: true };
    } catch (err) {
      return { error: reportError("SUBAGENT_SAVE", err) };
    }
  });

  ipcMain.handle("subagents:delete", (_e, id: string) => {
    try {
      deleteSubagent(id);
      return { ok: true };
    } catch (err) {
      return { error: reportError("SUBAGENT_DELETE", err) };
    }
  });
}
