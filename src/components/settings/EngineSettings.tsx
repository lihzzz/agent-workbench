import { memo, useState, useCallback, useEffect } from "react";
import { CheckCircle2, CircleAlert, Server, Terminal } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, SettingsSelect, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import type { AppSettings } from "@/types";

interface EngineSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

// ── Component ──

export const EngineSettings = memo(function EngineSettings({
  appSettings,
  onUpdateAppSettings,
}: EngineSettingsProps) {
  const [claudeBinarySource, setClaudeBinarySource] = useState<"auto" | "managed" | "custom">("auto");
  const [claudeCustomBinaryPath, setClaudeCustomBinaryPath] = useState("");
  const [codexBinarySource, setCodexBinarySource] = useState<"auto" | "managed" | "custom">("auto");
  const [codexCustomBinaryPath, setCodexCustomBinaryPath] = useState("");
  const [opencodeBinarySource, setOpenCodeBinarySource] = useState<"auto" | "custom">("auto");
  const [opencodeCustomBinaryPath, setOpenCodeCustomBinaryPath] = useState("");
  const [opencodeStatus, setOpenCodeStatus] = useState<{
    installed: boolean;
    path?: string;
    version?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (appSettings) {
      setClaudeBinarySource(appSettings.claudeBinarySource || "auto");
      setClaudeCustomBinaryPath(appSettings.claudeCustomBinaryPath || "");
      setCodexBinarySource(appSettings.codexBinarySource || "auto");
      setCodexCustomBinaryPath(appSettings.codexCustomBinaryPath || "");
      setOpenCodeBinarySource(appSettings.opencodeBinarySource || "auto");
      setOpenCodeCustomBinaryPath(appSettings.opencodeCustomBinaryPath || "");
    }
  }, [appSettings]);

  const refreshOpenCodeStatus = useCallback(async () => {
    const [status, version] = await Promise.all([
      window.claude.opencode.binaryStatus(),
      window.claude.opencode.version(),
    ]);
    setOpenCodeStatus({ ...status, version: version.version });
  }, []);

  useEffect(() => {
    void refreshOpenCodeStatus();
  }, [appSettings?.opencodeBinarySource, appSettings?.opencodeCustomBinaryPath, refreshOpenCodeStatus]);

  const handleClaudeBinarySourceChange = useCallback(
    async (source: "auto" | "managed" | "custom") => {
      setClaudeBinarySource(source);
      await onUpdateAppSettings({ claudeBinarySource: source });
    },
    [onUpdateAppSettings],
  );

  const handleClaudeCustomPathSave = useCallback(
    async (value: string) => {
      const next = value.trim();
      setClaudeCustomBinaryPath(next);
      await onUpdateAppSettings({ claudeCustomBinaryPath: next });
    },
    [onUpdateAppSettings],
  );

  const handleCodexBinarySourceChange = useCallback(
    async (source: "auto" | "managed" | "custom") => {
      setCodexBinarySource(source);
      await onUpdateAppSettings({ codexBinarySource: source });
    },
    [onUpdateAppSettings],
  );

  const handleCodexCustomPathSave = useCallback(
    async (value: string) => {
      const next = value.trim();
      setCodexCustomBinaryPath(next);
      await onUpdateAppSettings({ codexCustomBinaryPath: next });
    },
    [onUpdateAppSettings],
  );

  const handleOpenCodeBinarySourceChange = useCallback(
    async (source: "auto" | "custom") => {
      setOpenCodeBinarySource(source);
      await onUpdateAppSettings({ opencodeBinarySource: source });
      await refreshOpenCodeStatus();
    },
    [onUpdateAppSettings, refreshOpenCodeStatus],
  );

  const handleOpenCodeCustomPathSave = useCallback(
    async (value: string) => {
      const next = value.trim();
      setOpenCodeCustomBinaryPath(next);
      await onUpdateAppSettings({ opencodeCustomBinaryPath: next });
      await refreshOpenCodeStatus();
    },
    [onUpdateAppSettings, refreshOpenCodeStatus],
  );

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title="Engines"
        description="Configure engine-level runtime behavior and binary selection"
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          <SettingsSection icon={Server} label="Claude Code" first>
            <SettingRow
              label="Claude binary source"
              description="Choose how Harnss resolves the Claude executable."
            >
              <SettingsSelect
                value={claudeBinarySource}
                onValueChange={handleClaudeBinarySourceChange}
                options={[
                  { value: "auto", label: "Auto detect" },
                  { value: "managed", label: "Managed install" },
                  { value: "custom", label: "Custom path" },
                ]}
                className="w-44"
              />
            </SettingRow>

            {claudeBinarySource === "custom" && (
              <SettingRow
                label="Custom Claude path"
                description="Absolute path to claude executable (claude or claude.exe)."
              >
                <input
                  type="text"
                  value={claudeCustomBinaryPath}
                  onChange={(e) => setClaudeCustomBinaryPath(e.target.value)}
                  onBlur={(e) => handleClaudeCustomPathSave(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleClaudeCustomPathSave(e.currentTarget.value);
                  }}
                  spellCheck={false}
                  className="h-8 w-80 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                  placeholder="Absolute path to claude executable"
                />
              </SettingRow>
            )}
          </SettingsSection>

          <SettingsSection icon={Server} label="Codex">
            <SettingRow
              label="Codex binary source"
              description="Choose how Harnss resolves the Codex executable."
            >
              <SettingsSelect
                value={codexBinarySource}
                onValueChange={handleCodexBinarySourceChange}
                options={[
                  { value: "auto", label: "Auto detect" },
                  { value: "managed", label: "Managed download" },
                  { value: "custom", label: "Custom path" },
                ]}
                className="w-44"
              />
            </SettingRow>

            {codexBinarySource === "custom" && (
              <SettingRow
                label="Custom Codex path"
                description="Absolute path to codex executable (codex or codex.exe)."
              >
                <input
                  type="text"
                  value={codexCustomBinaryPath}
                  onChange={(e) => setCodexCustomBinaryPath(e.target.value)}
                  onBlur={(e) => handleCodexCustomPathSave(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCodexCustomPathSave(e.currentTarget.value);
                  }}
                  spellCheck={false}
                  className="h-8 w-80 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                  placeholder="Absolute path to codex executable"
                />
              </SettingRow>
            )}
          </SettingsSection>

          <SettingsSection icon={Terminal} label="OpenCode">
            <SettingRow
              label="Installation"
              description={opencodeStatus?.installed
                ? [opencodeStatus.version, opencodeStatus.path].filter(Boolean).join(" - ")
                : opencodeStatus?.error ?? "OpenCode CLI was not detected."}
            >
              <div className={`flex items-center gap-1.5 text-xs ${
                opencodeStatus?.installed ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
              }`}>
                {opencodeStatus?.installed
                  ? <CheckCircle2 className="size-3.5" />
                  : <CircleAlert className="size-3.5" />}
                {opencodeStatus?.installed ? "Installed" : "Not installed"}
              </div>
            </SettingRow>

            <SettingRow
              label="OpenCode binary source"
              description="Choose automatic detection or an installed executable."
            >
              <SettingsSelect
                value={opencodeBinarySource}
                onValueChange={handleOpenCodeBinarySourceChange}
                options={[
                  { value: "auto", label: "Auto detect" },
                  { value: "custom", label: "Custom path" },
                ]}
                className="w-44"
              />
            </SettingRow>

            {opencodeBinarySource === "custom" && (
              <SettingRow
                label="Custom OpenCode path"
                description="Absolute path to an executable opencode binary."
              >
                <input
                  type="text"
                  value={opencodeCustomBinaryPath}
                  onChange={(event) => setOpenCodeCustomBinaryPath(event.target.value)}
                  onBlur={(event) => void handleOpenCodeCustomPathSave(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleOpenCodeCustomPathSave(event.currentTarget.value);
                  }}
                  spellCheck={false}
                  className="h-8 w-80 rounded-md border border-foreground/10 bg-background px-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-foreground/30 focus:ring-1 focus:ring-foreground/20"
                  placeholder="Absolute path to opencode"
                />
              </SettingRow>
            )}
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});
