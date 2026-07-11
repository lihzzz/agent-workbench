import { Fragment, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useState, startTransition, memo, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { measureElement as measureVirtualElement, useVirtualizer } from "@tanstack/react-virtual";
import { motion } from "motion/react";
import { Loader2, Minus } from "lucide-react";
import type { UIMessage } from "@/types";
import { AgentIcon } from "./AgentIcon";
import { getAgentIcon } from "@/lib/engine-icons";
import { useAgentContext } from "./AgentContext";
import { MessageBubble } from "./MessageBubble";
import { SummaryBlock } from "./SummaryBlock";
import { ToolCall } from "./ToolCall";
import { ToolGroupBlock } from "./ToolGroupBlock";
import { TurnChangesSummary } from "./TurnChangesSummary";
import { extractTurnSummaries } from "@/lib/chat/turn-changes";
import type { TurnSummary } from "@/lib/chat/turn-changes";
import { computeToolGroups, type ToolGroup, type ToolGroupInfo } from "@/lib/workspace/tool-groups";
import { computeAssistantTurnDividerLabels } from "@/lib/chat/assistant-turn-divider";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { ChatUiStateProvider } from "@/components/chat-ui-state";
import {
  BOTTOM_LOCK_THRESHOLD_PX,
  USER_SCROLL_INTENT_WINDOW_MS,
  getTopScrollProgress,
  isWithinBottomLockThreshold,
  shouldUnlockBottomLock,
} from "@/lib/chat/scroll";
import {
  VIRTUALIZER_OVERSCAN,
  computeTailStartIndex,
  estimateRowHeight,
  getCachedMeasuredHeight,
  setCachedMeasuredHeight,
} from "@/lib/chat/virtualization";
import { CHAT_ROW_CLASS } from "@/components/lib/chat-layout";
import { useSettingsStore } from "@/stores/settings-store";

// ── Row model ──

export type RowDescriptor =
  | { kind: "message"; msg: UIMessage; originalIndex: number }
  | { kind: "tool_group"; group: ToolGroup; originalIndex: number; groupTurnSummary?: TurnSummary }
  | { kind: "turn_summary"; summary: TurnSummary }
  | { kind: "processing" };

const EMPTY_TOOL_GROUP_INFO: ToolGroupInfo = {
  groups: new Map(),
  groupedIndices: new Set(),
};
const EMPTY_STRING_SET: Set<string> = new Set();
const PROCESSING_ROW: RowDescriptor = { kind: "processing" };
const CHAT_TOP_PADDING_PX = 56;
const CHAT_BOTTOM_PADDING_PX = 144;
const CHAT_EXTRA_BOTTOM_PADDING_PX = 280;
const CHAT_COMPOSER_CLEARANCE_PX = 24;
const NARROW_CHAT_MESSAGE_WIDTH_THRESHOLD_PX = 900;

// ── Module-level pure functions (rerender-no-inline-components, rendering-hoist-jsx) ──

function buildRows(
  messages: UIMessage[],
  toolGroups: Map<number, ToolGroup>,
  groupedIndices: Set<number>,
  turnSummaryByEndIndex: Map<number, TurnSummary>,
  showProcessingIndicator: boolean,
): RowDescriptor[] {
  const rows: RowDescriptor[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "tool_call") {
      const group = toolGroups.get(i);
      if (group) {
        // Collect turn summaries inside the group range
        let groupTurnSummary: TurnSummary | undefined;
        for (let gi = group.startIndex; gi <= group.endIndex; gi++) {
          const ts = turnSummaryByEndIndex.get(gi);
          if (ts) groupTurnSummary = ts;
        }
        rows.push({ kind: "tool_group", group, originalIndex: i, groupTurnSummary });
        continue;
      }
      if (groupedIndices.has(i)) continue;
      rows.push({ kind: "message", msg, originalIndex: i });
    } else if (msg.role === "tool_result") {
      continue;
    } else if (groupedIndices.has(i)) {
      continue;
    } else {
      rows.push({ kind: "message", msg, originalIndex: i });
    }

    // Append turn summary after this row if applicable
    const turnSummary = turnSummaryByEndIndex.get(i);
    if (turnSummary) {
      rows.push({ kind: "turn_summary", summary: turnSummary });
    }
  }

  if (showProcessingIndicator) {
    rows.push(PROCESSING_ROW);
  }

  return rows;
}

