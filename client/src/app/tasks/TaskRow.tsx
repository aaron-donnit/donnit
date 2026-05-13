import { CalendarClock, Check, Clock3, Eye, HelpCircle, Loader2, Play, Repeat2, Send, ShieldCheck, UserPlus, UserRoundCheck, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Id, Task, TaskEvent, User } from "@/app/types";
import { urgencyClass, urgencyLabel, statusLabels } from "@/app/lib/urgency";
import { taskDueLabel } from "@/app/lib/date";
import { taskRepeatLabel } from "@/app/lib/task-text";
import { latestOpenUpdateRequest } from "@/app/lib/permissions";

export default function TaskRow({
  task,
  users,
  events = [],
  onComplete,
  onOpen,
  onPin,
  isCompleting,
  readOnly = false,
}: {
  task: Task;
  users: User[];
  events?: TaskEvent[];
  onComplete: () => void;
  onOpen: () => void;
  onPin?: () => void;
  isCompleting: boolean;
  readOnly?: boolean;
}) {
  const assignee = users.find((user) => user.id === task.assignedToId);
  const delegate = users.find((user) => String(user.id) === String(task.delegatedToId));
  const collaboratorCount = task.collaboratorIds?.length ?? 0;
  const isDone = task.status === "completed";
  const latestUpdateRequest = latestOpenUpdateRequest(task, events);
  const repeatLabel = taskRepeatLabel(task);
  const contextHints = [
    repeatLabel ? `${repeatLabel} responsibility` : "",
    task.description ? task.description.slice(0, 140) : "",
    task.completionNotes ? `Last note: ${task.completionNotes.slice(0, 120)}` : "",
    task.source !== "manual" ? `Source: ${task.source}` : "",
  ].filter(Boolean);

  return (
    <div
      className={`task-row task-row-openable ${urgencyClass(task.urgency)} ${isDone ? "is-done" : ""}`}
      data-testid={`row-task-${task.id}`}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <button
        type="button"
        onClick={onComplete}
        disabled={isCompleting || isDone || readOnly}
        aria-label={readOnly ? "Read-only team task" : isDone ? "Completed" : "Mark complete"}
        className={`check-circle ${isDone ? "is-checked" : ""}`}
        data-testid={`button-complete-${task.id}`}
      >
        {isCompleting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" strokeWidth={3} />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p
            className="task-title flex min-w-0 items-center gap-2 text-sm font-medium leading-snug text-foreground"
            data-testid={`text-task-title-${task.id}`}
          >
            <span className="min-w-0 truncate">{task.title}</span>
            {task.source && task.source !== "manual" ? (
              <span
                className="task-source-pill"
                data-testid={`text-task-source-${task.id}`}
                title={`Source: ${task.source}`}
              >
                {task.source}
              </span>
            ) : null}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {contextHints.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Show task context"
                    className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
                    data-testid={`button-task-context-${task.id}`}
                  >
                    <HelpCircle className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-1 text-xs">
                    {contextHints.slice(0, 4).map((hint, index) => (
                      <p key={`${task.id}-hint-${index}`}>{hint}</p>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            <span className="ui-label whitespace-nowrap" data-testid={`text-task-urgency-${task.id}`}>
              {urgencyLabel(task.urgency)}
            </span>
          </div>
        </div>
        {task.description && !isDone && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{task.description}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span
            className="inline-flex items-center gap-1"
            data-testid={`text-task-due-${task.id}`}
          >
            <CalendarClock className="size-3.5" />
            {taskDueLabel(task)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-3.5" />
            {task.estimatedMinutes} min
          </span>
          {repeatLabel && (
            <span className="inline-flex items-center gap-1 font-medium text-foreground" data-testid={`text-task-repeat-${task.id}`}>
              <Repeat2 className="size-3.5" />
              {repeatLabel}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <UserRoundCheck className="size-3.5" />
            {assignee?.name ?? "Unassigned"}
          </span>
          {task.visibility !== "work" && (
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <ShieldCheck className="size-3.5" />
              {task.visibility === "confidential" ? "Confidential" : "Personal"}
            </span>
          )}
          {delegate && (
            <span className="inline-flex items-center gap-1">
              <UserPlus className="size-3.5" />
              Delegated to {delegate.name}
            </span>
          )}
          {collaboratorCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" />
              {collaboratorCount} collaborator{collaboratorCount === 1 ? "" : "s"}
            </span>
          )}
          {task.status !== "open" && task.status !== "completed" && (
            <span className="ui-label">{statusLabels[task.status] ?? task.status}</span>
          )}
          {latestUpdateRequest && task.status !== "completed" && (
            <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300">
              <Send className="size-3.5" />
              Update requested
            </span>
          )}
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-green underline-offset-2 hover:underline"
            data-testid={`button-open-task-${task.id}`}
          >
            <Eye className="size-3.5" />
            Open
          </button>
          {onPin && !isDone && (
            <button
              type="button"
              onClick={onPin}
              disabled={readOnly}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-green underline-offset-2 hover:underline"
              data-testid={`button-work-task-${task.id}`}
            >
              <Play className="size-3.5" />
              Work
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
