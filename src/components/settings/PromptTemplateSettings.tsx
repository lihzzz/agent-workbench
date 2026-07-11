import { memo, useState, useCallback } from "react";
import { FileText, Plus, Pencil, Trash2, RotateCcw, ArrowLeft, Info, Shield } from "lucide-react";
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
import { extractTemplateVars, type PromptTemplate } from "@/types";

interface PromptTemplateSettingsProps {
  templates: PromptTemplate[];
  onSave: (template: PromptTemplate) => Promise<{ ok?: boolean; error?: string }>;
  onDelete: (id: string) => Promise<{ ok?: boolean; error?: string }>;
}

interface FormState {
  id: string;
  name: string;
  description: string;
  body: string;
  icon: string;
  iconType: "emoji" | "lucide";
  enabled: boolean;
}

interface FormErrors {
  name?: string;
  body?: string;
  general?: string;
}

function emptyForm(): FormState {
  return { id: "", name: "", description: "", body: "", icon: "📝", iconType: "emoji", enabled: true };
}

function templateToForm(t: PromptTemplate): FormState {
  const isEmoji = t.icon ? /^\p{Emoji}/u.test(t.icon) : false;
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    body: t.body,
    icon: t.icon ?? "📝",
    iconType: isEmoji ? "emoji" : "lucide",
    enabled: t.enabled !== false,
  };
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ── Card ──

const TemplateCard = memo(function TemplateCard({
  template,
  onEdit,
  onDelete,
}: {
  template: PromptTemplate;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const disabled = template.enabled === false;
  const isBuiltIn = template.builtIn === true;
  const vars = extractTemplateVars(template.body);

  return (
    <div className="group flex items-start gap-3 rounded-lg border border-foreground/[0.06] px-4 py-3 transition-colors hover:border-foreground/[0.1]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted/40 text-foreground/60">
        <AgentIcon icon={template.icon} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{template.name}</span>
          {isBuiltIn && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Shield className="h-2.5 w-2.5" />
              Built-in
            </Badge>
          )}
          {disabled && <Badge variant="secondary" className="text-[10px]">Disabled</Badge>}
        </div>
        <span className="line-clamp-2 text-xs text-muted-foreground">{template.description}</span>
        {vars.length > 0 && (
          <div className="mt-0.5 text-[11px] text-muted-foreground/70">
            {vars.length} variable{vars.length > 1 ? "s" : ""}: {vars.map((v) => `{{${v}}}`).join(", ")}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={onEdit}><Pencil className="h-3 w-3" /></Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">Edit</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive" onClick={onDelete}>
              {isBuiltIn ? <RotateCcw className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">{isBuiltIn ? "Reset to default" : "Delete"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
});

// ── Form ──

function TemplateForm({
  initial,
  isEditing,
  existingIds,
  onSave,
  onCancel,
}: {
  initial: FormState;
  isEditing: boolean;
  existingIds: Set<string>;
  onSave: (t: PromptTemplate) => Promise<{ ok?: boolean; error?: string }>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const vars = extractTemplateVars(form.body);

  const updateField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined, general: undefined }));
  }, []);

  const validate = useCallback((): FormErrors => {
    const e: FormErrors = {};
    if (!form.name.trim()) e.name = "Name is required";
    if (!form.body.trim()) e.body = "Body is required";
    if (!isEditing) {
      const id = slugify(form.name);
      if (!id) e.name = "Name must contain letters or numbers";
      else if (existingIds.has(id)) e.name = "A template with this name already exists";
    }
    return e;
  }, [form, isEditing, existingIds]);

  const handleSave = useCallback(async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setSaving(true);
    try {
      const template: PromptTemplate = {
        id: isEditing ? form.id : slugify(form.name),
        name: form.name.trim(),
        description: form.description.trim(),
        body: form.body,
        icon: form.icon.trim() || undefined,
        enabled: form.enabled,
      };
      const result = await onSave(template);
      if (result.ok) onCancel();
      else setErrors({ general: result.error ?? "Failed to save template" });
    } finally {
      setSaving(false);
    }
  }, [form, isEditing, validate, onSave, onCancel]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-foreground/[0.06] px-6 py-4">
        <Button variant="ghost" size="icon-xs" onClick={onCancel}><ArrowLeft className="h-3.5 w-3.5" /></Button>
        <h2 className="flex-1 text-base font-semibold text-foreground">{isEditing ? "Edit Template" : "Add Template"}</h2>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 px-6 py-5">
          {errors.general && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errors.general}</div>
          )}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Name <span className="text-destructive">*</span></label>
            <Input value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="review-changes" aria-invalid={!!errors.name} />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Description</label>
            <Input value={form.description} onChange={(e) => updateField("description", e.target.value)} placeholder="Ask for a code review of the current diff" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Body <span className="text-destructive">*</span></label>
            <textarea
              value={form.body}
              onChange={(e) => updateField("body", e.target.value)}
              placeholder="Review the current changes, focus on {{area}}. List findings by severity."
              rows={6}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
              aria-invalid={!!errors.body}
            />
            <p className="text-[11px] text-muted-foreground/60">
              Use <span className="font-mono">{`{{variable}}`}</span> for fill-in slots. {vars.length > 0 && `Detected: ${vars.map((v) => `{{${v}}}`).join(", ")}`}
            </p>
            {errors.body && <p className="text-xs text-destructive">{errors.body}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Icon</label>
            <IconPicker value={form.icon} iconType={form.iconType} onChange={(icon, type) => setForm((p) => ({ ...p, icon, iconType: type }))} />
          </div>
          <div className="flex items-center justify-between gap-6 py-1">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Enabled</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Disabled templates don't appear in the input picker.</p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(v) => updateField("enabled", v)} />
          </div>
        </div>
      </ScrollArea>
      <div className="flex items-center justify-end gap-2 border-t border-foreground/[0.06] px-6 py-3">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : isEditing ? "Save Changes" : "Add Template"}</Button>
      </div>
    </div>
  );
}

