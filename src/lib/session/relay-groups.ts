import type { ChatSession } from "@/types";

export interface RelayGroup {
  id: string;
  name: string;
  projectId: string;
  lanes: ChatSession[];
}

function laneOrder(session: ChatSession): number {
  return typeof session.stageIndex === "number" ? session.stageIndex : Number.MAX_SAFE_INTEGER;
}

export function buildRelayGroups(sessions: ChatSession[], projectId?: string): RelayGroup[] {
  const grouped = new Map<string, RelayGroup>();
  for (const session of sessions) {
    if (!session.workflowGroupId) continue;
    if (projectId && session.projectId !== projectId) continue;
    const existing = grouped.get(session.workflowGroupId) ?? {
      id: session.workflowGroupId,
      name: session.workflowGroupName || "Relay",
      projectId: session.projectId,
      lanes: [],
    };
    if (!existing.lanes.some((lane) => lane.id === session.id)) existing.lanes.push(session);
    grouped.set(existing.id, existing);
  }
  return [...grouped.values()]
    .map((group) => ({ ...group, lanes: group.lanes.toSorted((a, b) => laneOrder(a) - laneOrder(b)) }))
    .toSorted((a, b) => {
      const aCreated = a.lanes[0]?.createdAt ?? 0;
      const bCreated = b.lanes[0]?.createdAt ?? 0;
      return aCreated - bCreated;
    });
}

export function mergePendingRelayLane(
  lanes: ChatSession[],
  pending: ChatSession | null,
): ChatSession[] {
  if (!pending?.workflowGroupId) return lanes;
  const materialized = lanes.some((lane) =>
    lane.workflowGroupId === pending.workflowGroupId
      && lane.stageIndex === pending.stageIndex
      && lane.id !== pending.id,
  );
  if (materialized) return lanes;
  if (lanes.some((lane) => lane.id === pending.id)) return lanes;
  return [...lanes, pending].toSorted((a, b) => laneOrder(a) - laneOrder(b));
}
