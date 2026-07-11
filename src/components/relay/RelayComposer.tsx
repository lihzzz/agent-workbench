import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RelayComposerProps {
  isProcessing: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
}

export function RelayComposer({ isProcessing, onSend, onStop }: RelayComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(async () => {
    const prompt = text.trim();
    if (!prompt || sending) return;
    setSending(true);
    setText("");
    try {
      await onSend(prompt);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [onSend, sending, text]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }, [submit]);

  return (
    <div className="border-t border-border/50 bg-background p-3">
      <div className="flex items-end gap-2 rounded-md border border-border/60 bg-muted/20 p-2 focus-within:border-foreground/20">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message this lane"
          rows={2}
          className="max-h-32 min-h-12 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-5 outline-none placeholder:text-muted-foreground/60"
        />
        {isProcessing ? (
          <Button size="icon" variant="ghost" className="size-8 shrink-0 text-destructive" onClick={() => void onStop()} title="Stop">
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button size="icon" className="size-8 shrink-0" disabled={!text.trim() || sending} onClick={() => void submit()} title="Send">
            <Send className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