function getRowKey(row: RowDescriptor): string {
  if (row.kind === "processing") return "__processing__";
  if (row.kind === "turn_summary") return `ts-${row.summary.userMessageId}`;
  if (row.kind === "tool_group") return `group-${row.group.tools[0].id}`;
  return row.msg.id;
}

function canReuseRowDescriptor(previous: RowDescriptor | undefined, next: RowDescriptor): boolean {
  if (!previous) return false;

  if (next.kind === "processing") {
    return previous.kind === "processing";
  }

  if (next.kind === "turn_summary") {
    return previous.kind === "turn_summary" && previous.summary === next.summary;
  }

  if (next.kind === "tool_group") {
    return previous.kind === "tool_group" &&
      previous.group === next.group &&
      previous.originalIndex === next.originalIndex &&
      previous.groupTurnSummary === next.groupTurnSummary;
  }

  return previous.kind === "message" &&
    previous.msg === next.msg &&
    previous.originalIndex === next.originalIndex;
}

// ── ChatMessageRow (module-level, memo with custom comparator) ──

interface ChatMessageRowProps {
  row: RowDescriptor;
  showThinking: boolean;
  animatingGroupKeys: Set<string>;
  assistantTurnDividerLabels: Map<string, string>;
  continuationIds: Set<string>;
  sendNextId?: string | null;
  onRevert?: (checkpointId: string) => void;
  onFullRevert?: (checkpointId: string) => void;
  onSendQueuedNow?: (messageId: string) => void;
  onUnqueueQueuedMessage?: (messageId: string) => void;
}

const ChatMessageRow = memo(function ChatMessageRow({
  row,
  showThinking,
  animatingGroupKeys,
  assistantTurnDividerLabels,
  continuationIds,
  sendNextId,
  onRevert,
  onFullRevert,
  onSendQueuedNow,
  onUnqueueQueuedMessage,
}: ChatMessageRowProps) {
  // ── Display preferences from Zustand store ──
  const autoExpandTools = useSettingsStore((s) => s.autoExpandTools);
  const expandEditToolCallsByDefault = useSettingsStore((s) => s.expandEditToolCallsByDefault);
  const showToolIcons = useSettingsStore((s) => s.showToolIcons);
  const coloredToolIcons = useSettingsStore((s) => s.coloredToolIcons);
  if (row.kind === "processing") {
    return (
      <div className={`flex justify-start ${CHAT_ROW_CLASS}`}>
        <div className="flex items-center gap-1.5 text-xs">
          <Minus className="h-3 w-3 text-foreground/40" />
          <TextShimmer as="span" className="italic opacity-60" duration={1.8} spread={1.5}>
            Planning next moves
          </TextShimmer>
        </div>
      </div>
    );
  }

  if (row.kind === "turn_summary") {
    return <TurnChangesSummary summary={row.summary} />;
  }

  if (row.kind === "tool_group") {
    const groupKey = row.group.tools[0].id;
    const isNewGroup = animatingGroupKeys.has(groupKey);
    return (
      <Fragment>
        <ToolGroupBlock
          tools={row.group.tools}
          messages={row.group.messages}
          showThinking={showThinking}
          autoExpandTools={autoExpandTools}
          expandEditToolCallsByDefault={expandEditToolCallsByDefault}
          showToolIcons={showToolIcons}
          coloredToolIcons={coloredToolIcons}
          disableCollapseAnimation
          animate={isNewGroup}
        />
        {row.groupTurnSummary ? <TurnChangesSummary summary={row.groupTurnSummary} /> : null}
      </Fragment>
    );
  }

  // row.kind === "message"
  const msg = row.msg;

  if (msg.role === "summary") {
    return (
      <div data-message-id={msg.id}>
        <SummaryBlock message={msg} />
      </div>
    );
  }

  if (msg.role === "tool_call") {
    return (
      <div data-message-id={msg.id}>
        <ToolCall
          message={msg}
          autoExpandTools={autoExpandTools}
          expandEditToolCallsByDefault={expandEditToolCallsByDefault}
          showToolIcons={showToolIcons}
          coloredToolIcons={coloredToolIcons}
          disableCollapseAnimation
        />
      </div>
    );
  }

  return (
    <div data-message-id={msg.id}>
      <MessageBubble
        message={msg}
        showThinking={showThinking}
        assistantTurnDividerLabel={assistantTurnDividerLabels.get(msg.id)}
        isContinuation={continuationIds.has(msg.id)}
        isSendNextQueued={sendNextId === msg.id}
        onRevert={onRevert}
        onFullRevert={onFullRevert}
        onSendQueuedNow={onSendQueuedNow}
        onUnqueueQueued={onUnqueueQueuedMessage}
      />
    </div>
  );
}, (prev, next) =>
  prev.row === next.row &&
  prev.showThinking === next.showThinking &&
  prev.animatingGroupKeys === next.animatingGroupKeys &&
  prev.assistantTurnDividerLabels === next.assistantTurnDividerLabels &&
  prev.continuationIds === next.continuationIds &&
  prev.sendNextId === next.sendNextId &&
  prev.onRevert === next.onRevert &&
  prev.onFullRevert === next.onFullRevert &&
  prev.onSendQueuedNow === next.onSendQueuedNow &&
  prev.onUnqueueQueuedMessage === next.onUnqueueQueuedMessage,
);

