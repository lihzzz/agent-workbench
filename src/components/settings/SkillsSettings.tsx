import { memo } from "react";
import { Sparkles, FolderOpen, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSkills } from "@/hooks/useSkills";
import type { EngineId } from "@/types";

interface SkillsSettingsProps {
  sessionId: string | null;
  engine: EngineId | null;
}

const SCOPE_LABEL: Record<string, string> = {
  user: "User", repo: "Project", system: "System", admin: "Admin",
};

export const SkillsSettings = memo(function SkillsSettings({ sessionId, engine }: SkillsSettingsProps) {
  const { skills, errors, loading, hasSession, refresh } = useSkills(sessionId, engine);

  const grouped = skills.reduce<Record<string, typeof skills>>((acc, s) => {
    const k = s.scope ?? "other";
    (acc[k] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-foreground/[0.06] px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Skills</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Skills discovered for the active session. Add skills by placing them in your skills directory.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.claude.showItemInFolder("~/.claude/skills")}>
            <FolderOpen className="h-3.5 w-3.5" />
            Open folder
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={refresh} disabled={!hasSession}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 px-6 py-4">
          {!hasSession ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Sparkles className="h-8 w-8 text-muted-foreground/30" />
              <p className="mt-3 text-sm text-muted-foreground">No active Claude or Codex session</p>
              <p className="mt-1 text-xs text-muted-foreground/60">Start a session to see its available skills</p>
            </div>
          ) : skills.length === 0 && errors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Sparkles className="h-8 w-8 text-muted-foreground/30" />
              <p className="mt-3 text-sm text-muted-foreground">No skills found</p>
              <p className="mt-1 text-xs text-muted-foreground/60">Place skill folders in your skills directory, then refresh</p>
            </div>
          ) : (
            Object.entries(grouped).map(([scope, items]) => (
              <div key={scope}>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {SCOPE_LABEL[scope] ?? scope}
                </p>
                <div className="space-y-1.5">
                  {items.map((s) => (
                    <div key={`${s.source}-${s.name}-${s.path ?? ""}`} className="flex items-start gap-3 rounded-lg border border-foreground/[0.06] px-4 py-2.5">
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#f0abfc]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{s.name}</span>
                          {!s.enabled && <Badge variant="secondary" className="text-[10px]">Disabled</Badge>}
                        </div>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{s.description}</p>
                        {s.path && <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/50">{s.path}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}

          {errors.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> Skill load errors
              </div>
              {errors.map((e, i) => <p key={i} className="font-mono text-[11px] text-destructive/80">{e}</p>)}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
