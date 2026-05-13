import { useState, useEffect } from "react";
import { Eye, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import type { AgendaItem, Id, Task, TaskEvent, TaskSubtask, User } from "@/app/types";
import { dialogShellClass, dialogHeaderClass, dialogBodyClass, dialogFooterClass } from "@/app/constants";
import { urgencyClass, urgencyLabel } from "@/app/lib/urgency";
import { formatAgendaSlot } from "@/app/lib/agenda";
import TaskDetailDialog from "@/app/tasks/TaskDetailDialog";
import ReportMetric from "@/app/reports/ReportMetric";

export default function AgendaWorkDialog({
  open,
  onOpenChange,
  agenda,
  tasks,
  users,
  subtasks = [],
  events = [],
  authenticated = false,
  onPinTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agenda: AgendaItem[];
  tasks: Task[];
  users: User[];
  subtasks?: TaskSubtask[];
  events?: TaskEvent[];
  authenticated?: boolean;
  onPinTask: (taskId: Id) => void;
}) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((task) => String(task.id) === selectedTaskId) ?? null;
  const totalMinutes = agenda.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const scheduledCount = agenda.filter((item) => item.scheduleStatus === "scheduled").length;
  const nextItem = agenda.find((item) => item.scheduleStatus === "scheduled") ?? agenda[0] ?? null;
  const nextTask = nextItem ? tasks.find((task) => String(task.id) === String(nextItem.taskId)) ?? null : null;

  useEffect(() => {
    if (!open) setSelectedTaskId(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} sm:max-w-3xl`}>
        <DialogHeader className={dialogHeaderClass}>
          <DialogTitle>Daily agenda</DialogTitle>
          <DialogDescription>
            Work through approved agenda blocks in order. Pin a task to keep notes open while working.
          </DialogDescription>
        </DialogHeader>
        <div className={`${dialogBodyClass} space-y-3`}>
          <div className="grid gap-2 sm:grid-cols-3">
            <ReportMetric label="Agenda items" value={String(agenda.length)} />
            <ReportMetric label="Scheduled" value={String(scheduledCount)} />
            <ReportMetric label="Total time" value={`${totalMinutes}m`} />
          </div>
          {agenda.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Build and approve an agenda before opening the work screen.
            </p>
          ) : (
            <div className="space-y-3">
              {nextItem && (
                <div className="rounded-md border border-brand-green/30 bg-brand-green-pale/40 px-3 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="ui-label">Up next</p>
                      <h4 className="mt-1 truncate text-sm font-semibold text-foreground">{nextItem.title}</h4>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatAgendaSlot(nextItem)} / {nextItem.estimatedMinutes} min
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => nextTask && setSelectedTaskId(String(nextTask.id))}
                        disabled={!nextTask}
                      >
                        <Eye className="size-4" />
                        Open
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          onPinTask(nextItem.taskId);
                          toast({ title: "Task pinned", description: "The work box is ready for notes." });
                        }}
                      >
                        <Play className="size-4" />
                        Work
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              <ol className="space-y-2">
              {agenda.map((item, index) => {
                const task = tasks.find((candidate) => String(candidate.id) === String(item.taskId));
                const taskSubtasks = subtasks.filter((subtask) => String(subtask.taskId) === String(item.taskId));
                const doneSubtasks = taskSubtasks.filter((subtask) => subtask.done).length;
                const progressPct =
                  taskSubtasks.length > 0
                    ? Math.round((doneSubtasks / taskSubtasks.length) * 100)
                    : task?.status === "completed"
                      ? 100
                      : task?.status === "accepted"
                        ? 20
                        : 0;
                return (
                  <li key={`${item.taskId}-${item.order}`} className={`task-row flex-col items-stretch gap-2 ${urgencyClass(item.urgency)}`}>
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <p className="line-clamp-1 min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">{item.title}</p>
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold tabular-nums">
                        {index + 1}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs text-muted-foreground">
                        {formatAgendaSlot(item)} / {item.estimatedMinutes} min / {urgencyLabel(item.urgency)}
                      </p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-brand-green" style={{ width: `${progressPct}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-1.5 border-t border-border pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => task && setSelectedTaskId(String(task.id))}
                        disabled={!task}
                        data-testid={`button-agenda-work-open-${item.taskId}`}
                      >
                        <Eye className="size-4" />
                        Open
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          onPinTask(item.taskId);
                          toast({ title: "Task pinned", description: "The work box is ready for notes." });
                        }}
                      >
                        <Play className="size-4" />
                        Work
                      </Button>
                    </div>
                  </li>
                );
              })}
              </ol>
            </div>
          )}
        </div>
        <DialogFooter className={dialogFooterClass}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
      <TaskDetailDialog
        task={selectedTask}
        users={users}
        subtasks={subtasks}
        events={events}
        authenticated={authenticated}
        readOnly
        open={Boolean(selectedTask)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedTaskId(null);
        }}
      />
    </Dialog>
  );
}