// ── ChatViewProps ──

interface ChatViewProps {
  messages: UIMessage[];
  isProcessing: boolean;
  showThinking: boolean;
  extraBottomPadding?: boolean;
  scrollToMessageId?: string;
  onScrolledToMessage?: () => void;
  sessionId?: string;
  onRevert?: (checkpointId: string) => void;
  onFullRevert?: (checkpointId: string) => void;
  onTopScrollProgress?: (progress: number) => void;
  onSendQueuedNow?: (messageId: string) => void;
  onUnqueueQueuedMessage?: (messageId: string) => void;
  sendNextId?: string | null;
  /** Current space ID — included in remount key so space switches show spinner immediately */
  spaceId?: string;
}

// ── ChatView (outer, handles empty state) ──

export const ChatView = memo(function ChatView(props: ChatViewProps) {
  const { messages } = props;
  const { agents, selectedAgent, handleAgentChange } = useAgentContext();

  if (messages.length === 0) {
    const showAgentPicker = agents.length > 1;

    return (
      <div className="flex flex-1 items-center justify-center">
        <motion.div
          className="flex flex-col items-center gap-5"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 0.68, 0, 1] }}
        >
          <div className="flex flex-col items-center gap-3">
            <h2
              className="text-3xl italic text-foreground/20"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
            >
              Send a message to start
            </h2>
            <p
              className="text-sm italic text-muted-foreground/30"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
            >
              Your conversation will appear here
            </p>
          </div>

          {showAgentPicker && (
            <motion.div
              className="flex items-center gap-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.4, ease: [0.22, 0.68, 0, 1] }}
            >
              {agents.map((agent) => {
                const isSelected = agent.engine === "claude"
                  ? selectedAgent == null || selectedAgent.engine === "claude"
                  : selectedAgent?.id === agent.id;

                return (
                  <button
                    key={agent.id}
                    title={agent.name}
                    onClick={() => handleAgentChange(agent.engine === "claude" ? null : agent)}
                    className={`rounded-full p-2 transition-all ${
                      isSelected
                        ? "bg-foreground/[0.06] ring-1 ring-foreground/[0.08] scale-110"
                        : "opacity-30 hover:opacity-60 hover:scale-105"
                    }`}
                  >
                    <AgentIcon
                      icon={getAgentIcon(agent)}
                      size={20}
                    />
                  </button>
                );
              })}
            </motion.div>
          )}
        </motion.div>
      </div>
    );
  }

  // Key by spaceId + sessionId + first message ID to force a clean remount on space or session switch.
  // spaceId ensures the spinner shows immediately when switching spaces (before the 60ms debounced
  // session switch fires). sessionId + messages[0]?.id handle same-space session switches.
  const contentKey = `${props.spaceId ?? "s"}-${props.sessionId ?? "__empty__"}-${messages[0]?.id ?? ""}`;
  return <ChatViewContent key={contentKey} {...props} />;
});

