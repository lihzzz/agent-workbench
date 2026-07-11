import type { EngineId } from "@shared/types/engine";

/**
 * Per-engine accent colors for visually distinguishing sessions in the sidebar.
 *
 * Each engine gets a distinct hue. Values are plain CSS colors (with alpha)
 * usable directly in inline styles, so they render identically in light and
 * dark themes without depending on Tailwind theme tokens.
 *
 * ACP agents are heterogeneous (each registry agent can differ), so they share
 * a neutral violet accent — the agent's own icon already differentiates them.
 */
export interface EngineAccent {
  /** Solid accent — used for the left rail bar. */
  bar: string;
  /** Faint background tint for the icon badge and active/hover row. */
  tint: string;
  /** Slightly stronger tint for the icon badge ring. */
  ring: string;
}

const ACCENTS: Record<EngineId, EngineAccent> = {
  // Claude — warm amber/orange (matches the Anthropic brand mark).
  claude: {
    bar: "#d97757",
    tint: "rgba(217, 119, 87, 0.14)",
    ring: "rgba(217, 119, 87, 0.45)",
  },
  // Codex — cool teal/cyan, clearly separated from Claude's warm tone.
  codex: {
    bar: "#2da8a8",
    tint: "rgba(45, 168, 168, 0.14)",
    ring: "rgba(45, 168, 168, 0.45)",
  },
  // ACP agents — neutral violet; the agent's own icon carries identity.
  acp: {
    bar: "#8b7cf6",
    tint: "rgba(139, 124, 246, 0.14)",
    ring: "rgba(139, 124, 246, 0.45)",
  },
  // OpenCode — green terminal accent.
  opencode: {
    bar: "#35a56f",
    tint: "rgba(53, 165, 111, 0.14)",
    ring: "rgba(53, 165, 111, 0.45)",
  },
};

/** Resolve the accent palette for a session's engine (defaults to Claude). */
export function getEngineAccent(engine: EngineId | undefined): EngineAccent {
  return ACCENTS[engine ?? "claude"] ?? ACCENTS.claude;
}
