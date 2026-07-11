import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RadioTower, ShieldCheck, Terminal, Unplug } from "lucide-react";
import { DEFAULT_REMOTE_CONTROL_SETTINGS, type RemoteCapability } from "@shared/types/remote";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { SettingRow, SettingsHeader, SettingsSection, SettingsSelect } from "@/components/settings/shared";
import type { AppSettings, RemoteConnectorStatus, RemoteControlPublicSettings, RemotePublicStatus } from "@/types";

interface RemoteControlSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

type RemoteControlSettingsPatch = Omit<Partial<RemoteControlPublicSettings>, "capabilities"> & {
  capabilities?: Partial<Record<RemoteCapability, boolean>>;
};

const CAPABILITY_LABELS: Record<RemoteCapability, { label: string; description: string }> = {
  "status.read": {
    label: "Status read",
    description: "Allow remote clients to see desktop, project, and session status.",
  },
  "chat.read": {
    label: "Chat read",
    description: "Allow remote clients to read session summaries and paginated messages.",
  },
  "chat.write": {
    label: "Chat write",
    description: "Allow remote clients to send messages to existing sessions.",
  },
  "task.start": {
    label: "Task start",
    description: "Allow remote clients to start tasks using desktop-defined safe profiles.",
  },
  "task.stop": {
    label: "Task stop",
    description: "Allow remote clients to interrupt or stop running turns.",
  },
  "permission.respond": {
    label: "Permission approval",
    description: "Allow remote clients to respond to permission prompts after step-up.",
  },
  "diff.read": {
    label: "Diff read",
    description: "Allow read-only git status and file diff access.",
  },
  "terminal.read": {
    label: "Terminal read",
    description: "Allow terminal list, snapshot, and subscribed output access.",
  },
  "terminal.write": {
    label: "Terminal write",
    description: "Allow terminal writes only with a temporary lease and step-up.",
  },
};

const CAPABILITY_ORDER = Object.keys(CAPABILITY_LABELS) as RemoteCapability[];

function mergeRemoteSettings(
  current: RemoteControlPublicSettings | undefined,
  patch: RemoteControlSettingsPatch,
): RemoteControlPublicSettings {
  const base = current ?? DEFAULT_REMOTE_CONTROL_SETTINGS;
  return {
    ...base,
    ...patch,
    capabilities: {
      ...DEFAULT_REMOTE_CONTROL_SETTINGS.capabilities,
      ...base.capabilities,
      ...patch.capabilities,
    },
  };
}

function statusVariant(status: RemoteConnectorStatus | undefined): "default" | "secondary" | "outline" | "destructive" {
  if (status === "connected") return "default";
  if (status === "connecting" || status === "pairing") return "secondary";
  if (status === "backoff" || status === "revoked") return "destructive";
  return "outline";
}

function formatRemoteTimestamp(timestamp?: number): string {
  if (!timestamp) return "Not available";
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function connectionLabel(
  status: RemoteConnectorStatus | undefined,
  enabled: boolean,
  paired: boolean,
): string {
  if (!enabled) return "Disabled";
  if (!paired) return "Pairing required";
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "backoff":
      return "Disconnected, retrying";
    case "pairing":
      return "Paired, waiting to connect";
    case "revoked":
      return "Revoked";
    default:
      return "Disconnected";
  }
}

function connectionDescription(
  status: RemoteConnectorStatus | undefined,
  enabled: boolean,
  paired: boolean,
  rendererReady: boolean,
): string {
  if (!enabled) return "Remote control is off. The Web client cannot operate this desktop.";
  if (!paired) return "Pair this desktop with the remote server before the Web client can connect.";
  if (status === "connected" && rendererReady) {
    return "The relay is online and the renderer bridge is ready. Web commands can run according to the enabled capabilities.";
  }
  if (status === "connected") {
    return "The relay is online, but the renderer bridge is not ready yet. Web commands may not run.";
  }
  if (status === "backoff") {
    return "The desktop is paired, but the outbound WebSocket is offline. The app is retrying and Web commands are paused.";
  }
  if (status === "connecting") return "Opening the outbound WebSocket to the remote server.";
  if (status === "revoked") return "The paired device was revoked. Pair again with a fresh device token.";
  return "Waiting for a paired desktop credential before connecting.";
}

