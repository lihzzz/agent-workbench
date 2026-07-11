import type { InstalledAgent } from "@/types";
import type { EngineId } from "@shared/types/engine";

/** CDN icons for built-in engines; ACP agents use their own `icon` field */
export const ENGINE_ICONS: Record<string, string> = {
  claude: "https://cdn.agentclientprotocol.com/registry/v1/latest/claude-acp.svg",
  codex: "https://cdn.agentclientprotocol.com/registry/v1/latest/codex-acp.svg",
  opencode: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2335a56f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='4 17 10 11 4 5'/%3E%3Cline x1='12' x2='20' y1='19' y2='19'/%3E%3C/svg%3E",
};

/** Resolve the icon source for an agent — engine CDN icons override agent-level icons */
export function getAgentIcon(agent: InstalledAgent): string | undefined {
  return ENGINE_ICONS[agent.engine] ?? agent.icon;
}

/** Resolve the icon URL for a session based on its engine and optional agent ID */
export function getSessionEngineIcon(
  engine: EngineId | undefined,
  agentId: string | undefined,
  agents?: InstalledAgent[],
): string | undefined {
  const effectiveEngine = engine ?? "claude";
  if (effectiveEngine !== "acp") {
    return ENGINE_ICONS[effectiveEngine];
  }
  if (agentId && agents) {
    const agent = agents.find((a) => a.id === agentId);
    if (agent) return getAgentIcon(agent);
  }
  return undefined;
}
