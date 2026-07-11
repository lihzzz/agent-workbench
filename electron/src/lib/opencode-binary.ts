import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { getAppSetting } from "./app-settings";

const KNOWN_PATHS = process.platform === "darwin"
  ? ["/opt/homebrew/bin/opencode", "/usr/local/bin/opencode"]
  : process.platform === "linux"
    ? ["/usr/local/bin/opencode", "/usr/bin/opencode", path.join(os.homedir(), ".opencode", "bin", "opencode")]
    : [];

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeExecutable(candidate: string | undefined): string | null {
  if (!candidate?.trim()) return null;
  const normalized = path.resolve(candidate.trim());
  return isExecutable(normalized) ? normalized : null;
}

function resolveFromPath(): string | null {
  try {
    const command = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(command, ["opencode"], { encoding: "utf-8", timeout: 5_000 });
    for (const line of output.split(/\r?\n/)) {
      const resolved = normalizeExecutable(line);
      if (resolved) return resolved;
    }
  } catch {
    // Not installed on PATH.
  }
  return null;
}

export function resolveOpenCodeBinaryPath(): string {
  if (getAppSetting("opencodeBinarySource") === "custom") {
    const configured = getAppSetting("opencodeCustomBinaryPath").trim();
    if (!configured) throw new Error("OpenCode custom binary path is not set");
    if (!path.isAbsolute(configured)) throw new Error("OpenCode custom binary path must be absolute");
    const resolved = normalizeExecutable(configured);
    if (!resolved) throw new Error(`Configured OpenCode binary path is not executable: ${configured}`);
    return resolved;
  }

  const environment = normalizeExecutable(process.env.OPENCODE_CLI_PATH);
  if (environment) return environment;
  const fromPath = resolveFromPath();
  if (fromPath) return fromPath;
  for (const knownPath of KNOWN_PATHS) {
    const resolved = normalizeExecutable(knownPath);
    if (resolved) return resolved;
  }
  throw new Error("OpenCode CLI not found. Install OpenCode or configure its binary path in Settings.");
}

export function getOpenCodeBinaryStatus(): { installed: boolean; path?: string; error?: string } {
  try {
    return { installed: true, path: resolveOpenCodeBinaryPath() };
  } catch (error) {
    return { installed: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function getOpenCodeVersion(): string | null {
  try {
    return execFileSync(resolveOpenCodeBinaryPath(), ["--version"], {
      encoding: "utf-8",
      timeout: 10_000,
    }).trim() || null;
  } catch {
    return null;
  }
}