// ── ChatViewContent (inner, module-level) ──

function ChatViewContent({
  messages, isProcessing, showThinking, extraBottomPadding, scrollToMessageId, onScrolledToMessage,
  sessionId, onRevert, onFullRevert, onTopScrollProgress,
  onSendQueuedNow, onUnqueueQueuedMessage, sendNextId,
}: ChatViewProps) {
  // ── Display preferences from Zustand store (only those used directly in ChatViewContent) ──
  const autoGroupTools = useSettingsStore((s) => s.autoGroupTools);
  const avoidGroupingEdits = useSettingsStore((s) => s.avoidGroupingEdits);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [useFullWidthMessages, setUseFullWidthMessages] = useState(false);

  // ── Scroll state (refs, not state — rerender-use-ref-transient-values) ──
  const bottomLockedRef = useRef(true);
  const [composerInset, setComposerInset] = useState(0);

  // ── Deferred mount: show spinner for one frame, then render content ──
  // Prevents UI freeze on session/space switch by deferring heavy work.
  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      startTransition(() => setContentReady(true));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const userScrollIntentRef = useRef(0);
  const scrollRafPending = useRef(false);
  const cachedRowsByKeyRef = useRef<Map<string, RowDescriptor>>(new Map());
  // Store callbacks in refs to avoid effect re-subscriptions (advanced-event-handler-refs)
  const onTopScrollProgressRef = useRef(onTopScrollProgress);
  onTopScrollProgressRef.current = onTopScrollProgress;
  const onScrolledToMessageRef = useRef(onScrolledToMessage);
  onScrolledToMessageRef.current = onScrolledToMessage;
  const lastTopProgressRef = useRef(-1);
  const bottomPadding = useMemo(() => {
    const fallbackPadding = extraBottomPadding ? CHAT_EXTRA_BOTTOM_PADDING_PX : CHAT_BOTTOM_PADDING_PX;
    if (composerInset <= 0) return fallbackPadding;
    return Math.max(fallbackPadding, composerInset + CHAT_COMPOSER_CLEARANCE_PX);
  }, [composerInset, extraBottomPadding]);

  // ── Single-pass partition: queued vs non-queued (js-combine-iterations) ──
  const { nonQueuedMessages, queuedMessages } = useMemo(() => {
    const hasQueued = messages.some((m) => m.isQueued);
    if (!hasQueued) {
      return { nonQueuedMessages: messages, queuedMessages: [] as UIMessage[] };
    }
    const nonQueued: UIMessage[] = [];
    const queued: UIMessage[] = [];
    for (const m of messages) {
      (m.isQueued ? queued : nonQueued).push(m);
    }
    return { nonQueuedMessages: nonQueued, queuedMessages: queued };
  }, [messages]);

  // ── Continuation IDs (O(n) forward pass, cached by message count) ──
  // Roles don't change during streaming — only content/thinking updates.
  // Cache by message count so we skip the O(n) scan during content streaming.
  const cachedContinuationRef = useRef<{ len: number; qLen: number; ids: Set<string> }>({ len: 0, qLen: 0, ids: new Set() });
  const continuationIds = useMemo(() => {
    const cached = cachedContinuationRef.current;
    if (nonQueuedMessages.length === cached.len && queuedMessages.length === cached.qLen) {
      return cached.ids;
    }
    const ids = new Set<string>();
    let lastRole: string | null = null;
    const allMessages = queuedMessages.length > 0
      ? [...nonQueuedMessages, ...queuedMessages]
      : nonQueuedMessages;
    for (const msg of allMessages) {
      if (msg.role === "assistant") {
        if (lastRole === "assistant" || lastRole === "tool_call" || lastRole === "tool_result" || lastRole === "system" || lastRole === "summary") {
          ids.add(msg.id);
        }
        lastRole = "assistant";
      } else if (msg.role === "user") {
        lastRole = "user";
      } else {
        if (lastRole !== null) {
          lastRole = lastRole === "user" ? "user" : lastRole;
        }
      }
    }
    cachedContinuationRef.current = { len: nonQueuedMessages.length, qLen: queuedMessages.length, ids };
    return ids;
  }, [nonQueuedMessages, queuedMessages]);

  // ── Structural identity key for expensive derived data ──
  // Primitive string key so useMemo can do stable dependency comparison.
  // Recomputes turn summaries, divider labels, and tool groups only when
  // message structure actually changes (new message, tool result arrives, processing toggles).
  const structKey = useMemo(() => {
    let toolResultCount = 0;
    for (let i = nonQueuedMessages.length - 1; i >= Math.max(0, nonQueuedMessages.length - 10); i--) {
      if (nonQueuedMessages[i].role === "tool_call" && nonQueuedMessages[i].toolResult) toolResultCount++;
    }
    const lastId = nonQueuedMessages[nonQueuedMessages.length - 1]?.id ?? "";
    return `${nonQueuedMessages.length}:${lastId}:${toolResultCount}:${isProcessing}`;
  }, [nonQueuedMessages, isProcessing]);

  // ── Turn summaries (rerender-derived-state-no-effect) ──
  const turnSummaryByEndIndex = useMemo(() => {
    const summaries = extractTurnSummaries(nonQueuedMessages, isProcessing);
    const map = new Map<number, TurnSummary>();
    for (const s of summaries) {
      map.set(s.endMessageIndex, s);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structKey]);

  const assistantTurnDividerLabels = useMemo(() => {
    return computeAssistantTurnDividerLabels(nonQueuedMessages, isProcessing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structKey]);

  // ── Tool groups (js-index-maps, js-set-map-lookups) ──
  const { groups: toolGroups, groupedIndices } = useMemo(() => {
    if (!autoGroupTools) return EMPTY_TOOL_GROUP_INFO;
    return computeToolGroups(nonQueuedMessages, isProcessing, avoidGroupingEdits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structKey, autoGroupTools, avoidGroupingEdits]);

  // ── Tool group animation tracking ──
  const finalizedGroupKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const group of toolGroups.values()) {
      if (group.isFinalized && group.tools.length > 0) {
        keys.add(group.tools[0].id);
      }
    }
    return keys;
  }, [toolGroups]);

  const knownGroupKeysRef = useRef<Set<string>>(new Set());
  const seenUngroupedToolKeysRef = useRef<Set<string>>(new Set());
  const trackedSessionIdRef = useRef<string | undefined | null>(null);

  if (trackedSessionIdRef.current !== sessionId) {
    trackedSessionIdRef.current = sessionId;
    knownGroupKeysRef.current = new Set();
    seenUngroupedToolKeysRef.current = new Set();
  }

  const visibleUngroupedToolKeys = useMemo(() => {
    const keys = new Set<string>();
    nonQueuedMessages.forEach((msg, index) => {
      if (msg.role !== "tool_call") return;
      const group = toolGroups.get(index);
      if (group?.isFinalized || groupedIndices.has(index)) return;
      keys.add(msg.id);
    });
    return keys;
  }, [groupedIndices, nonQueuedMessages, toolGroups]);

  const animatingGroupKeys = useMemo(() => {
    const found: string[] = [];
    for (const key of finalizedGroupKeys) {
      if (!knownGroupKeysRef.current.has(key) && seenUngroupedToolKeysRef.current.has(key)) {
        found.push(key);
      }
    }
    return found.length === 0 ? EMPTY_STRING_SET : new Set(found);
  }, [finalizedGroupKeys]);

  useEffect(() => {
    if (visibleUngroupedToolKeys.size === 0) return;
    const seen = seenUngroupedToolKeysRef.current;
    for (const key of visibleUngroupedToolKeys) seen.add(key);
  }, [visibleUngroupedToolKeys]);

  useEffect(() => {
    const known = knownGroupKeysRef.current;
    for (const key of finalizedGroupKeys) known.add(key);
  }, [finalizedGroupKeys]);

  // ── Processing indicator (O(n) scan, cached when streaming) ──
  const cachedProcessingRef = useRef<{ processing: boolean; value: boolean }>({ processing: false, value: false });
  const showProcessingIndicator = useMemo(() => {
    if (!isProcessing) {
      cachedProcessingRef.current = { processing: false, value: false };
      return false;
    }
    // Once hidden during this processing turn, stay hidden
    if (cachedProcessingRef.current.processing && !cachedProcessingRef.current.value) {
      return false;
    }
    const result = !nonQueuedMessages.some((m) =>
      (m.role === "assistant" && m.isStreaming && (m.content || m.thinking)) ||
      (m.role === "tool_call" && !m.toolResult),
    );
    cachedProcessingRef.current = { processing: true, value: result };
    return result;
  }, [isProcessing, nonQueuedMessages]);

  const rows = useMemo(() => {
    const builtRows = buildRows(
      nonQueuedMessages,
      toolGroups,
      groupedIndices,
      turnSummaryByEndIndex,
      showProcessingIndicator,
    );
    if (queuedMessages.length > 0) {
      builtRows.push(...queuedMessages.map((msg, index) => ({
        kind: "message" as const,
        msg,
        originalIndex: nonQueuedMessages.length + index,
      })));
    }

    const previousRowsByKey = cachedRowsByKeyRef.current;
    const nextRowsByKey = new Map<string, RowDescriptor>();
    const stableRows = builtRows.map((row) => {
      const key = getRowKey(row);
      const previousRow = previousRowsByKey.get(key);
      const stableRow = previousRow && canReuseRowDescriptor(previousRow, row)
        ? previousRow
        : row;
      nextRowsByKey.set(key, stableRow);
      return stableRow;
    });

    cachedRowsByKeyRef.current = nextRowsByKey;
    return stableRows;
  }, [
    groupedIndices,
    nonQueuedMessages,
    queuedMessages,
    showProcessingIndicator,
    toolGroups,
    turnSummaryByEndIndex,
  ]);

  const tailStart = useMemo(
    () => computeTailStartIndex(rows, isProcessing),
    [isProcessing, rows],
  );
  const historicalRows = useMemo(() => rows.slice(0, tailStart), [rows, tailStart]);
  const tailRows = useMemo(() => rows.slice(tailStart), [rows, tailStart]);
  const getHistoricalRowKey = useCallback(
    (index: number) => getRowKey(historicalRows[index]),
    [historicalRows],
  );
  const estimateHistoricalRow = useCallback((index: number) => {
    const row = historicalRows[index];
    return getCachedMeasuredHeight(getRowKey(row)) ?? estimateRowHeight(row);
  }, [historicalRows]);
  const measureHistoricalRow = useCallback((
    element: HTMLDivElement,
    entry: ResizeObserverEntry | undefined,
    instance: Parameters<typeof measureVirtualElement<HTMLDivElement>>[2],
  ) => {
    const height = measureVirtualElement(element, entry, instance);
    const rowKey = element.dataset.rowKey;
    if (rowKey && height > 0) setCachedMeasuredHeight(rowKey, height);
    return height;
  }, []);
  const historicalVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: historicalRows.length,
    getScrollElement: () => scrollContainerRef.current,
    getItemKey: getHistoricalRowKey,
    estimateSize: estimateHistoricalRow,
    measureElement: measureHistoricalRow,
    overscan: VIRTUALIZER_OVERSCAN,
    scrollMargin: CHAT_TOP_PADDING_PX,
    enabled: contentReady,
  });
  const virtualRows = historicalVirtualizer.getVirtualItems();
  const historicalHeight = historicalVirtualizer.getTotalSize();

  // ── Scroll handling (rerender-defer-reads, rerender-use-ref-transient-values) ──

  const publishTopProgress = useCallback((progress: number) => {
    const clamped = Math.max(0, Math.min(1, progress));
    const last = lastTopProgressRef.current;
    if (last < 0 || Math.abs(clamped - last) >= 0.01 || clamped === 0 || clamped === 1) {
      lastTopProgressRef.current = clamped;
      onTopScrollProgressRef.current?.(clamped);
    }
  }, []);

  const followBottomNow = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el || !bottomLockedRef.current) return;
    el.scrollTop = el.scrollHeight;
    publishTopProgress(getTopScrollProgress(el.scrollTop));
  }, [publishTopProgress]);

  useLayoutEffect(() => {
    if (!contentReady) return;
    if (rows.length === 0) return;
    followBottomNow();
  }, [bottomPadding, contentReady, followBottomNow, rows.length]);

  useLayoutEffect(() => {
    if (!contentReady) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    const composer = el.parentElement?.querySelector<HTMLElement>("[data-chat-composer]");
    if (!composer) {
      setComposerInset((prev) => (prev === 0 ? prev : 0));
      return;
    }

    const updateComposerInset = () => {
      const nextInset = Math.ceil(composer.getBoundingClientRect().height);
      setComposerInset((prev) => (prev === nextInset ? prev : nextInset));
    };

    updateComposerInset();

    const observer = new ResizeObserver(() => {
      updateComposerInset();
      followBottomNow();
    });
    observer.observe(composer);

    return () => observer.disconnect();
  }, [contentReady, followBottomNow]);

  useLayoutEffect(() => {
    if (!contentReady) return;
    const el = scrollContainerRef.current;
    const inner = el?.firstElementChild;
    if (!el || !inner) return;

    const observer = new ResizeObserver(() => {
      followBottomNow();
    });
    observer.observe(el);
    observer.observe(inner);

    return () => observer.disconnect();
  }, [contentReady, followBottomNow]);

  useLayoutEffect(() => {
    if (!contentReady) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    const updateMessageWidths = () => {
      const next = el.clientWidth <= NARROW_CHAT_MESSAGE_WIDTH_THRESHOLD_PX;
      setUseFullWidthMessages((prev) => (prev === next ? prev : next));
    };

    updateMessageWidths();

    const observer = new ResizeObserver(updateMessageWidths);
    observer.observe(el);

    return () => observer.disconnect();
  }, [contentReady]);

  const handleScroll = useCallback(() => {
    if (scrollRafPending.current) return;
    scrollRafPending.current = true;
    requestAnimationFrame(() => {
      scrollRafPending.current = false;
      const el = scrollContainerRef.current;
      if (!el) return;

      const { scrollTop, scrollHeight, clientHeight } = el;

      // Top scroll progress for fade overlay
      publishTopProgress(getTopScrollProgress(scrollTop));

      // Bottom lock detection (rerender-derived-state — boolean, not continuous value)
      const hasRecentUserIntent = Date.now() <= userScrollIntentRef.current;
      if (shouldUnlockBottomLock({ scrollTop, scrollHeight, clientHeight, hasRecentUserIntent, threshold: BOTTOM_LOCK_THRESHOLD_PX })) {
        bottomLockedRef.current = false;
        return;
      }
      // Only re-lock when the USER actively scrolls to the bottom (has recent intent).
      // Without the intent check, programmatic scrollHeight changes during hydration
      // can place the user within the threshold and re-lock, causing forced scroll-to-bottom
      // that fights with the user trying to scroll up.
      if (hasRecentUserIntent && isWithinBottomLockThreshold({ scrollTop, scrollHeight, clientHeight }, BOTTOM_LOCK_THRESHOLD_PX)) {
        bottomLockedRef.current = true;
      }
    });
  }, [publishTopProgress]);

  const markUserIntent = useCallback(() => {
    userScrollIntentRef.current = Date.now() + USER_SCROLL_INTENT_WINDOW_MS;
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    markUserIntent();
  }, [markUserIntent]);

  // ── Passive wheel/touch listeners (compositor-unblocking) ──
  // Must re-run when contentReady changes — on initial mount the scroll container
  // doesn't exist (spinner showing), so listeners aren't attached. When contentReady
  // becomes true the container appears and we need to attach.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener("wheel", markUserIntent, { passive: true });
    el.addEventListener("touchmove", markUserIntent, { passive: true });
    return () => {
      el.removeEventListener("wheel", markUserIntent);
      el.removeEventListener("touchmove", markUserIntent);
    };
  }, [markUserIntent, contentReady]);

  // ── Session switch — force scroll to bottom (rerender-dependencies — primitive dep) ──
  useLayoutEffect(() => {
    if (!sessionId) return;
    bottomLockedRef.current = true;
    userScrollIntentRef.current = 0;
    lastTopProgressRef.current = -1;
    // Scroll immediately — useLayoutEffect fires before browser paints,
    // so setting scrollTop here prevents any visible flicker at scrollTop=0.
    followBottomNow();
    // Post-paint correction: child effects may change DOM heights after mount
    requestAnimationFrame(() => {
      followBottomNow();
    });
  }, [followBottomNow, sessionId]);

  // ── Scroll-to-message (search navigation) ──
  useEffect(() => {
    if (!scrollToMessageId) return;

    const targetIndex = rows.findIndex(
      (row) => row.kind === "message" && row.msg.id === scrollToMessageId,
    );
    if (targetIndex >= 0 && targetIndex < tailStart) {
      bottomLockedRef.current = false;
      historicalVirtualizer.scrollToIndex(targetIndex, { align: "center" });
    }

    let frame = 0;
    const focusTarget = (attempt: number) => {
      const el = scrollContainerRef.current?.querySelector(`[data-message-id="${scrollToMessageId}"]`);
      if (el) {
        bottomLockedRef.current = false;
        el.scrollIntoView({ block: "center" });

        // Flash highlight after scroll settles
        setTimeout(() => {
          el.classList.add("search-highlight");
          setTimeout(() => {
            el.classList.remove("search-highlight");
            onScrolledToMessageRef.current?.();
          }, 1500);
        }, 100);
      } else if (attempt < 4) {
        frame = requestAnimationFrame(() => focusTarget(attempt + 1));
      } else {
        onScrolledToMessageRef.current?.();
      }
    };
    frame = requestAnimationFrame(() => focusTarget(0));
    return () => cancelAnimationFrame(frame);
  }, [historicalVirtualizer, rows, scrollToMessageId, tailStart]);

  // ── Render ──

  if (!contentReady) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-foreground/20" />
      </div>
    );
  }

  const chatContentStyle = {
    paddingTop: `${CHAT_TOP_PADDING_PX}px`,
    paddingBottom: `${bottomPadding}px`,
    "--chat-assistant-message-max-width": useFullWidthMessages ? "100%" : "85%",
    "--chat-user-message-max-width": useFullWidthMessages ? "100%" : "80%",
  } as CSSProperties;

  return (
    <ChatUiStateProvider>
      <div
        ref={scrollContainerRef}
        className="relative min-h-0 flex-1 overflow-y-auto"
        style={{ overscrollBehaviorY: "contain" }}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
      >
        <div style={chatContentStyle}>
          <div className="relative" style={{ height: `${historicalHeight}px` }}>
            {virtualRows.map((virtualRow) => {
              const row = historicalRows[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  ref={historicalVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  data-row-key={getRowKey(row)}
                  className="absolute start-0 top-0 w-full flow-root"
                  style={{ transform: `translateY(${virtualRow.start - CHAT_TOP_PADDING_PX}px)` }}
                >
                  <ChatMessageRow
                    row={row}
                    showThinking={showThinking}
                    animatingGroupKeys={animatingGroupKeys}
                    assistantTurnDividerLabels={assistantTurnDividerLabels}
                    continuationIds={continuationIds}
                    sendNextId={sendNextId}
                    onRevert={onRevert}
                    onFullRevert={onFullRevert}
                    onSendQueuedNow={onSendQueuedNow}
                    onUnqueueQueuedMessage={onUnqueueQueuedMessage}
                  />
                </div>
              );
            })}
          </div>
          {tailRows.map((row) => (
            <div key={getRowKey(row)} className="flow-root">
              <ChatMessageRow
                row={row}
                showThinking={showThinking}
                animatingGroupKeys={animatingGroupKeys}
                assistantTurnDividerLabels={assistantTurnDividerLabels}
                continuationIds={continuationIds}
                sendNextId={sendNextId}
                onRevert={onRevert}
                onFullRevert={onFullRevert}
                onSendQueuedNow={onSendQueuedNow}
                onUnqueueQueuedMessage={onUnqueueQueuedMessage}
              />
            </div>
          ))}
        </div>
      </div>
    </ChatUiStateProvider>
  );
}
