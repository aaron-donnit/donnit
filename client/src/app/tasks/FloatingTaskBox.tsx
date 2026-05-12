import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, FileText, GripVertical, Loader2, Maximize2, Minimize2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Task, User } from "@/app/types";
import { urgencyLabel } from "@/app/lib/urgency";
import { invalidateWorkspace } from "@/app/lib/hooks";
import RichNoteEditor from "@/app/tasks/RichNoteEditor";

export default function FloatingTaskBox({
  task,
  users,
  onClose,
}: {
  task: Task | null;
  users: User[];
  onClose: () => void;
}) {
  type CapturedAttachment = {
    name: string;
    kind: "Document" | "Image" | "Spreadsheet" | "Other";
    size: number;
  };
  const [position, setPosition] = useState(() => ({
    x: typeof window === "undefined" ? 24 : Math.max(8, window.innerWidth - 364),
    y: 92,
  }));
  const [minimized, setMinimized] = useState(false);
  const [note, setNote] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [attachments, setAttachments] = useState<CapturedAttachment[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    setNote(task?.completionNotes ?? "");
    setAttachmentName("");
    setAttachments([]);
    setMinimized(false);
  }, [task?.id]);

  const classifyAttachment = (file: File): CapturedAttachment["kind"] => {
    const lower = file.name.toLowerCase();
    if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(lower)) return "Image";
    if (/\.(csv|xls|xlsx|numbers)$/i.test(lower)) return "Spreadsheet";
    if (file.type.includes("pdf") || /\.(pdf|doc|docx|txt|rtf)$/i.test(lower)) return "Document";
    return "Other";
  };

  const attachmentLines = () => [
    ...(attachmentName.trim() ? [`Attachment noted: ${attachmentName.trim()}`] : []),
    ...attachments.map((file) => `Attachment captured: [${file.kind}] ${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`),
  ];

  const saveNote = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error("No active task.");
      const noteText = [note.trim(), ...attachmentLines()].filter(Boolean).join("\n");
      const res = await apiRequest("POST", `/api/tasks/${task.id}/notes`, { note: noteText || "Working update." });
      return (await res.json()) as Task;
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      setAttachmentName("");
      setAttachments([]);
      toast({ title: "Task note saved", description: "Your work update was added." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not save note",
        description: error instanceof Error ? error.message : "Try saving the work note again.",
        variant: "destructive",
      });
    },
  });

  const completeTask = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error("No active task.");
      const noteText = [note.trim(), ...attachmentLines()].filter(Boolean).join("\n") || "Donnit.";
      const res = await apiRequest("POST", `/api/tasks/${task.id}/complete`, { note: noteText });
      return (await res.json()) as Task;
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Donnit", description: "Task completed from the work box." });
      onClose();
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not complete task",
        description: error instanceof Error ? error.message : "Try completing the task again.",
        variant: "destructive",
      });
    },
  });

  if (!task) return null;
  const owner = users.find((user) => String(user.id) === String(task.assignedToId));
  const maxX = typeof window === "undefined" ? 24 : Math.max(8, window.innerWidth - 360);
  const maxY = typeof window === "undefined" ? 92 : Math.max(72, window.innerHeight - (minimized ? 76 : 420));
  const clampedX = Math.min(Math.max(8, position.x), maxX);
  const clampedY = Math.min(Math.max(72, position.y), maxY);

  return (
    <div
      className="fixed z-[70] w-[min(340px,calc(100vw-1rem))] rounded-md border border-border bg-background shadow-2xl"
      style={{ right: "auto", left: clampedX, top: clampedY }}
      data-testid="floating-task-box"
    >
      <div
        className="flex cursor-move items-center justify-between gap-2 border-b border-border px-3 py-2"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          dragRef.current = { startX: event.clientX, startY: event.clientY, originX: clampedX, originY: clampedY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          const nextX = dragRef.current.originX + event.clientX - dragRef.current.startX;
          const nextY = dragRef.current.originY + event.clientY - dragRef.current.startY;
          setPosition({ x: nextX, y: nextY });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <GripVertical className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">Working on</p>
            <p className="truncate text-[11px] text-muted-foreground">{owner?.name ?? "Unassigned"}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setMinimized((value) => !value);
            }}
            aria-label={minimized ? "Expand active task" : "Minimize active task"}
            data-testid="button-floating-task-minimize"
          >
            {minimized ? <Maximize2 className="size-3.5" /> : <Minimize2 className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            aria-label="Close active task"
            data-testid="button-floating-task-close"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      {!minimized && (
        <div className="space-y-3 px-3 py-3">
          <div>
            <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{task.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {task.dueDate ?? "No due date"} / {task.estimatedMinutes} min / {urgencyLabel(task.urgency)}
            </p>
          </div>
          {task.description && (
            <p className="max-h-20 overflow-y-auto rounded-md bg-muted px-2 py-2 text-xs leading-relaxed text-muted-foreground">
              {task.description}
            </p>
          )}
          <RichNoteEditor
            id="floating-task-note"
            label="Work note"
            value={note}
            onChange={setNote}
            placeholder="Add an update, blocker, or next step."
            className="h-28 resize-none text-xs"
            maxLength={1600}
            testId="input-floating-task-note"
          />
          <div className="space-y-1.5">
            <Label htmlFor="floating-task-attachment" className="ui-label">
              Attachment note
            </Label>
            <Input
              id="floating-task-attachment"
              value={attachmentName}
              onChange={(event) => setAttachmentName(event.target.value)}
              placeholder="Paste file name or link for now"
              className="h-8 text-xs"
              data-testid="input-floating-task-attachment"
            />
          </div>
          <div
            className={`rounded-md border border-dashed px-3 py-3 text-xs transition ${
              draggingFiles ? "border-brand-green bg-brand-green/10" : "border-border bg-muted/30"
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDraggingFiles(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDraggingFiles(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDraggingFiles(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const dropped = Array.from(event.dataTransfer.files ?? []).map((file) => ({
                name: file.name,
                kind: classifyAttachment(file),
                size: file.size,
              }));
              if (dropped.length > 0) {
                setAttachments((current) => [...current, ...dropped].slice(0, 8));
              }
              setDraggingFiles(false);
            }}
            data-testid="dropzone-floating-task-attachments"
          >
            <div className="flex items-center gap-2 font-medium text-foreground">
              <Paperclip className="size-3.5" />
              Drop files to log with this task
            </div>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              Names and types are recorded with the update.
            </p>
            {attachments.length > 0 && (
              <div className="mt-2 space-y-1">
                {attachments.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1">
                    <span className="min-w-0 truncate">{file.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{file.kind}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => saveNote.mutate()}
              disabled={saveNote.isPending || completeTask.isPending}
              data-testid="button-floating-task-save"
            >
              {saveNote.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              Save
            </Button>
            <Button
              size="sm"
              onClick={() => completeTask.mutate()}
              disabled={saveNote.isPending || completeTask.isPending}
              data-testid="button-floating-task-complete"
            >
              {completeTask.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Donnit
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
