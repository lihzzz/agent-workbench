import type { SlashCommand } from "@/types";
import type { AcceptedMediaType } from "./constants";
import { ACCEPTED_IMAGE_TYPES } from "./constants";

const BLANK_AUDIO_PLACEHOLDER_RE = /\[BLANK_AUDIO\]/gi;

/** Read a file as base64 data with its media type. */
export function readFileAsBase64(
  file: globalThis.File,
): Promise<{ data: string; mediaType: AcceptedMediaType }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve({ data: base64, mediaType: file.type as AcceptedMediaType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Check if a file has an accepted image MIME type. */
export function isAcceptedImage(file: globalThis.File): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type);
}

/** Insert text at the current cursor position in a contentEditable element. */
export function insertTextAtCursor(
  el: HTMLElement | null,
  text: string,
): void {
  if (!el) return;
  el.focus();

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    // No cursor -- append to end
    el.appendChild(document.createTextNode(text));
  } else {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    // Move cursor after inserted text
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Trigger input handler so hasContent updates and send button enables
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Replace the entire contents of a contentEditable element with `text`,
 * placing the caret at the end. Used for CLI-style history recall.
 * Mirrors the DOM-write pattern in CommandPicker.selectCommand and dispatches
 * an `input` event so `hasContent` recomputes.
 */
export function setEditableText(el: HTMLElement | null, text: string): void {
  if (!el) return;
  el.textContent = text;

  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(el);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);
  el.focus();

  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Get the caret's bounding rect, or null when it can't be determined. */
function getCaretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  let rect = range.getBoundingClientRect();
  // Collapsed ranges at line boundaries can report an empty rect; insert a
  // temporary marker to obtain a reliable position.
  if (rect.width === 0 && rect.height === 0) {
    const marker = document.createElement("span");
    marker.textContent = "​";
    range.insertNode(marker);
    rect = marker.getBoundingClientRect();
    const parent = marker.parentNode;
    parent?.removeChild(marker);
    parent?.normalize();
  }
  if (rect.width === 0 && rect.height === 0) return null;
  return rect;
}

const CARET_LINE_TOLERANCE = 4;

/**
 * Whether the caret sits on the first visual line of the editable. Used to
 * gate Up-arrow history recall so the key still moves the caret normally on
 * lower lines. Returns true when there is no selection/content.
 */
export function isCaretOnFirstLine(el: HTMLElement | null): boolean {
  if (!el) return true;
  const caret = getCaretRect();
  if (!caret) return true;
  const box = el.getBoundingClientRect();
  return caret.top - box.top <= CARET_LINE_TOLERANCE;
}

/**
 * Whether the caret sits on the last visual line of the editable. Used to gate
 * Down-arrow history recall. Returns true when there is no selection/content.
 */
export function isCaretOnLastLine(el: HTMLElement | null): boolean {
  if (!el) return true;
  const caret = getCaretRect();
  if (!caret) return true;
  const box = el.getBoundingClientRect();
  return box.bottom - caret.bottom <= CARET_LINE_TOLERANCE;
}


/** Fast non-whitespace check that short-circuits early for typical prompts. */
export function hasMeaningfulText(text: string): boolean {
  const sanitized = stripVoicePlaceholderText(text);
  for (let i = 0; i < sanitized.length; i++) {
    const code = sanitized.charCodeAt(i);
    if (
      code !== 32 && // space
      code !== 9 && // tab
      code !== 10 && // \n
      code !== 13 && // \r
      code !== 11 && // vertical tab
      code !== 12 && // form feed
      code !== 160 // nbsp
    ) {
      return true;
    }
  }
  return false;
}

/** Remove placeholder text inserted by native dictation when no speech was captured. */
export function stripVoicePlaceholderText(text: string): string {
  return text.replace(BLANK_AUDIO_PLACEHOLDER_RE, "");
}

/** Extract full text + mention paths from a contentEditable element. */
export function extractEditableContent(el: HTMLElement): {
  text: string;
  mentionPaths: string[];
  deepMentionPaths: Set<string>;
} {
  let text = "";
  const mentionPaths: string[] = [];
  const deepMentionPaths = new Set<string>();
  const BLOCK_TAGS = new Set([
    "DIV",
    "P",
    "LI",
    "PRE",
    "BLOCKQUOTE",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
  ]);

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    } else if (node instanceof HTMLElement) {
      const mentionPath = node.dataset.mentionPath;
      if (mentionPath) {
        const isDeep = node.dataset.mentionDeep === "true";
        text += `@${isDeep ? "#" : ""}${mentionPath}`;
        mentionPaths.push(mentionPath);
        if (isDeep) {
          deepMentionPaths.add(mentionPath);
        }
      } else if (node.tagName === "BR") {
        text += "\n";
      } else {
        for (const child of node.childNodes) walk(child);
        // Preserve line boundaries when the editor stores rows as block nodes.
        if (BLOCK_TAGS.has(node.tagName) && !text.endsWith("\n")) {
          text += "\n";
        }
      }
    }
  };

  for (const child of el.childNodes) walk(child);
  return {
    text: stripVoicePlaceholderText(
      text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " "),
    ),
    mentionPaths: [...new Set(mentionPaths)],
    deepMentionPaths,
  };
}

