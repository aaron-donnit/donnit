import { useState, useMemo } from "react";
import { Archive, Eye, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Task, TaskEvent, TaskSubtask, User } from "@/app/types";
import { statusLabels } from "@/app/lib/urgency";
import { titleCase } from "@/app/lib/task-text";
import { activityEventLabel, eventSearchText } from "@/app/lib/activity";
import TaskDetailDialog from "@/app/tasks/TaskDetailDialog";

export default function ActivityLogPanel({
  events,
  tasks,
  users,
  subtasks = [],
  authenticated = false,
  compact = false,
}: {
  events: TaskEvent[];
  tasks: Task[];
  users: User[];
  subtasks?: TaskSubtask[];
  authenticated?: boolean;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const taskById = useMemo(() => new Map(tasks.map((task) => [String(task.id), task])), [tasks]);
  const userById = useMemo(() => new Map(users.map((user) => [String(user.id), user])), [users]);
  const filtered = useMemo(() => {
    if (!normalizedQuery) return events;
    return events.filter((event) => {
      const task = taskById.get(String(event.taskId));
      const user = userById.get(String(event.actorId));
      return eventSearchText(event, task, user).includes(normalizedQuery);
    });
  }, [events, normalizedQuery, taskById, userById]);
  const visible = compact && !normalizedQuery ? filtered.slice(0, 6) : filtered.slice(0, compact ? 10 : 150);
  const selectedTask = selectedTaskId ? taskById.get(selectedTaskId) ?? null : null;

  return (
    <div className="panel" data-testid={compact ? "panel-log" : "panel-activity-log"}>
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="display-font text-sm font-bold">
              <Archive className="mr-2 inline size-4" />
              Task log
            </h3>
            <p className="ui-label mt-1">Search prior tasks, notes, owners, and updates</p>
          </div>
          <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums text-muted-foreground">
            {filtered.length} result{filtered.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search task title, notes, person, source, or date"
            className="h-9 pl-9"
            data-testid="input-task-log-search"
          />
        </div>
      </div>
      <div className="px-4 py-3">
        {visible.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            {normalizedQuery ? "No matching task history found." : "No activity yet."}
          </p>
        ) : (
          <ul className={compact ? "space-y-2.5" : "divide-y divide-border"}>
            {visible.map((event) => {
              const task = taskById.get(String(event.taskId));
              const user = userById.get(String(event.actorId));
              const isComplete = event.type === "completed";
              return (
                <li
                  key={event.id}
                  className={compact ? "flex gap-2.5" : "py-3"}
                  data-testid={`row-event-${event.id}`}
                >
                  <div className="flex w-full items-start gap-3">
                    <span
                      className={`mt-2 size-2 shrink-0 rounded-full ${
                        isComplete ? "bg-brand-green" : "bg-muted-foreground/40"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-snug text-foreground">
                            {task?.title ?? `Task ${event.taskId}`}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {activityEventLabel(event.type)} by {user?.name ?? "Unknown"} - {new Date(event.createdAt).toLocaleString()}
                          </p>
                        </div>
                        {task && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => setSelectedTaskId(String(event.taskId))}
                            data-testid={`button-open-log-task-${event.id}`}
                          >
                            <Eye className="size-3" />
                            Open
                          </Button>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                        {task?.dueDate && <span className="rounded bg-muted px-1.5 py-0.5">Due {task.dueDate}</span>}
                        {task?.source && <span className="rounded bg-muted px-1.5 py-0.5">{titleCase(task.source)}</span>}
                        {task?.status && <span className="rounded bg-muted px-1.5 py-0.5">{statusLabels[task.status] ?? task.status}</span>}
                      </div>
                      {event.note && <p className="mt-1.5 line-clamp-3 text-xs text-foreground">{event.note}</p>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {filtered.length > visible.length && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Showing {visible.length} of {filtered.length}. Refine the search to narrow the log.
          </p>
        )}
      </div>
      <TaskDetailDialog
        task={selectedTask}
        users={users}
        subtasks={subtasks}
        events={events}
        authenticated={authenticated}
        open={Boolean(selectedTask)}
        onOpenChange={(open) => {
          if (!open) setSelectedTaskId(null);
        }}
      />
    </div>
  );
}