// ── Main ──

export const PromptTemplateSettings = memo(function PromptTemplateSettings({
  templates,
  onSave,
  onDelete,
}: PromptTemplateSettingsProps) {
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const existingIds = new Set(templates.map((t) => t.id));
  const pendingDelete = templates.find((t) => t.id === deleteId);

  const handleConfirmDelete = useCallback(() => {
    if (deleteId) onDelete(deleteId);
    setDeleteId(null);
  }, [deleteId, onDelete]);

  if (isCreating) return <TemplateForm initial={emptyForm()} isEditing={false} existingIds={existingIds} onSave={onSave} onCancel={() => setIsCreating(false)} />;
  if (editing) return <TemplateForm initial={templateToForm(editing)} isEditing={true} existingIds={existingIds} onSave={onSave} onCancel={() => setEditing(null)} />;

  const sorted = [...templates].sort((a, b) => {
    if (a.builtIn && !b.builtIn) return -1;
    if (!a.builtIn && b.builtIn) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-foreground/[0.06] px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">Prompt Templates</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Reusable prompts you can insert from the input bar's slash menu.</p>
      </div>
      <div className="mx-6 mt-4 flex items-start gap-2 rounded-md border border-foreground/[0.06] bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Type <span className="font-mono">/</span> in the input bar to insert a template. Use <span className="font-mono">{`{{variable}}`}</span> for fill-in slots.</span>
      </div>
      <div className="flex items-center justify-end px-6 py-3">
        <Button size="sm" onClick={() => setIsCreating(true)}><Plus className="h-3.5 w-3.5" />Add Template</Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 px-6 pb-4">
          {sorted.map((t) => (
            <TemplateCard key={t.id} template={t} onEdit={() => setEditing(t)} onDelete={() => setDeleteId(t.id)} />
          ))}
          {templates.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/30" />
              <p className="mt-3 text-sm text-muted-foreground">No templates yet</p>
              <p className="mt-1 text-xs text-muted-foreground/60">Create a reusable prompt to insert from the input bar</p>
            </div>
          )}
        </div>
      </ScrollArea>
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        onConfirm={handleConfirmDelete}
        title={pendingDelete?.builtIn ? "Reset Template" : "Delete Template"}
        description={
          pendingDelete?.builtIn ? (
            <>This will reset <span className="font-medium text-foreground">{pendingDelete?.name}</span> to its default, discarding your changes.</>
          ) : (
            <>This will permanently delete <span className="font-medium text-foreground">{pendingDelete?.name}</span>. This action cannot be undone.</>
          )
        }
        confirmLabel={pendingDelete?.builtIn ? "Reset" : "Delete"}
      />
    </div>
  );
});
