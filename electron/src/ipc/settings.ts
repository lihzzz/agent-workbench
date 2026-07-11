import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import { getAppSettings, setAppSettings, type AppSettings } from "../lib/app-settings";
import { reportError } from "../lib/error-utils";
import { safeSend } from "../lib/safe-send";

// Listeners notified when any setting changes (used by updater, etc.)
type SettingsListener = (settings: AppSettings) => void;
const listeners: SettingsListener[] = [];

export function onSettingsChanged(cb: SettingsListener): void {
  listeners.push(cb);
}

export function updateSettings(
  patch: Partial<AppSettings>,
  getMainWindow?: () => BrowserWindow | null,
): AppSettings {
  const next = setAppSettings(patch);
  for (const cb of listeners) cb(next);
  if (getMainWindow) {
    safeSend(getMainWindow, "settings:changed", next);
  }
  return next;
}

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("settings:get", () => {
    try {
      return getAppSettings();
    } catch (err) {
      reportError("SETTINGS:GET_ERR", err);
      return null;
    }
  });

  ipcMain.handle("settings:set", (_event, patch: Partial<AppSettings>) => {
    try {
      updateSettings(patch, getMainWindow);
      return { ok: true };
    } catch (err) {
      const errMsg = reportError("SETTINGS:SET_ERR", err);
      return { error: errMsg };
    }
  });
}
