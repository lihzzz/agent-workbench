import { createContext, lazy, Suspense, useContext, type CSSProperties, type HTMLAttributes, type MouseEventHandler } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./CopyButton";
import { guessLanguage } from "@/lib/languages";

const LazySyntaxHighlighter = lazy(() =>
  import("./LazySyntaxHighlighter").then((mod) => ({ default: mod.LazySyntaxHighlighter })),
);
const LazyMermaidDiagram = lazy(() =>
  import("./MermaidDiagram").then((mod) => ({ default: mod.MermaidDiagram })),
);

const REMARK_PLUGINS = [remarkGfm];

/**
 * Context to distinguish fenced code blocks (inside <pre>) from inline `code`.
 * react-markdown v10 removed the `inline` prop from the code component.
 */
const IsBlockCodeContext = createContext(false);
const IsStreamingMarkdownContext = createContext(false);

function parseFileHref(href: string): { filePath: string; line?: number } | null {
  if (!href) return null;

  try {
    const url = new URL(href);
    if (url.protocol !== "file:") return null;
    const filePath = decodeURIComponent(url.pathname);
    const hashLine = /^#L(\d+)$/i.exec(url.hash)?.[1];
    const line = hashLine ? Number(hashLine) : undefined;
    return { filePath, line };
  } catch {
    // Not an absolute URL; continue with path-like fallback.
  }

  if (
    href.startsWith("/") ||
    href.startsWith("./") ||
    href.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(href)
  ) {
    const [, pathPart, linePart] = href.match(/^(.*?)(?::(\d+))?$/) ?? [];
    if (pathPart) {
      return { filePath: pathPart, line: linePart ? Number(linePart) : undefined };
    }
  }

  return null;
}

const MD_COMPONENTS: Components = {
  a({ href, children, ...props }) {
    const onClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
      if (!href || href.startsWith("#")) return;
      event.preventDefault();
      const fileTarget = parseFileHref(href);
      if (fileTarget) {
        void window.claude.openInEditor(fileTarget.filePath, fileTarget.line);
        return;
      }
      void window.claude.openExternal(href);
    };

    return (
      <a
        {...props}
        href={href}
        onClick={onClick}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
  code: CodeBlock,
  pre({ children }) {
    return (
      <IsBlockCodeContext.Provider value={true}>
        {children}
      </IsBlockCodeContext.Provider>
    );
  },
};

const SYNTAX_STYLE: CSSProperties = {
  margin: 0,
  borderRadius: 0,
  background: "transparent",
  textShadow: "none",
  fontSize: "12px",
  padding: "12px",
};

const CODE_TAG_PROPS = { style: { background: "transparent", textShadow: "none" } };

function PlainCodeBlock({ code, style = SYNTAX_STYLE }: { code: string; style?: CSSProperties }) {
  return (
    <pre className="overflow-x-auto p-3 text-xs font-mono" style={style}>
      <code>{code}</code>
    </pre>
  );
}

function CodeBlock(props: HTMLAttributes<HTMLElement> & { node?: unknown }) {
  const { className, children } = props;
  const isBlock = useContext(IsBlockCodeContext);
  const isStreaming = useContext(IsStreamingMarkdownContext);
  const match = /language-(\w+)/.exec(String(className ?? ""));
  const code = String(children).replace(/\n$/, "");

  if (isBlock && match) {
    const language = match[1];

    if (language === "mermaid") {
      return (
        <Suspense fallback={<PlainCodeBlock code={code} />}>
          <LazyMermaidDiagram code={code} isStreaming={isStreaming} />
        </Suspense>
      );
    }

    return (
      <div className="not-prose group/code relative my-2 rounded-lg bg-foreground/[0.03] overflow-hidden" style={{ contain: "content" }}>
        <div className="flex items-center justify-between bg-foreground/[0.04] px-3 py-1">
          <span className="text-[11px] text-muted-foreground">{language}</span>
          <CopyButton text={code} className="opacity-0 transition-opacity group-hover/code:opacity-100" />
        </div>
        {isStreaming ? (
          <pre className="overflow-x-auto p-3 text-xs font-mono" style={SYNTAX_STYLE}>
            <code>{code}</code>
          </pre>
        ) : (
          <Suspense fallback={<PlainCodeBlock code={code} />}>
            <LazySyntaxHighlighter
              code={code}
              language={language}
              PreTag="div"
              customStyle={SYNTAX_STYLE}
              codeTagProps={CODE_TAG_PROPS}
            />
          </Suspense>
        )}
      </div>
    );
  }

  if (isBlock) {
    const guessedLang = !isStreaming ? guessLanguage(code) : null;
    return (
      <div className="not-prose group/code relative my-2 rounded-lg bg-foreground/[0.03] overflow-hidden" style={{ contain: "content" }}>
        <div className="flex items-center justify-between bg-foreground/[0.04] px-3 py-1">
          {guessedLang ? (
            <span className="text-[11px] text-muted-foreground">{guessedLang}</span>
          ) : (
            <span />
          )}
          <CopyButton text={code} className="opacity-0 transition-opacity group-hover/code:opacity-100" />
        </div>
        {guessedLang ? (
          <Suspense fallback={<PlainCodeBlock code={code} />}>
            <LazySyntaxHighlighter
              code={code}
              language={guessedLang}
              PreTag="div"
              customStyle={SYNTAX_STYLE}
              codeTagProps={CODE_TAG_PROPS}
            />
          </Suspense>
        ) : (
          <pre className="overflow-x-auto p-3 text-xs font-mono">
            <code>{code}</code>
          </pre>
        )}
      </div>
    );
  }

  return (
    <code className="not-prose rounded bg-foreground/[0.08] px-1.5 py-0.5 text-xs font-mono">
      {children}
    </code>
  );
}

export function MarkdownContent({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  return (
    <IsStreamingMarkdownContext.Provider value={isStreaming}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={MD_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </IsStreamingMarkdownContext.Provider>
  );
}
