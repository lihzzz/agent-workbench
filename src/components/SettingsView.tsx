import { memo, useState, useCallback, useEffect } from "react";
import {
  SlidersHorizontal,
  Bell,
  Bot,
  Plug,
  Cpu,
  Info,
  Wrench,
  Palette,
  Sparkles,
  Users,
  BarChart3,
  DollarSign,
  PanelLeft,
  Archive,
  FileText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentSettings } from "@/components/settings/AgentSettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { NotificationsSettings } from "@/components/settings/NotificationsSettings";
import { McpSettings } from "@/components/settings/McpSettings";
import { AdvancedSettings } from "@/components/settings/AdvancedSettings";
import { EngineSettings } from "@/components/settings/EngineSettings";
import { AboutSettings } from "@/components/settings/AboutSettings";
import { AnalyticsSettings } from "@/components/settings/AnalyticsSettings";
import { ArchivedSettings } from "@/components/settings/ArchivedSettings";
import { CostDashboardSettings } from "@/components/settings/CostDashboardSettings";
import { SubagentSettings } from "@/components/settings/SubagentSettings";
import { PromptTemplateSettings } from "@/components/settings/PromptTemplateSettings";
import { SkillsSettings } from "@/components/settings/SkillsSettings";
import { useSettingsStore } from "@/stores/settings-store";
import { isMac } from "@/lib/utils";
import type { AppSettings, ChatSession, Project, EngineId } from "@/types";
import { useAgentContext } from "./AgentContext";

// ── Section definitions ──

export type SettingsSection = "general" | "appearance" | "notifications" | "analytics" | "usage" | "archived" | "agents" | "mcp" | "engines" | "skills" | "custom-agents" | "prompt-templates" | "advanced" | "about";

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  /** Renders a subtle "soon" indicator next to the label */
  comingSoon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "usage", label: "Usage & Cost", icon: DollarSign },
  { id: "archived", label: "Archived Chats", icon: Archive },
  { id: "agents", label: "ACP Agents", icon: Bot },
  { id: "mcp", label: "MCP Servers", icon: Plug },
  { id: "engines", label: "Engines", icon: Cpu },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "custom-agents", label: "Subagents", icon: Users },
  { id: "prompt-templates", label: "Prompt Templates", icon: FileText },
  { id: "advanced", label: "Advanced", icon: Wrench },
  { id: "about", label: "About", icon: Info },
];

// ── Props ──

interface SettingsViewProps {
  onClose: () => void;
  glassSupported: boolean;
  macLiquidGlassSupported: boolean;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  /** Resets the welcome wizard so it shows again. Dev-only. */
  onReplayWelcome: () => void;
  /** Open directly to a specific section (e.g. "agents" from the engine picker). */
  initialSection?: SettingsSection;
  /** All sessions across projects — used by the Archived panel. */
  sessions: ChatSession[];
  /** Projects — used by the Archived panel to group archived chats. */
  projects: Project[];
  /** Restore an archived chat back to the sidebar. */
  onRestoreSession: (sessionId: string) => void;
  /** Permanently delete a chat. */
  onDeleteSession: (sessionId: string) => void;
  /** Active session id + engine — used by the Skills panel to query discovered skills. */
  activeSessionId: string | null;
  activeEngine: EngineId | null;
}

// ── Component ──

