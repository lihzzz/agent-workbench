import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ChatSession, EngineId, InstalledAgent, RelayStageRole, UIMessage } from "@/types";
import { DRAFT_ID, type StartOptions } from "@/hooks/session/types";
import {
  buildHandoffPrompt,
  extractRelayAssistantText,
  getNextRelayRole,
  getRelayRecipe,
} from "@/lib/session/handoff";
import { buildRelayGroups, mergePendingRelayLane } from "@/lib/session/relay-groups";

export interface RelayHandoffDraft {
  source: ChatSession;
  targetRole: RelayStageRole;
  prompt: string;
}

interface UseRelayOrchestratorOptions {
  sessions: ChatSession[];
  activeSessionId: string | null;
  activeMessages: UIMessage[];
  activeProjectId: string | null;
  agents: InstalledAgent[];
  getModelForEngine: (engine: EngineId) => string;
  createSession: (projectId: string, options?: StartOptions) => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  interrupt: () => Promise<void>;
}

function relayId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `relay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function waitForNextTick(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

export function useRelayOrchestrator(options: UseRelayOrchestratorOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [pendingDraftLane, setPendingDraftLane] = useState<ChatSession | null>(null);
  const sessionsRef = useRef(options.sessions);
  sessionsRef.current = options.sessions;
  const activeSessionIdRef = useRef(options.activeSessionId);
  activeSessionIdRef.current = options.activeSessionId;

  const groups = useMemo(
    () => buildRelayGroups(options.sessions, projectId ?? undefined),
    [options.sessions, projectId],
  );
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null;
  const lanes = useMemo(
    () => mergePendingRelayLane(activeGroup?.lanes ?? [], pendingDraftLane),
    [activeGroup?.lanes, pendingDraftLane],
  );
  const activeGroupName = activeGroup?.name ?? pendingDraftLane?.workflowGroupName ?? "Relay";

  useEffect(() => {
    if (!pendingDraftLane?.workflowGroupId) return;
    const materialized = options.sessions.some((session) =>
      session.workflowGroupId === pendingDraftLane.workflowGroupId
        && session.stageIndex === pendingDraftLane.stageIndex
        && session.id !== DRAFT_ID,
    );
    if (materialized) setPendingDraftLane(null);
  }, [options.sessions, pendingDraftLane]);

  const sessionOptions = useCallback((
    role: RelayStageRole,
    metadata: Pick<StartOptions, "workflowGroupId" | "workflowGroupName" | "stageIndex" | "handoffFromSessionId">,
  ): StartOptions => {
    const recipe = getRelayRecipe(role);
    const agent = options.agents.find((entry) => entry.engine === recipe.engine);
    return {
      engine: recipe.engine,
      agentId: agent?.id ?? (recipe.engine === "codex" ? "codex" : "claude-code"),
      model: options.getModelForEngine(recipe.engine) || undefined,
      permissionMode: "default",
      planMode: false,
      stageRole: role,
      ...metadata,
    };
  }, [options.agents, options.getModelForEngine]);

  const makePendingLane = useCallback((input: {
    projectId: string;
    groupId: string;
    groupName: string;
    role: RelayStageRole;
    stageIndex: number;
    handoffFromSessionId?: string;
  }): ChatSession => {
    const recipe = getRelayRecipe(input.role);
    return {
      id: DRAFT_ID,
      projectId: input.projectId,
      title: recipe.label,
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
      totalCost: 0,
      isActive: true,
      engine: recipe.engine,
      agentId: options.agents.find((agent) => agent.engine === recipe.engine)?.id,
      model: options.getModelForEngine(recipe.engine) || undefined,
      workflowGroupId: input.groupId,
      workflowGroupName: input.groupName,
      stageRole: input.role,
      stageIndex: input.stageIndex,
      handoffFromSessionId: input.handoffFromSessionId,
    };
  }, [options.agents, options.getModelForEngine]);

  const openRelay = useCallback(async (requestedProjectId?: string) => {
    const nextProjectId = requestedProjectId ?? options.activeProjectId;
    if (!nextProjectId) {
      toast.error("Open a project before starting Relay");
      return;
    }
    const existing = buildRelayGroups(sessionsRef.current, nextProjectId)[0];
    setProjectId(nextProjectId);
    setIsOpen(true);
    if (existing) {
      setActiveGroupId(existing.id);
      setPendingDraftLane(null);
      const lastLane = existing.lanes.at(-1);
      if (lastLane && activeSessionIdRef.current !== lastLane.id) {
        await options.switchSession(lastLane.id);
      }
      return;
    }

    const groupId = relayId();
    const groupName = getRelayRecipe("plan").label;
    const pending = makePendingLane({
      projectId: nextProjectId,
      groupId,
      groupName,
      role: "plan",
      stageIndex: 0,
    });
    setActiveGroupId(groupId);
    setPendingDraftLane(pending);
    await options.createSession(nextProjectId, sessionOptions("plan", {
      workflowGroupId: groupId,
      workflowGroupName: groupName,
      stageIndex: 0,
    }));
  }, [makePendingLane, options.activeProjectId, options.createSession, options.switchSession, sessionOptions]);

  const closeRelay = useCallback(() => setIsOpen(false), []);

  const waitForActiveDraft = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (activeSessionIdRef.current === DRAFT_ID) return true;
      await waitForNextTick();
    }
    return activeSessionIdRef.current === DRAFT_ID;
  }, []);

  const activateLane = useCallback(async (lane: ChatSession) => {
    if (lane.id === DRAFT_ID || lane.id === activeSessionIdRef.current) return;
    await options.switchSession(lane.id);
  }, [options.switchSession]);

  const prepareHandoff = useCallback(async (
    source: ChatSession,
    targetRole?: RelayStageRole,
  ): Promise<RelayHandoffDraft | null> => {
    if (!source.stageRole) return null;
    const nextRole = targetRole ?? getNextRelayRole(source.stageRole);
    if (!nextRole) return null;
    let messages: UIMessage[] = [];
    if (source.id === activeSessionIdRef.current) {
      messages = options.activeMessages;
    } else {
      const persisted = await window.claude.sessions.load(source.projectId, source.id);
      messages = persisted?.messages ?? [];
    }
    return {
      source,
      targetRole: nextRole,
      prompt: buildHandoffPrompt({
        targetRole: nextRole,
        prevRole: getRelayRecipe(source.stageRole).label,
        prevEngine: source.engine ?? "claude",
        prevText: extractRelayAssistantText(messages),
        artifacts: getRelayRecipe(nextRole).artifact,
      }),
    };
  }, [options.activeMessages]);

  const confirmHandoff = useCallback(async (draft: RelayHandoffDraft): Promise<boolean> => {
    const groupId = draft.source.workflowGroupId;
    if (!groupId) return false;
    const groupName = draft.source.workflowGroupName || "Relay";
    const currentLanes = buildRelayGroups(sessionsRef.current, draft.source.projectId)
      .find((group) => group.id === groupId)?.lanes ?? [];
    const stageIndex = currentLanes.reduce(
      (maximum, lane) => Math.max(maximum, lane.stageIndex ?? -1),
      -1,
    ) + 1;
    const pending = makePendingLane({
      projectId: draft.source.projectId,
      groupId,
      groupName,
      role: draft.targetRole,
      stageIndex,
      handoffFromSessionId: draft.source.id,
    });
    setPendingDraftLane(pending);
    try {
      await options.createSession(draft.source.projectId, sessionOptions(draft.targetRole, {
        workflowGroupId: groupId,
        workflowGroupName: groupName,
        stageIndex,
        handoffFromSessionId: draft.source.id,
      }));
      const draftReady = await waitForActiveDraft();
      if (!draftReady) {
        throw new Error("The next Relay lane draft did not become active.");
      }
      await options.send(draft.prompt);
      return true;
    } catch (error) {
      setPendingDraftLane(null);
      await options.switchSession(draft.source.id);
      toast.error("Relay handoff failed", {
        description: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }, [makePendingLane, options.createSession, options.send, options.switchSession, sessionOptions, waitForActiveDraft]);

  return {
    isOpen,
    projectId,
    activeGroup,
    activeGroupName,
    activeGroupId,
    groups,
    lanes,
    pendingDraftLane,
    activeLaneId: options.activeSessionId,
    openRelay,
    closeRelay,
    activateLane,
    send: options.send,
    interrupt: options.interrupt,
    prepareHandoff,
    confirmHandoff,
  };
}
