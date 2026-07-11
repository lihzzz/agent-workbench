import { createContext, useContext, type ReactNode } from "react";
import type { InstalledAgent, CustomSubagent, PromptTemplate, EngineId } from "@/types";

/** Standard IPC result shape returned by agent save/delete operations. */
interface AgentIpcResult {
  ok?: boolean;
  error?: string;
}

/** Agent-related state and callbacks shared across the component tree. */
export interface AgentContextValue {
  agents: InstalledAgent[];
  selectedAgent: InstalledAgent | null;
  saveAgent: (agent: InstalledAgent) => Promise<AgentIpcResult>;
  deleteAgent: (id: string) => Promise<AgentIpcResult>;
  handleAgentChange: (agent: InstalledAgent | null) => void;
  lockedEngine: EngineId | null;
  lockedAgentId: string | null;
  // ── Custom subagents (Claude SDK AgentDefinitions) ──
  subagents: CustomSubagent[];
  saveSubagent: (subagent: CustomSubagent) => Promise<AgentIpcResult>;
  deleteSubagent: (id: string) => Promise<AgentIpcResult>;
  // ── Prompt templates ──
  promptTemplates: PromptTemplate[];
  savePromptTemplate: (template: PromptTemplate) => Promise<AgentIpcResult>;
  deletePromptTemplate: (id: string) => Promise<AgentIpcResult>;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children, value }: { children: ReactNode; value: AgentContextValue }) {
  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgentContext(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgentContext must be used within AgentProvider");
  return ctx;
}
