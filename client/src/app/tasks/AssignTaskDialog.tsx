import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Id, PositionProfile, Task, TaskTemplate, User } from "@/app/types";
import { dialogShellClass, dialogHeaderClass, dialogBodyClass, dialogFooterClass } from "@/app/constants";
import { isActiveUser } from "@/app/lib/permissions";
import { profilePrimaryOwnerId, profileAssignmentLabel } from "@/app/lib/profiles";
import { defaultRepeatDetails, descriptionWithRepeatDetails } from "@/app/lib/repeat";
import { invalidateWorkspace } from "@/app/lib/hooks";

export default function AssignTaskDialog({
  open,
  onOpenChange,
  users,
  currentUserId,
  taskTemplates,
  positionProfiles = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: User[];
  currentUserId: Id;
  taskTemplates: TaskTemplate[];
  positionProfiles?: PositionProfile[];
}) {
  const assignableUsers = useMemo(
    () =>
      users.length > 0
        ? users.filter(isActiveUser)
        : [{ id: currentUserId, name: "You", email: "", role: "", persona: "", managerId: null, canAssign: true, status: "active" as const }],
    [users, currentUserId],
  );
  const defaultAssigneeId = String(
    assignableUsers.find((user) => String(user.id) === String(currentUserId))?.id ??
      assignableUsers[0]?.id ??
      currentUserId,
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedToId, setAssignedToId] = useState(defaultAssigneeId);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
  const [estimatedMinutes, setEstimatedMinutes] = useState(30);
  const [urgency, setUrgency] = useState<"low" | "normal" | "high" | "critical">("normal");
  const [visibility, setVisibility] = useState<"work" | "personal" | "confidential">("work");
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly" | "monthly" | "quarterly" | "annual">("none");
  const [repeatDetails, setRepeatDetails] = useState("");
  const [reminderDaysBefore, setReminderDaysBefore] = useState(0);
  const [templateId, setTemplateId] = useState("");
  const [positionProfileId, setPositionProfileId] = useState("");
  const savedPositionProfiles = positionProfiles.filter((profile) => profile.persisted);
  const assigneePositionProfiles = savedPositionProfiles.filter((profile) => String(profilePrimaryOwnerId(profile)) === assignedToId);
  const coveragePositionProfiles = savedPositionProfiles.filter(
    (profile) =>
      String(profilePrimaryOwnerId(profile)) !== assignedToId &&
      (String(profile.temporaryOwnerId ?? "") === assignedToId || String(profile.delegateUserId ?? "") === assignedToId),
  );
  const otherPositionProfiles = savedPositionProfiles.filter(
    (profile) => !assigneePositionProfiles.some((item) => item.id === profile.id) && !coveragePositionProfiles.some((item) => item.id === profile.id),
  );

  useEffect(() => {
    if (!open) return;
    setAssignedToId(defaultAssigneeId);
    setTitle("");
    setDescription("");
    setDueDate("");
    setDueTime("");
    setStartTime("");
    setEndTime("");
    setIsAllDay(false);
    setEstimatedMinutes(30);
    setUrgency("normal");
    setVisibility("work");
    setRecurrence("none");
    setRepeatDetails("");
    setReminderDaysBefore(0);
    setTemplateId("");
    setPositionProfileId("");
  }, [open, defaultAssigneeId]);

  useEffect(() => {
    if (visibility === "personal" && positionProfileId) {
      setPositionProfileId("");
    }
  }, [positionProfileId, visibility]);

  const selectedTemplate = taskTemplates.find((template) => String(template.id) === templateId);

  useEffect(() => {
    if (!selectedTemplate) return;
    setUrgency(selectedTemplate.defaultUrgency);
    setEstimatedMinutes(selectedTemplate.defaultEstimatedMinutes);
    setRecurrence(selectedTemplate.defaultRecurrence);
    setRepeatDetails((current) => current || defaultRepeatDetails(selectedTemplate.defaultRecurrence, dueDate));
    if (!description.trim() && selectedTemplate.description.trim()) {
      setDescription(selectedTemplate.description);
    }
  }, [selectedTemplate?.id]);

  const create = useMutation({
    mutationFn: async () => {
      const assignee = assignableUsers.find((user) => String(user.id) === assignedToId);
      const assignedTo = assignee?.id ?? currentUserId;
      const assignedBy = currentUserId;
      const isSelfAssigned = String(assignedTo) === String(assignedBy);
      const res = await apiRequest("POST", "/api/tasks", {
        title: title.trim(),
        description: descriptionWithRepeatDetails(description.trim(), recurrence === "none" ? "" : repeatDetails),
        status: isSelfAssigned ? "open" : "pending_acceptance",
        urgency,
        dueDate: dueDate || null,
        dueTime: isAllDay ? null : dueTime || null,
        startTime: isAllDay ? null : startTime || null,
        endTime: isAllDay ? null : endTime || null,
        isAllDay,
        estimatedMinutes,
        assignedToId: assignedTo,
        assignedById: assignedBy,
        source: "manual",
        visibility,
        positionProfileId: visibility === "personal" ? null : positionProfileId || null,
        recurrence,
        reminderDaysBefore,
        templateId: templateId || undefined,
      });
      return (await res.json()) as Task;
    },
    onSuccess: async (task) => {
      await invalidateWorkspace();
      toast({
        title: "Task assigned",
        description:
          task.status === "pending_acceptance"
            ? "The assignee can accept or deny it from their workspace."
            : "The task is now on the agenda.",
      });
      setTitle("");
      setDescription("");
      setDueDate("");
      setDueTime("");
      setStartTime("");
      setEndTime("");
      setIsAllDay(false);
      setEstimatedMinutes(30);
      setUrgency("normal");
      setVisibility("work");
      setRecurrence("none");
      setRepeatDetails("");
      setReminderDaysBefore(0);
      setTemplateId("");
      setPositionProfileId("");
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not assign task",
        description: error instanceof Error ? error.message : "Check the task details and try again.",
        variant: "destructive",
      });
    },
  });

  const ready = title.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} sm:max-w-lg`}>
        <DialogHeader className={dialogHeaderClass}>
          <DialogTitle>Manual task</DialogTitle>
          <DialogDescription>
            Create a task directly when chat is not the fastest path.
          </DialogDescription>
        </DialogHeader>
        <div className={dialogBodyClass}>
          <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="assign-title">Title</Label>
            <Input
              id="assign-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Review payroll report"
              maxLength={160}
              data-testid="input-assign-title"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assign-person">Assignee</Label>
            <select
              id="assign-person"
              value={assignedToId}
              onChange={(event) => {
                setAssignedToId(event.target.value);
                setPositionProfileId("");
              }}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="select-assign-user"
            >
              {assignableUsers.map((user) => (
                <option key={String(user.id)} value={String(user.id)}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>
          {savedPositionProfiles.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="assign-position-profile">Position Profile</Label>
              <select
                id="assign-position-profile"
                value={positionProfileId}
                onChange={(event) => setPositionProfileId(event.target.value)}
                disabled={visibility === "personal"}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                data-testid="select-assign-position-profile"
              >
                <option value="">No Position Profile</option>
                {assigneePositionProfiles.length > 0 && (
                  <optgroup label="Assignee profiles">
                    {assigneePositionProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.title} - {profileAssignmentLabel(profile, users)}
                      </option>
                    ))}
                  </optgroup>
                )}
                {coveragePositionProfiles.length > 0 && (
                  <optgroup label="Coverage profiles">
                    {coveragePositionProfiles.map((profile) => (
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
                  ? "Personal tasks do not write into role memory."
                  : assigneePositionProfiles.length > 1
                    ? "This employee has multiple profiles. Choose where this task belongs."
                    : "Optional: connect this work to role memory."}
              </p>
            </div>
          )}
          {taskTemplates.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="assign-template">Template</Label>
              <select
                id="assign-template"
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="select-assign-template"
              >
                <option value="">No template</option>
                {taskTemplates.map((template) => (
                  <option key={String(template.id)} value={String(template.id)}>
                    {template.name}
                  </option>
                ))}
              </select>
              {selectedTemplate && (
                <p className="text-xs text-muted-foreground">
                  Adds {selectedTemplate.subtasks.length} saved subtask{selectedTemplate.subtasks.length === 1 ? "" : "s"}.
                </p>
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="assign-due">Due date</Label>
              <Input
                id="assign-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                data-testid="input-assign-due"
              />
              <Input
                type="time"
                value={dueTime}
                onChange={(event) => setDueTime(event.target.value)}
                disabled={isAllDay}
                aria-label="Due time"
                data-testid="input-assign-due-time"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assign-estimate">Minutes</Label>
              <Input
                id="assign-estimate"
                type="number"
                min={5}
                max={1440}
                step={1}
                value={estimatedMinutes}
                onChange={(event) => setEstimatedMinutes(Number(event.target.value) || 30)}
                data-testid="input-assign-estimate"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assign-urgency">Urgency</Label>
              <select
                id="assign-urgency"
                value={urgency}
                onChange={(event) => setUrgency(event.target.value as "low" | "normal" | "high" | "critical")}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="select-assign-urgency"
              >
                <option value="low">Low</option>
                <option value="normal">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={isAllDay}
                onChange={(event) => setIsAllDay(event.target.checked)}
                className="size-4 rounded border-border accent-brand-green"
                data-testid="checkbox-assign-all-day"
              />
              All day
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="assign-start-time">Fixed start</Label>
              <Input
                id="assign-start-time"
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                disabled={isAllDay}
                data-testid="input-assign-start-time"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assign-end-time">Fixed end</Label>
              <Input
                id="assign-end-time"
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                disabled={isAllDay}
                data-testid="input-assign-end-time"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex min-h-10 flex-wrap items-center gap-3 rounded-md border border-border bg-muted/25 px-3 py-2">
              <label className="inline-flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={visibility === "confidential"}
                  onChange={(event) => setVisibility(event.target.checked ? "confidential" : "work")}
                  className="size-4 rounded border-border accent-brand-green"
                  data-testid="checkbox-assign-confidential"
                />
                Confidential
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={visibility === "personal"}
                  onChange={(event) => setVisibility(event.target.checked ? "personal" : "work")}
                  className="size-4 rounded border-border accent-brand-green"
                  data-testid="checkbox-assign-personal"
                />
                Personal
              </label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assign-recurrence">Repeat</Label>
              <select
                id="assign-recurrence"
                value={recurrence}
                onChange={(event) => {
                  const next = event.target.value as "none" | "daily" | "weekly" | "monthly" | "quarterly" | "annual";
                  setRecurrence(next);
                  setRepeatDetails((current) => current || defaultRepeatDetails(next, dueDate));
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="select-assign-recurrence"
              >
                <option value="none">No</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assign-reminder">Show early</Label>
              <Input
                id="assign-reminder"
                type="number"
                min={0}
                max={365}
                step={1}
                value={reminderDaysBefore}
                onChange={(event) => setReminderDaysBefore(Math.max(0, Number(event.target.value) || 0))}
                data-testid="input-assign-reminder"
              />
            </div>
          </div>
          {recurrence !== "none" && (
            <div className="space-y-1.5">
              <Label htmlFor="assign-repeat-pattern">Repeat pattern</Label>
              <Input
                id="assign-repeat-pattern"
                value={repeatDetails}
                onChange={(event) => setRepeatDetails(event.target.value)}
                placeholder="Every Tuesday, first Monday monthly, or May 15 every year"
                data-testid="input-assign-repeat-pattern"
              />
              <p className="text-xs text-muted-foreground">
                Keep this short. Donnit stores it with the task context for role continuity.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="assign-description">Notes</Label>
            <Textarea
              id="assign-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Add context, source, or acceptance criteria."
              className="min-h-[90px]"
              maxLength={1000}
              data-testid="input-assign-description"
            />
          </div>
        </div>
        </div>
        <DialogFooter className={dialogFooterClass}>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-assign-cancel">
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={!ready || create.isPending} data-testid="button-assign-submit">
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
