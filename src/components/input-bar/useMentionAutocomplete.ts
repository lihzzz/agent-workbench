import { useState, useRef, useEffect, useCallback, useMemo } from "react";

// ── SVG icon strings for DOM-created mention chips ──
// (Can't use React components in DOM-created elements)

const FILE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0 text-muted-foreground"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`;
const FOLDER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0 text-blue-400"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;

export interface MentionEntry {
  path: string;
  isDir: boolean;
}

export interface IndexedMentionEntry extends MentionEntry {
  lowerPath: string;
  depth: number;
}

interface RankedMentionEntry extends IndexedMentionEntry {
  score: number;
}

const MAX_MENTION_RESULTS = 12;

export interface UseMentionAutocompleteOptions {
  projectPath?: string;
  editableRef: React.RefObject<HTMLDivElement | null>;
}

function compareDefaultMentionOrder(
  a: IndexedMentionEntry,
  b: IndexedMentionEntry,
) {
  if (a.depth !== b.depth) return a.depth - b.depth;
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
  return a.path.localeCompare(b.path);
}

function getMentionScore(
  query: string,
  lowerQuery: string,
  entry: IndexedMentionEntry,
): number {
  const target = entry.path;
  const lowerTarget = entry.lowerPath;

  if (lowerTarget.startsWith(lowerQuery)) return 100 + 1 / target.length;
  if (lowerTarget.includes(lowerQuery)) return 50 + 1 / target.length;

  let qi = 0;
  for (let ti = 0; ti < lowerTarget.length && qi < lowerQuery.length; ti++) {
    if (lowerTarget[ti] === lowerQuery[qi]) qi++;
  }
  if (qi === query.length) return 10 + qi / target.length;

  return 0;
}

function insertRankedMention(
  ranked: RankedMentionEntry[],
  entry: RankedMentionEntry,
) {
  if (
    ranked.length === MAX_MENTION_RESULTS &&
    entry.score <= ranked[ranked.length - 1].score
  ) {
    return;
  }

  let index = ranked.length;
  while (index > 0 && entry.score > ranked[index - 1].score) {
    index--;
  }

  ranked.splice(index, 0, entry);
  if (ranked.length > MAX_MENTION_RESULTS) ranked.pop();
}

export function getMentionResults(
  entries: IndexedMentionEntry[],
  query: string,
  mentionedPaths: ReadonlySet<string> = new Set(),
): MentionEntry[] {
  if (!query) {
    const results: MentionEntry[] = [];
    for (const entry of entries) {
      if (mentionedPaths.has(entry.path)) continue;
      results.push({ path: entry.path, isDir: entry.isDir });
      if (results.length === MAX_MENTION_RESULTS) break;
    }
    return results;
  }

  const lowerQuery = query.toLowerCase();
  const ranked: RankedMentionEntry[] = [];

  for (const entry of entries) {
    if (mentionedPaths.has(entry.path)) continue;
    const score = getMentionScore(query, lowerQuery, entry);
    if (score <= 0) continue;
    insertRankedMention(ranked, { ...entry, score });
  }

  return ranked.map((entry) => ({ path: entry.path, isDir: entry.isDir }));
}

