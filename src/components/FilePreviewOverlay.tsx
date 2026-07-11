import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, File, Loader2, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OpenInEditorButton } from "./OpenInEditorButton";
import { useResolvedTheme } from "@/hooks/useTheme";
import { getLanguageFromPath } from "@/lib/languages";
import { getMonacoLanguageFromPath, disableMonacoDiagnostics } from "@/lib/monaco";
import { captureException } from "@/lib/analytics/analytics";

const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((mod) => ({ default: mod.default })),
);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Props ──

interface FilePreviewOverlayProps {
  filePath: string | null;
  projectRoot: string | null;
  sourceRect: DOMRect | null;
  onClose: () => void;
}

// ── Overlay dimensions ──

const OVERLAY_WIDTH = 800;
const OVERLAY_MAX_HEIGHT_VH = 85;

// ── Component ──

export const FilePreviewOverlay = memo(function FilePreviewOverlay({
  filePath,
  projectRoot,
  sourceRect,
  onClose,
}: FilePreviewOverlayProps) {
  return (
    <AnimatePresence mode="wait">
      {filePath && (
        <OverlayContent
          key={filePath}
          filePath={filePath}
          projectRoot={projectRoot}
          sourceRect={sourceRect}
          onClose={onClose}
        />
      )}
    </AnimatePresence>
  );
});

// ── Inner content (separate for AnimatePresence keying) ──

interface OverlayContentProps {
  filePath: string;
  projectRoot: string | null;
  sourceRect: DOMRect | null;
  onClose: () => void;
}

