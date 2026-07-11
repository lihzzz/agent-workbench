import { useCallback, useEffect, useRef, useState } from "react";
import { Network, X } from "lucide-react";
import type { ChatSession, PermissionRequest, RelayStageRole, RespondPermissionFn, UIMessage } from "@/types";
import type { RelayHandoffDraft } from "@/hooks/useRelayOrchestrator";
import { DRAFT_ID } from "@/hooks/session/types";
import { Button } from "@/components/ui/button";
import { RelayHandoffDialog } from "./RelayHandoffDialog";
import { RelayLaneCard } from "./RelayLaneCard";

interface RelayLanesViewProps {
  groupName: string;
  lanes: ChatSession[];
  activeLaneId: string | null;
  activeMessages: UIMessage[];
  isProcessing: boolean;
  pendingPermission: PermissionRequest | null;
  respondPermission: RespondPermissionFn;
  spaceId: string;
  onClose: () => void;
  onActivateLane: (lane: ChatSession) => Promise<void>;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
  onPrepareHandoff: (lane: ChatSession, role?: RelayStageRole) => Promise<RelayHandoffDraft | null>;
  onConfirmHandoff: (draft: RelayHandoffDraft) => Promise<boolean>;
}

export function RelayLanesView({
  groupName,
  lanes,
  activeLaneId,
  activeMessages,
  isProcessing,
  pendingPermission,
  respondPermission,
  spaceId,
  onClose,
  onActivateLane,
  onSend,
  onStop,
  onPrepareHandoff,
  onConfirmHandoff,
}: RelayLanesViewProps) {
  const [handoffDraft, setHandoffDraft] = useState<RelayHandoffDraft | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = scrollRef.current?.querySelector<HTMLElement>("[data-active-relay-lane='true']");
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeLaneId, lanes.length]);

  const prepare = useCallback(async (lane: ChatSession, role?: RelayStageRole) => {
    setHandoffDraft(await onPrepareHandoff(lane, role));
  }, [onPrepareHandoff]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4">
        <Network className="size-4 text-emerald-600 dark:text-emerald-400" />
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{groupName || "Relay collaboration"}</div>
        <span className="text-xs text-muted-foreground">{lanes.length} lanes</span>
        <Button size="icon" variant="ghost" className="size-8" onClick={onClose} title="Close Relay">
          <X className="size-4" />
        </Button>
      </header>
      <div ref={scrollRef} className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {lanes.map((lane) => {
          const isActive = lane.id === activeLaneId || (lane.id === DRAFT_ID && activeLaneId === DRAFT_ID);
          return (
            <div key={`${lane.workflowGroupId}:${lane.stageIndex}:${lane.id}`} data-active-relay-lane={isActive ? "true" : undefined} className="h-full shrink-0">
              <RelayLaneCard
                lane={lane}
                isActive={isActive}
                activeMessages={activeMessages}
                isProcessing={isActive && isProcessing}
                pendingPermission={isActive ? pendingPermission : null}
                respondPermission={respondPermission}
                spaceId={spaceId}
                onActivate={onActivateLane}
                onSend={onSend}
                onStop={onStop}
                onHandoff={(source) => prepare(source)}
              />
            </div>
          );
        })}
      </div>
      <RelayHandoffDialog
        draft={handoffDraft}
        onOpenChange={(open) => { if (!open) setHandoffDraft(null); }}
        onRoleChange={async (role) => {
          if (handoffDraft) await prepare(handoffDraft.source, role);
        }}
        onConfirm={onConfirmHandoff}
      />
    </div>
  );
}