export function useMentionAutocomplete({
  projectPath,
  editableRef,
}: UseMentionAutocompleteOptions) {
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [fileCache, setFileCache] = useState<{
    files: string[];
    dirs: string[];
  } | null>(null);

  const mentionListRef = useRef<HTMLDivElement>(null);
  const mentionStartNode = useRef<Node | null>(null);
  const mentionStartOffset = useRef<number>(0);
  const fileCacheFetchIdRef = useRef(0);
  const fileCacheRefreshTimerRef = useRef<ReturnType<typeof setTimeout>>(
    undefined,
  );

  // ── File cache management ──

  const refreshFileCache = useCallback(async (cwd: string) => {
    const fetchId = ++fileCacheFetchIdRef.current;
    const result = await window.claude.files.list(cwd);
    if (fetchId !== fileCacheFetchIdRef.current) return;
    setFileCache(result);
  }, []);

  const scheduleFileCacheRefresh = useCallback(
    (cwd: string) => {
      clearTimeout(fileCacheRefreshTimerRef.current);
      fileCacheRefreshTimerRef.current = setTimeout(() => {
        void refreshFileCache(cwd);
      }, 150);
    },
    [refreshFileCache],
  );

  // Fetch and keep the mention file cache fresh for the active project.
  useEffect(() => {
    if (!projectPath) {
      fileCacheFetchIdRef.current += 1;
      clearTimeout(fileCacheRefreshTimerRef.current);
      setFileCache(null);
      return;
    }

    setFileCache(null);
    void refreshFileCache(projectPath);
    void window.claude.files.watch(projectPath);

    const unsubscribe = window.claude.files.onChanged(({ cwd }) => {
      if (cwd !== projectPath) return;
      scheduleFileCacheRefresh(projectPath);
    });

    const refreshOnFocus = () => scheduleFileCacheRefresh(projectPath);
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") {
        scheduleFileCacheRefresh(projectPath);
      }
    };

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisible);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisible);
      clearTimeout(fileCacheRefreshTimerRef.current);
      void window.claude.files.unwatch(projectPath);
    };
  }, [projectPath, refreshFileCache, scheduleFileCacheRefresh]);

  // ── Filtered mention results (fixed: useMemo instead of useCallback) ──

  const indexedEntries = useMemo<IndexedMentionEntry[]>(() => {
    if (!fileCache) return [];

    const entries: IndexedMentionEntry[] = [
      ...fileCache.dirs.map((path) => ({
        path,
        lowerPath: path.toLowerCase(),
        depth: path.split("/").length,
        isDir: true,
      })),
      ...fileCache.files.map((path) => ({
        path,
        lowerPath: path.toLowerCase(),
        depth: path.split("/").length,
        isDir: false,
      })),
    ];

    entries.sort(compareDefaultMentionOrder);
    return entries;
  }, [fileCache]);

  const results = useMemo(() => {
    if (!showMentions || indexedEntries.length === 0) return [];

    // Filter out paths already mentioned as chips
    const mentionedPaths = new Set<string>();
    if (editableRef.current) {
      editableRef.current
        .querySelectorAll("[data-mention-path]")
        .forEach((el) => {
          const p = el.getAttribute("data-mention-path");
          if (p) mentionedPaths.add(p);
        });
    }
    return getMentionResults(indexedEntries, mentionQuery, mentionedPaths);
  }, [showMentions, indexedEntries, mentionQuery, editableRef]);

  // Clamp mention index when results shrink
  useEffect(() => {
    if (mentionIndex >= results.length) {
      setMentionIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, mentionIndex]);

  // Scroll active mention into view
  useEffect(() => {
    if (!mentionListRef.current) return;
    const active =
      mentionListRef.current.querySelector("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [mentionIndex]);

  // ── Mention lifecycle ──

  const closeMentions = useCallback(() => {
    setShowMentions(false);
    setMentionQuery("");
    setMentionIndex(0);
    mentionStartNode.current = null;
    mentionStartOffset.current = 0;
  }, []);

  /** Insert a mention chip into the contentEditable at the current @-trigger position. */
  const selectMention = useCallback(
    (entry: MentionEntry) => {
      const el = editableRef.current;
      const node = mentionStartNode.current;
      const sel = window.getSelection();
      if (!el || !node || !sel || !sel.rangeCount) {
        closeMentions();
        return;
      }

      // Delete the @query text (from @ to current cursor position)
      const range = document.createRange();
      range.setStart(node, mentionStartOffset.current);
      const curRange = sel.getRangeAt(0);
      range.setEnd(curRange.startContainer, curRange.startOffset);

      // Check if @# was used (deep folder mode)
      const deletedText = range.toString();
      const isDeepMode = deletedText.startsWith("@#");
      const isDeepDir = isDeepMode && entry.isDir;

      range.deleteContents();

      // Create chip element
      const chip = document.createElement("span");
      chip.contentEditable = "false";
      chip.className = isDeepDir
        ? "mention-chip inline-flex items-center gap-1 rounded-md bg-primary/60 px-1.5 py-0.5 text-xs text-primary-foreground font-mono align-baseline cursor-default select-none"
        : "mention-chip inline-flex items-center gap-1 rounded-md bg-accent/60 px-1.5 py-0.5 text-xs text-accent-foreground font-mono align-baseline cursor-default select-none";
      chip.setAttribute("data-mention-path", entry.path);
      chip.setAttribute("data-mention-dir", String(entry.isDir));
      if (isDeepDir) {
        chip.setAttribute("data-mention-deep", "true");
      }
      chip.innerHTML = `${entry.isDir ? FOLDER_ICON_SVG : FILE_ICON_SVG}<span>${isDeepDir ? "#" : ""}${entry.path}</span>`;

      // Insert chip at cursor
      range.insertNode(chip);

      // Add space after chip so cursor has somewhere to go
      const space = document.createTextNode(" ");
      chip.after(space);

      // Move cursor after the space
      const newRange = document.createRange();
      newRange.setStartAfter(space);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);

      closeMentions();

      // Signal that content changed (caller should update hasContent)
      return true;
    },
    [editableRef, closeMentions],
  );

  /** Detect @ trigger from the current cursor position in the contentEditable. */
  const detectMentionTrigger = useCallback(
    (node: Node, offset: number) => {
      if (node.nodeType !== Node.TEXT_NODE) {
        if (showMentions) closeMentions();
        return;
      }

      const nodeText = node.textContent ?? "";
      const scanStart = Math.max(0, offset - 256);
      const textBefore = nodeText.slice(scanStart, offset);
      const atMatch = textBefore.match(/(^|[\s])@(#?)([^\s]*)$/);

      if (atMatch && projectPath) {
        mentionStartNode.current = node;
        mentionStartOffset.current =
          scanStart + textBefore.lastIndexOf("@");
        setMentionQuery(atMatch[3]);
        setShowMentions(true);
        setMentionIndex(0);
      } else {
        if (showMentions) closeMentions();
      }
    },
    [showMentions, closeMentions, projectPath],
  );

  return {
    showMentions,
    mentionIndex,
    setMentionIndex,
    results,
    mentionListRef,
    closeMentions,
    selectMention,
    detectMentionTrigger,
  };
}
