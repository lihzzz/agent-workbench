import { memo, useState, useCallback } from "react";
import { Bot, Plus, Pencil, Trash2, RotateCcw, ArrowLeft, Info, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconPicker } from "@/components/IconPicker";
import { AgentIcon } from "@/components/AgentIcon";
import { SettingsSelect } from "@/components/settings/shared";
import { SELECTABLE_TOOLS, type CustomSubagent } from "@/types";

// ── Types ──

interface SubagentSettingsProps {
  subagents: CustomSubagent[];
  onSave: (subagent: CustomSubagent) => Promise<{ ok?: boolean; error?: string }>;
  onDelete: (id: string) => Promise<{ ok?: boolean; error?: string }>;
}

interface FormState {
  id: string;
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  disallowedTools: string[];
  model: string;
  icon: string;
  iconType: "emoji" | "lucide";
  enabled: boolean;
}

interface FormErrors {
  name?: string;
  description?: string;
  prompt?: string;
  general?: string;
}

const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "inherit", label: "Inherit from session" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

// ── Helpers ──

function emptyForm(): FormState {
  return {
    id: "",
    name: "",
    description: "",
    prompt: "",
    tools: [],
    disallowedTools: [],
    model: "inherit",
    icon: "bot",
    iconType: "lucide",
    enabled: true,
  };
}

function subagentToForm(s: CustomSubagent): FormState {
  const isEmoji = s.icon ? /^\p{Emoji}/u.test(s.icon) : false;
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    prompt: s.prompt,
    tools: s.tools ?? [],
    disallowedTools: s.disallowedTools ?? [],
    model: s.model ?? "inherit",
    icon: s.icon ?? "bot",
    iconType: isEmoji ? "emoji" : "lucide",
    enabled: s.enabled !== false,
  };
}

/** Derive a kebab-case id from a name. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Subagent Card ──

const SubagentCard = memo(function SubagentCard({
  subagent,
  onEdit,
  onDelete,
}: {
  subagent: CustomSubagent;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const disabled = subagent.enabled === false;
  const toolCount = subagent.tools?.length ?? 0;
  const isBuiltIn = subagent.builtIn === true;

  return (
    <div className="group flex items-start gap-3 rounded-lg border border-foreground/[0.06] px-4 py-3 transition-colors hover:border-foreground/[0.1]">
      {/* Icon */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted/40 text-foreground/60">
        <AgentIcon icon={subagent.icon} />
      </div>

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{subagent.name}</span>
          {isBuiltIn && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Shield className="h-2.5 w-2.5" />
              Built-in
            </Badge>
          )}
          {disabled && (
            <Badge variant="secondary" className="text-[10px]">
              Disabled
            </Badge>
          )}
        </div>
        <span className="line-clamp-2 text-xs text-muted-foreground">{subagent.description}</span>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground/70">
          <span className="capitalize">{subagent.model && subagent.model !== "inherit" ? subagent.model : "inherit"}</span>
          <span>·</span>
          <span>{toolCount > 0 ? `${toolCount} tool${toolCount > 1 ? "s" : ""}` : "all tools"}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={onEdit}>
              <Pencil className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">Edit</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              {isBuiltIn ? <RotateCcw className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">{isBuiltIn ? "Reset to default" : "Delete"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});

// ── Tool multi-select ──

