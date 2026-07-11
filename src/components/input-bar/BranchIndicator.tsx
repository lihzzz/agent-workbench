import { useEffect, useRef, useState, useCallback } from "react";
import { GitBranch } from "lucide-react";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * Compact, read-only git branch indicator for the input toolbar.
 *
 * Resolves the current branch for `projectPath` via `git:status` and refreshes
 * when the window regains focus (cheap, no polling loop). Clicking copies the
 * branch name. Renders nothing when the path isn't a git repo or has no branch.
 */
export function BranchIndicator({ projectPath }: { projectPath?: string }) {
  const [branch, setBranch] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!projectPath) {
      setBranch(null);
      return;
    }
    const requestId = ++requestIdRef.current;
    try {
      const status = await window.claude.git.status(projectPath);
      // Ignore stale responses (project path changed mid-flight).
      if (requestId !== requestIdRef.current) return;
      if (!("error" in status) && status.branch) {
        setBranch(status.branch);
      } else {
        setBranch(null);
      }
    } catch {
      if (requestId === requestIdRef.current) setBranch(null);
    }
  }, [projectPath]);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const handleCopy = useCallback(async () => {
    if (!branch) return;
    const ok = await copyToClipboard(branch);
    if (ok) {
      toast.success("Branch name copied", { description: branch });
    } else {
      toast.error("Failed to copy branch name");
    }
  }, [branch]);

  if (!branch) return null;

  return (
    <>
      <span
        className="mx-0.5 h-3.5 w-px shrink-0 bg-border/20"
        aria-hidden="true"
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleCopy}
            className="flex min-w-0 max-w-[140px] shrink items-center gap-1 rounded-lg px-1.5 py-1 font-normal text-muted-foreground transition-colors duration-150 hover:bg-muted/50 hover:text-foreground"
          >
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate text-xs">{branch}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">Branch: {branch} (click to copy)</p>
        </TooltipContent>
      </Tooltip>
    </>
  );
}
