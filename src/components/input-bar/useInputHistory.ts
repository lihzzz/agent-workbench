import { useCallback, useEffect, useRef, useState } from "react";

/**
 * CLI-style input history for the chat composer.
 *
 * Maintains a per-project ring buffer of previously submitted messages plus a
 * browse cursor, mirroring shell history semantics:
 *   - Pressing Up recalls older entries (recallPrev)
 *   - Pressing Down recalls newer entries, then restores the in-progress draft
 *     once you move past the most recent entry (recallNext)
 *
 * Newest entry lives at the end of `entries`. Consecutive duplicates are
 * collapsed and the buffer is capped at MAX_ENTRIES. History is persisted to
 * localStorage under a `harnss-` prefixed key (per-project when a projectPath
 * is available, otherwise global), matching the convention in useSettings.ts.
 */

const MAX_ENTRIES = 100;

function storageKey(projectPath: string | undefined): string {
  return projectPath
    ? `harnss-${projectPath}-input-history`
    : "harnss-input-history";
}

function readEntries(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function writeEntries(key: string, entries: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // Storage full / unavailable — history is best-effort, ignore.
  }
}

export interface InputHistory {
  /** Reactive entries in oldest-to-newest storage order. */
  entries: string[];
  /** Append a submitted message and reset the browse cursor. */
  push: (text: string) => void;
  /**
   * Recall the previous (older) entry. On first call, stashes `currentText`
   * so it can be restored later via recallNext. Returns the entry text, or
   * null when there is nothing to recall (empty history).
   */
  recallPrev: (currentText: string) => string | null;
  /**
   * Recall the next (newer) entry. Returns the stashed draft (and exits
   * browsing) when moving past the most recent entry, or null when not
   * currently browsing.
   */
  recallNext: () => string | null;
  /** Clear the browse cursor and stashed draft (call on manual edit/send). */
  reset: () => void;
  /** Whether the user is currently browsing history. */
  isBrowsing: () => boolean;
}

export function useInputHistory(projectPath: string | undefined): InputHistory {
  const key = storageKey(projectPath);

  const [entries, setEntries] = useState<string[]>(() => readEntries(key));
  const entriesRef = useRef<string[]>(entries);
  const keyRef = useRef(key);

  // cursor: index into entries currently shown, or null when not browsing.
  const [cursor, setCursor] = useState<number | null>(null);
  const cursorRef = useRef<number | null>(null);
  const stashedDraftRef = useRef<string>("");

  const setCursorBoth = useCallback((value: number | null) => {
    cursorRef.current = value;
    setCursor(value);
  }, []);

  const reset = useCallback(() => {
    if (cursorRef.current !== null) setCursorBoth(null);
    stashedDraftRef.current = "";
  }, [setCursorBoth]);

  useEffect(() => {
    keyRef.current = key;
    const next = readEntries(key);
    entriesRef.current = next;
    setEntries(next);
    reset();
  }, [key, reset]);

  const push = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      reset();
      if (!trimmed) return;
      const entries = entriesRef.current;
      // Skip if identical to the most recent entry.
      if (entries[entries.length - 1] === trimmed) return;
      const next = [...entries, trimmed];
      if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES);
      entriesRef.current = next;
      setEntries(next);
      writeEntries(keyRef.current, next);
    },
    [reset],
  );

  const recallPrev = useCallback(
    (currentText: string): string | null => {
      const entries = entriesRef.current;
      if (entries.length === 0) return null;

      if (cursorRef.current === null) {
        // Entering history — stash whatever the user was typing.
        stashedDraftRef.current = currentText;
        const idx = entries.length - 1;
        setCursorBoth(idx);
        return entries[idx];
      }

      const nextIdx = Math.max(0, cursorRef.current - 1);
      setCursorBoth(nextIdx);
      return entries[nextIdx];
    },
    [setCursorBoth],
  );

  const recallNext = useCallback((): string | null => {
    if (cursorRef.current === null) return null;
    const entries = entriesRef.current;
    const nextIdx = cursorRef.current + 1;
    if (nextIdx >= entries.length) {
      // Moved past the newest entry — restore the stashed draft and exit.
      const draft = stashedDraftRef.current;
      reset();
      return draft;
    }
    setCursorBoth(nextIdx);
    return entries[nextIdx];
  }, [reset, setCursorBoth]);

  const isBrowsing = useCallback(() => cursor !== null, [cursor]);

  return { entries, push, recallPrev, recallNext, reset, isBrowsing };
}
