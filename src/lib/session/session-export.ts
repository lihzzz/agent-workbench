import type { PersistedSession, Project, UIMessage, SubagentToolStep } from "@/types";
import {
  extractResultText,
  formatInput,
  stripAnsi,
} from "@/components/lib/tool-formatting";

export type ExportFormat = "markdown" | "json" | "html";

export const EXPORT_FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  markdown: "md",
  json: "json",
  html: "html",
};

interface ExportOptions {
  /** Whether to inline base64 image attachments. When false, images are listed as placeholders. */
  inlineImages?: boolean;
  /** Whether to include assistant thinking blocks. */
  includeThinking?: boolean;
}

const DEFAULT_OPTIONS: Required<ExportOptions> = {
  inlineImages: true,
  includeThinking: true,
};

// ── Shared helpers ──

/** Strip `<file>`, `<folder>`, and `<element>` XML context blocks from user message text. */
function stripFileContext(text: string): string {
  return text
    .replace(/<file[^>]*>[\s\S]*?<\/file>/g, "")
    .replace(/<folder[^>]*>[\s\S]*?<\/folder>/g, "")
    .replace(/<element[^>]*>[\s\S]*?<\/element>/g, "")
    .trim();
}

/** The user-visible text for a message: prefer displayContent, fall back to stripped content. */
function userVisibleText(message: UIMessage): string {
  if (typeof message.displayContent === "string") return message.displayContent.trim();
  return stripFileContext(message.content);
}

function formatTimestamp(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toISOString();
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

/** Sanitize a string for safe use as a filename across platforms. */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim()
    .slice(0, 80) || "session";
}

export function buildExportFilename(session: PersistedSession, format: ExportFormat): string {
  const title = sanitizeFileName(session.title || "Untitled");
  const date = session.createdAt ? new Date(session.createdAt).toISOString().slice(0, 10) : "session";
  return `${date}-${title}.${EXPORT_FORMAT_EXTENSIONS[format]}`;
}

// ── Markdown ──

function renderToolStep(step: SubagentToolStep, indent: string): string {
  const lines: string[] = [];
  lines.push(`${indent}- **${step.toolName}**`);
  const input = step.toolInput ? formatInput(step.toolInput) : "";
  if (input) {
    lines.push(`${indent}  \`\`\``);
    for (const line of input.split("\n")) lines.push(`${indent}  ${line}`);
    lines.push(`${indent}  \`\`\``);
  }
  return lines.join("\n");
}

function renderToolCall(message: UIMessage): string {
  const lines: string[] = [];
  const toolName = message.toolName ?? "tool";
  lines.push(`> 🔧 **Tool call:** \`${toolName}\``);

  if (message.toolInput) {
    const input = formatInput(message.toolInput);
    if (input) {
      lines.push("");
      lines.push("```");
      lines.push(input);
      lines.push("```");
    }
  }

  const resultText = stripAnsi(extractResultText(message.toolResult)).trim();
  if (resultText) {
    lines.push("");
    lines.push("<details><summary>Result</summary>");
    lines.push("");
    lines.push("```");
    lines.push(resultText);
    lines.push("```");
    lines.push("");
    lines.push("</details>");
  }

  if (message.subagentSteps && message.subagentSteps.length > 0) {
    lines.push("");
    lines.push("Subagent steps:");
    for (const step of message.subagentSteps) {
      lines.push(renderToolStep(step, ""));
    }
  }

  return lines.join("\n");
}

function renderMessageMarkdown(message: UIMessage, opts: Required<ExportOptions>): string | null {
  switch (message.role) {
    case "user": {
      const text = userVisibleText(message);
      const parts: string[] = [`### 👤 User`];
      if (text) parts.push("", text);
      if (message.images && message.images.length > 0) {
        parts.push("");
        for (const img of message.images) {
          const name = img.fileName ?? "image";
          if (opts.inlineImages) {
            parts.push(`![${name}](data:${img.mediaType};base64,${img.data})`);
          } else {
            parts.push(`*[image attachment: ${name}]*`);
          }
        }
      }
      return parts.join("\n");
    }
    case "assistant": {
      const parts: string[] = [`### 🤖 Assistant`];
      if (opts.includeThinking && message.thinking && message.thinking.trim()) {
        parts.push("");
        parts.push("<details><summary>Thinking</summary>");
        parts.push("");
        parts.push(message.thinking.trim());
        parts.push("");
        parts.push("</details>");
      }
      const text = message.content.trim();
      if (text) {
        parts.push("");
        parts.push(text);
      }
      return parts.join("\n");
    }
    case "tool_call":
      return renderToolCall(message);
    case "tool_result": {
      const text = stripAnsi(extractResultText(message.toolResult)).trim() || message.content.trim();
      if (!text) return null;
      return ["> 📤 **Tool result:**", "", "```", text, "```"].join("\n");
    }
    case "summary": {
      const text = message.content.trim();
      if (!text) return null;
      return [`### 📝 Summary`, "", text].join("\n");
    }
    case "system": {
      const text = message.content.trim();
      if (!text) return null;
      const prefix = message.isError ? "⚠️ " : "";
      return `> ${prefix}_${text.replace(/\n/g, " ")}_`;
    }
    default:
      return null;
  }
}

export function sessionToMarkdown(
  session: PersistedSession,
  project?: Project,
  options: ExportOptions = {},
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const header: string[] = [];
  header.push(`# ${session.title || "Untitled session"}`);
  header.push("");

  const meta: string[] = [];
  if (project) meta.push(`- **Project:** ${project.name}`);
  if (session.engine) meta.push(`- **Engine:** ${session.engine}`);
  if (session.model) meta.push(`- **Model:** ${session.model}`);
  if (session.createdAt) meta.push(`- **Created:** ${formatTimestamp(session.createdAt)}`);
  meta.push(`- **Total cost:** ${formatCost(session.totalCost ?? 0)}`);
  meta.push(`- **Messages:** ${session.messages.length}`);
  header.push(...meta);
  header.push("");
  header.push("---");

  const body: string[] = [];
  for (const message of session.messages) {
    const rendered = renderMessageMarkdown(message, opts);
    if (rendered) body.push(rendered);
  }

  return [header.join("\n"), body.join("\n\n")].join("\n\n") + "\n";
}

// ── JSON ──

export function sessionToJson(session: PersistedSession): string {
  return JSON.stringify(session, null, 2);
}

// ── HTML ──

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function sessionToHtml(
  session: PersistedSession,
  project?: Project,
  options: ExportOptions = {},
): string {
  const markdown = sessionToMarkdown(session, project, options);
  const title = escapeHtml(session.title || "Untitled session");
  // Embed raw markdown in a <pre> wrapper — keeps the export dependency-free.
  // Renderers/viewers that want rich HTML can post-process; this guarantees a
  // self-contained, readable artifact without bundling a markdown engine here.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.6; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  pre { white-space: pre-wrap; word-wrap: break-word; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; }
  @media (prefers-color-scheme: dark) { body { background: #0d0d0d; color: #e6e6e6; } }
</style>
</head>
<body>
<pre>${escapeHtml(markdown)}</pre>
</body>
</html>
`;
}

// ── Dispatch ──

export function exportSession(
  session: PersistedSession,
  format: ExportFormat,
  project?: Project,
  options: ExportOptions = {},
): string {
  switch (format) {
    case "markdown":
      return sessionToMarkdown(session, project, options);
    case "json":
      return sessionToJson(session);
    case "html":
      return sessionToHtml(session, project, options);
  }
}
