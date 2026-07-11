import { ArrowRight, Loader2 } from "lucide-react";
import type { ChatSession, PermissionRequest, RespondPermissionFn, UIMessage } from "@/types";
import { getNextRelayRole, getRelayRecipe } from "@/lib/session/handoff";
import { DRAFT_ID } from "@/hooks/session/types";
import { getSessionEngineIcon } from "@/lib/engine-icons";
import { AgentIcon } from "@/components/AgentIcon";
import { ChatView } from "@/components/ChatView";
import { PermissionPrompt } from "@/components/PermissionPrompt";
import { Button } from "@/components/ui/button";
import { RelayComposer } from "./RelayComposer";
import { useLaneSnapshot } from "./useLaneSnapshot";

interface RelayLaneCardProps {
  lane: ChatSession;
  isActive: boolean;
  activeMessages: UIMessage[];
  isProcessing: boolean;
  pendingPermission: PermissionRequest | null;
  respondPermission: RespondPermissionFn;
  spaceId: string;
  onActivate: (lane: ChatSession) => Promise<void>;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
  onHandoff: (lane: ChatSession) => Promise<void>;
}

export function RelayLaneCard({
  lane,
  isActive,
  activeMessages,
  isProcessing,
  pendingPermission,
  respondPermission,
  spaceId,
  onActivate,
  onSend,
  onStop,
  onHandoff,
}: RelayLaneCardProps) {
  const snapshot = useLaneSnapshot(lane, isActive, activeMessages);
  const recipe = getRelayRecipe(lane.stageRole ?? "plan");
  const canHandoff = lane.id !== DRAFT_ID && getNextRelayRole(recipe.role) !== null && !isProcessing;

  return (
    <section
      className={`flex h-full w-[min(420px,calc(100vw-2rem))] shrink-0 flex-col overflow-hidden rounded-md border bg-background ${
        isActive ? "border-foreground/25 shadow-sm" : "border-border/60 opacity-90"
      }`}
      onClick={() => { if (!isActive) void onActivate(lane); }}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/50 px-3">
        <span className="flex size-7 items-center justify-center rounded-md bg-muted/50">
          <AgentIcon icon={getSessionEngineIcon(lane.engine, lane.agentId)} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{recipe.label}</div>
          <div className="truncate text-[11px] text-muted-foreground">{lane.engine ?? "claude"}</div>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">{(lane.stageIndex ?? 0) + 1}</span>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {snapshot.loading ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
        ) : snapshot.error ? (
          <div className="m-auto max-w-64 px-4 text-center text-xs text-destructive">{snapshot.error}</div>
        ) : (
          <ChatView
            messages={snapshot.messages}
            isProcessing={isActive && isProcessing}
            showThinking
            sessionId={lane.id}
            spaceId={spaceId}
          />
        )}
      </div>

      {isActive && pendingPermission ? (
        <PermissionPrompt request={pendingPermission} onRespond={respondPermission} />
      ) : null}

      {isActive ? (
        <RelayComposer isProcessing={isProcessing} onSend={onSend} onStop={onStop} />
      ) : null}

      {canHandoff ? (
        <div className="flex shrink-0 justify-end border-t border-border/50 px-3 py-2">
          <Button size="sm" variant="ghost" onClick={(event) => { event.stopPropagation(); void onHandoff(lane); }}>
            Hand off
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </section>
  );
}
