import { memo, useEffect, useState } from "react";
import { AlertCircle, Archive, Loader2, MessageSquare } from "lucide-react";
import { AgentIcon } from "@/components/AgentIcon";
import { ChatUiStateProvider } from "@/components/chat-ui-state";
import { MessageBubble } from "@/components/MessageBubble";
import { ToolCall } from "@/components/ToolCall";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getSessionEngineIcon } from "@/lib/engine-icons";
import type { ChatSession, InstalledAgent, PersistedSession } from "@/types";

interface ArchivedChatPreviewProps {
  session: ChatSession | null;
  agents: InstalledAgent[];
  onClose: () => void;
}

export const ArchivedChatPreview = memo(function ArchivedChatPreview({
  session,
  agents,
  onClose,
}: ArchivedChatPreviewProps) {
  const [persisted, setPersisted] = useState<PersistedSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setPersisted(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPersisted(null);
    window.claude.sessions.load(session.projectId, session.id)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setError("This archived chat could not be found on disk.");
          return;
        }
        setPersisted(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Failed to load archived chat");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const messages = persisted?.messages ?? [];

  return (
    <Dialog open={session !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[min(82vh,760px)] w-[min(820px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/40 px-5 py-4">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-sm">
            {session ? (
              <AgentIcon
                icon={getSessionEngineIcon(session.engine, session.agentId, agents)}
                size={16}
                className="shrink-0 opacity-70"
              />
            ) : <Archive className="h-4 w-4" />}
            <span className="truncate">{session?.title ?? "Archived chat"}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">Read-only archived conversation preview.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-5">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <AlertCircle className="h-5 w-5 text-destructive/70" />
              <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <MessageSquare className="h-5 w-5 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">This chat has no messages.</p>
            </div>
          ) : (
            <ChatUiStateProvider>
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-1">
                {messages.map((message) => {
                  if (message.role === "tool_result") return null;
                  if (message.role === "tool_call") {
                    return (
                      <div key={message.id} className="px-4 py-1">
                        <ToolCall message={message} compact />
                      </div>
                    );
                  }
                  return <MessageBubble key={message.id} message={message} showThinking />;
                })}
              </div>
            </ChatUiStateProvider>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});
