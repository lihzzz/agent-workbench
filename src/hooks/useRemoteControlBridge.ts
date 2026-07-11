import { useEffect, useMemo, useRef } from "react";
import type {
  AppPermissionBehavior,
  ChatSession,
  ImageAttachment,
  PermissionRequest,
  Project,
  RemoteStartTaskInput,
  Space,
  UIMessage,
} from "@/types";
import { RemoteRendererBridge } from "@/lib/remote/remote-renderer-bridge";
import { SessionRuntimeFacade } from "@/lib/remote/session-runtime-facade";
import { SessionRuntimeRegistry } from "@/lib/remote/session-runtime-registry";
import { buildRemoteSnapshot } from "@/lib/remote/snapshot-builder";

interface UseRemoteControlBridgeOptions {
  projects: Project[];
  spaces: Space[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: UIMessage[];
  pendingPermission: PermissionRequest | null;
  send: (text: string, images?: ImageAttachment[], displayText?: string) => Promise<void>;
  interrupt: () => Promise<void>;
  stop: () => Promise<void>;
  respondPermission: (behavior: AppPermissionBehavior) => Promise<void>;
  startRemoteTask: (input: RemoteStartTaskInput) => Promise<{ sessionId: string }>;
}

export function useRemoteControlBridge({
  projects,
  spaces,
  sessions,
  activeSessionId,
  messages,
  pendingPermission,
  send,
  interrupt,
  stop,
  respondPermission,
  startRemoteTask,
}: UseRemoteControlBridgeOptions): void {
  const callbacksRef = useRef({ send, interrupt, stop, respondPermission, startRemoteTask });
  callbacksRef.current = { send, interrupt, stop, respondPermission, startRemoteTask };

  const registry = useMemo(() => new SessionRuntimeRegistry(), []);
  const bridge = useMemo(() => {
    const facade = new SessionRuntimeFacade(registry, {
      sendActive: (...args) => callbacksRef.current.send(...args),
      interruptActive: () => callbacksRef.current.interrupt(),
      stopActive: () => callbacksRef.current.stop(),
      respondActivePermission: (behavior) => callbacksRef.current.respondPermission(behavior),
      startRemoteTask: (input) => callbacksRef.current.startRemoteTask(input),
    });
    return new RemoteRendererBridge(facade);
  }, [registry]);

  useEffect(() => {
    bridge.start();
    return () => bridge.dispose();
  }, [bridge]);

  useEffect(() => {
    registry.setState({
      projects,
      spaces,
      sessions,
      activeSessionId,
      activeMessages: messages,
      pendingPermission,
    });
    bridge.publishSnapshot(buildRemoteSnapshot({
      projects,
      spaces,
      sessions,
      activeSessionId,
      activeMessages: messages,
      pendingPermission,
    }));
  }, [
    activeSessionId,
    bridge,
    messages,
    pendingPermission,
    projects,
    registry,
    sessions,
    spaces,
  ]);
}
