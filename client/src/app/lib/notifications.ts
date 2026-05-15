import type { Task, EmailSuggestion, TaskEvent, Id } from "@/app/types";
import { localDateIso, addLocalDays } from "@/app/lib/date";
import { latestOpenUpdateRequest } from "@/app/lib/permissions";

export type DerivedNotification = {
  id: string;
  title: string;
  detail: string;
  severity: "high" | "normal" | "low";
  source: "approval" | "task";
  taskId?: Id;
  suggestionId?: Id;
};

export function buildNotifications(
  tasks: Task[],
  suggestions: EmailSuggestion[],
  events: TaskEvent[] = [],
  currentUserId?: Id,
  canSeeAdminAlerts = false,
): DerivedNotification[] {
  const today = localDateIso();
  const soonIso = addLocalDays(2, today);
  const active = tasks.filter((task) => task.status !== "completed" && task.status !== "denied");
  const items: DerivedNotification[] = [];

  for (const suggestion of suggestions.filter((item) => item.status === "pending")) {
    items.push({
      id: `suggestion-${suggestion.id}`,
      title: "Approval waiting",
      detail: suggestion.suggestedTitle,
      severity: "normal",
      source: "approval",
      suggestionId: suggestion.id,
    });
  }

  if (currentUserId) {
    for (const event of events.filter((item) => item.type === "accepted" || item.type === "denied")) {
      const task = tasks.find((candidate) => String(candidate.id) === String(event.taskId));
      if (!task) continue;
      const assignedByCurrentUser = String(task.assignedById) === String(currentUserId);
      const actedBySomeoneElse = String(event.actorId) !== String(currentUserId);
      if (!assignedByCurrentUser || !actedBySomeoneElse) continue;
      items.push({
        id: `assignment-response-${task.id}-${event.id}`,
        title: event.type === "accepted" ? "Task accepted" : "Task declined",
        detail: event.type === "accepted" ? task.title : `${task.title}${event.note ? ` - ${event.note}` : ""}`,
        severity: event.type === "denied" ? "high" : "normal",
        source: "task",
        taskId: task.id,
      });
    }
    for (const event of events.filter((item) => item.type === "assistant_completed" || item.type === "assistant_failed")) {
      if (event.type === "assistant_failed" && !canSeeAdminAlerts) continue;
      const task = tasks.find((candidate) => String(candidate.id) === String(event.taskId));
      if (!task) continue;
      const visibleToCurrentUser =
        (event.type === "assistant_failed" && canSeeAdminAlerts) ||
        String(event.actorId) === String(currentUserId) ||
        String(task.assignedToId) === String(currentUserId) ||
        String(task.assignedById) === String(currentUserId) ||
        String(task.delegatedToId ?? "") === String(currentUserId) ||
        (task.collaboratorIds ?? []).some((id) => String(id) === String(currentUserId));
      if (!visibleToCurrentUser) continue;
      items.push({
        id: `assistant-${event.type}-${task.id}-${event.id}`,
        title: event.type === "assistant_completed" ? "Donnit AI finished" : "Donnit AI needs review",
        detail: event.type === "assistant_completed" ? task.title : `${task.title}${event.note ? ` - ${event.note}` : ""}`,
        severity: event.type === "assistant_failed" ? "high" : "normal",
        source: "task",
        taskId: task.id,
      });
    }
  }

  for (const task of active) {
    const latestUpdateRequest = latestOpenUpdateRequest(task, events);
    const updateVisibleToCurrentUser =
      !currentUserId ||
      String(task.assignedToId) === String(currentUserId) ||
      String(task.delegatedToId ?? "") === String(currentUserId) ||
      (task.collaboratorIds ?? []).some((id) => String(id) === String(currentUserId));
    if (latestUpdateRequest && updateVisibleToCurrentUser && String(latestUpdateRequest.actorId) !== String(currentUserId ?? "")) {
      items.push({
        id: `update-request-${task.id}-${latestUpdateRequest.id}`,
        title: "Update requested",
        detail: task.title,
        severity: "normal",
        source: "task",
        taskId: task.id,
      });
    }
    if (task.dueDate && task.dueDate < today) {
      items.push({
        id: `overdue-${task.id}`,
        title: "Past due",
        detail: task.title,
        severity: "high",
        source: "task",
        taskId: task.id,
      });
    } else if (task.dueDate && task.dueDate <= soonIso) {
      items.push({
        id: `soon-${task.id}`,
        title: task.dueDate === today ? "Due today" : "Due soon",
        detail: task.title,
        severity: task.urgency === "critical" || task.urgency === "high" ? "high" : "normal",
        source: "task",
        taskId: task.id,
      });
    }
    if (task.status === "pending_acceptance") {
      items.push({
        id: `acceptance-${task.id}`,
        title: "Needs acceptance",
        detail: task.title,
        severity: "normal",
        source: "approval",
        taskId: task.id,
      });
    }
    if (task.delegatedToId) {
      items.push({
        id: `delegated-${task.id}`,
        title: "Delegated work open",
        detail: task.title,
        severity: "low",
        source: "task",
        taskId: task.id,
      });
    }
  }

  return items.slice(0, 12);
}
