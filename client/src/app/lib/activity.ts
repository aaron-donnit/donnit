import type { Task, TaskEvent, User } from "@/app/types";
import { titleCase } from "@/app/lib/task-text";

export function activityEventLabel(type: string) {
  return titleCase(type.replace(/_/g, " "));
}

export function eventSearchText(event: TaskEvent, task: Task | undefined, user: User | undefined) {
  return [
    event.type,
    event.note,
    event.createdAt,
    task?.title,
    task?.description,
    task?.completionNotes,
    task?.dueDate,
    task?.source,
    task?.urgency,
    task?.status,
    user?.name,
    user?.email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
