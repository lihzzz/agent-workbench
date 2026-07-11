import { useCallback, useEffect, useState } from "react";
import type { Project } from "@/types";
import type { UsageRow } from "@/lib/session/usage-aggregation";
import { reportError } from "@/lib/analytics/analytics";

interface UseUsageDataResult {
  rows: UsageRow[];
  loading: boolean;
  refresh: () => void;
}

/**
 * Loads usage rows for every session across the given projects.
 * Reads only the lightweight `.meta.json` sidecars (via `sessions:list`),
 * so it never loads full session transcripts — cheap even with thousands of chats.
 */
export function useUsageData(projects: Project[]): UseUsageDataResult {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const projectNames = new Map(projects.map((p) => [p.id, p.name]));
        const perProject = await Promise.all(
          projects.map(async (project) => {
            const metas = await window.claude.sessions.list(project.id);
            return metas.map((meta): UsageRow => ({
              projectId: project.id,
              projectName: projectNames.get(project.id) ?? project.name,
              sessionId: meta.id,
              title: meta.title || "Untitled",
              engine: meta.engine ?? "claude",
              createdAt: meta.createdAt,
              lastMessageAt: meta.lastMessageAt || meta.createdAt,
              totalCost: meta.totalCost ?? 0,
              modelUsage: meta.modelUsage ?? {},
            }));
          }),
        );
        if (cancelled) return;
        setRows(perProject.flat());
      } catch (err) {
        if (!cancelled) {
          reportError("USAGE:LOAD", err);
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projects, nonce]);

  return { rows, loading, refresh };
}
