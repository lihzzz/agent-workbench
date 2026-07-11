/**
 * Custom Subagents — user-defined Claude SDK `AgentDefinition`s.
 *
 * These are *in-session* expert subagents (system prompt + tool whitelist +
 * model), NOT external ACP processes (those are `InstalledAgent` in registry.ts).
 * The main Claude agent delegates tasks to them automatically via the Task tool.
 * Claude engine only — ACP/Codex sessions ignore them.
 */

/** Persisted shape of a user-defined subagent. */
export interface CustomSubagent {
  /** Unique id — used as the key in the SDK `agents` record. */
  id: string;
  /** Display name shown in the panel. */
  name: string;
  /**
   * Natural-language description of *when to use* this subagent. Required —
   * this is what the main Claude agent reads (via the Task tool's subagent_type
   * enum) to decide whether/when to delegate. The single most important field.
   */
  description: string;
  /** The subagent's system prompt. Required. Only used when the subagent runs. */
  prompt: string;
  /** Allowed tool names. Omit/empty to inherit all tools from the parent. */
  tools?: string[];
  /** Tool names to explicitly disallow. */
  disallowedTools?: string[];
  /** Model alias ('sonnet' | 'opus' | 'haiku' | 'inherit') or full id. Omit to inherit. */
  model?: string;
  /** UI icon — emoji or lucide icon name (consumed by IconPicker / AgentIcon). */
  icon?: string;
  /** Whether to inject this subagent into sessions. Defaults to true when absent. */
  enabled?: boolean;
  /**
   * True for app-shipped defaults. Built-ins can be edited or disabled but not
   * removed — deleting one resets it to its shipped definition.
   */
  builtIn?: boolean;
}

/**
 * Conservative whitelist of built-in tool names that can be granted to a
 * subagent. Deliberately hardcoded — NOT derived from `TOOL_LABELS` (which is a
 * UI label table that both omits NotebookEdit and includes non-grantable items
 * like Think/EnterPlanMode/ExitPlanMode). Expand as verified against the SDK.
 */
export const SELECTABLE_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "WebSearch",
  "WebFetch",
  "Task",
  "TodoWrite",
  "NotebookEdit",
] as const;

export type SelectableTool = (typeof SELECTABLE_TOOLS)[number];
