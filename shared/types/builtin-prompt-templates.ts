import type { PromptTemplate } from "@shared/types/prompt-template";

/**
 * App-shipped default prompt templates. Seeded on first run; users can edit or
 * disable them, but deleting one resets it to the definition here.
 */
export const BUILTIN_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "review-changes",
    name: "Review changes",
    description: "Ask for a code review of the current diff",
    body: "Review the current changes for correctness bugs, edge cases, and security issues. Focus on {{area}}. List findings by severity with file:line and a concrete fix.",
    icon: "🔍",
    enabled: true,
    builtIn: true,
  },
  {
    id: "write-tests",
    name: "Write tests",
    description: "Ask to add tests for a target",
    body: "Write tests for {{target}}. Match the project's existing test framework and style, cover the happy path, edge cases, and error handling, then run the suite and report results.",
    icon: "🧪",
    enabled: true,
    builtIn: true,
  },
  {
    id: "summarize-file",
    name: "Summarize",
    description: "Summarize a file or topic concisely",
    body: "Read {{path}} and give a concise summary: a one-line TL;DR, then the key points and takeaways. Preserve important specifics.",
    icon: "📄",
    enabled: true,
    builtIn: true,
  },
];

export const BUILTIN_TEMPLATE_IDS = new Set(BUILTIN_PROMPT_TEMPLATES.map((t) => t.id));
