import { useEffect, useState } from "react";
import type { ChatSession, UIMessage } from "@/types";
import { DRAFT_ID } from "@/hooks/session/types";

export function useLaneSnapshot(
  lane: ChatSession,
  isActive: boolean,
  activeMessages: UIMessage[],
): { messages: UIMessage[]; loading: boolean; error: string | null } {
  const [messages, setMessages] = useState<UIMessage[]>(isActive ? activeMessages : []);
  const [loading, setLoading] = useState(!isActive && lane.id !== DRAFT_ID);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive) return;
    setMessages(activeMessages);
    setLoading(false);
    setError(null);
  }, [activeMessages, isActive]);

  useEffect(() => {
    if (isActive) return;
    if (lane.id === DRAFT_ID) {
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.claude.sessions.load(lane.projectId, lane.id).then((persisted) => {
      if (cancelled) return;
      setMessages(persisted?.messages ?? []);
      setLoading(false);
    }).catch((loadError) => {
      if (cancelled) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [isActive, lane.id, lane.projectId]);

  return { messages, loading, error };
}
