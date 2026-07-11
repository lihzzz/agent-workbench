import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Inline form for filling a prompt template's {{variables}} before insertion. */
export function TemplateVarForm({
  vars,
  onConfirm,
  onCancel,
}: {
  vars: string[];
  onConfirm: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(vars.map((v) => [v, ""])),
  );
  const firstRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  const confirm = () => onConfirm(values);

  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-2 rounded-lg border border-foreground/10 bg-popover p-3 shadow-lg">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Fill template variables
      </p>
      <div className="space-y-2">
        {vars.map((v, i) => (
          <div key={v} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate font-mono text-xs text-foreground/60">{`{{${v}}}`}</span>
            <Input
              ref={i === 0 ? firstRef : undefined}
              value={values[v]}
              onChange={(e) => setValues((prev) => ({ ...prev, [v]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); confirm(); }
                if (e.key === "Escape") { e.preventDefault(); onCancel(); }
              }}
              className="flex-1"
              placeholder={v}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={confirm}>Insert</Button>
      </div>
    </div>
  );
}
