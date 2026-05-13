import type { User, Task, TaskEvent, Id } from "@/app/types";
import { localDateIso } from "@/app/lib/date";

export function canAdministerProfiles(user: User | null | undefined) {
  return user?.role === "owner" || user?.role === "admin";
}

export function canManageWorkspaceMembers(user: User | null | undefined) {
  return user?.role === "owner" || user?.role === "admin";
}

export function canViewManagerReports(user: User | null | undefined) {
  return user?.role === "owner" || user?.role === "admin" || user?.role === "manager";
}

export function isActiveUser(user: User) {
  return user.status !== "inactive";
}

export function latestOpenUpdateRequest(task: Task, events: TaskEvent[]) {
  const taskEvents = events
    .filter((event) => String(event.taskId) === String(task.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const request = taskEvents.find((event) => event.type === "update_requested");
  if (!request) return undefined;
  const response = taskEvents.find(
    (event) =>
      event.createdAt > request.createdAt &&
      String(event.actorId) !== String(request.actorId) &&
      ["updated", "note_added", "completed", "accepted", "denied"].includes(event.type),
  );
  return response ? undefined : request;
}

export function teamMembersForUser(users: User[], currentUser: User | null | undefined, currentUserId: Id | null | undefined) {
  if (!currentUser || !currentUserId) return [];
  if (!["owner", "admin", "manager"].includes(currentUser.role)) return [];
  return users.filter((user) => {
    if (!isActiveUser(user)) return false;
    if (currentUser.role === "owner" || currentUser.role === "admin") return String(user.id) !== String(currentUserId);
    return String(user.managerId) === String(currentUserId);
  });
}

export function isVisibleWorkTask(task: Task) {
  if (!task.visibleFrom) return true;
  if (task.status === "completed" || task.status === "denied") return true;
  return task.visibleFrom <= localDateIso();
}
