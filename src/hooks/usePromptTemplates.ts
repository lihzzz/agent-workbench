import { useState, useEffect, useCallback } from "react";
import type { PromptTemplate } from "@/types";

/** Loads + mutates user-managed prompt templates. */
export function usePromptTemplates() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);

  const refresh = useCallback(async () => {
    const list = await window.claude.promptTemplates.list();
    setTemplates(list);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const saveTemplate = useCallback(async (template: PromptTemplate) => {
    const result = await window.claude.promptTemplates.save(template);
    if (result.ok) await refresh();
    return result;
  }, [refresh]);

  const deleteTemplate = useCallback(async (id: string) => {
    const result = await window.claude.promptTemplates.delete(id);
    if (result.ok) await refresh();
    return result;
  }, [refresh]);

  return { templates, refresh, saveTemplate, deleteTemplate };
}
