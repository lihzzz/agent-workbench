import { memo, useEffect, useMemo, useState } from "react";
import { History, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface InputHistoryDialogProps {
  open: boolean;
  entries: string[];
  onOpenChange: (open: boolean) => void;
  onSelect: (entry: string) => void;
}

export const InputHistoryDialog = memo(function InputHistoryDialog({
  open,
  entries,
  onOpenChange,
  onSelect,
}: InputHistoryDialogProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const newestFirst = entries.toReversed();
    return normalizedQuery
      ? newestFirst.filter((entry) => entry.toLowerCase().includes(normalizedQuery))
      : newestFirst;
  }, [entries, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[72vh] w-[min(640px,calc(100vw-32px))] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/40 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-muted-foreground" />
            Input History
          </DialogTitle>
          <DialogDescription className="sr-only">
            Search previous prompts and select one to restore it to the composer.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border/30 px-4 py-3">
          <label className="flex h-9 items-center gap-2 rounded-md border border-border/50 bg-background px-3 focus-within:border-foreground/25">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search prompts"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filteredEntries.length > 0 ? (
            <div className="flex flex-col gap-1">
              {filteredEntries.map((entry, index) => (
                <button
                  key={`${entries.length - index}-${entry}`}
                  type="button"
                  onClick={() => onSelect(entry)}
                  className="rounded-md px-3 py-2.5 text-start transition-colors hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.05] focus-visible:outline-none"
                >
                  <span className="line-clamp-3 whitespace-pre-wrap wrap-break-word text-[13px] leading-5 text-foreground/80">
                    {entry}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex min-h-36 items-center justify-center text-sm text-muted-foreground/55">
              No matching prompts
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});