/** Simple fuzzy match: all query chars must appear in order. */
export function fuzzyMatch(
  query: string,
  target: string,
): { match: boolean; score: number } {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (t.startsWith(q)) return { match: true, score: 100 + 1 / target.length };
  if (t.includes(q)) return { match: true, score: 50 + 1 / target.length };

  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  if (qi === q.length)
    return { match: true, score: 10 + qi / target.length };

  return { match: false, score: 0 };
}

// ── Slash command helpers (exported for tests + external consumers) ──

export const LOCAL_CLEAR_COMMAND: SlashCommand = {
  name: "clear",
  description: "Open a new chat without sending anything to the agent",
  argumentHint: "",
  source: "local",
};

export const LOCAL_COMPACT_COMMAND: SlashCommand = {
  name: "compact",
  description: "Compact the current conversation context",
  argumentHint: "",
  source: "local",
};

export type CommandPrefix = "/" | "$";

export function getCommandPrefix(cmd: SlashCommand): CommandPrefix {
  return cmd.source === "codex-skill" || cmd.source === "codex-app"
    ? "$"
    : "/";
}

interface GetAvailableSlashCommandsOptions {
  includeCompact?: boolean;
}

export function getAvailableSlashCommands(
  slashCommands?: SlashCommand[],
  options: GetAvailableSlashCommandsOptions = {},
): SlashCommand[] {
  const localCommands = [LOCAL_CLEAR_COMMAND];
  if (options.includeCompact) localCommands.push(LOCAL_COMPACT_COMMAND);

  const localSlashNames = new Set(localCommands.map((cmd) => cmd.name));
  const commands =
    slashCommands?.filter(
      (cmd) => getCommandPrefix(cmd) !== "/" || !localSlashNames.has(cmd.name),
    ) ?? [];
  return [...localCommands, ...commands];
}

export function isClearCommandText(text: string): boolean {
  return text.trim() === `/${LOCAL_CLEAR_COMMAND.name}`;
}

export function isCompactCommandText(text: string): boolean {
  return text.trim() === `/${LOCAL_COMPACT_COMMAND.name}`;
}

export function getSlashCommandReplacement(cmd: SlashCommand): string {
  switch (cmd.source) {
    case "claude":
    case "acp":
    case "codex":
      return `/${cmd.name} `;
    case "codex-skill":
      return cmd.defaultPrompt
        ? `$${cmd.name} ${cmd.defaultPrompt}`
        : `$${cmd.name} `;
    case "codex-app":
      return `$${cmd.appSlug ?? cmd.name} `;
    case "local":
      // Local commands execute directly, so keep the exact command text with no trailing space.
      return `/${cmd.name}`;
    case "template":
      // Templates insert their raw body; the picker handles {{variable}} forms upstream.
      return cmd.templateBody ?? "";
  }
}

// ── In-source tests ──

if (import.meta.vitest) {
  const { it, describe, expect } = import.meta.vitest;

  describe("extractEditableContent", () => {
    it("extracts shallow mention paths from data attributes", () => {
      const container = document.createElement("div");
      const mention = document.createElement("span");
      mention.dataset.mentionPath = "foo/bar";
      container.appendChild(mention);

      const result = extractEditableContent(container);

      expect(result.text).toBe("@foo/bar");
      expect(result.mentionPaths).toEqual(["foo/bar"]);
      expect(result.deepMentionPaths.size).toBe(0);
    });

    it("extracts deep mention paths and formats text with @# prefix", () => {
      const container = document.createElement("div");
      const block = document.createElement("div");
      const deepMention = document.createElement("span");

      deepMention.dataset.mentionPath = "space/123";
      deepMention.dataset.mentionDeep = "true";

      block.appendChild(document.createTextNode("See "));
      block.appendChild(deepMention);
      container.appendChild(block);

      const result = extractEditableContent(container);

      // Block elements append a trailing newline.
      expect(result.text).toBe("See @#space/123\n");
      expect(result.mentionPaths).toEqual(["space/123"]);
      expect(result.deepMentionPaths.has("space/123")).toBe(true);
    });

  });
}
