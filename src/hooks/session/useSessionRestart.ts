import { useCallback } from "react";
import type { McpServerConfig, Project } from "../../types";
import { toMcpStatusState } from "../../lib/mcp-utils";
import { suppressNextSessionCompletion } from "../../lib/notification-utils";
import { createSystemMessage } from "../../lib/message-factory";
import {
  DRAFT_ID,
  getEffectiveClaudePermissionMode,
  getCodexApprovalPolicy,
  getCodexSandboxMode,
} from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks } from "./types";

interface UseSessionRestartParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  findProject: (projectId: string) => Project | null;
  getProjectCwd: (project: Project) => string;
}

export function useSessionRestart({
  refs,
  setters,
  engines,
  findProject,
  getProjectCwd,
}: UseSessionRestartParams) {
  const { claude, acp, opencode } = engines;
  const {
    setSessions,
    setActiveSessionId,
    setInitialMessages,
    setInitialMeta,
    setInitialConfigOptions,
    setAcpMcpStatuses,
  } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    messagesRef,
    totalCostRef,
    contextUsageRef,
    isProcessingRef,
    liveSessionIdsRef,
    backgroundStoreRef,
    startOptionsRef,
    acpAgentIdRef,
  } = refs;

  // ── Restart ACP session with updated MCP servers ──

  const restartAcpSession = useCallback(async (servers: McpServerConfig[], cwdOverride?: string): Promise<{ ok?: boolean; error?: string }> => {
    const currentId = activeSessionIdRef.current;
    if (!currentId || currentId === DRAFT_ID) return { ok: true };

    const session = sessionsRef.current.find(s => s.id === currentId);
    const project = session ? findProject(session.projectId) : null;
    const agentId = session?.agentId ?? acpAgentIdRef.current;
    if (!session || !project || !agentId) return { error: "ACP session cannot be restarted right now." };

    // Probe servers so we get accurate statuses (including needs-auth) before any reload
    const probeResults = await window.claude.mcp.probe(servers);
    // Guard: session may have changed during async probe
    if (activeSessionIdRef.current !== currentId) return { ok: true };
    setAcpMcpStatuses(probeResults.map(r => ({
      name: r.name,
      status: toMcpStatusState(r.status),
      ...(r.error ? { error: r.error } : {}),
    })));

    // Try session/load first — updates MCP on the existing connection, no context loss
    const nextCwd = cwdOverride ?? getProjectCwd(project);
    const reloadResult = await window.claude.acp.reloadSession(currentId, servers, nextCwd);
    if (reloadResult.supportsLoad && reloadResult.ok) {
      // session/load succeeded — session ID and process unchanged, context preserved
      return { ok: true };
    }

    // Fall back to stop + restart (agent doesn't support session/load, or reload failed)
    const currentMessages = messagesRef.current;
    const currentCost = totalCostRef.current;

    suppressNextSessionCompletion(currentId);
    await window.claude.acp.stop(currentId);
    liveSessionIdsRef.current.delete(currentId);
    backgroundStoreRef.current.delete(currentId);

    const result = await window.claude.acp.start({
      agentId,
      cwd: nextCwd,
      mcpServers: servers,
    });
    if ("authRequired" in result && result.authRequired) {
      const pendingAuthId = result.sessionId;
      liveSessionIdsRef.current.add(pendingAuthId);
      setSessions(prev => prev.map(s =>
        s.id === currentId ? { ...s, id: pendingAuthId } : s
      ));
      if (pendingAuthId !== currentId) {
        try {
          const oldData = await window.claude.sessions.load(session.projectId, currentId);
          if (oldData) {
            await window.claude.sessions.save({
              ...oldData,
              id: pendingAuthId,
              messages: currentMessages,
            });
            await window.claude.sessions.delete(session.projectId, currentId);
          }
        } catch { /* persistence migration is best-effort */ }
      }
      setInitialMessages(currentMessages);
      setInitialMeta({
        isProcessing: false,
        isConnected: false,
        sessionInfo: null,
        totalCost: currentCost,
        contextUsage: contextUsageRef.current,
      });
      setActiveSessionId(pendingAuthId);
      acp.setAuthMethods(result.authMethods ?? []);
      acp.setAuthRequired(true);
      return { error: "ACP session requires authentication before it can restart." };
    }
    if (!("sessionId" in result) || !result.sessionId) {
      // Show error in the UI after restart failure — use setMessages directly
      // because session ID hasn't changed (no reset effect to consume initialMessages)
      const errorMsg = ("error" in result && result.error) ? result.error : "Failed to restart agent session";
      acp.setMessages(prev => [...prev, createSystemMessage(errorMsg, true)]);
      return { error: errorMsg };
    }

    const newId = result.sessionId;
    const nextAgentSessionId = "agentSessionId" in result ? result.agentSessionId : undefined;
    liveSessionIdsRef.current.add(newId);

    setSessions(prev => prev.map(s =>
      s.id === currentId ? { ...s, id: newId, agentSessionId: nextAgentSessionId ?? s.agentSessionId } : s
    ));
    refs.acpAgentSessionIdRef.current = nextAgentSessionId ?? refs.acpAgentSessionIdRef.current;

    // Migrate the persisted session file from currentId to newId and delete the old
    // one, so the next full list rebuild doesn't surface a duplicate, identically-named
    // sidebar entry (mirrors the Claude revive path).
    if (newId !== currentId) {
      try {
        const oldData = await window.claude.sessions.load(session.projectId, currentId);
        if (oldData) {
          await window.claude.sessions.save({
            ...oldData,
            id: newId,
            messages: currentMessages,
            agentSessionId: nextAgentSessionId ?? oldData.agentSessionId,
          });
          await window.claude.sessions.delete(session.projectId, currentId);
        }
      } catch { /* persistence migration is best-effort */ }
    }
    // Restore UI message history and config options through initialMessages -> useACP reset effect
    setInitialMessages(currentMessages);
    setInitialMeta({
      isProcessing: false,
      isConnected: true,
      sessionInfo: null,
      totalCost: currentCost,
      contextUsage: contextUsageRef.current,
    });
    if ("configOptions" in result && result.configOptions?.length) setInitialConfigOptions(result.configOptions);
    setActiveSessionId(newId);
    return { ok: true };
  }, [findProject, getProjectCwd]);

  // ── Restart the active session in the current worktree ──

  const restartActiveSessionInCurrentWorktree = useCallback(async (): Promise<{ ok?: boolean; error?: string }> => {
    const currentId = activeSessionIdRef.current;
    if (!currentId || currentId === DRAFT_ID) return { ok: true };
    if (isProcessingRef.current) {
      return { error: "Wait for the current turn to finish before restarting in another worktree." };
    }

    const session = sessionsRef.current.find((s) => s.id === currentId);
    if (!session) return { error: "Active session not found." };
    const project = findProject(session.projectId);
    if (!project) return { error: "Project not found." };
    const nextCwd = getProjectCwd(project);
    const mcpServers = await window.claude.mcp.list(session.projectId);

    if (session.engine === "acp") {
      return restartAcpSession(mcpServers, nextCwd);
    }

    if (session.engine === "codex") {
      let codexThreadId: string | undefined = session.codexThreadId;
      if (!codexThreadId) {
        try {
          const persisted = await window.claude.sessions.load(session.projectId, currentId);
          codexThreadId = persisted?.codexThreadId;
        } catch {
          // Ignore persistence lookup failure; we'll surface the missing thread below.
        }
      }

      if (!codexThreadId) {
        return { error: "Codex session cannot be restarted in another worktree because no thread ID is available." };
      }

      const resumeResult = await window.claude.codex.resume({
        cwd: nextCwd,
        threadId: codexThreadId,
        model: session.model,
        approvalPolicy: getCodexApprovalPolicy(startOptionsRef.current),
        sandbox: getCodexSandboxMode(startOptionsRef.current),
      });

      if (resumeResult.error || !resumeResult.sessionId) {
        return { error: resumeResult.error || "Failed to restart Codex session in the selected worktree." };
      }

      const newId = resumeResult.sessionId;
      const resolvedModel = resumeResult.selectedModel ?? session.model;
      liveSessionIdsRef.current.add(newId);
      setSessions((prev) => prev.map((s) =>
        s.id === currentId
          ? { ...s, id: newId, model: resolvedModel, codexThreadId: resumeResult.threadId ?? codexThreadId }
          : s,
      ));

      // Migrate the persisted session file from currentId to newId and delete the old
      // one, so the next full list rebuild doesn't surface a duplicate, identically-named
      // sidebar entry (mirrors the Claude revive path).
      if (newId !== currentId) {
        try {
          const oldData = await window.claude.sessions.load(session.projectId, currentId);
          if (oldData) {
            await window.claude.sessions.save({
              ...oldData,
              id: newId,
              messages: messagesRef.current,
              model: resolvedModel ?? oldData.model,
              codexThreadId: resumeResult.threadId ?? codexThreadId,
            });
            await window.claude.sessions.delete(session.projectId, currentId);
          }
        } catch { /* persistence migration is best-effort */ }
      }
      setInitialMessages(messagesRef.current);
      setInitialMeta({
        isProcessing: false,
        isConnected: true,
        sessionInfo: null,
        totalCost: totalCostRef.current,
        contextUsage: contextUsageRef.current,
      });
      setActiveSessionId(newId);

      suppressNextSessionCompletion(currentId);
      await window.claude.codex.stop(currentId);
      liveSessionIdsRef.current.delete(currentId);
      backgroundStoreRef.current.delete(currentId);
      return { ok: true };
    }

    if (session.engine === "opencode") {
      let nativeSessionId = session.opencodeSessionId;
      if (!nativeSessionId) {
        const persisted = await window.claude.sessions.load(session.projectId, currentId).catch(() => null);
        nativeSessionId = persisted?.opencodeSessionId;
      }
      if (!nativeSessionId) {
        return { error: "OpenCode session cannot be restarted because its native session ID is missing." };
      }
      const resumeResult = await window.claude.opencode.resume({
        cwd: nextCwd,
        resumeSessionId: nativeSessionId,
        model: session.model,
      });
      if (resumeResult.error || !resumeResult.sessionId || !resumeResult.opencodeSessionId) {
        return { error: resumeResult.error || "Failed to restart OpenCode session in the selected worktree." };
      }
      const newId = resumeResult.sessionId;
      liveSessionIdsRef.current.add(newId);
      if (resumeResult.models) opencode.setModels(resumeResult.models);
      setSessions((previous) => previous.map((entry) =>
        entry.id === currentId
          ? {
              ...entry,
              id: newId,
              model: resumeResult.selectedModel ?? entry.model,
              opencodeSessionId: resumeResult.opencodeSessionId,
            }
          : entry,
      ));
      const oldData = await window.claude.sessions.load(session.projectId, currentId).catch(() => null);
      if (oldData) {
        await window.claude.sessions.save({
          ...oldData,
          id: newId,
          messages: messagesRef.current,
          model: resumeResult.selectedModel ?? oldData.model,
          opencodeSessionId: resumeResult.opencodeSessionId,
        });
        if (newId !== currentId) await window.claude.sessions.delete(session.projectId, currentId);
      }
      setInitialMessages(messagesRef.current);
      setInitialMeta({
        isProcessing: false,
        isConnected: true,
        sessionInfo: null,
        totalCost: totalCostRef.current,
        contextUsage: contextUsageRef.current,
      });
      setActiveSessionId(newId);

      suppressNextSessionCompletion(currentId);
      await window.claude.opencode.stop(currentId);
      liveSessionIdsRef.current.delete(currentId);
      backgroundStoreRef.current.delete(currentId);
      return { ok: true };
    }

    const restartResult = await window.claude.restartSession(currentId, mcpServers, nextCwd);
    if (restartResult?.error) {
      return { error: restartResult.error };
    }
    if (restartResult?.restarted) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    await claude.refreshMcpStatus();
    return { ok: true };
  }, [claude.refreshMcpStatus, findProject, getProjectCwd, opencode.setModels, restartAcpSession]);

  // ── Full revert: rewind files + fork a new SDK session truncated to the checkpoint ──

  const fullRevertSession = useCallback(async (checkpointId: string) => {
    const currentId = activeSessionIdRef.current;
    if (!currentId || currentId === DRAFT_ID) return;

    const session = sessionsRef.current.find(s => s.id === currentId);
    if (!session) return;
    const project = findProject(session.projectId);
    if (!project) return;

    // 1. Flush any pending streaming content
    claude.flushNow();
    claude.resetStreaming();

    // 2. Compute truncated messages BEFORE the async IPC calls
    const currentMessages = messagesRef.current;
    const checkpointIdx = currentMessages.findIndex(
      (m) => m.role === "user" && m.checkpointId === checkpointId,
    );
    const truncatedMessages = checkpointIdx >= 0
      ? currentMessages.slice(0, checkpointIdx)
      : currentMessages;

    // 3. Revert files while old session is still alive (needs queryHandle.rewindFiles)
    const revertResult = await window.claude.revertFiles(currentId, checkpointId);
    if (revertResult.error) {
      claude.setMessages(prev => [...prev, createSystemMessage(`File revert failed: ${revertResult.error}`, true)]);
      return;
    }

    // 4. Stop old session — cleanup runs async in the event loop's finally block
    suppressNextSessionCompletion(currentId);
    await window.claude.stop(currentId, "revert_restart");
    liveSessionIdsRef.current.delete(currentId);
    backgroundStoreRef.current.delete(currentId);

    // 5. Start a forked session — SDK creates a new session branched at the checkpoint.
    const mcpServers = await window.claude.mcp.list(session.projectId);
    const startResult = await window.claude.start({
      cwd: getProjectCwd(project),
      model: session.model,
      permissionMode: getEffectiveClaudePermissionMode(startOptionsRef.current),
      thinkingEnabled: startOptionsRef.current.thinkingEnabled,
      effort: startOptionsRef.current.effort,
      resume: currentId,
      forkSession: true,
      resumeSessionAt: checkpointId,
      mcpServers,
    });

    if (startResult.error) {
      claude.setMessages(prev => [...prev, createSystemMessage(`Full revert failed: ${startResult.error}`, true)]);
      return;
    }

    const newId = startResult.sessionId;
    liveSessionIdsRef.current.add(newId);

    // 6. Map sidebar entry to new forked ID
    setSessions(prev => prev.map(s =>
      s.id === currentId ? { ...s, id: newId } : s,
    ));

    // 7. Provide truncated messages + system message via initialMessages -> reset effect
    const systemMsg = createSystemMessage("Session reverted: files restored and chat history truncated.");
    setInitialMessages([...truncatedMessages, systemMsg]);
    setInitialMeta({
      isProcessing: false,
      isConnected: true,
      sessionInfo: null, // repopulated by system/init event from forked session
      totalCost: totalCostRef.current,
      contextUsage: contextUsageRef.current,
    });

    // 8. Switch to new session ID -> triggers useClaude's reset effect
    setActiveSessionId(newId);

    // 9. Persist: save under new forked ID, delete old session file
    const oldData = await window.claude.sessions.load(project.id, currentId);
    if (oldData) {
      await window.claude.sessions.save({
        ...oldData,
        id: newId,
        messages: [...truncatedMessages, systemMsg],
      });
      await window.claude.sessions.delete(project.id, currentId);
    }
  }, [findProject, claude.flushNow, claude.resetStreaming, claude.setMessages]);

  return {
    restartAcpSession,
    restartActiveSessionInCurrentWorktree,
    fullRevertSession,
  };
}