function ToolCheckboxGrid({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (tool: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {SELECTABLE_TOOLS.map((tool) => {
        const checked = selected.includes(tool);
        return (
          <button
            key={tool}
            type="button"
            onClick={() => onToggle(tool)}
            className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
              checked
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-foreground/[0.08] text-muted-foreground hover:border-foreground/[0.16]"
            }`}
          >
            <span
              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                checked ? "border-primary bg-primary text-primary-foreground" : "border-foreground/30"
              }`}
            >
              {checked && <span className="text-[9px] leading-none">✓</span>}
            </span>
            <span className="truncate font-mono">{tool}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Subagent Form ──

function SubagentForm({
  initial,
  isEditing,
  existingIds,
  onSave,
  onCancel,
}: {
  initial: FormState;
  isEditing: boolean;
  existingIds: Set<string>;
  onSave: (subagent: CustomSubagent) => Promise<{ ok?: boolean; error?: string }>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const updateField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined, general: undefined }));
  }, []);

  const toggleTool = useCallback((key: "tools" | "disallowedTools", tool: string) => {
    setForm((prev) => {
      const has = prev[key].includes(tool);
      return { ...prev, [key]: has ? prev[key].filter((t) => t !== tool) : [...prev[key], tool] };
    });
  }, []);

  const validate = useCallback((): FormErrors => {
    const e: FormErrors = {};
    if (!form.name.trim()) e.name = "Name is required";
    if (!form.description.trim()) e.description = "Description is required — the main agent uses it to decide when to delegate";
    if (!form.prompt.trim()) e.prompt = "System prompt is required";

    // For new subagents, ensure the derived id is unique
    if (!isEditing) {
      const id = slugify(form.name);
      if (id && existingIds.has(id)) e.name = "A subagent with this name already exists";
      if (!id) e.name = "Name must contain letters or numbers";
    }
    return e;
  }, [form, isEditing, existingIds]);

  const handleSave = useCallback(async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setSaving(true);
    try {
      const subagent: CustomSubagent = {
        id: isEditing ? form.id : slugify(form.name),
        name: form.name.trim(),
        description: form.description.trim(),
        prompt: form.prompt.trim(),
        tools: form.tools.length > 0 ? form.tools : undefined,
        disallowedTools: form.disallowedTools.length > 0 ? form.disallowedTools : undefined,
        model: form.model !== "inherit" ? form.model : undefined,
        icon: form.icon.trim() || undefined,
        enabled: form.enabled,
      };
      const result = await onSave(subagent);
      if (result.ok) {
        onCancel();
      } else {
        setErrors({ general: result.error ?? "Failed to save subagent" });
      }
    } finally {
      setSaving(false);
    }
  }, [form, isEditing, validate, onSave, onCancel]);

  return (
    <div className="flex h-full flex-col">
      {/* Form header */}
      <div className="flex items-center gap-3 border-b border-foreground/[0.06] px-6 py-4">
        <Button variant="ghost" size="icon-xs" onClick={onCancel}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <h2 className="flex-1 text-base font-semibold text-foreground">
          {isEditing ? "Edit Subagent" : "Add Subagent"}
        </h2>
      </div>

      {/* Scrollable body */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 px-6 py-5">
          {errors.general && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {errors.general}
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Name <span className="text-destructive">*</span>
            </label>
            <Input
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="test-runner"
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Description <span className="text-destructive">*</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="Use this subagent to run the test suite and report failures concisely."
              rows={2}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
              aria-invalid={!!errors.description}
            />
            <p className="text-[11px] text-muted-foreground/60">
              When to use this subagent. The main Claude agent reads this to decide whether to delegate automatically.
            </p>
            {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
          </div>

          {/* Prompt */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              System Prompt <span className="text-destructive">*</span>
            </label>
            <textarea
              value={form.prompt}
              onChange={(e) => updateField("prompt", e.target.value)}
              placeholder="You are a test-running specialist. Run the project's tests, then report only the failures with their root cause."
              rows={6}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
              aria-invalid={!!errors.prompt}
            />
            {errors.prompt && <p className="text-xs text-destructive">{errors.prompt}</p>}
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Model
            </label>
            <SettingsSelect
              value={form.model}
              onValueChange={(v) => updateField("model", v)}
              options={MODEL_OPTIONS}
            />
          </div>

          {/* Allowed tools */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Allowed Tools
            </label>
            <ToolCheckboxGrid selected={form.tools} onToggle={(t) => toggleTool("tools", t)} />
            <p className="text-[11px] text-muted-foreground/60">
              Leave empty to inherit all tools from the parent session.
            </p>
          </div>

          {/* Disallowed tools */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Disallowed Tools
            </label>
            <ToolCheckboxGrid
              selected={form.disallowedTools}
              onToggle={(t) => toggleTool("disallowedTools", t)}
            />
          </div>

          {/* Icon */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Icon
            </label>
            <IconPicker
              value={form.icon}
              iconType={form.iconType}
              onChange={(icon, type) => {
                setForm((prev) => ({ ...prev, icon, iconType: type }));
                setErrors((prev) => ({ ...prev, general: undefined }));
              }}
            />
          </div>

          {/* Enabled */}
          <div className="flex items-center justify-between gap-6 py-1">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Enabled</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Disabled subagents are not injected into sessions.
              </p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(v) => updateField("enabled", v)} />
          </div>
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-foreground/[0.06] px-6 py-3">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : isEditing ? "Save Changes" : "Add Subagent"}
        </Button>
      </div>
    </div>
  );
}

// ── Main Component ──

export const SubagentSettings = memo(function SubagentSettings({
  subagents,
  onSave,
  onDelete,
}: SubagentSettingsProps) {
  const [editing, setEditing] = useState<CustomSubagent | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const existingIds = new Set(subagents.map((s) => s.id));
  const pendingDelete = subagents.find((s) => s.id === deleteId);

  const handleConfirmDelete = useCallback(() => {
    if (deleteId) onDelete(deleteId);
    setDeleteId(null);
  }, [deleteId, onDelete]);

  if (isCreating) {
    return (
      <SubagentForm
        initial={emptyForm()}
        isEditing={false}
        existingIds={existingIds}
        onSave={onSave}
        onCancel={() => setIsCreating(false)}
      />
    );
  }

  if (editing) {
    return (
      <SubagentForm
        initial={subagentToForm(editing)}
        isEditing={true}
        existingIds={existingIds}
        onSave={onSave}
        onCancel={() => setEditing(null)}
      />
    );
  }

  // Sort: built-in first, then alphabetical
  const sorted = [...subagents].sort((a, b) => {
    if (a.builtIn && !b.builtIn) return -1;
    if (!a.builtIn && b.builtIn) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-foreground/[0.06] px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">Subagents</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Reusable expert subagents the main Claude agent delegates to via the Task tool.
        </p>
      </div>

      {/* Claude-only + apply-timing notice */}
      <div className="mx-6 mt-4 flex items-start gap-2 rounded-md border border-foreground/[0.06] bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Subagents apply to <span className="font-medium text-foreground">Claude engine</span> sessions only.
          Changes take effect in newly started or restarted sessions — active sessions are not updated.
        </span>
      </div>

      {/* Add button */}
      <div className="flex items-center justify-end px-6 py-3">
        <Button size="sm" onClick={() => setIsCreating(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add Subagent
        </Button>
      </div>

      {/* List */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 px-6 pb-4">
          {sorted.map((s) => (
            <SubagentCard
              key={s.id}
              subagent={s}
              onEdit={() => setEditing(s)}
              onDelete={() => setDeleteId(s.id)}
            />
          ))}
          {subagents.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bot className="h-8 w-8 text-muted-foreground/30" />
              <p className="mt-3 text-sm text-muted-foreground">No subagents yet</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Create a specialized subagent the main agent can delegate to
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Delete / reset confirmation */}
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        onConfirm={handleConfirmDelete}
        title={pendingDelete?.builtIn ? "Reset Subagent" : "Delete Subagent"}
        description={
          pendingDelete?.builtIn ? (
            <>
              This will reset{" "}
              <span className="font-medium text-foreground">{pendingDelete?.name}</span> to its default
              definition, discarding your changes.
            </>
          ) : (
            <>
              This will permanently delete{" "}
              <span className="font-medium text-foreground">{pendingDelete?.name}</span>. This action cannot be undone.
            </>
          )
        }
        confirmLabel={pendingDelete?.builtIn ? "Reset" : "Delete"}
      />
    </div>
  );
});
