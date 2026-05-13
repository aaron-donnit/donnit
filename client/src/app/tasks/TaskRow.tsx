import { Check, Loader2, Minus, MoveUp, Play, Triangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Id, Task, TaskEvent, User } from "@/app/types";
import { urgencyLabel } from "@/app/lib/urgency";
import { localDateIso, taskDueLabel } from "@/app/lib/date";
import { taskRepeatLabel } from "@/app/lib/task-text";
import { latestOpenUpdateRequest } from "@/app/lib/permissions";

function PrioIcon({ urgency }: { urgency: string }) {
  const cls = `task-prio prio-${urgency}`;
  if (urgency === "critical" || urgency === "high") {
    return (
      <span className={cls} aria-hidden="true">
        <Triangle className="fill-current" strokeWidth={0} />
      </span>
    );
  }
  if (urgency === "normal" || urgency === "medium") {
    return (
      <span className={cls} aria-hidden="true">
        <MoveUp strokeWidth={1.7} />
      </span>
    );
  }
  return (
    <span className={`task-prio prio-${urgency}`} aria-hidden="true">
      <Minus strokeWidth={1.7} />
    </span>
  );
}

function dueTone(task: Task, todayIso: string): string {
  if (!task.dueDate) return "";
  if (task.dueDate < todayIso) return "due-overdue";
  if (task.dueDate === todayIso) return "due-today";
  return "";
}

export default function TaskRow({
  task,
  users,
  events = [],
  onComplete,
  onOpen,
  onPreview,
  onPin,
  isCompleting,
  readOnly = false,
}: {
  task: Task;
  users: User[];
  events?: TaskEvent[];
  onComplete: () => void;
  onOpen: () => void;
  onPreview?: () => void;
  onPin?: () => void;
  isCompleting: boolean;
  readOnly?: boolean;
}) {
  const assignee = users.find((u) => u.id === task.assignedToId);
  const isDone = task.status === "completed";
  const latestUpdateRequest = latestOpenUpdateRequest(task, events);
  const repeatLabel = taskRepeatLabel(task);
  const todayIso = localDateIso();
  const dueLabel = taskDueLabel(task);
  const dueClass = dueTone(task, todayIso);
  const initials = (assignee?.name ?? "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const hasExtra =
    Boolean(task.description) ||
    repeatLabel ||
    Boolean(task.source && task.source !== "manual") ||
    latestUpdateRequest;

  return (
    <div
      className={`task-row task-row-openable ${isDone ? "is-done" : ""}`}
      data-testid={`row-task-${task.id}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        (onPreview ?? onOpen)();
      }}
    >
      {/* Col 1 — check circle */}
      <button
        type="button"
        onClick={onComplete}
        disabled={isCompleting || isDone || readOnly}
        aria-label={readOnly ? "Read-only" : isDone ? "Completed" : "Mark complete"}
        className={`check-circle ${isDone ? "is-checked" : ""}`}
        data-testid={`button-complete-${task.id}`}
      >
        {isCompleting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" strokeWidth={3} />
        )}
      </button>

      {/* Col 2 — priority icon */}
      <PrioIcon urgency={task.urgency} />

      {/* Col 3 — title */}
      <button
        type="button"
        onClick={onOpen}
        className="task-title min-w-0 truncate text-left text-sm font-medium text-foreground hover:text-brand-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        data-testid={`text-task-title-${task.id}`}
        title={task.title}
      >
        {task.title}
        {task.source && task.source !== "manual" ? (
          <span className="task-source-pill ml-1.5" data-testid={`text-task-source-${task.id}`}>
            {task.source}
          </span>
        ) : null}
      </button>

      {/* Col 4 — urgency badge + optional context tooltip */}
      <span className="inline-flex items-center gap-1">
        {hasExtra && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Task details"
                className="inline-flex size-5 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground"
                data-testid={`button-task-context-${task.id}`}
              >
                <span className="text-[9px] font-bold leading-none">…</span>
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <div className="space-y-1 text-xs">
                {task.description && <p>{task.description.slice(0, 140)}</p>}
                {repeatLabel && <p className="font-medium">{repeatLabel}</p>}
                {latestUpdateRequest && <p className="text-amber-600 dark:text-amber-400">Update requested</p>}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
        <span
          className={`task-meta-badge badge-${task.urgency}`}
          data-testid={`text-task-urgency-${task.id}`}
        >
          {urgencyLabel(task.urgency)}
        </span>
      </span>

      {/* Col 5 — due date */}
      <span
        className={`task-due-cell ${dueClass}`}
        data-testid={`text-task-due-${task.id}`}
      >
        {dueLabel}
      </span>

      {/* Col 6 — assignee avatar */}
      <span
        className="task-avatar"
        title={assignee?.name ?? "Unassigned"}
        aria-label={assignee?.name ?? "Unassigned"}
      >
        {initials}
      </span>

      {/* Col 7 — action buttons */}
      <span className="inline-flex items-center gap-0.5">
        {onPin && !isDone && (
          <button
            type="button"
            onClick={onPin}
            disabled={readOnly}
            aria-label="Work on task"
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            data-testid={`button-work-task-${task.id}`}
          >
            <Play className="size-3" strokeWidth={2} />
          </button>
        )}
      </span>
    </div>
  );
}
