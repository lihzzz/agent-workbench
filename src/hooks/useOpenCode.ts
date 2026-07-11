import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AppPermissionBehavior,
  BackgroundSessionSnapshot,
  ImageAttachment,
  OpenCodeModelInfo,
  OpenCodePermissionRequest,
  OpenCodeSessionEvent,
  UIMessage,
} from "@/types";
import { captureException } from "@/lib/analytics/analytics";
import { openCodePermissionReply, reduceOpenCodeEvent, type OpenCodeAdapterState } from "@/lib/engine/opencode-adapter";
import { createSystemMessage, createUserMessage } from "@/lib/message-factory";
import { suppressNextSessionCompletion } from "@/lib/notification-utils";
import { useEngineBase } from "./useEngineBase";

interface UseOpenCodeOptions {
  sessionId: string | null;
  sessionModel?: string;
  initialMessages?: UIMessage[];
  initialMeta?: BackgroundSessionSnapshot | null;
  initialPermission?: import("@/types").PermissionRequest | null;
}

export function useOpenCode({
  sessionId,
  sessionModel,
  initialMessages,
  initialMeta,
  initialPermission,
}: UseOpenCodeOptions) {
  const base = useEngineBase({ sessionId, initialMessages, initialMeta, initialPermission });
  const {
    messages,
    setMessages,
    isProcessing,
    setIsProcessing,
    isConnected,
    setIsConnected,
    sessionInfo,
    setSessionInfo,
    totalCost,
    setTotalCost,
    pendingPermission,
    setPendingPermission,
    contextUsage,
    setContextUsage,
    modelUsage,
    setModelUsage,
    sessionIdRef,
    scheduleFlush,
    cancelPendingFlush,
  } = base;
  const [models, setModels] = useState<OpenCodeModelInfo[]>([]);
  const projectionPendingRef = useRef(false);

  const projectionRef = useRef<OpenCodeAdapterState>({
    messages,
    isProcessing,
    isConnected,
    totalCost,
    contextUsage,
    modelUsage,
    currentModel: sessionModel,
    processedStepIds: new Set(),
  });

  if (!projectionPendingRef.current) {
    projectionRef.current = {
      ...projectionRef.current,
      messages,
      isProcessing,
      isConnected,
      totalCost,
      contextUsage,
      modelUsage,
      currentModel: projectionRef.current.currentModel ?? sessionModel,
    };
  }

  useEffect(() => {
    projectionRef.current = {
      messages: initialMessages ?? [],
      isProcessing: initialMeta?.isProcessing ?? false,
      isConnected: initialMeta?.isConnected ?? false,
      totalCost: initialMeta?.totalCost ?? 0,
      contextUsage: initialMeta?.contextUsage ?? null,
      modelUsage: initialMeta?.modelUsage ?? {},
      currentModel: sessionModel,
      processedStepIds: new Set(),
    };
    projectionPendingRef.current = false;
    setModels([]);
    cancelPendingFlush();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const flushProjection = useCallback(() => {
    const projection = projectionRef.current;
    setMessages(projection.messages);
    setIsProcessing(projection.isProcessing);
    setIsConnected(projection.isConnected);
    setTotalCost(projection.totalCost);
    setContextUsage(projection.contextUsage);
    setModelUsage(projection.modelUsage);
    const model = projection.currentModel ?? sessionModel;
    if (sessionId && model) {
      setSessionInfo((previous) => ({
        sessionId,
        model,
        cwd: previous?.cwd ?? "",
        tools: previous?.tools ?? [],
        version: previous?.version ?? "",
      }));
    }
    projectionPendingRef.current = false;
  }, [sessionId, sessionModel, setContextUsage, setIsConnected, setIsProcessing, setMessages, setModelUsage, setSessionInfo, setTotalCost]);

  const pushError = useCallback((message: string) => {
    setMessages((previous) => [...previous, createSystemMessage(message, true)]);
  }, [setMessages]);

  useEffect(() => {
    if (!sessionId) return;
    setIsConnected(true);
    setSessionInfo({
      sessionId,
      model: sessionModel ?? "",
      cwd: "",
      tools: [],
      version: "",
    });

    const unsubscribeEvent = window.claude.opencode.onEvent((data: OpenCodeSessionEvent) => {
      if (data._sessionId !== sessionIdRef.current) return;
      projectionPendingRef.current = true;
      projectionRef.current = reduceOpenCodeEvent(projectionRef.current, data.event);
      scheduleFlush(flushProjection);
    });
    const unsubscribePermission = window.claude.opencode.onPermissionRequest((data: OpenCodePermissionRequest) => {
      if (data._sessionId !== sessionIdRef.current) return;
      setPendingPermission({
        requestId: data.requestId,
        toolName: data.toolName,
        toolInput: data.toolInput,
        toolUseId: data.toolUseId ?? data.requestId,
      });
    });
    const unsubscribeExit = window.claude.opencode.onExit((data) => {
      if (data._sessionId !== sessionIdRef.current) return;
      setIsConnected(false);
      setIsProcessing(false);
      setPendingPermission(null);
      if (data.error || (data.code !== null && data.code !== 0)) {
        pushError(data.error ?? `OpenCode process exited with code ${data.code}.`);
      }
    });

    return () => {
      unsubscribeEvent();
      unsubscribePermission();
      unsubscribeExit();
      cancelPendingFlush();
    };
  }, [cancelPendingFlush, flushProjection, pushError, scheduleFlush, sessionId, sessionModel, setIsConnected, setIsProcessing, setPendingPermission, setSessionInfo]);

  const sendRaw = useCallback(async (text: string, images?: ImageAttachment[]): Promise<boolean> => {
    if (!sessionId) return false;
    setIsProcessing(true);
    try {
      const result = await window.claude.opencode.send(sessionId, text, images);
      if (result.error) {
        pushError(`OpenCode prompt error: ${result.error}`);
        setIsProcessing(false);
        return false;
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      captureException(error instanceof Error ? error : new Error(message), { label: "OPENCODE_SEND_ERR" });
      pushError(`OpenCode prompt error: ${message}`);
      setIsProcessing(false);
      return false;
    }
  }, [pushError, sessionId, setIsProcessing]);

  const send = useCallback(async (text: string, images?: ImageAttachment[], displayText?: string): Promise<boolean> => {
    if (!sessionId) return false;
    setMessages((previous) => [...previous, createUserMessage(text, images, displayText)]);
    return sendRaw(text, images);
  }, [sendRaw, sessionId, setMessages]);

  const stop = useCallback(async () => {
    if (!sessionId) return;
    suppressNextSessionCompletion(sessionId);
    await window.claude.opencode.stop(sessionId);
  }, [sessionId]);

  const interrupt = useCallback(async () => {
    if (!sessionId) return;
    suppressNextSessionCompletion(sessionId);
    setIsProcessing(false);
    setPendingPermission(null);
    const result = await window.claude.opencode.interrupt(sessionId);
    if (result.error) pushError(`OpenCode interrupt error: ${result.error}`);
  }, [pushError, sessionId, setIsProcessing, setPendingPermission]);

  const respondPermission = useCallback(async (behavior: AppPermissionBehavior) => {
    if (!sessionId || !pendingPermission) return;
    const reply = openCodePermissionReply(behavior);
    const result = await window.claude.opencode.respondPermission(
      sessionId,
      pendingPermission.requestId,
      reply,
    );
    if (result.error) {
      pushError(`OpenCode permission response failed: ${result.error}`);
      return;
    }
    setPendingPermission(null);
  }, [pendingPermission, pushError, sessionId, setPendingPermission]);

  const setModel = useCallback(async (model: string) => {
    if (!sessionId) return;
    const result = await window.claude.opencode.setModel(sessionId, model);
    if (result.error) {
      pushError(`OpenCode model change failed: ${result.error}`);
      return;
    }
    projectionRef.current.currentModel = model;
    setSessionInfo((previous) => previous ? { ...previous, model } : previous);
  }, [pushError, sessionId, setSessionInfo]);

  const compact = useCallback(async () => { /* OpenCode compact is not supported. */ }, []);
  const setPermissionMode = useCallback(async (_mode: string) => { /* OpenCode permission mode is provider-controlled. */ }, []);

  return {
    messages,
    setMessages,
    isProcessing,
    setIsProcessing,
    isConnected,
    setIsConnected,
    sessionInfo,
    setSessionInfo,
    totalCost,
    setTotalCost,
    contextUsage,
    modelUsage,
    send,
    sendRaw,
    stop,
    interrupt,
    compact,
    pendingPermission,
    respondPermission,
    setPermissionMode,
    models,
    setModels,
    setModel,
    slashCommands: [],
  };
}
