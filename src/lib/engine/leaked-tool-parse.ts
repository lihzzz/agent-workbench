/**
 * Detect and parse tool-call function-call syntax that a model has mistakenly
 * emitted as plain *text* instead of as a structured `tool_use` content block.
 *
 * This is a known LLM failure mode that worsens with long context / after
 * context compaction: the model "forgets" the tool-use framing and writes the
 * raw invocation markup into its text reply, e.g.
 *
 *   call <invoke name="Bash">
 *     <parameter name="command">ls scripts/</parameter>
 *     <parameter name="description">List scripts directory</parameter>
 *   </invoke>
 *
 * The SDK forwards this as a `text_delta`, so the renderer would otherwise show
 * the raw XML verbatim. These helpers let the UI recover: strip the markup from
 * the visible text and reconstruct synthetic (un-executed) tool-call cards.
 *
 * Tolerant of optional namespace prefixes (e.g. `antml:invoke`) and of the
 * `<function_calls>` wrapper the markup is sometimes nested in.
 */

/** A tool call recovered from leaked text. Shaped to match `tool_use.input`. */
export interface LeakedToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface LeakedParseResult {
  /** Visible text with all tool-call markup removed. */
  cleanedText: string;
  /** Tool calls reconstructed from the leaked markup, in document order. */
  calls: LeakedToolCall[];
}

// Matches a full <invoke name="...">...</invoke> block, optional ns prefix.
const INVOKE_RE = /<(?:[\w-]+:)?invoke\s+name="([^"]*)"\s*>([\s\S]*?)<\/(?:[\w-]+:)?invoke\s*>/gi;
// Matches a <parameter name="...">value</parameter> inside an invoke body.
const PARAM_RE = /<(?:[\w-]+:)?parameter\s+name="([^"]*)"\s*>([\s\S]*?)<\/(?:[\w-]+:)?parameter\s*>/gi;
// Wrapper tags + dangling "call" lead-in word that sometimes accompany the markup.
const WRAPPER_RE = /<\/?(?:[\w-]+:)?function_calls\s*>/gi;
const DANGLING_CALL_RE = /(^|\n)[ \t]*call[ \t]*(?=<(?:[\w-]+:)?invoke\b)/gi;
// Cheap pre-check so the regex scan only runs when markup is actually present.
const QUICK_PROBE = "name=";

/**
 * Fast, allocation-free pre-check. Avoids running the regex on every streaming
 * frame for the common case where no leaked markup is present.
 */
export function hasLeakedToolCall(text: string): boolean {
  if (!text) return false;
  // Must contain an invoke open tag with a name attribute.
  const lower = text.toLowerCase();
  const idx = lower.indexOf("invoke");
  return idx !== -1 && lower.includes(QUICK_PROBE, idx);
}

/** Coerce a raw parameter string into a value, preserving JSON when valid. */
function coerceParamValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  // Only attempt JSON parse for clearly-structured values to avoid turning
  // shell commands or prose into numbers/booleans unexpectedly.
  const first = trimmed[0];
  if (first === "{" || first === "[") {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      /* fall through to raw string */
    }
  }
  return trimmed;
}

/**
 * Parse leaked tool-call markup out of `text`.
 *
 * Returns the text with all markup stripped (`cleanedText`) plus the
 * reconstructed tool calls. When no markup is present, `cleanedText === text`
 * (referential identity preserved) and `calls` is empty.
 */
export function parseLeakedToolCalls(text: string): LeakedParseResult {
  if (!hasLeakedToolCall(text)) return { cleanedText: text, calls: [] };

  const calls: LeakedToolCall[] = [];

  INVOKE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INVOKE_RE.exec(text)) !== null) {
    const name = match[1]?.trim();
    if (!name) continue;
    const body = match[2] ?? "";
    const input: Record<string, unknown> = {};
    PARAM_RE.lastIndex = 0;
    let pm: RegExpExecArray | null;
    while ((pm = PARAM_RE.exec(body)) !== null) {
      const key = pm[1]?.trim();
      if (!key) continue;
      input[key] = coerceParamValue(pm[2] ?? "");
    }
    calls.push({ name, input });
  }

  if (calls.length === 0) return { cleanedText: text, calls: [] };

  // Strip dangling "call" lead-ins FIRST (they anchor on the following
  // <invoke>, which the next step removes), then the invoke blocks and wrapper
  // tags, then tidy the whitespace the removal leaves behind.
  const cleanedText = text
    .replace(DANGLING_CALL_RE, "$1")
    .replace(INVOKE_RE, "")
    .replace(WRAPPER_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanedText, calls };
}

/**
 * Streaming-display variant. Strips fully-closed invoke blocks AND hides a
 * trailing *unclosed* invoke/function_calls block that is still arriving, so
 * half-written markup never flashes as raw text mid-stream. Cheap no-op when
 * no markup is present (referential identity preserved).
 */
export function stripStreamingLeak(text: string): string {
  if (!hasLeakedToolCall(text)) return text;
  let out = parseLeakedToolCalls(text).cleanedText;
  // Drop any trailing, not-yet-closed opening tag (invoke/function_calls) and
  // a dangling "call" lead-in, which the closed-block parser cannot remove yet.
  const openIdx = out.search(/(?:\n[ \t]*call[ \t]*)?<(?:[\w-]+:)?(?:invoke|function_calls)\b[^]*$/i);
  if (openIdx !== -1) out = out.slice(0, openIdx).trimEnd();
  return out;
}
