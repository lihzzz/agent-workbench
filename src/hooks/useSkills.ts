import { useState, useEffect, useCallback } from "react";
import type { EngineId } from "@/types";

/** Normalized skill entry across Claude (slash-commands) and Codex (skills/list). */
export interface SkillItem {
  name: string;
  description: string;
  scope?: string;
  enabled: boolean;
  path?: string;
  source: "claude" | "codex";
}

interface UseSkillsResult {
  skills: SkillItem[];
  errors: string[];
  loading: boolean;
  hasSession: boolean;
  refresh: () => void;
}

/**
 * Read-only skill discovery for the active session. Skills are discovered from
 * disk by the engine at runtime, so this requires an active Claude/Codex
 * session. There is no create/install — users add skills by editing files under
 * ~/.claude/skills, .claude/skills, etc.
 */
export function useSkills(sessionId: string | null, engine: EngineId | null): UseSkillsResult {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionId || !engine || (engine !== "claude" && engine !== "codex")) {
      setSkills([]);
      setErrors([]);
      return;
    }
    setLoading(true);
    try {
      if (engine === "claude") {
        const res = await window.claude.slashCommands(sessionId);
        setSkills(
          (res.commands ?? []).map((c) => ({
            name: c.name,
            description: c.description ?? "",
            enabled: true,
            source: "claude" as const,
          })),
        );
        setErrors(res.error ? [res.error] : []);
      } else {
        const res = await window.claude.codex.listSkills(sessionId);
        const items: SkillItem[] = [];
        const errs: string[] = [];
        for (const entry of res.skills ?? []) {
          for (const s of entry.skills) {
            items.push({
              name: s.name,
              description: s.interface?.shortDescription ?? s.shortDescription ?? s.description,
              scope: s.scope,
              enabled: s.enabled,
              path: s.path,
              source: "codex",
            });
          }
          for (const e of entry.errors ?? []) errs.push(`${e.path}: ${e.message}`);
        }
        setSkills(items);
        setErrors(res.error ? [res.error, ...errs] : errs);
      }
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setLoading(false);
    }
  }, [sessionId, engine]);

  useEffect(() => { refresh(); }, [refresh]);

  return {
    skills,
    errors,
    loading,
    hasSession: !!sessionId && (engine === "claude" || engine === "codex"),
    refresh,
  };
}
