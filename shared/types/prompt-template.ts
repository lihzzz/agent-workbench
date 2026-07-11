/**
 * Prompt templates — reusable, user-managed prompts with {{variable}} slots.
 *
 * Persisted via prompt-template-registry.ts (single JSON array). Surfaced in the
 * InputBar's slash-command picker; selecting one fills the input (after a
 * variable form when the body has {{slots}}).
 */

export interface PromptTemplate {
  /** Unique id — slug used as the slash-command name in the picker. */
  id: string;
  /** Display name. */
  name: string;
  /** One-line description shown in the picker. */
  description: string;
  /** Template body. May contain {{variable}} placeholders. */
  body: string;
  /** UI icon — emoji or lucide name. */
  icon?: string;
  /** Whether to show in the picker. Defaults to true when absent. */
  enabled?: boolean;
  /** True for app-shipped defaults — can be edited/disabled, delete resets it. */
  builtIn?: boolean;
}

/** Extract distinct {{variable}} names from a template body, preserving order. */
export function extractTemplateVars(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /\{\{\s*([\w-]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Replace {{var}} placeholders in body with the given values. Missing keys are left as-is. */
export function fillTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (full, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : full,
  );
}
