import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { RelayStageRole } from "@/types";
import type { RelayHandoffDraft } from "@/hooks/useRelayOrchestrator";
import { RELAY_RECIPES } from "@/lib/session/handoff";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RelayHandoffDialogProps {
  draft: RelayHandoffDraft | null;
  onOpenChange: (open: boolean) => void;
  onRoleChange: (role: RelayStageRole) => Promise<void>;
  onConfirm: (draft: RelayHandoffDraft) => Promise<boolean>;
}

export function RelayHandoffDialog({
  draft,
  onOpenChange,
  onRoleChange,
  onConfirm,
}: RelayHandoffDialogProps) {
  const [prompt, setPrompt] = useState(draft?.prompt ?? "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setPrompt(draft?.prompt ?? ""), [draft?.prompt]);

  if (!draft) return null;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Hand off lane</DialogTitle>
          <DialogDescription>Review the target role and prompt before creating the next lane.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Target</span>
            <Select value={draft.targetRole} onValueChange={(value) => void onRoleChange(value as RelayStageRole)}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELAY_RECIPES.map((recipe) => (
                  <SelectItem key={recipe.role} value={recipe.role}>{recipe.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={14}
            className="w-full resize-y rounded-md border border-border bg-muted/20 p-3 font-mono text-xs leading-5 outline-none focus:border-foreground/25"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!prompt.trim() || submitting}
            onClick={async () => {
              setSubmitting(true);
              try {
                const success = await onConfirm({ ...draft, prompt: prompt.trim() });
                if (success) onOpenChange(false);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <ArrowRight className="size-4" />
            Create lane
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
