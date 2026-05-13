import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, History, Loader2, Pin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { EmailSuggestion, Id, PositionProfile, SuggestionPatch, Task, TaskEvent, TaskSubtask, User } from "@/app/types";
import { urgencyLabel, statusLabels } from "@/app/lib/urgency";
import { localDateIso, addLocalDays, taskDueLabel } from "@/app/lib/date";
import { taskRepeatLabel } from "@/app/lib/task-text";
import { stripRepeatDetails } from "@/app/lib/repeat";
import { invalidateWorkspace } from "@/app/lib/hooks";
import { activityEventLabel } from "@/app/lib/activity";
import TaskRow from "@/app/tasks/TaskRow";
import TaskDetailDialog from "@/app/tasks/TaskDetailDialog";
import SuggestionCard from "@/app/inbox/SuggestionCard";

export type TaskStatusFilter = "open" | "today" | "overdue" | "needs_acceptance" | "completed";

export default function TaskList({
  tasks,
  suggestions = [],
  users,
  subtasks = [],
  events = [],
  authenticated = false,
  positionProfiles = [],
  currentUserId,
  viewLabel,
  onPinTask,
  readOnly = false,
  inlineDetail = false,
  statusFilter = null,
  onStatusFilterChange,
}: {
  tasks: Task[];
  suggestions?: EmailSuggestion[];
  users: User[];
  subtasks?: TaskSubtask[];
  events?: TaskEvent[];
  authenticated?: boolean;
  positionProfiles?: PositionProfile[];
  currentUserId?: Id;
  viewLabel?: string;
  onPinTask?: (taskId: Id) => void;
  readOnly?: boolean;
  inlineDetail?: boolean;
  statusFilter?: TaskStatusFilter | null;
  onStatusFilterChange?: (filter: TaskStatusFilter | null) => void;
}) {
  const [completingId, setCompletingId] = useState<Id | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [dialogTaskId, setDialogTaskId] = useState<string | null>(null);
  const [locallyCompletedIds, setLocallyCompletedIds] = useState<Set<string>>(new Set());
  const [taskSearch, setTaskSearch] = useState("");
  const [taskView, setTaskView] = useState<"active" | "mine" | "review" | "done" | "all">("active");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const visibleTasks = useMemo(
    () =>
      tasks.map((task) =>
        locallyCompletedIds.has(String(task.id)) && task.status !== "completed"
          ? { ...task, status: "completed" as const, completedAt: task.completedAt ?? new Date().toISOString() }
          : task,
      ),
    [locallyCompletedIds, tasks],
  );
  const selectedTask = visibleTasks.find((task) => String(task.id) === selectedTaskId) ?? null;
  const dialogTask = visibleTasks.find((task) => String(task.id) === (dialogTaskId ?? selectedTaskId)) ?? null;

  useEffect(() => {
    setLocallyCompletedIds((current) => {
      const next = new Set(Array.from(current).filter((id) => !tasks.some((task) => String(task.id) === id && task.status === "completed")));
      return next.size === current.size ? current : next;
    });
  }, [tasks]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const complete = useMutation({
    mutationFn: async (id: Id) =>
      apiRequest("POST", `/api/tasks/${id}/complete`, { note: "Done. That's one less thing." }),
    onMutate: (id: Id) => {
      setCompletingId(id);
      setLocallyCompletedIds((current) => new Set(current).add(String(id)));
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      setCompletingId(null);
    },
    onError: (_error, id) => {
      setLocallyCompletedIds((current) => {
        const next = new Set(current);
        next.delete(String(id));
        return next;
      });
      setCompletingId(null);
    },
  });
  const approveSuggestion = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/suggestions/${id}/approve`),
    onSuccess: invalidateWorkspace,
  });
  const dismissSuggestion = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/suggestions/${id}/dismiss`),
    onSuccess: invalidateWorkspace,
  });
  const acceptTask = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/tasks/${id}/accept`),
    onSuccess: invalidateWorkspace,
  });
  const denyTask = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/tasks/${id}/deny`, { note: "Not the right owner." }),
    onSuccess: invalidateWorkspace,
  });
  const updateSuggestion = useMutation({
    mutationFn: async ({ id, patch }: { id: Id; patch: SuggestionPatch }) =>
      apiRequest("PATCH", `/api/suggestions/${id}`, patch),
    onSuccess: invalidateWorkspace,
  });

  // Sort for execution: completion last, then time pressure, urgency, shorter work, and age.
  const urgencyRank: Record<string, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    medium: 2,
    low: 3,
  };
  const today = localDateIso();
  const soonIso = addLocalDays(3, today);
  const pressureRank = (task: Task) => {
    if (task.status === "completed") return 99;
    if (task.dueDate && task.dueDate < today) return 0;
    if (task.dueDate === today) return 1;
    if (task.dueDate && task.dueDate <= soonIso) return 2;
    if (!task.dueDate && (task.urgency === "critical" || task.urgency === "high")) return 3;
    if (task.dueDate) return 4;
    return 5;
  };
  const groupForTask = (task: Task) => {
    if (task.dueDate && task.dueDate < today) return { id: "overdue", label: "Do now", detail: "Past due work" };
    if (task.dueDate === today) return { id: "today", label: "Today", detail: "Due today" };
    if (/reply|respond|follow up|follow-up|email|call|message/i.test(`${task.title} ${task.description}`) || ["email", "slack", "sms"].includes(task.source)) {
      return { id: "communications", label: "Communications batch", detail: "Handle together while context is open" };
    }
    if (/review|approve|audit|contract|document|proposal|invoice|reconcile/i.test(`${task.title} ${task.description}`) || task.source === "document") {
      return { id: "review", label: "Review batch", detail: "Read, decide, and approve together" };
    }
    if (/plan|roadmap|strategy|report|presentation|deck|onboarding/i.test(`${task.title} ${task.description}`)) {
      return { id: "planning", label: "Planning batch", detail: "Deep work and manager planning" };
    }
    if (task.dueDate) return { id: "scheduled", label: "Scheduled later", detail: "Upcoming dated work" };
    return { id: "backlog", label: "Backlog", detail: "No due date yet" };
  };

  const normalizedTaskSearch = taskSearch.trim().toLowerCase();
  const userNameForTask = (task: Task) => users.find((user) => String(user.id) === String(task.assignedToId))?.name ?? "";
  const isMineTask = (task: Task) =>
    currentUserId
      ? String(task.assignedToId) === String(currentUserId) || String(task.delegatedToId ?? "") === String(currentUserId)
      : true;
  const matchesTaskSearch = (task: Task) => {
    if (!normalizedTaskSearch) return true;
    const haystack = [
      task.title,
      task.description,
      task.completionNotes,
      task.source,
      task.urgency,
      task.status,
      task.dueDate ?? "",
      userNameForTask(task),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedTaskSearch);
  };
  const matchesStatusFilter = (task: Task) => {
    if (!statusFilter) return true;
    if (statusFilter === "open") return task.status !== "completed" && task.status !== "denied";
    if (statusFilter === "today") return task.dueDate === today && task.status !== "completed" && task.status !== "denied";
    if (statusFilter === "overdue") return Boolean(task.dueDate && task.dueDate < today && task.status !== "completed" && task.status !== "denied");
    if (statusFilter === "needs_acceptance") return task.status === "pending_acceptance";
    if (statusFilter === "completed") return task.status === "completed";
    return true;
  };
  const pendingSuggestions = suggestions.filter((suggestion) => suggestion.status === "pending");
  const pendingTaskCount = visibleTasks.filter((task) => task.status === "pending_acceptance").length;
  const effectiveTaskView =
    statusFilter === "completed"
      ? "done"
      : statusFilter === "needs_acceptance"
        ? "review"
        : statusFilter
          ? "active"
          : taskView;
  const scopedTasks = visibleTasks.filter((task) => {
    if (effectiveTaskView === "mine" && !isMineTask(task)) return false;
    return matchesTaskSearch(task);
  });
  const filteredTasks = scopedTasks.filter((task) => {
    if (effectiveTaskView === "active" && (task.status === "completed" || task.status === "denied")) return false;
    if (effectiveTaskView === "review" && task.status !== "pending_acceptance") return false;
    if (effectiveTaskView === "done" && task.status !== "completed") return false;
    return matchesStatusFilter(task);
  });

  const sorted = [...filteredTasks].sort((a, b) => {
    const aDone = a.status === "completed" ? 1 : 0;
    const bDone = b.status === "completed" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aPressure = pressureRank(a);
    const bPressure = pressureRank(b);
    if (aPressure !== bPressure) return aPressure - bPressure;
    const urgencyDelta = (urgencyRank[a.urgency] ?? 4) - (urgencyRank[b.urgency] ?? 4);
    if (urgencyDelta !== 0) return urgencyDelta;
    const aDue = a.dueDate ?? "9999-12-31";
    const bDue = b.dueDate ?? "9999-12-31";
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    if (a.estimatedMinutes !== b.estimatedMinutes) return a.estimatedMinutes - b.estimatedMinutes;
    return a.createdAt.localeCompare(b.createdAt);
  });

  const open = sorted.filter((t) => t.status !== "completed" && t.status !== "denied");
  const reviewTasks = effectiveTaskView === "review" ? open.filter((task) => task.status === "pending_acceptance") : [];
  const newTaskCutoff = nowMs - 30 * 60 * 1000;
  const newTasks = open
    .filter((task) => {
      const createdAt = new Date(task.createdAt).getTime();
      return Number.isFinite(createdAt) && createdAt >= newTaskCutoff;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 2);
  const showNewTaskBucket = (!statusFilter || statusFilter === "open") && effectiveTaskView !== "review";
  const newTaskIds = new Set(showNewTaskBucket ? newTasks.map((task) => String(task.id)) : []);
  const prioritizedOpen = effectiveTaskView === "review" ? [] : open.filter((task) => !newTaskIds.has(String(task.id)));
  const done =
    statusFilter && statusFilter !== "completed"
      ? []
      : (effectiveTaskView === "active" ? scopedTasks : filteredTasks)
          .filter((t) => t.status === "completed")
          .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt));
  const grouped = prioritizedOpen.reduce<Array<{ id: string; label: string; detail: string; tasks: Task[] }>>((groups, task) => {
    const group = groupForTask(task);
    const existing = groups.find((item) => item.id === group.id);
    if (existing) existing.tasks.push(task);
    else groups.push({ ...group, tasks: [task] });
    return groups;
  }, []);
  const inlineTask = selectedTask ?? open[0] ?? done[0] ?? null;
  const inlineAssignee = inlineTask ? users.find((user) => String(user.id) === String(inlineTask.assignedToId)) : null;
  const inlineTaskEvents = inlineTask ? events.filter((event) => String(event.taskId) === String(inlineTask.id)).slice(0, 4) : [];
  const inlineTaskSubtasks = inlineTask ? subtasks.filter((subtask) => String(subtask.taskId) === String(inlineTask.id)) : [];

  return (
    <div className="panel flex flex-col" data-testid="panel-tasks">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="work-heading">To do</h2>
          <p className="ui-label mt-1">
            {viewLabel ? `${viewLabel} - ` : ""}New work first, then Eisenhower priority order
          </p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums">
          {open.length} open
        </span>
      </div>

      <div className="work-toolbar border-b border-border px-2">
        {([
          ["active", "Active", visibleTasks.filter((task) => task.status !== "completed" && task.status !== "denied").length],
          ["mine", "Mine", null],
          ["review", "Needs Review", pendingTaskCount + pendingSuggestions.length],
          ["done", "Done", visibleTasks.filter((task) => task.status === "completed").length],
          ["all", "All", null],
        ] as Array<[string, string, number | null]>).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              onStatusFilterChange?.(null);
              setTaskView(id as "active" | "mine" | "review" | "done" | "all");
            }}
            className={`work-tab${effectiveTaskView === id ? " active" : ""}`}
            data-testid={`button-task-view-${id}`}
          >
            {label}
            {count != null && <span className="work-tab-count">{count}</span>}
          </button>
        ))}
        <span className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={taskSearch}
            onChange={(event) => setTaskSearch(event.target.value)}
            placeholder="Search..."
            className="h-7 w-40 pl-7 text-xs"
            data-testid="input-task-list-search"
          />
        </div>
      </div>

      <div className={inlineDetail ? "tasks-split-layout" : ""}>
      <div className="flex flex-col gap-2 px-4 py-4">
        {effectiveTaskView === "review" && (
          <div className="space-y-2">
            <div className="task-group-head bucket-review" data-testid="task-group-head-review">
              <span className="task-group-dot is-upcoming" aria-hidden="true" />
              <span className="task-group-label">Needs review</span>
              <span className="task-group-detail">Scanned emails and assigned tasks waiting for your decision</span>
              <span className="task-group-count">{pendingTaskCount + pendingSuggestions.length}</span>
            </div>
            {pendingSuggestions.length > 0 && (
              <div className="space-y-2" data-testid="section-needs-review-suggestions">
                {pendingSuggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    onApprove={() => approveSuggestion.mutate(suggestion.id)}
                    onDismiss={() => dismissSuggestion.mutate(suggestion.id)}
                    onSaveEdits={(id, patch) => updateSuggestion.mutate({ id, patch })}
                    approving={approveSuggestion.isPending}
                    dismissing={dismissSuggestion.isPending}
                    saving={updateSuggestion.isPending}
                  />
                ))}
              </div>
            )}
            {reviewTasks.length > 0 && (
              <div className="space-y-2" data-testid="section-needs-review-tasks">
                {reviewTasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-md border border-border bg-card p-3 shadow-sm"
                    data-testid={`row-needs-review-task-${task.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground break-words">{task.title}</p>
                        {task.description && (
                          <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{task.description}</p>
                        )}
                      </div>
                      <span className="ui-label whitespace-nowrap">{urgencyLabel(task.urgency)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>Due {task.dueDate ?? "not set"}</span>
                      <span>{task.estimatedMinutes} min</span>
                      <span>Source: {task.source}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => acceptTask.mutate(task.id)}
                        disabled={acceptTask.isPending || denyTask.isPending}
                        data-testid={`button-needs-review-accept-${task.id}`}
                      >
                        <Check className="size-4" />
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => denyTask.mutate(task.id)}
                        disabled={acceptTask.isPending || denyTask.isPending}
                        data-testid={`button-needs-review-deny-${task.id}`}
                      >
                        Deny
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedTaskId(String(task.id))}
                        data-testid={`button-needs-review-open-${task.id}`}
                      >
                        Open
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showNewTaskBucket && (
          <div className="space-y-2">
            <div className="task-group-head bucket-upcoming" data-testid="task-group-head-new">
              <span className="task-group-dot is-upcoming" aria-hidden="true" />
              <span className="task-group-label">New tasks</span>
              <span className="task-group-detail">Newest work from the last 30 minutes</span>
              <span className="task-group-count">{newTasks.length}</span>
            </div>
            {newTasks.length > 0 ? (
              newTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  users={users}
                  events={events}
                  isCompleting={completingId === task.id && complete.isPending}
                  onComplete={() => complete.mutate(task.id)}
                  onOpen={() => setSelectedTaskId(String(task.id))}
                  onPin={!readOnly && onPinTask ? () => onPinTask(task.id) : undefined}
                  readOnly={readOnly}
                />
              ))
            ) : (
              <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-4 text-center text-sm text-muted-foreground/70">
                No new tasks
              </div>
            )}
          </div>
        )}

        {open.length === 0 && done.length === 0 && !(effectiveTaskView === "review" && pendingSuggestions.length > 0) ? (
          <div className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-10 text-center">
            <Search className="mx-auto size-8 text-brand-green" />
            <p className="display-font mt-3 text-base font-bold">
              {taskSearch.trim() ? "No matching tasks." : effectiveTaskView === "review" ? "Nothing needs review." : "Plate's clear."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {taskSearch.trim() ? "Try a different keyword, owner, source, or status." : effectiveTaskView === "review" ? "Scanned emails and assigned tasks that need approval will appear here." : "Done. That's one less thing."}
            </p>
          </div>
        ) : (
          grouped.map((group) => {
            const dotTone =
              group.id === "overdue"
                ? "is-overdue"
                : group.id === "today"
                  ? "is-today"
                  : group.id === "scheduled"
                    ? "is-upcoming"
                    : group.id === "backlog"
                      ? "is-delegated"
                      : "is-upcoming";
            return (
            <div key={group.id} className="space-y-2">
              <div className={`task-group-head bucket-${group.id}`} data-testid={`task-group-head-${group.id}`}>
                <span className={`task-group-dot ${dotTone}`} aria-hidden="true" />
                <span className="task-group-label">{group.label}</span>
                <span className="task-group-detail">{group.detail}</span>
                <span className="task-group-count">{group.tasks.length}</span>
              </div>
              {group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  users={users}
                  events={events}
                  isCompleting={completingId === task.id && complete.isPending}
                  onComplete={() => complete.mutate(task.id)}
                  onOpen={() => setSelectedTaskId(String(task.id))}
                  onPin={!readOnly && onPinTask ? () => onPinTask(task.id) : undefined}
                  readOnly={readOnly}
                />
              ))}
            </div>
            );
          })
        )}

        {done.length > 0 && (
          <>
            <div className="task-group-head bucket-done mt-4" data-testid="section-done">
              <span className="task-group-dot is-done" aria-hidden="true" />
              <span className="task-group-label">Done</span>
              <span className="task-group-detail">Recently completed</span>
              <span className="task-group-count">{done.length}</span>
            </div>
            {done.slice(0, 8).map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                users={users}
                events={events}
                isCompleting={false}
                onComplete={() => undefined}
                onOpen={() => setSelectedTaskId(String(task.id))}
                onPin={!readOnly && onPinTask ? () => onPinTask(task.id) : undefined}
                readOnly={readOnly}
              />
            ))}
          </>
        )}
      </div>
      {inlineDetail && (
        <aside className="task-inline-detail">
          {inlineTask ? (
            <>
              <div className="task-inline-detail-head">
                <div>
                  <p className="ui-label">Task detail</p>
                  <h3>{inlineTask.title}</h3>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onPinTask?.(inlineTask.id)}
                  disabled={readOnly || !onPinTask}
                  title="Pin to work window"
                  data-testid={`button-inline-pin-task-${inlineTask.id}`}
                >
                  <Pin className="size-4" />
                </Button>
              </div>
              <div className="task-inline-meta">
                <span>Status</span>
                <strong>{statusLabels[inlineTask.status] ?? inlineTask.status}</strong>
                <span>Urgency</span>
                <strong>{urgencyLabel(inlineTask.urgency)}</strong>
                <span>Due</span>
                <strong>{taskDueLabel(inlineTask)}</strong>
                <span>Assignee</span>
                <strong>{inlineAssignee?.name ?? "Unassigned"}</strong>
                <span>Estimate</span>
                <strong>{inlineTask.estimatedMinutes} min</strong>
                {taskRepeatLabel(inlineTask) && (
                  <>
                    <span>Repeats</span>
                    <strong>{taskRepeatLabel(inlineTask)}</strong>
                  </>
                )}
              </div>
              {inlineTask.description && (
                <div className="task-inline-section">
                  <p className="ui-label">Notes</p>
                  <p>{stripRepeatDetails(inlineTask.description)}</p>
                </div>
              )}
              <div className="task-inline-section">
                <p className="ui-label">Subtasks {inlineTaskSubtasks.length > 0 ? `(${inlineTaskSubtasks.filter((item) => item.done).length}/${inlineTaskSubtasks.length})` : ""}</p>
                {inlineTaskSubtasks.length > 0 ? (
                  inlineTaskSubtasks.slice(0, 5).map((subtask) => (
                    <div key={subtask.id} className="task-inline-list-item">
                      <span className={`check-circle ${subtask.done ? "is-checked" : ""}`}>
                        <Check className="size-3" />
                      </span>
                      <span>{subtask.title}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">No subtasks yet.</p>
                )}
              </div>
              <div className="task-inline-section">
                <p className="ui-label">Activity</p>
                {inlineTaskEvents.length > 0 ? (
                  inlineTaskEvents.map((event) => (
                    <div key={event.id} className="task-inline-list-item">
                      <History className="size-3.5 text-muted-foreground" />
                      <span>{activityEventLabel(event.type)}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">No updates yet.</p>
                )}
              </div>
              <div className="task-inline-actions">
                <Button
                  type="button"
                  onClick={() => complete.mutate(inlineTask.id)}
                  disabled={readOnly || inlineTask.status === "completed" || complete.isPending}
                  data-testid={`button-inline-complete-task-${inlineTask.id}`}
                >
                  {complete.isPending && completingId === inlineTask.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Mark done
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogTaskId(String(inlineTask.id))}
                  data-testid={`button-inline-open-task-${inlineTask.id}`}
                >
                  Open full task
                </Button>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
              Select a task to see details.
            </div>
          )}
        </aside>
      )}
      </div>
      <TaskDetailDialog
        task={inlineDetail ? dialogTask : selectedTask}
        users={users}
        subtasks={subtasks}
        events={events}
        authenticated={authenticated}
        positionProfiles={positionProfiles}
        readOnly={readOnly}
        open={inlineDetail ? Boolean(dialogTaskId) : Boolean(selectedTask)}
        onOpenChange={(open) => {
          if (!open) {
            if (inlineDetail) setDialogTaskId(null);
            else setSelectedTaskId(null);
          }
        }}
      />
    </div>
  );
}