const OverlayContent = memo(function OverlayContent({
  filePath,
  projectRoot,
  sourceRect,
  onClose,
}: OverlayContentProps) {
  const [content, setContent] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mtimeMs, setMtimeMs] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const resolvedTheme = useResolvedTheme();

  // Load file content
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);

    window.claude
      .readFile(filePath)
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
        } else {
          const nextContent = result.content ?? "";
          setContent(nextContent);
          setDraft(nextContent);
          setMtimeMs(result.mtimeMs);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        captureException(err instanceof Error ? err : new Error(String(err)), { label: "FILE_READ_ERR" });
        setError(err instanceof Error ? err.message : "Failed to read file");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const isDirty = content !== null && draft !== content;

  const handleSave = useCallback(async () => {
    if (!projectRoot || content === null || !isDirty || isSaving) return;
    setIsSaving(true);
    try {
      const result = await window.claude.writeFile(filePath, projectRoot, draft, mtimeMs);
      if (result.error) {
        toast.error("Could not save file", { description: result.error });
        return;
      }
      setContent(draft);
      setMtimeMs(result.mtimeMs);
      toast.success("File saved");
    } catch (err) {
      captureException(err instanceof Error ? err : new Error(String(err)), { label: "FILE_WRITE_ERR" });
      toast.error("Could not save file", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsSaving(false);
    }
  }, [content, draft, filePath, isDirty, isSaving, mtimeMs, projectRoot]);

  // Escape exits edit mode first; Cmd/Ctrl+S saves while editing.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && isEditing) {
        e.preventDefault();
        e.stopPropagation();
        void handleSave();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (isEditing) {
          setIsEditing(false);
          return;
        }
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleSave, isEditing, onClose]);

  // Compute FLIP transform from source rect
  const flipTransform = useMemo(() => {
    if (!sourceRect) return null;

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const overlayW = Math.min(OVERLAY_WIDTH, viewportW - 48);
    const overlayH = Math.min(
      viewportH * (OVERLAY_MAX_HEIGHT_VH / 100),
      viewportH - 48,
    );

    // Source center offset from viewport center (overlay's final position)
    const sourceX = sourceRect.left + sourceRect.width / 2;
    const sourceY = sourceRect.top + sourceRect.height / 2;

    return {
      x: sourceX - viewportW / 2,
      y: sourceY - viewportH / 2,
      scaleX: Math.max(sourceRect.width / overlayW, 0.02),
      scaleY: Math.max(sourceRect.height / overlayH, 0.02),
    };
  }, [sourceRect]);

  // File metadata
  const fileName = filePath.split("/").pop() ?? filePath;
  const dirPath = filePath.split("/").slice(0, -1).join("/");
  const language = getLanguageFromPath(filePath);
  const monacoLang = getMonacoLanguageFromPath(filePath);
  const lineCount = draft ? draft.split("\n").length : 0;
  const fileSize = content !== null ? formatFileSize(new Blob([draft]).size) : "";

  const morphTransform = flipTransform
    ? { x: flipTransform.x, y: flipTransform.y, scaleX: flipTransform.scaleX, scaleY: flipTransform.scaleY, opacity: 0 }
    : { scale: 0.92, opacity: 0 };

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="fixed inset-0 z-50 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={handleBackdropClick}
      />

      {/* Morphing overlay card */}
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
        onClick={handleBackdropClick}
      >
        <motion.div
          className="pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-2xl"
          style={{
            width: Math.min(OVERLAY_WIDTH, window.innerWidth - 48),
            height: `${OVERLAY_MAX_HEIGHT_VH}vh`,
          }}
          initial={morphTransform}
          animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1, scale: 1, opacity: 1 }}
          exit={morphTransform}
          transition={{
            type: "spring",
            damping: 32,
            stiffness: 380,
            mass: 0.8,
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-foreground/[0.08] px-4 py-2.5">
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                {fileName}
                {isDirty ? <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Unsaved changes" /> : null}
              </span>
              <span className="ms-2 truncate text-xs text-muted-foreground/60">{dirPath}</span>
            </div>
            <div className="flex items-center gap-1">
              {content !== null && projectRoot ? (
                <>
                  {isEditing && isDirty ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => void handleSave()}
                          disabled={isSaving}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40"
                        >
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom"><p className="text-xs">Save file</p></TooltipContent>
                    </Tooltip>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setIsEditing((current) => !current)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                      >
                        {isEditing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="text-xs">{isEditing ? "Finish editing" : "Edit file"}</p>
                    </TooltipContent>
                  </Tooltip>
                </>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <OpenInEditorButton filePath={filePath} className="!text-muted-foreground/40 hover:!text-muted-foreground" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}>
                  <p className="text-xs">Open in editor</p>
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md
                  text-muted-foreground/40 transition-colors duration-150
                  hover:text-foreground hover:bg-foreground/[0.06]
                  active:scale-90"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Editor content */}
          <div className="relative flex-1 overflow-hidden" style={{ minHeight: 300 }}>
            {loading && (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
              </div>
            )}

            {error && (
              <div className="flex h-full items-center justify-center p-6">
                <p className="text-center text-sm text-muted-foreground/60">{error}</p>
              </div>
            )}

            {content !== null && !loading && (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
                  </div>
                }
              >
                <MonacoEditor
                  height="100%"
                  language={monacoLang}
                  value={draft}
                  onChange={(value) => setDraft(value ?? "")}
                  theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
                  beforeMount={disableMonacoDiagnostics}
                  options={{
                    readOnly: !isEditing,
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    lineNumbers: "on",
                    wordWrap: "on",
                    automaticLayout: true,
                    domReadOnly: !isEditing,
                    renderLineHighlight: "none",
                    overviewRulerLanes: 0,
                    hideCursorInOverviewRuler: true,
                    scrollbar: {
                      verticalScrollbarSize: 8,
                      horizontalScrollbarSize: 8,
                    },
                    padding: { top: 8, bottom: 8 },
                  }}
                  loading={
                    <div className="flex h-full items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
                    </div>
                  }
                />
              </Suspense>
            )}
          </div>

          {/* Footer */}
          {content !== null && !loading && (
            <div className="flex items-center gap-3 border-t border-foreground/[0.08] px-4 py-1.5">
              <span className="text-[11px] text-muted-foreground/50">
                {lineCount} {lineCount === 1 ? "line" : "lines"}
              </span>
              <span className="text-[11px] text-muted-foreground/30">•</span>
              <span className="text-[11px] text-muted-foreground/50">{language}</span>
              <span className="text-[11px] text-muted-foreground/30">•</span>
              <span className="text-[11px] text-muted-foreground/50">{fileSize}</span>
            </div>
          )}
        </motion.div>
      </motion.div>
    </>
  );
});
