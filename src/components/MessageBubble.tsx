import { lazy, memo, Suspense, useState, useMemo, type ReactNode } from "react";
import { AlertCircle, Clock, Crosshair, File, Folder, Info, RotateCcw, Send, Undo2, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useStreamingTextReveal } from "@/hooks/useStreamingTextReveal";
import { parseLeakedToolCalls } from "@/lib/engine/leaked-tool-parse";
import type { UIMessage, ImageAttachment } from "@/types";
import { ImageLightbox } from "./ImageLightbox";
import {
  CHAT_CONTENT_STACK_CLASS,
  CHAT_PROSE_EDGE_CLASS,
  CHAT_ROW_CLASS,
} from "@/components/lib/chat-layout";

const MarkdownContent = lazy(() =>
  import("./MarkdownContent").then((mod) => ({ default: mod.MarkdownContent })),
);
const ThinkingBlock = lazy(() =>
  import("./ThinkingBlock").then((mod) => ({ default: mod.ThinkingBlock })),
);

/** Strip `<file path="...">...</file>` and `<folder path="...">...</folder>` context blocks from user messages */
function stripFileContext(text: string): string {
  let result = text.replace(/<file path="[^"]*">[\s\S]*?<\/file>\s*/g, "");
  result = result.replace(/<folder path="[^"]*">[\s\S]*?<\/folder>\s*/g, "");
  result = result.replace(/<element [^>]*>[\s\S]*?<\/element>\s*/g, "");
  return result.trim();
}

/** Render @path references and grabbed-element markers as styled inline badges */
function renderWithMentions(text: string): ReactNode[] {
  // Match @path/to/file, @path/to/dir/, or [[element:...]]
  const parts = text.split(/(@[\w./_-]+\/?|\[\[element:[^\]]+\]\])/g);
  return parts.map((part, i) => {
    const browserMatch = /^\[\[element:(.+)\]\]$/.exec(part);
    if (browserMatch) {
      return (
        <span
          key={i}
          className="inline-flex items-baseline gap-0.5 rounded bg-blue-500/15 px-1 py-px font-mono text-xs text-blue-300"
        >
          <Crosshair className="inline h-3 w-3 shrink-0 self-center" />
          {browserMatch[1]}
        </span>
      );
    }
    if (part.startsWith("@") && part.length > 1) {
      const filePath = part.slice(1);
      const isDir = filePath.endsWith("/");
      return (
        <span
          key={i}
          className="inline-flex items-baseline gap-0.5 rounded bg-accent/50 px-1 py-px font-mono text-xs text-accent-foreground"
        >
          {isDir ? (
            <Folder className="inline h-3 w-3 shrink-0 self-center text-blue-400" />
          ) : (
            <File className="inline h-3 w-3 shrink-0 self-center text-muted-foreground" />
          )}
          {filePath}
        </span>
      );
    }
    return part;
  });
}

