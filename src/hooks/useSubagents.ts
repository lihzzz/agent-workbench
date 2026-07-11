import { useState, useEffect, useCallback } from "react";
import type { CustomSubagent } from "@/types";

/** Loads + mutates user-defined custom subagents (Claude SDK AgentDefinitions). */
export function useSubagents() {
  const [subagents, setSubagents] = useState<CustomSubagent[]>([]);

  const refresh = useCallback(async () => {
    const list = await window.claude.subagents.list();
    setSubagents(list);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const saveSubagent = useCallback(async (subagent: CustomSubagent) => {
    const result = await window.claude.subagents.save(subagent);
    if (result.ok) await refresh();
    return result;
  }, [refresh]);

  const deleteSubagent = useCallback(async (id: string) => {
    const result = await window.claude.subagents.delete(id);
    if (result.ok) await refresh();
    return result;
  }, [refresh]);

  return { subagents, refresh, saveSubagent, deleteSubagent };
}
