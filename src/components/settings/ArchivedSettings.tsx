/**
 * Archived chats settings panel.
 *
 * Lists every archived session grouped by project. Archived chats are hidden
 * from the sidebar; from here the user can restore a chat back to the sidebar
 * or permanently delete it.
 */

import { memo, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Trash2, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AgentIcon } from "@/components/AgentIcon";
import { getSessionEngineIcon } from "@/lib/engine-icons";
import type { ChatSession, InstalledAgent, Project } from "@/types";
import { SettingsHeader } from "./shared";
import { ArchivedChatPreview } from "./ArchivedChatPreview";

interface ArchivedSettingsProps {
  /** All sessions across all projects (archived ones are filtered locally). */
  sessions: ChatSession[];
  /** Projects, used to label and group archived chats. */
  projects: Project[];
  /** Installed agents, used to resolve per-session engine icons. */
  agents: InstalledAgent[];
  /** Restore a chat back to the sidebar. */
  onRestore: (sessionId: string) => void;
  /** Permanently delete a chat. */
  onDelete: (sessionId: string) => void;
}

interface ArchivedGroup {
  project: Project;
  sessions: ChatSession[];
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export const ArchivedSettings = memo(function ArchivedSettings({
  sessions,
  projects,
  agents,
  onRestore,
  onDelete,
}: ArchivedSettingsProps) {
  const [pendingDelete, setPendingDelete] = useState<ChatSession | null>(null);
  const [previewSession, setPreviewSession] = useState<ChatSession | null>(null);
  // Project group ids that are expanded (default: all collapsed).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (projectId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  // Group archived sessions by project, newest activity first within each group.
  const groups = useMemo<ArchivedGroup[]>(() => {
    const archived = sessions.filter((s) => s.archived);
    const byProject = new Map<string, ChatSession[]>();
    for (const session of archived) {
      const arr = byProject.get(session.projectId) ?? [];
      arr.push(session);
      byProject.set(session.projectId, arr);
    }
    const result: ArchivedGroup[] = [];
    for (const project of projects) {
      const projectSessions = byProject.get(project.id);
      if (!projectSessions || projectSessions.length === 0) continue;
      projectSessions.sort(
        (a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt),
      );
      result.push({ project, sessions: projectSessions });
    }
    return result;
  }, [sessions, projects]);

  const totalArchived = useMemo(
    () => groups.reduce((sum, g) => sum + g.sessions.length, 0),
    [groups],
  );

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title="Archived Chats"
        description="Chats you've archived are hidden from the sidebar. Restore them to bring them back, or delete them permanently."
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-4">
          {totalArchived === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/[0.04]">
                <Archive className="h-5 w-5 text-muted-foreground/60" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No archived chats</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Archive a chat from its menu in the sidebar and it will appear here.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => {
                const isCollapsed = !expanded.has(group.project.id);
                return (
                  <div key={group.project.id}>
                    <button
                      onClick={() => toggleExpanded(group.project.id)}
                      className="mb-1.5 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-start transition-colors hover:bg-foreground/[0.03]"
                    >
                      <ChevronRight
                        className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform ${
                          isCollapsed ? "" : "rotate-90"
                        }`}
                      />
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {group.project.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground/50">
                        {group.sessions.length}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div className="flex flex-col gap-0.5">
                        {group.sessions.map((session) => (
                          <div
                            key={session.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setPreviewSession(session)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setPreviewSession(session);
                              }
                            }}
                            className="group flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03] focus-visible:outline-none"
                          >
                            <AgentIcon
                              icon={getSessionEngineIcon(session.engine, session.agentId, agents)}
                              size={14}
                              className="shrink-0 opacity-50"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm text-foreground">{session.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatTimestamp(session.lastMessageAt ?? session.createdAt)}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onRestore(session.id);
                                }}
                              >
                                <ArchiveRestore className="h-3.5 w-3.5" />
                                Restore
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPendingDelete(session);
                                }}
                                title="Delete permanently"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
        title="Delete chat?"
        description={
          <>
            This will permanently delete{" "}
            <span className="font-medium text-foreground">
              {pendingDelete?.title}
            </span>
            . This action cannot be undone.
          </>
        }
        confirmLabel="Delete"
      />
      <ArchivedChatPreview
        session={previewSession}
        agents={agents}
        onClose={() => setPreviewSession(null)}
      />
    </div>
  );
});