interface MessageBubbleProps {
  message: UIMessage;
  showThinking?: boolean;
  assistantTurnDividerLabel?: string;
  isContinuation?: boolean;
  /** True when this queued message is the prioritized "send next" item */
  isSendNextQueued?: boolean;
  /** Called when user clicks "Revert files only" — restores files to state before this message */
  onRevert?: (checkpointId: string) => void;
  /** Called when user clicks "Revert files + chat" — restores files AND truncates conversation */
  onFullRevert?: (checkpointId: string) => void;
  /** Called when user clicks "Send next" on a queued user message */
  onSendQueuedNow?: (messageId: string) => void;
  /** Called when user removes a queued user message before it is sent */
  onUnqueueQueued?: (messageId: string) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  showThinking = true,
  assistantTurnDividerLabel,
  isContinuation,
  isSendNextQueued = false,
  onRevert,
  onFullRevert,
  onSendQueuedNow,
  onUnqueueQueued,
}: MessageBubbleProps) {
  // All hooks must be called before any early returns (Rules of Hooks)
  const isUser = message.role === "user";
  const [viewingImage, setViewingImage] = useState<ImageAttachment | null>(null);
  const time = useMemo(() => new Date(message.timestamp).toLocaleTimeString(), [message.timestamp]);
  const displayContent = useMemo(() => isUser ? (message.displayContent ?? stripFileContext(message.content)) : message.content, [isUser, message.content, message.displayContent]);

  // Defensive last line of defense: if leaked tool-call markup ever reaches the
  // assistant content (e.g. a path that bypassed useClaude's parsing), strip it
  // here so raw <invoke> XML never renders as markdown.
  const assistantContent = useMemo(
    () => (message.role === "assistant" ? parseLeakedToolCalls(message.content).cleanedText : message.content),
    [message.role, message.content],
  );

  // Per-token fade-in animation via DOM surgery in useLayoutEffect.
  // Always renders ReactMarkdown (real-time markdown parsing) — the hook
  // splits trailing text nodes into [old | animated-new] before each paint.
  const proseRef = useStreamingTextReveal(
    message.role === "assistant" ? message.isStreaming : undefined,
    message.role === "assistant" ? message.content : "",
  );

  if (message.role === "system") {
    const isError = message.isError;
    return (
      <div className={cn(
        "mx-auto max-w-3xl px-4 py-1 text-center text-xs",
        isError ? "text-destructive" : "text-muted-foreground",
      )}>
        <div className="inline-flex items-center gap-1.5">
          {isError ? <AlertCircle className="h-3 w-3" /> : <Info className="h-3 w-3" />}
          {message.content}
        </div>
      </div>
    );
  }

  if (isUser) {
    const checkpointId = message.checkpointId;
    const canRevert = !!checkpointId && (!!onRevert || !!onFullRevert);
    return (
      <div className={cn("group/user flex justify-end", CHAT_ROW_CLASS, message.isQueued && "opacity-60")}>
        <div className={cn("relative max-w-[var(--chat-user-message-max-width,80%)]", canRevert && "pb-5")}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={cn(
                "rounded-2xl rounded-tr-sm bg-primary/15 px-3.5 py-2 text-sm text-foreground wrap-break-word whitespace-pre-wrap ring-1 ring-inset ring-primary/20",
                message.isQueued && !isSendNextQueued && "border border-dashed border-foreground/10",
                message.isQueued && isSendNextQueued && "border border-dashed border-red-400/50",
              )}>
                {message.images && message.images.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {message.images.map((img) => (
                      <img
                        key={img.id}
                        src={`data:${img.mediaType};base64,${img.data}`}
                        alt={img.fileName ?? "attached image"}
                        className="max-h-48 cursor-pointer rounded-lg transition-opacity hover:opacity-90"
                        onClick={() => setViewingImage(img)}
                      />
                    ))}
                  </div>
                )}
                <ImageLightbox
                  image={viewingImage}
                  open={!!viewingImage}
                  onOpenChange={(isOpen) => { if (!isOpen) setViewingImage(null); }}
                />
                {renderWithMentions(displayContent)}
                {message.isQueued && (
                  <div className="mt-2 flex items-center gap-2 border-t border-foreground/[0.06] pt-2 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3 shrink-0" />
                    <span>Queued</span>
                    {(onSendQueuedNow || onUnqueueQueued) && (
                      <div className="ms-auto flex items-center gap-1">
                        {onSendQueuedNow && (
                          <button
                            type="button"
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all",
                              isSendNextQueued
                                ? "bg-primary/15 text-primary hover:bg-primary/25"
                                : "text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground",
                            )}
                            onClick={() => onSendQueuedNow(message.id)}
                          >
                            <Send className="h-2.5 w-2.5" />
                            Send next
                          </button>
                        )}
                        {onUnqueueQueued && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => onUnqueueQueued(message.id)}
                          >
                            <X className="h-2.5 w-2.5" />
                            Unqueue
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p className="text-xs">{time}</p>
            </TooltipContent>
          </Tooltip>
          {/* Revert dropdown — visible on hover, offers file-only or full (files + chat) revert */}
          {canRevert && (
            <div className="pointer-events-none absolute end-0 -bottom-0.5 w-max opacity-0 transition-opacity group-hover/user:opacity-100">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="pointer-events-auto flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] text-foreground/30 transition-colors hover:text-foreground/60">
                    <Undo2 className="h-3 w-3" />
                    Revert to here
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {onRevert && (
                    <DropdownMenuItem onClick={() => onRevert(checkpointId)}>
                      <Undo2 className="h-3.5 w-3.5 me-2" />
                      Revert files only
                    </DropdownMenuItem>
                  )}
                  {onFullRevert && (
                    <DropdownMenuItem onClick={() => onFullRevert(checkpointId)}>
                      <RotateCcw className="h-3.5 w-3.5 me-2" />
                      Revert files + chat
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Assistant message — always render with ReactMarkdown.
  // Previously this used IntersectionObserver to defer markdown parsing for
  // off-screen messages, but that caused messages to render as plain text
  // (showing literal # and * characters) when the observer didn't fire
  // reliably — e.g. after session switch-back, persistence restore, or within
  // Radix ScrollArea. Always rendering markdown is fast enough for individual
  // messages; for truly long chats, proper virtualization should be used instead.
  const hasRenderableAssistantContent = !!message.content || (showThinking && !!message.thinking);
  if (!hasRenderableAssistantContent) {
    return null;
  }

  return (
    <div
      className={cn("flex justify-start", CHAT_ROW_CLASS)}
      data-continuation={isContinuation || undefined}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("min-w-0 max-w-[var(--chat-assistant-message-max-width,85%)]", assistantTurnDividerLabel && "w-full")}>
            <div className={cn("flow-root wrap-break-word", CHAT_CONTENT_STACK_CLASS, assistantTurnDividerLabel ? "w-full" : "min-w-0")}>
            {assistantTurnDividerLabel ? (
              <div className="relative mb-3 w-full text-center text-[11px] text-muted-foreground/70">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-foreground/[0.08]" />
                <span className="relative inline-block bg-background px-3 font-medium">
                  {assistantTurnDividerLabel}
                </span>
              </div>
            ) : null}
              <div className={assistantTurnDividerLabel ? "inline-block min-w-0 max-w-full" : undefined}>
                {showThinking && message.thinking && (
                  <Suspense fallback={null}>
                    <ThinkingBlock
                      thinking={message.thinking}
                      isStreaming={message.isStreaming}
                      thinkingComplete={message.thinkingComplete}
                      storageKey={`thinking:${message.id}`}
                    />
                  </Suspense>
                )}
                {assistantContent ? (
                  <div
                    ref={proseRef}
                    className={cn(
                      "flow-root prose dark:prose-invert prose-sm max-w-none text-foreground [&_li::marker]:text-foreground dark:[&_li::marker]:text-foreground/70",
                      CHAT_PROSE_EDGE_CLASS,
                    )}
                  >
                    <Suspense fallback={<span className="whitespace-pre-wrap">{assistantContent}</span>}>
                      <MarkdownContent
                        content={assistantContent}
                        isStreaming={!!message.isStreaming}
                      />
                    </Suspense>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="text-xs">{time}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}, (prev, next) =>
  prev.message.content === next.message.content &&
  prev.message.thinking === next.message.thinking &&
  prev.message.isStreaming === next.message.isStreaming &&
  prev.message.thinkingComplete === next.message.thinkingComplete &&
  prev.message.images === next.message.images &&
  prev.message.isError === next.message.isError &&
  prev.message.checkpointId === next.message.checkpointId &&
  prev.message.isQueued === next.message.isQueued &&
  prev.assistantTurnDividerLabel === next.assistantTurnDividerLabel &&
  prev.isSendNextQueued === next.isSendNextQueued &&
  prev.showThinking === next.showThinking &&
  prev.isContinuation === next.isContinuation &&
  prev.onRevert === next.onRevert &&
  prev.onFullRevert === next.onFullRevert &&
  prev.onSendQueuedNow === next.onSendQueuedNow &&
  prev.onUnqueueQueued === next.onUnqueueQueued,
);
