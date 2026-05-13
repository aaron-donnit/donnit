import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, CheckCircle2, History, ListChecks, ListPlus, Loader2, MoreHorizontal, Send, UserPlus, UserRoundCheck, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Id, LocalSubtask, PositionProfile, Task, TaskEvent, TaskSubtask, User } from "@/app/types";
import { dialogShellClass } from "@/app/constants";
import { urgencyLabel } from "@/app/lib/urgency";
import { taskDueLabel } from "@/app/lib/date";
import { taskRepeatLabel } from "@/app/lib/task-text";
import { extractRepeatDetails, stripRepeatDetails, descriptionWithRepeatDetails, defaultRepeatDetails } from "@/app/lib/repeat";
import { sortSubtasks, normalizeLocalSubtasks, apiErrorMessage, parseInheritedTaskContext } from "@/app/lib/tasks";
import { isActiveUser, latestOpenUpdateRequest } from "@/app/lib/permissions";
import { profilePrimaryOwnerId, profileAssignmentLabel } from "@/app/lib/profiles";
import { invalidateWorkspace } from "@/app/lib/hooks";
import { statusLabels } from "@/app/lib/urgency";
import RichNoteEditor from "@/app/tasks/RichNoteEditor";

export default function TaskDetailDialog({
  task,
  users,
  subtasks: persistedSubtasks = [],
  events = [],
  authenticated = false,
  positionProfiles = [],
  readOnly = false,
  open,
  onOpenChange,
}: {
  task: Task | null;
  users: User[];
  subtasks?: TaskSubtask[];
  events?: TaskEvent[];
  authenticated?: boolean;
  positionProfiles?: PositionProfile[];
  readOnly?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("open");
  const [urgency, setUrgency] = useState<"low" | "normal" | "high" | "critical">("normal");
  const [visibility, setVisibility] = useState<"work" | "personal" | "confidential">("work");
  const [recurrence, setRecurrence] = useState("none");
  const [repeatDetails, setRepeatDetails] = useState("");
  const [reminderDaysBefore, setReminderDaysBefore] = useState(0);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
  const [estimatedMinutes, setEstimatedMinutes] = useState(30);
  const [assignedToId, setAssignedToId] = useState("");
  const [positionProfileId, setPositionProfileId] = useState("");
  const [delegatedToId, setDelegatedToId] = useState("");
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [localSubtasks, setLocalSubtasks] = useState<LocalSubtask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [showInheritedHistory, setShowInheritedHistory] = useState(false);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(stripRepeatDetails(task.description));
    setStatus(task.status);
    setUrgency(task.urgency as "low" | "normal" | "high" | "critical");
    setVisibility(task.visibility ?? "work");
    setRecurrence(task.recurrence ?? "none");
    setRepeatDetails(extractRepeatDetails(task.description));
    setReminderDaysBefore(task.reminderDaysBefore ?? 0);
    setDueDate(task.dueDate ?? "");
    setDueTime(task.dueTime ?? "");
    setStartTime(task.startTime ?? "");
    setEndTime(task.endTime ?? "");
    setIsAllDay(task.isAllDay ?? false);
    setEstimatedMinutes(task.estimatedMinutes);
    setAssignedToId(String(task.assignedToId));
    setPositionProfileId(task.positionProfileId ? String(task.positionProfileId) : "");
    setDelegatedToId(task.delegatedToId ? String(task.delegatedToId) : "");
    setCollaboratorIds((task.collaboratorIds ?? []).map((id) => String(id)));
    setNote(task.completionNotes ?? "");
    setNewSubtaskTitle("");
    setShowInheritedHistory(false);
    if (authenticated) {
      setLocalSubtasks([]);
      return;
    }
    try {
      if (typeof window === "undefined") {
        setLocalSubtasks([]);
      } else {
        setLocalSubtasks(
          normalizeLocalSubtasks(task.id, JSON.parse(window.localStorage.getItem(`donnit.subtasks.${task.id}`) ?? "[]")),
        );
      }
    } catch {
      setLocalSubtasks([]);
    }
  }, [authenticated, task]);

  useEffect(() => {
    if (visibility === "personal" && positionProfileId) {
      setPositionProfileId("");
    }
  }, [positionProfileId, visibility]);

  const save = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error("No task selected.");
      if (readOnly) throw new Error("This team view is read-only.");
      const res = await apiRequest("PATCH", `/api/tasks/${task.id}`, {
        title: title.trim(),
        description: descriptionWithRepeatDetails(description.trim(), recurrence === "none" ? "" : repeatDetails),
        status,
        urgency,
        visibility,
        recurrence,
        reminderDaysBefore,
        dueDate: dueDate || null,
        dueTime: isAllDay ? null : dueTime || null,
        startTime: isAllDay ? null : startTime || null,
        endTime: isAllDay ? null : endTime || null,
        isAllDay,
        estimatedMinutes,
        assignedToId,
        positionProfileId: visibility === "personal" ? null : positionProfileId || null,
        delegatedToId: delegatedToId || null,
        collaboratorIds,
        note: note.trim() || undefined,
      });
      return (await res.json()) as Task;
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Task updated", description: "The task details were saved." });
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not update task",
        description: error instanceof Error ? error.message : "Check the task details and try again.",
        variant: "destructive",
      });
    },
  });

  const updateRelationships = useMutation({
    mutationFn: async (next: {
      assignedToId: string;
      delegatedToId: string;
      collaboratorIds: string[];
    }) => {
      if (!task) throw new Error("No task selected.");
      if (readOnly) throw new Error("This team view is read-only.");
      const res = await apiRequest("PATCH", `/api/tasks/${task.id}`, {
        assignedToId: next.assignedToId,
        delegatedToId: next.delegatedToId || null,
        collaboratorIds: next.collaboratorIds,
      });
      return (await res.json()) as Task;
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Task routing updated", description: "People changes were saved." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not update people",
        description: error instanceof Error ? error.message : "Try that routing change again.",
        variant: "destructive",
      });
    },
  });

  const postpone = useMutation({
    mutationFn: async (days: 1 | 7) => {
      if (!task) throw new Error("No task selected.");
      if (readOnly) throw new Error("This team view is read-only.");
      const res = await apiRequest("POST", `/api/tasks/${task.id}/${days === 1 ? "postpone-day" : "postpone-week"}`, {});
      return (await res.json()) as Task;
    },
    onSuccess: async (updated) => {
      setDueDate(updated.dueDate ?? "");
      await invalidateWorkspace();
      toast({ title: "Due date updated", description: `Moved to ${updated.dueDate ?? "no due date"}.` });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not push due date",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const donnit = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error("No task selected.");
      if (readOnly) throw new Error("This team view is read-only.");
      const res = await apiRequest("POST", `/api/tasks/${task.id}/complete`, { note: note.trim() || "Donnit." });
      return (await res.json()) as Task;
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Donnit", description: "Task completed." });
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not complete task",
        description: error instanceof Error ? error.message : "Try completing it again.",
        variant: "destructive",
      });
    },
  });

  const createSubtask = useMutation({
    mutationFn: async (input: { title: string; position: number }) => {
      if (!task) throw new Error("No task selected.");
      if (readOnly) throw new Error("This team view is read-only.");
      const res = await apiRequest("POST", `/api/tasks/${task.id}/subtasks`, input);
      return (await res.json()) as TaskSubtask;
    },
    onSuccess: async () => {
      setNewSubtaskTitle("");
      await invalidateWorkspace();
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not add subtask",
        description: apiErrorMessage(error, "Apply migration 0010 and try again."),
        variant: "destructive",
      });
    },
  });

  const updateSubtask = useMutation({
    mutationFn: async (input: { subtaskId: Id; done: boolean }) => {
      if (!task) throw new Error("No task selected.");
      if (readOnly) throw new Error("This team view is read-only.");
      const res = await apiRequest("PATCH", `/api/tasks/${task.id}/subtasks/${input.subtaskId}`, { done: input.done });
      return (await res.json()) as TaskSubtask;
    },
    onSuccess: invalidateWorkspace,
    onError: (error: unknown) => {
      toast({
        title: "Could not update subtask",
        description: apiErrorMessage(error, "Try that subtask again."),
        variant: "destructive",
      });
    },
  });

  const removeSubtask = useMutation({
    mutationFn: async (subtaskId: Id) => {
      if (!task) throw new Error("No task selected.");
      if (readOnly) throw new Error("This team view is read-only.");
      await apiRequest("DELETE", `/api/tasks/${task.id}/subtasks/${subtaskId}`);
    },
    onSuccess: invalidateWorkspace,
    onError: (error: unknown) => {
      toast({
        title: "Could not delete subtask",
        description: apiErrorMessage(error, "Try deleting it again."),
        variant: "destructive",
      });
    },
  });

  if (!task) return null;
  const activeUsers = users.filter(isActiveUser);
  const assignee = users.find((user) => String(user.id) === String(task.assignedToId));
  const assigner = users.find((user) => String(user.id) === String(task.assignedById));
  const delegate = users.find((user) => String(user.id) === delegatedToId);
  const inheritedContext = parseInheritedTaskContext(events, task.id);
  const inheritedFrom = inheritedContext ? users.find((user) => String(user.id) === String(inheritedContext.fromUserId)) : null;
  const selectedCollaborators = users.filter((user) => collaboratorIds.includes(String(user.id)));
  const savedPositionProfiles = positionProfiles.filter((profile) => profile.persisted);
  const selectedAssigneeProfiles = savedPositionProfiles.filter((profile) => String(profilePrimaryOwnerId(profile)) === assignedToId);
  const coverageProfiles = savedPositionProfiles.filter(
    (profile) =>
      String(profilePrimaryOwnerId(profile)) !== assignedToId &&
      (String(profile.temporaryOwnerId ?? "") === assignedToId || String(profile.delegateUserId ?? "") === assignedToId),
  );
  const otherPositionProfiles = savedPositionProfiles.filter(
    (profile) => !selectedAssigneeProfiles.some((item) => item.id === profile.id) && !coverageProfiles.some((item) => item.id === profile.id),
  );
  const collaboratorOptions = activeUsers.filter(
    (user) => String(user.id) !== assignedToId && !collaboratorIds.includes(String(user.id)),
  );
  const ready = title.trim().length >= 2;
  const addCollaborator = (userId: string) => {
    if (!userId) return;
    const nextCollaborators = collaboratorIds.includes(userId) ? collaboratorIds : [...collaboratorIds, userId];
    setCollaboratorIds(nextCollaborators);
    updateRelationships.mutate({ assignedToId, delegatedToId, collaboratorIds: nextCollaborators });
  };
  const removeCollaborator = (userId: string) => {
    const nextCollaborators = collaboratorIds.filter((id) => id !== userId);
    setCollaboratorIds(nextCollaborators);
    updateRelationships.mutate({ assignedToId, delegatedToId, collaboratorIds: nextCollaborators });
  };
  const reassignOwner = (userId: string) => {
    const nextDelegate = delegatedToId === userId ? "" : delegatedToId;
    const nextCollaborators = collaboratorIds.filter((id) => id !== userId);
    setAssignedToId(userId);
    setDelegatedToId(nextDelegate);
    setCollaboratorIds(nextCollaborators);
    updateRelationships.mutate({ assignedToId: userId, delegatedToId: nextDelegate, collaboratorIds: nextCollaborators });
  };
  const delegateTask = (userId: string) => {
    setDelegatedToId(userId);
    updateRelationships.mutate({ assignedToId, delegatedToId: userId, collaboratorIds });
  };
  const persistSubtasks = (next: LocalSubtask[]) => {
    setLocalSubtasks(next);
    if (task && typeof window !== "undefined") {
      window.localStorage.setItem(`donnit.subtasks.${task.id}`, JSON.stringify(next));
    }
  };
  const subtasks = authenticated
    ? sortSubtasks(persistedSubtasks.filter((item) => String(item.taskId) === String(task.id)))
    : sortSubtasks(localSubtasks);
  const addSubtask = () => {
    const titleText = newSubtaskTitle.trim();
    if (!titleText) return;
    if (authenticated) {
      createSubtask.mutate({ title: titleText, position: subtasks.length });
      return;
    }
    persistSubtasks([
      ...subtasks,
      {
        id: `subtask-${Date.now()}`,
        taskId: task.id,
        title: titleText,
        done: false,
        position: subtasks.length,
        completedAt: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    setNewSubtaskTitle("");
  };
  const toggleSubtask = (subtask: TaskSubtask) => {
    if (authenticated) {
      updateSubtask.mutate({ subtaskId: subtask.id, done: !subtask.done });
      return;
    }
    persistSubtasks(
      subtasks.map((item) =>
        item.id === subtask.id
          ? { ...item, done: !item.done, completedAt: !item.done ? new Date().toISOString() : null }
          : item,
      ),
    );
  };
  const deleteSubtask = (subtaskId: Id) => {
    if (authenticated) {
      removeSubtask.mutate(subtaskId);
      return;
    }
    persistSubtasks(subtasks.filter((item) => String(item.id) !== String(subtaskId)));
  };
  const taskEvents = task
    ? events
        .filter((event) => String(event.taskId) === String(task.id))
        .slice(0, 8)
    : [];
  const latestUpdateRequest = task ? latestOpenUpdateRequest(task, events) : undefined;
  const updateRequester = latestUpdateRequest
    ? users.find((user) => String(user.id) === String(latestUpdateRequest.actorId))
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} sm:max-w-2xl`}>
        <DialogHeader className="relative shrink-0 border-b border-border px-5 py-4 pr-24">
          <div className="absolute right-14 top-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={readOnly}
                  aria-label="Task settings"
                  data-testid="button-task-settings-menu"
                >
                  <MoreHorizontal className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 p-3">
                <DropdownMenuLabel>Task settings</DropdownMenuLabel>
                <div className="mt-2 grid gap-3">
                  <div className="flex min-h-10 flex-wrap items-center gap-3 rounded-md border border-border bg-muted/25 px-3 py-2">
                    <label className="inline-flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={visibility === "confidential"}
                        onChange={(event) => setVisibility(event.target.checked ? "confidential" : "work")}
                        className="size-4 rounded border-border accent-brand-green"
                        data-testid="checkbox-task-detail-confidential"
                      />
                      Confidential
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={visibility === "personal"}
                        onChange={(event) => setVisibility(event.target.checked ? "personal" : "work")}
                        className="size-4 rounded border-border accent-brand-green"
                        data-testid="checkbox-task-detail-personal"
                      />
                      Personal
                    </label>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="task-detail-recurrence">Recurring</Label>
                    <select
                      id="task-detail-recurrence"
                      value={recurrence}
                      onChange={(event) => {
                        const next = event.target.value;
                        setRecurrence(next);
                        setRepeatDetails((current) => current || defaultRepeatDetails(next, dueDate));
                      }}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                      data-testid="select-task-detail-recurrence"
                    >
                      <option value="none">No recurrence</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annual">Annual</option>
                    </select>
                  </div>
                  {recurrence !== "none" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="task-detail-repeat-pattern">Repeat pattern</Label>
                      <Input
                        id="task-detail-repeat-pattern"
                        value={repeatDetails}
                        onChange={(event) => setRepeatDetails(event.target.value)}
                        placeholder="Every Tuesday, first Monday monthly, or May 15 every year"
                        data-testid="input-task-detail-repeat-pattern"
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="task-detail-reminder">Show early</Label>
                    <Input
                      id="task-detail-reminder"
                      type="number"
                      min={0}
                      max={365}
                      value={reminderDaysBefore}
                      onChange={(event) => setReminderDaysBefore(Math.max(0, Number(event.target.value) || 0))}
                      data-testid="input-task-detail-reminder-days"
                    />
                  </div>
                  {savedPositionProfiles.length > 0 && (
                    <div className="space-y-1.5">
                      <Label htmlFor="task-detail-position-profile">Position Profile</Label>
                      <select
                        id="task-detail-position-profile"
                        value={positionProfileId}
                        onChange={(event) => setPositionProfileId(event.target.value)}
                        disabled={visibility === "personal"}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
                        data-testid="select-task-detail-position-profile"
                      >
                        <option value="">No Position Profile</option>
                        {selectedAssigneeProfiles.length > 0 && (
                          <optgroup label="Assigned person's profiles">
                            {selectedAssigneeProfiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>
                                {profile.title} - {profileAssignmentLabel(profile, users)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {coverageProfiles.length > 0 && (
                          <optgroup label="Coverage profiles">
                            {coverageProfiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>
                                {profile.title} - {profileAssignmentLabel(profile, users)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {otherPositionProfiles.length > 0 && (
                          <optgroup label="Other profiles">
                            {otherPositionProfiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>
                                {profile.title} - {profileAssignmentLabel(profile, users)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        {visibility === "personal"
                          ? "Personal tasks are excluded from Position Profile memory."
                          : "Choose the role memory this task should update."}
                      </p>
                    </div>
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <DialogTitle>Task details</DialogTitle>
          <DialogDescription>
            Owned by {assignee?.name ?? "Unknown"} - assigned by {assigner?.name ?? "Unknown"}
            {delegate ? `, delegated to ${delegate.name}` : ""}.
            {readOnly ? " You are viewing this as a manager; changes are disabled." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-4">
          {latestUpdateRequest && !readOnly && task.status !== "completed" && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Update requested</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {updateRequester?.name ?? "Your manager"} asked for an update: {latestUpdateRequest.note}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!note.trim()) setNote("Update: ");
                    window.setTimeout(() => document.getElementById("task-detail-note")?.focus(), 0);
                  }}
                  data-testid="button-task-respond-update-request"
                >
                  <Send className="size-4" />
                  Respond
                </Button>
              </div>
            </div>
          )}
          {inheritedContext && (
            <div className="rounded-md border border-brand-green/30 bg-brand-green/10 px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Inherited from {inheritedContext.profileTitle}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    This task starts with blank working notes for the new owner. Prior context is preserved separately for reference.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowInheritedHistory((value) => !value)}
                  data-testid="button-task-inherited-history-toggle"
                >
                  {showInheritedHistory ? "Hide history" : "Show history"}
                </Button>
              </div>
              {showInheritedHistory && (
                <div className="mt-3 grid gap-2 text-xs">
                  <div className="rounded-md border border-border bg-background px-3 py-2">
                    <p className="font-medium text-foreground">
                      Source owner: {inheritedFrom?.name ?? "Previous profile owner"}
                      {inheritedContext.inheritedAt ? ` · ${new Date(inheritedContext.inheritedAt).toLocaleString()}` : ""}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Mode: {inheritedContext.mode === "delegate" ? "delegated coverage" : "reassigned profile work"}
                      {inheritedContext.delegateUntil ? ` through ${inheritedContext.delegateUntil}` : ""}
                    </p>
                  </div>
                  {inheritedContext.inheritedDescription && (
                    <div className="rounded-md border border-border bg-background px-3 py-2">
                      <p className="mb-1 font-medium text-foreground">Previous description</p>
                      <p className="whitespace-pre-wrap text-muted-foreground">{inheritedContext.inheritedDescription}</p>
                    </div>
                  )}
                  {inheritedContext.inheritedCompletionNotes && (
                    <div className="rounded-md border border-border bg-background px-3 py-2">
                      <p className="mb-1 font-medium text-foreground">Previous notes</p>
                      <p className="whitespace-pre-wrap text-muted-foreground">{inheritedContext.inheritedCompletionNotes}</p>
                    </div>
                  )}
                  {!inheritedContext.inheritedDescription && !inheritedContext.inheritedCompletionNotes && (
                    <p className="rounded-md border border-dashed border-border bg-background px-3 py-3 text-center text-muted-foreground">
                      No prior notes were captured with this handoff.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="task-detail-title">Title</Label>
            <Input
              id="task-detail-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={readOnly}
              maxLength={160}
              data-testid="input-task-detail-title"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="task-detail-status">Status</Label>
              <select
                id="task-detail-status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                disabled={readOnly}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="select-task-detail-status"
              >
                <option value="open">Open</option>
                <option value="pending_acceptance">Needs acceptance</option>
                <option value="accepted">Accepted</option>
                <option value="denied">Denied</option>
                <option value="completed">Done</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-detail-urgency">Urgency</Label>
              <select
                id="task-detail-urgency"
                value={urgency}
                onChange={(event) => setUrgency(event.target.value as "low" | "normal" | "high" | "critical")}
                disabled={readOnly}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="select-task-detail-urgency"
              >
                <option value="low">Low</option>
                <option value="normal">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-detail-due">Due</Label>
              <Input
                id="task-detail-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                disabled={readOnly}
                data-testid="input-task-detail-due"
              />
              <Input
                type="time"
                value={dueTime}
                onChange={(event) => setDueTime(event.target.value)}
                disabled={readOnly || isAllDay}
                aria-label="Due time"
                data-testid="input-task-detail-due-time"
              />
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => postpone.mutate(1)}
                  disabled={postpone.isPending || readOnly}
                  data-testid="button-task-postpone-day"
                >
                  +1 day
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => postpone.mutate(7)}
                  disabled={postpone.isPending || readOnly}
                  data-testid="button-task-postpone-week"
                >
                  +1 week
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-detail-estimate">Minutes</Label>
              <Input
                id="task-detail-estimate"
                type="number"
                min={5}
                max={1440}
                step={1}
                value={estimatedMinutes}
                onChange={(event) => setEstimatedMinutes(Number(event.target.value) || 30)}
                disabled={readOnly}
                data-testid="input-task-detail-estimate"
              />
            </div>
          </div>
          <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={isAllDay}
                onChange={(event) => setIsAllDay(event.target.checked)}
                disabled={readOnly}
                className="size-4 rounded border-border accent-brand-green"
                data-testid="checkbox-task-detail-all-day"
              />
              All day
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="task-detail-start-time">Fixed start</Label>
              <Input
                id="task-detail-start-time"
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                disabled={readOnly || isAllDay}
                data-testid="input-task-detail-start-time"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-detail-end-time">Fixed end</Label>
              <Input
                id="task-detail-end-time"
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                disabled={readOnly || isAllDay}
                data-testid="input-task-detail-end-time"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-detail-description">Description</Label>
            <Textarea
              id="task-detail-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={readOnly}
              className="min-h-[90px]"
              maxLength={2000}
              data-testid="input-task-detail-description"
            />
          </div>
          <RichNoteEditor
            id="task-detail-note"
            label="Notes"
            value={note}
            onChange={setNote}
            disabled={readOnly}
            placeholder="Add an update, blocker, or completion note."
            className="min-h-[120px]"
            maxLength={1600}
            testId="input-task-detail-note"
          />
          <div className="rounded-md border border-border bg-background px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Subtasks</p>
                <p className="text-xs text-muted-foreground">
                  {subtasks.filter((item) => item.done).length}/{subtasks.length} complete
                </p>
              </div>
              <ListChecks className="size-4 text-muted-foreground" />
            </div>
            <div className="flex gap-2">
              <Input
                value={newSubtaskTitle}
                onChange={(event) => setNewSubtaskTitle(event.target.value)}
                disabled={readOnly}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addSubtask();
                  }
                }}
                placeholder="Add a subtask"
                maxLength={160}
                data-testid="input-new-subtask"
              />
              <Button
                type="button"
                variant="outline"
                onClick={addSubtask}
                disabled={!newSubtaskTitle.trim() || createSubtask.isPending || readOnly}
              >
                {createSubtask.isPending ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />}
                Add
              </Button>
            </div>
            <div className="mt-3 space-y-1.5">
              {subtasks.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                  Break this task into steps as you work.
                </p>
              ) : (
                subtasks.map((subtask) => (
                  <div key={subtask.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-2">
                    <button
                      type="button"
                      onClick={() => toggleSubtask(subtask)}
                      disabled={updateSubtask.isPending || readOnly}
                      className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${
                        subtask.done ? "border-brand-green bg-brand-green text-white" : "border-border bg-muted"
                      }`}
                      data-testid={`button-subtask-toggle-${subtask.id}`}
                    >
                      {subtask.done && <Check className="size-3.5" />}
                    </button>
                    <span className={`min-w-0 flex-1 truncate text-sm ${subtask.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                      {subtask.title}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => deleteSubtask(subtask.id)}
                      disabled={removeSubtask.isPending || readOnly}
                      aria-label="Delete subtask"
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
          {taskEvents.length > 0 && (
            <div className="rounded-md border border-border bg-background px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Progress history</p>
                  <p className="text-xs text-muted-foreground">Recent updates, requests, and status changes</p>
                </div>
                <History className="size-4 text-muted-foreground" />
              </div>
              <ul className="space-y-2">
                {taskEvents.map((event) => {
                  const actor = users.find((user) => String(user.id) === String(event.actorId));
                  return (
                    <li key={String(event.id)} className="rounded-md bg-muted/40 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium capitalize text-foreground">{event.type.replace(/_/g, " ")}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {new Date(event.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {actor?.name ?? "Unknown"} - {event.note || "No note added."}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          </div>
        </div>
        <DialogFooter className="flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
          <div className="flex flex-col gap-2 sm:flex-row">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={updateRelationships.isPending || readOnly} data-testid="button-task-people-menu">
                  {updateRelationships.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Users className="size-4" />
                  )}
                  Reassign / delegate / collaborate
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>Reassign owner</DropdownMenuLabel>
                {activeUsers.map((user) => {
                  const userId = String(user.id);
                  return (
                    <DropdownMenuItem
                      key={`owner-${userId}`}
                      onClick={() => reassignOwner(userId)}
                      data-testid={`menu-reassign-${userId}`}
                    >
                      <UserRoundCheck className="size-4" />
                      <span>{user.name}</span>
                      {userId === assignedToId && <Check className="ml-auto size-4" />}
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Delegate task</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => delegateTask("")} data-testid="menu-delegate-none">
                  <X className="size-4" />
                  No delegate
                  {!delegatedToId && <Check className="ml-auto size-4" />}
                </DropdownMenuItem>
                {activeUsers
                  .filter((user) => String(user.id) !== assignedToId)
                  .map((user) => {
                    const userId = String(user.id);
                    return (
                      <DropdownMenuItem
                        key={`delegate-${userId}`}
                        onClick={() => delegateTask(userId)}
                        data-testid={`menu-delegate-${userId}`}
                      >
                        <UserPlus className="size-4" />
                        <span>{user.name}</span>
                        {userId === delegatedToId && <Check className="ml-auto size-4" />}
                      </DropdownMenuItem>
                    );
                  })}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Add collaborator</DropdownMenuLabel>
                {collaboratorOptions.length === 0 ? (
                  <DropdownMenuItem disabled>All available people added</DropdownMenuItem>
                ) : (
                  collaboratorOptions.map((user) => {
                    const userId = String(user.id);
                    return (
                      <DropdownMenuItem
                        key={`collaborator-${userId}`}
                        onClick={() => addCollaborator(userId)}
                        data-testid={`menu-add-collaborator-${userId}`}
                      >
                        <Users className="size-4" />
                        {user.name}
                      </DropdownMenuItem>
                    );
                  })
                )}
                {selectedCollaborators.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Current collaborators</DropdownMenuLabel>
                    {selectedCollaborators.map((user) => (
                      <DropdownMenuItem
                        key={`remove-collaborator-${user.id}`}
                        onClick={() => removeCollaborator(String(user.id))}
                        data-testid={`menu-remove-collaborator-${user.id}`}
                      >
                        <X className="size-4" />
                        Remove {user.name}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => save.mutate()} disabled={!ready || save.isPending || readOnly} data-testid="button-task-detail-save">
              {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Save changes
            </Button>
          </div>
          <Button
            onClick={() => donnit.mutate()}
            disabled={donnit.isPending || task.status === "completed" || readOnly}
            data-testid="button-task-donnit"
          >
            {donnit.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Donnit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
