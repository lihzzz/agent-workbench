import { describe, it, expect } from "vitest";
import {
  sessionToMarkdown,
  sessionToJson,
  sessionToHtml,
  buildExportFilename,
  exportSession,
} from "./session-export";
import type { PersistedSession, Project, UIMessage } from "@/types";

function msg(partial: Partial<UIMessage> & Pick<UIMessage, "role">): UIMessage {
  return {
    id: Math.random().toString(36).slice(2),
    content: "",
    timestamp: 1_700_000_000_000,
    ...partial,
  };
}

function makeSession(messages: UIMessage[], overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    id: "sess-1",
    projectId: "proj-1",
    title: "My Session",
    createdAt: Date.parse("2026-06-15T00:00:00.000Z"),
    totalCost: 0.1234,
    engine: "claude",
    model: "claude-opus-4",
    messages,
    ...overrides,
  };
}

const PROJECT: Project = {
  id: "proj-1",
  name: "Demo Project",
  path: "/tmp/demo",
  createdAt: 0,
};

describe("buildExportFilename", () => {
  it("includes date, sanitized title and extension", () => {
    const session = makeSession([]);
    expect(buildExportFilename(session, "markdown")).toBe("2026-06-15-My Session.md");
    expect(buildExportFilename(session, "json")).toBe("2026-06-15-My Session.json");
    expect(buildExportFilename(session, "html")).toBe("2026-06-15-My Session.html");
  });

  it("strips illegal filename characters", () => {
    const session = makeSession([], { title: "a/b:c*d?\"e<f>g|h" });
    const name = buildExportFilename(session, "markdown");
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name.endsWith(".md")).toBe(true);
  });

  it("falls back to 'Untitled' for an empty title", () => {
    const session = makeSession([], { title: "" });
    expect(buildExportFilename(session, "markdown")).toBe("2026-06-15-Untitled.md");
  });
});

describe("sessionToMarkdown", () => {
  it("renders a header with project, engine, model, cost and message count", () => {
    const session = makeSession([msg({ role: "user", content: "hi" })]);
    const md = sessionToMarkdown(session, PROJECT);
    expect(md).toContain("# My Session");
    expect(md).toContain("**Project:** Demo Project");
    expect(md).toContain("**Engine:** claude");
    expect(md).toContain("**Model:** claude-opus-4");
    expect(md).toContain("**Total cost:** $0.1234");
    expect(md).toContain("**Messages:** 1");
  });

  it("prefers displayContent over raw content for user messages", () => {
    const session = makeSession([
      msg({ role: "user", content: "<file>secret</file>visible", displayContent: "visible only" }),
    ]);
    const md = sessionToMarkdown(session);
    expect(md).toContain("visible only");
    expect(md).not.toContain("secret");
  });

  it("strips <file> XML when displayContent is absent (old sessions)", () => {
    const session = makeSession([
      msg({ role: "user", content: "<file path='a'>CONTENT</file>real question" }),
    ]);
    const md = sessionToMarkdown(session);
    expect(md).toContain("real question");
    expect(md).not.toContain("CONTENT");
  });

  it("renders assistant thinking in a details block when enabled", () => {
    const session = makeSession([
      msg({ role: "assistant", content: "answer", thinking: "my reasoning" }),
    ]);
    const md = sessionToMarkdown(session);
    expect(md).toContain("<details><summary>Thinking</summary>");
    expect(md).toContain("my reasoning");
    expect(md).toContain("answer");
  });

  it("omits thinking when includeThinking is false", () => {
    const session = makeSession([
      msg({ role: "assistant", content: "answer", thinking: "my reasoning" }),
    ]);
    const md = sessionToMarkdown(session, undefined, { includeThinking: false });
    expect(md).not.toContain("my reasoning");
    expect(md).toContain("answer");
  });

  it("renders tool calls with input and collapsible result", () => {
    const session = makeSession([
      msg({
        role: "tool_call",
        toolName: "Bash",
        toolInput: { command: "ls -la" },
        toolResult: { stdout: "file1\nfile2" },
      }),
    ]);
    const md = sessionToMarkdown(session);
    expect(md).toContain("`Bash`");
    expect(md).toContain("ls -la");
    expect(md).toContain("file1");
  });

  it("inlines images as data URIs by default and as placeholders when disabled", () => {
    const session = makeSession([
      msg({
        role: "user",
        content: "look",
        images: [{ id: "i1", data: "QUJD", mediaType: "image/png", fileName: "shot.png" }],
      }),
    ]);
    expect(sessionToMarkdown(session)).toContain("data:image/png;base64,QUJD");
    expect(sessionToMarkdown(session, undefined, { inlineImages: false })).toContain("[image attachment: shot.png]");
  });

  it("renders an error system message with a warning marker", () => {
    const session = makeSession([msg({ role: "system", content: "boom", isError: true })]);
    expect(sessionToMarkdown(session)).toContain("⚠️");
  });

  it("handles an empty session without throwing", () => {
    const session = makeSession([]);
    expect(() => sessionToMarkdown(session)).not.toThrow();
    expect(sessionToMarkdown(session)).toContain("# My Session");
  });
});

describe("sessionToJson", () => {
  it("round-trips the session losslessly", () => {
    const session = makeSession([msg({ role: "user", content: "hi" })]);
    const parsed = JSON.parse(sessionToJson(session));
    expect(parsed).toEqual(session);
  });
});

describe("sessionToHtml", () => {
  it("produces a self-contained HTML document with escaped content", () => {
    const session = makeSession([msg({ role: "user", content: "1 < 2 & 3 > 0" })], {
      title: "T<itle>",
    });
    const html = sessionToHtml(session);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>T&lt;itle&gt;</title>");
    expect(html).toContain("&lt;");
    expect(html).not.toContain("<script>");
  });
});

describe("exportSession dispatch", () => {
  it("dispatches to the correct format", () => {
    const session = makeSession([msg({ role: "user", content: "hi" })]);
    expect(exportSession(session, "json")).toBe(sessionToJson(session));
    expect(exportSession(session, "markdown")).toBe(sessionToMarkdown(session));
    expect(exportSession(session, "html")).toBe(sessionToHtml(session));
  });
});
