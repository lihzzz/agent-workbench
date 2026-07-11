import { useCallback } from "react";
import { toast } from "sonner";
import { useInlineRename } from "@/hooks/useInlineRename";
import {
  Columns2,
  Copy,
  Pencil,
  Trash2,
  MoreHorizontal,
  Loader2,
  Pin,
  PinOff,
  FolderInput,
  FolderMinus,
  Archive,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatFolder, ChatSession, InstalledAgent } from "@/types";
import type { ExportFormat } from "@/lib/session/session-export";
import { AgentIcon } from "@/components/AgentIcon";
import { getSessionEngineIcon } from "@/lib/engine-icons";
import { getEngineAccent } from "@/lib/engine-colors";
import {
  writeSidebarDragPayload,
  clearSidebarDragPayload,
} from "@/lib/sidebar/dnd";
import { copyToClipboard } from "@/lib/clipboard";
import { useContextMenuPosition } from "@/hooks/useContextMenuPosition";

export function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  onRename,
  onPinToggle,
  onArchiveToggle,
  folders,
  onMoveToFolder,
  agents,
  onOpenInSplitView,
  canOpenInSplitView = true,
  onExport,
}: {
  islandLayout: boolean;
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  /** Toggle pin state. Omit if pin feature not available in this context. */
  onPinToggle?: () => void;
  /** Toggle archive state. Omit if archive feature not available in this context. */
  onArchiveToggle?: () => void;
  /** Available folders for "Move to folder" submenu. Omit to hide the menu. */
  folders?: ChatFolder[];
  /** Move session to a folder (null = remove from folder). */
  onMoveToFolder?: (folderId: string | null) => void;
  agents?: InstalledAgent[];
  /** Open this session in the split view secondary pane. */
  onOpenInSplitView?: () => void;
  canOpenInSplitView?: boolean;
  /** Export this session to a file in the given format. */
  onExport?: (format: ExportFormat) => void;
}) {
  const { isEditing, startEditing, inputProps: renameInputProps } = useInlineRename({
    initialName: session.title,
    onRename,
  });
  const {
    menuOpen, menuAlign, setMenuOpen,
    handleContextMenu, handleMenuButtonClick,
    triggerStyle, containerRef,
  } = useContextMenuPosition();

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      writeSidebarDragPayload(e.dataTransfer, {
        kind: "session",
        id: session.id,
      });
      e.dataTransfer.effectAllowed = "move";
    },
    [session.id],
  );

  const handleDragEnd = useCallback(() => {
    clearSidebarDragPayload();
  }, []);

  const handleCopyId = useCallback(async () => {
    const ok = await copyToClipboard(session.id);
    if (ok) {
      toast.success("Session ID copied", { description: session.id });
    } else {
      toast.error("Failed to copy session ID");
    }
  }, [session.id]);

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 px-1 ps-2">
        <input
          {...renameInputProps}
          className="flex-1 rounded-lg bg-black/5 px-2 py-1 text-[13px] text-sidebar-foreground outline-none ring-1 ring-sidebar-ring dark:bg-white/5"
        />
      </div>
    );
  }

  const hasFolderMenu = folders && folders.length > 0 && onMoveToFolder;

  // Per-engine accent for visual differentiation (left rail bar + icon badge).
  const accent = getEngineAccent(session.engine);

  return (
    <div
      ref={containerRef}
      className="group relative"
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onContextMenu={handleContextMenu}
    >
      {/* Engine accent rail — always visible, colored per engine */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-1 start-0 w-[3px] rounded-full transition-opacity ${
          isActive ? "opacity-100" : "opacity-60 group-hover:opacity-90"
        }`}
        style={{ backgroundColor: accent.bar }}
      />
      <button
        onClick={onSelect}
        className={`session-item-button flex w-full min-w-0 items-center gap-2.5 rounded-lg ps-4 pe-3 group-hover:pe-8 py-1.5 text-start text-[13px] font-medium transition-all ${
          isActive
            ? "session-item-active text-black dark:text-primary"
            : "text-sidebar-foreground/75 hover:bg-black/5 hover:text-sidebar-foreground dark:hover:bg-white/5"
        }`}
        style={
          isActive
            ? { backgroundColor: accent.tint, boxShadow: `inset 0 0 0 1px ${accent.ring}` }
            : undefined
        }
      >
        {/* Engine icon badge — always shows which engine; status is overlaid as
            a small corner indicator so the engine stays identifiable in every state. */}
        <span
          className="relative flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: accent.tint, boxShadow: `inset 0 0 0 1px ${accent.ring}` }}
        >
          <AgentIcon
            icon={getSessionEngineIcon(session.engine, session.agentId, agents)}
            size={11}
            className="shrink-0 opacity-90"
          />
          {session.pinned && (
            <Pin className="absolute -end-1 -top-1 h-2 w-2 text-sidebar-foreground/50" />
          )}
          {/* Status corner indicator — overlaps the badge edge, never hides the icon */}
          {session.hasPendingPermission ? (
            <span className="absolute -end-1 -bottom-1 flex h-2.5 w-2.5 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500 ring-1 ring-sidebar" />
            </span>
          ) : session.isProcessing ? (
            <span className="absolute -end-1 -bottom-1 rounded-full bg-sidebar">
              <Loader2 className="h-2.5 w-2.5 animate-spin text-sidebar-foreground/70" />
            </span>
          ) : session.hasUnreadCompletion && !isActive ? (
            <span className="absolute -end-1 -bottom-1 flex h-2.5 w-2.5 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
              <span className="relative h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-sidebar" />
            </span>
          ) : null}
        </span>
        {session.titleGenerating ? (
          <span
            className={
              isActive
                ? "text-current opacity-80 italic"
                : "text-sidebar-foreground/60 italic"
            }
          >
            Generating title...
          </span>
        ) : (
          <span className="min-w-0 truncate">{session.title}</span>
        )}
      </button>

      <div className="absolute end-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-all group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-md text-sidebar-foreground/60 hover:bg-black/10 hover:text-sidebar-foreground dark:hover:bg-white/10"
          onClick={handleMenuButtonClick}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </div>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <span style={triggerStyle} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align={menuAlign} side="bottom" sideOffset={6} className="w-44">
          {/* Pin / Unpin */}
          {onPinToggle && (
            <DropdownMenuItem onClick={onPinToggle}>
              {session.pinned ? (
                <>
                  <PinOff className="me-2 h-3.5 w-3.5" />
                  Unpin
                </>
              ) : (
                <>
                  <Pin className="me-2 h-3.5 w-3.5" />
                  Pin
                </>
              )}
            </DropdownMenuItem>
          )}

          {/* Move to folder */}
          {hasFolderMenu && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="me-2 h-3.5 w-3.5" />
                Move to folder
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                {session.folderId && (
                  <DropdownMenuItem onClick={() => onMoveToFolder(null)}>
                    <FolderMinus className="me-2 h-3.5 w-3.5" />
                    Remove from folder
                  </DropdownMenuItem>
                )}
                {folders
                  .filter((f) => f.id !== session.folderId)
                  .map((folder) => (
                    <DropdownMenuItem
                      key={folder.id}
                      onClick={() => onMoveToFolder(folder.id)}
                    >
                      <FolderInput className="me-2 h-3.5 w-3.5" />
                      {folder.name}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {(onPinToggle || hasFolderMenu) && <DropdownMenuSeparator />}

          {onOpenInSplitView && canOpenInSplitView && (
            <DropdownMenuItem onClick={onOpenInSplitView}>
              <Columns2 className="me-2 h-3.5 w-3.5" />
              Open in Split View
            </DropdownMenuItem>
          )}

          <DropdownMenuItem onClick={handleCopyId}>
            <Copy className="me-2 h-3.5 w-3.5" />
            Copy session ID
          </DropdownMenuItem>

          {onExport && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Download className="me-2 h-3.5 w-3.5" />
                Export
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-40">
                <DropdownMenuItem onClick={() => onExport("markdown")}>Markdown (.md)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onExport("html")}>HTML (.html)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onExport("json")}>JSON (.json)</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          <DropdownMenuItem onClick={startEditing}>
            <Pencil className="me-2 h-3.5 w-3.5" />
            Rename
          </DropdownMenuItem>
          {onArchiveToggle && (
            <DropdownMenuItem onClick={onArchiveToggle}>
              <Archive className="me-2 h-3.5 w-3.5" />
              {session.archived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="me-2 h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