export const RemoteControlSettings = memo(function RemoteControlSettings({
  appSettings,
  onUpdateAppSettings,
}: RemoteControlSettingsProps) {
  const remoteSettings = useMemo(
    () => mergeRemoteSettings(appSettings?.remoteControl, {}),
    [appSettings?.remoteControl],
  );
  const [status, setStatus] = useState<RemotePublicStatus | null>(null);
  const [serverUrl, setServerUrl] = useState(remoteSettings.serverUrl ?? "");
  const [desktopName, setDesktopName] = useState(remoteSettings.desktopName ?? "");
  const [desktopId, setDesktopId] = useState("");
  const [deviceToken, setDeviceToken] = useState("");

  useEffect(() => {
    setServerUrl(remoteSettings.serverUrl ?? "");
    setDesktopName(remoteSettings.desktopName ?? "");
  }, [remoteSettings.desktopName, remoteSettings.serverUrl]);

  useEffect(() => {
    if (status?.desktopId) setDesktopId(status.desktopId);
  }, [status?.desktopId]);

  useEffect(() => {
    let disposed = false;
    window.claude.remote.status().then((next) => {
      if (!disposed) setStatus(next);
    });
    const unsubscribe = window.claude.remote.onStatusChanged(setStatus);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const updateRemoteSettings = useCallback(
    async (patch: RemoteControlSettingsPatch) => {
      await onUpdateAppSettings({
        remoteControl: mergeRemoteSettings(remoteSettings, patch),
      });
    },
    [onUpdateAppSettings, remoteSettings],
  );

  const handleCapabilityToggle = useCallback(
    async (capability: RemoteCapability, checked: boolean) => {
      await updateRemoteSettings({
        capabilities: { [capability]: checked },
      });
    },
    [updateRemoteSettings],
  );

  const handleEnabledToggle = useCallback(
    async (checked: boolean) => {
      await updateRemoteSettings({ enabled: checked });
      setStatus(await window.claude.remote.status());
    },
    [updateRemoteSettings],
  );

  const handlePair = useCallback(async () => {
    const trimmedServer = serverUrl.trim();
    const trimmedName = desktopName.trim() || "Harnss Desktop";
    const trimmedDesktopId = desktopId.trim();
    const trimmedToken = deviceToken.trim();
    if (!trimmedServer || !trimmedDesktopId || !trimmedToken) return;
    const result = await window.claude.remote.pair({
      serverUrl: trimmedServer,
      desktopName: trimmedName,
      desktopId: trimmedDesktopId,
      deviceToken: trimmedToken,
    });
    if (!result.error) {
      setDeviceToken("");
      await updateRemoteSettings({
        enabled: true,
        serverUrl: trimmedServer,
        desktopName: trimmedName,
      });
      setStatus(await window.claude.remote.status());
    }
  }, [desktopId, desktopName, deviceToken, serverUrl, updateRemoteSettings]);

  const handleRevoke = useCallback(async () => {
    const result = await window.claude.remote.revoke();
    if (!result.error) {
      await updateRemoteSettings({ enabled: false });
      setStatus(await window.claude.remote.status());
    }
  }, [updateRemoteSettings]);

  const paired = !!status?.paired;
  const canOperateFromWeb = status?.status === "connected" && !!status.rendererReady;
  const currentStatus = status?.status ?? (remoteSettings.enabled ? "pairing" : "disabled");
  const statusLabel = connectionLabel(currentStatus, remoteSettings.enabled, paired);
  const StatusIcon = canOperateFromWeb
    ? CheckCircle2
    : currentStatus === "connecting" || currentStatus === "backoff"
      ? Loader2
      : AlertTriangle;
  const statusTone = canOperateFromWeb
    ? "border-emerald-200 bg-emerald-50/70 text-emerald-950"
    : currentStatus === "backoff" || currentStatus === "connecting"
      ? "border-amber-200 bg-amber-50/70 text-amber-950"
      : currentStatus === "revoked"
        ? "border-red-200 bg-red-50/70 text-red-950"
        : "border-border bg-muted/30 text-foreground";
  const statusIconTone = canOperateFromWeb
    ? "text-emerald-700"
    : currentStatus === "revoked"
      ? "text-red-700"
      : "text-amber-700";

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title="Remote Control"
        description="Desktop-owned remote access with local policy, audit, and temporary leases"
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          <SettingsSection icon={RadioTower} label="Connection" first>
            <div className={`mb-3 rounded-lg border p-3 ${statusTone}`}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusIcon
                  className={`h-4 w-4 ${statusIconTone} ${currentStatus === "connecting" || currentStatus === "backoff" ? "animate-spin" : ""}`}
                />
                <Badge variant={statusVariant(currentStatus)}>{statusLabel}</Badge>
                {paired && <Badge variant="outline">Paired</Badge>}
                <Badge variant={canOperateFromWeb ? "default" : "outline"}>
                  {canOperateFromWeb ? "Web operable" : "Web paused"}
                </Badge>
              </div>
              <p className="mt-2 text-sm">
                {connectionDescription(currentStatus, remoteSettings.enabled, paired, !!status?.rendererReady)}
              </p>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <span>Server: {(status?.serverUrl ?? serverUrl) || "Not configured"}</span>
                <span>Desktop ID: {(status?.desktopId ?? desktopId) || "Not paired"}</span>
                <span>Connected: {formatRemoteTimestamp(status?.connectedAt)}</span>
                <span>Last heartbeat: {formatRemoteTimestamp(status?.lastHeartbeatAt)}</span>
              </div>
            </div>

            <SettingRow
              label="Enable remote control"
              description="Opens an outbound desktop WebSocket only when a device is paired."
            >
              <Switch
                checked={remoteSettings.enabled}
                onCheckedChange={handleEnabledToggle}
              />
            </SettingRow>

            <div className="grid gap-3 py-3">
              <Input
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="https://remote.example.com"
                spellCheck={false}
              />
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
                <Input
                  value={desktopName}
                  onChange={(event) => setDesktopName(event.target.value)}
                  placeholder="Desktop name"
                  spellCheck={false}
                />
                <Input
                  value={desktopId}
                  onChange={(event) => setDesktopId(event.target.value)}
                  placeholder="Desktop ID"
                  spellCheck={false}
                />
                <Input
                  value={deviceToken}
                  onChange={(event) => setDeviceToken(event.target.value)}
                  placeholder="Device token"
                  spellCheck={false}
                  type="password"
                />
                <Button
                  size="sm"
                  onClick={handlePair}
                  disabled={!serverUrl.trim() || !desktopId.trim() || !deviceToken.trim()}
                >
                  Pair
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Device token is only needed when pairing again. The saved token is not shown after it is stored.
              </p>
            </div>

            {paired && (
              <SettingRow
                label="Revoke paired device"
                description={status?.desktopId ? `Desktop ID: ${status.desktopId}` : undefined}
              >
                <Button size="sm" variant="outline" onClick={handleRevoke}>
                  <Unplug className="h-4 w-4" />
                  Revoke
                </Button>
              </SettingRow>
            )}
          </SettingsSection>

          <SettingsSection icon={ShieldCheck} label="Capabilities">
            {CAPABILITY_ORDER.map((capability) => {
              const meta = CAPABILITY_LABELS[capability];
              return (
                <SettingRow
                  key={capability}
                  label={meta.label}
                  description={meta.description}
                >
                  <Switch
                    checked={!!remoteSettings.capabilities[capability]}
                    onCheckedChange={(checked) => handleCapabilityToggle(capability, checked)}
                  />
                </SettingRow>
              );
            })}
          </SettingsSection>

          <SettingsSection icon={Terminal} label="Terminal">
            <SettingRow
              label="Terminal write mode"
              description="Temporary leases are revoked on disconnect, disable, or revoke."
            >
              <SettingsSelect
                value={remoteSettings.terminalWriteMode}
                onValueChange={(value) => updateRemoteSettings({ terminalWriteMode: value })}
                options={[
                  { value: "disabled", label: "Disabled" },
                  { value: "temporary", label: "Temporary" },
                ]}
                className="w-32"
              />
            </SettingRow>
            <SettingRow
              label="Terminal lease TTL"
              description="Maximum lifetime for a remote terminal write lease."
            >
              <SettingsSelect
                value={String(remoteSettings.terminalWriteTtlMs)}
                onValueChange={(value) => updateRemoteSettings({ terminalWriteTtlMs: Number(value) })}
                options={[
                  { value: String(5 * 60 * 1000), label: "5 min" },
                  { value: String(10 * 60 * 1000), label: "10 min" },
                  { value: String(15 * 60 * 1000), label: "15 min" },
                ]}
                className="w-28"
              />
            </SettingRow>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});
