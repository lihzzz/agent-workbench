/**
 * Unified tool island content renderer.
 *
 * Maps a `toolId` to the correct panel component (ToolsPanel, BrowserPanel, etc.)
 * with the provided context. Replaces three copies of the same switch/record:
 * - `renderMainWorkspaceToolContent` (main single-chat)
 * - inline `toolNode` in `renderSplitTopRowItem` (split-view top row)
 * - inline `toolNode` in `renderSplitBottomToolIsland` (split-view bottom dock)
 */

import { lazy, Suspense, type ReactNode } from "react";
import type { PanelToolId, EngineId, McpServerConfig, McpServerStatus, UIMessage, GrabbedElement } from "@/types";
import type { TerminalTab } from "@/lib/terminal-tabs";
import type { ResolvedTheme } from "@/hooks/useTheme";

const ToolsPanel = lazy(() =>
  import("@/components/ToolsPanel").then((mod) => ({ default: mod.ToolsPanel })),
);
const BrowserPanel = lazy(() =>
  import("@/components/BrowserPanel").then((mod) => ({ default: mod.BrowserPanel })),
);
const GitPanel = lazy(() =>
  import("@/components/git/GitPanel").then((mod) => ({ default: mod.GitPanel })),
);
const FilesPanel = lazy(() =>
  import("@/components/FilesPanel").then((mod) => ({ default: mod.FilesPanel })),
);
const ProjectFilesPanel = lazy(() =>
  import("@/components/ProjectFilesPanel").then((mod) => ({ default: mod.ProjectFilesPanel })),
);
const McpPanel = lazy(() =>
  import("@/components/McpPanel").then((mod) => ({ default: mod.McpPanel })),
);

function ToolPanelFallback() {
  return <div className="h-full min-h-0 w-full" />;
}

// ── Props ──

export interface ToolIslandContentProps {
  toolId: PanelToolId;
  persistKey: string;
  headerControls: ReactNode;

  // Session / project context
  projectPath: string | undefined;
  projectRoot: string | undefined;
  projectId: string | null;
  sessionId: string | null;
  messages: UIMessage[];
  activeEngine: EngineId | undefined;
  isActiveSessionPane: boolean;
  hasLiveSession: boolean;

  // Space / terminal context
  spaceId: string;
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string | null;
  terminalsReady: boolean;
  onSetActiveTab: (tabId: string | null) => void;
  onCreateTerminal: () => Promise<void>;
  onEnsureTerminal: () => Promise<void>;
  onCloseTerminal: (tabId: string) => Promise<void>;
  resolvedTheme: ResolvedTheme;

  // Panel-specific callbacks
  onElementGrab?: (element: GrabbedElement) => void;
  onScrollToToolCall?: (messageId: string) => void;
  onPreviewFile?: (path: string, rect: DOMRect) => void;
  collapsedRepos: Set<string>;
  onToggleRepoCollapsed: (path: string) => void;
  // MCP panel
  mcpServerStatuses: McpServerStatus[];
  mcpStatusPreliminary: boolean;
  onRefreshMcpStatus: () => void;
  onReconnectMcpServer: (name: string) => Promise<void> | void;
  onRestartWithMcpServers: (servers: McpServerConfig[]) => Promise<void> | void;
}

export function ToolIslandContent({
  toolId,
  persistKey,
  headerControls,
  projectPath,
  projectRoot,
  projectId,
  sessionId,
  messages,
  activeEngine,
  isActiveSessionPane,
  hasLiveSession,
  spaceId,
  terminalTabs,
  activeTerminalTabId,
  terminalsReady,
  onSetActiveTab,
  onCreateTerminal,
  onEnsureTerminal,
  onCloseTerminal,
  resolvedTheme,
  onElementGrab,
  onScrollToToolCall,
  onPreviewFile,
  collapsedRepos,
  onToggleRepoCollapsed,
  mcpServerStatuses,
  mcpStatusPreliminary,
  onRefreshMcpStatus,
  onReconnectMcpServer,
  onRestartWithMcpServers,
}: ToolIslandContentProps): ReactNode {
  switch (toolId) {
    case "terminal":
      return (
        <Suspense fallback={<ToolPanelFallback />}>
          <ToolsPanel
            spaceId={spaceId}
            tabs={terminalTabs}
            activeTabId={activeTerminalTabId}
            terminalsReady={terminalsReady}
            onSetActiveTab={onSetActiveTab}
            onCreateTerminal={onCreateTerminal}
            onEnsureTerminal={onEnsureTerminal}
            onCloseTerminal={onCloseTerminal}
            resolvedTheme={resolvedTheme}
            headerControls={headerControls}
          />
        </Suspense>
      );
    case "browser":
      return (
        <Suspense fallback={<ToolPanelFallback />}>
          <BrowserPanel
            persistKey={persistKey}
            onElementGrab={isActiveSessionPane ? onElementGrab : undefined}
            headerControls={headerControls}
          />
        </Suspense>
      );
    case "git":
      return (
        <Suspense fallback={<ToolPanelFallback />}>
          <GitPanel
            cwd={projectRoot}
            collapsedRepos={collapsedRepos}
            onToggleRepoCollapsed={onToggleRepoCollapsed}
            activeEngine={activeEngine}
            activeSessionId={sessionId}
            headerControls={headerControls}
          />
        </Suspense>
      );
    case "files":
      return (
        <Suspense fallback={<ToolPanelFallback />}>
          <FilesPanel
            sessionId={sessionId}
            messages={messages}
            cwd={projectPath}
            activeEngine={activeEngine}
            onScrollToToolCall={onScrollToToolCall}
            enabled={true}
            headerControls={headerControls}
          />
        </Suspense>
      );
    case "project-files":
      return (
        <Suspense fallback={<ToolPanelFallback />}>
          <ProjectFilesPanel
            cwd={projectPath}
            enabled={true}
            onPreviewFile={onPreviewFile}
            headerControls={headerControls}
          />
        </Suspense>
      );
    case "mcp":
      return (
        <Suspense fallback={<ToolPanelFallback />}>
          <McpPanel
            projectId={projectId}
            runtimeStatuses={mcpServerStatuses}
            isPreliminary={isActiveSessionPane ? mcpStatusPreliminary : false}
            hasLiveSession={hasLiveSession}
            onRefreshStatus={onRefreshMcpStatus}
            onReconnect={onReconnectMcpServer}
            onRestartWithServers={onRestartWithMcpServers}
            headerControls={headerControls}
          />
        </Suspense>
      );
  }
}