export const SettingsView = memo(function SettingsView({
  onClose,
  glassSupported,
  macLiquidGlassSupported,
  sidebarOpen = false,
  onToggleSidebar,
  onReplayWelcome,
  initialSection,
  sessions,
  projects,
  onRestoreSession,
  onDeleteSession,
  activeSessionId,
  activeEngine,
}: SettingsViewProps) {
  const { agents, saveAgent, deleteAgent, subagents, saveSubagent, deleteSubagent, promptTemplates, savePromptTemplate, deletePromptTemplate } = useAgentContext();
  const islandLayout = useSettingsStore((s) => s.islandLayout);
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection ?? "general");
  const macIslandTitlebarOffsetClass = "";

  // ── Main-process app settings (loaded once, updated optimistically) ──
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    window.claude.settings.get().then((s: AppSettings | null) => {
      if (s) setAppSettings(s);
    });
  }, []);

  const updateAppSettings = useCallback(async (patch: Partial<AppSettings>) => {
    // Optimistic local update
    setAppSettings((prev) => (prev ? { ...prev, ...patch } : null));
    await window.claude.settings.set(patch);
  }, []);

  // Escape key closes settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const renderSection = useCallback(() => {
    switch (activeSection) {
      case "general":
        return (
          <GeneralSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
          />
        );
      case "appearance":
        return (
          <AppearanceSettings
            glassSupported={glassSupported}
            macLiquidGlassSupported={macLiquidGlassSupported}
          />
        );
      case "notifications":
        return (
          <NotificationsSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
          />
        );
      case "analytics":
        return (
          <AnalyticsSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
          />
        );
      case "archived":
        return (
          <ArchivedSettings
            sessions={sessions}
            projects={projects}
            agents={agents}
            onRestore={onRestoreSession}
            onDelete={onDeleteSession}
          />
        );
      case "usage":
        return <CostDashboardSettings projects={projects} />;
      case "agents":
        return (
          <AgentSettings
            agents={agents}
            onSave={saveAgent}
            onDelete={deleteAgent}
          />
        );
      case "mcp":
        return <McpSettings />;
      case "engines":
        return (
          <EngineSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
          />
        );
      case "advanced":
        return (
          <AdvancedSettings
            appSettings={appSettings}
            onUpdateAppSettings={updateAppSettings}
            onReplayWelcome={onReplayWelcome}
          />
        );
      case "skills":
        return <SkillsSettings sessionId={activeSessionId} engine={activeEngine} />;
      case "custom-agents":
        return (
          <SubagentSettings
            subagents={subagents}
            onSave={saveSubagent}
            onDelete={deleteSubagent}
          />
        );
      case "prompt-templates":
        return (
          <PromptTemplateSettings
            templates={promptTemplates}
            onSave={savePromptTemplate}
            onDelete={deletePromptTemplate}
          />
        );
      case "about":
        return <AboutSettings />;
      default:
        return null;
    }
  }, [activeSection, appSettings, updateAppSettings, agents, saveAgent, deleteAgent, subagents, saveSubagent, deleteSubagent, promptTemplates, savePromptTemplate, deletePromptTemplate, activeSessionId, activeEngine, glassSupported, macLiquidGlassSupported, onReplayWelcome, sessions, projects, onRestoreSession, onDeleteSession]);

  return (
    <div className={`island flex flex-1 flex-col overflow-hidden bg-background ${islandLayout ? "rounded-[var(--island-radius)]" : "rounded-none"}`}>
      <div
        className={`drag-region flex shrink-0 items-center border-b border-foreground/[0.06] ${
          islandLayout ? "h-[2.375rem] px-4" : "h-[3.25rem] px-4"
        } ${
          !sidebarOpen && isMac ? (islandLayout ? "ps-[78px]" : "ps-[84px]") : ""
        }`}
      >
        {onToggleSidebar && !sidebarOpen && (
          <Button
            variant="ghost"
            size="icon"
            className={`no-drag me-2 h-7 w-7 text-muted-foreground/60 hover:text-foreground ${macIslandTitlebarOffsetClass}`}
            onClick={onToggleSidebar}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        )}
        <span className={`leading-none text-sm font-semibold text-foreground ${macIslandTitlebarOffsetClass}`}>Settings</span>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Settings nav sidebar */}
        <div className="flex w-44 shrink-0 flex-col border-e border-foreground/[0.06]">
          {/* Nav items */}
          <nav className="flex flex-1 flex-col gap-0.5 px-1.5 py-2">
            {NAV_ITEMS.map((item) => {
              const isActive = activeSection === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`flex w-full items-center justify-start gap-2 rounded-md px-2 py-1.5 text-[13px] text-start transition-colors ${
                    isActive
                      ? "bg-foreground/[0.06] font-medium text-foreground"
                      : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.comingSoon && (
                    <span className="rounded bg-foreground/[0.06] px-1.5 py-px text-[10px] font-medium text-muted-foreground/70">
                      Soon
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content area — centered container with max width */}
        <div className="flex min-w-0 flex-1 justify-center overflow-hidden">
          <div className="flex h-full w-full max-w-3xl flex-col">
            {renderSection()}
          </div>
        </div>
      </div>
    </div>
  );
});
