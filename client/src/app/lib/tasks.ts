import type { Id, LocalSubtask, TaskSubtask, TaskEvent, InheritedTaskContext } from "@/app/types";

export function sortSubtasks(subtasks: TaskSubtask[]) {
  return [...subtasks].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export function normalizeLocalSubtasks(taskId: Id, value: unknown): LocalSubtask[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index): LocalSubtask | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : `subtask-${Date.now()}-${index}`;
      const title = typeof record.title === "string" ? record.title.trim() : "";
      if (!title) return null;
      const done = record.done === true;
      return {
        id,
        taskId,
        title,
        done,
        position: typeof record.position === "number" ? record.position : index,
        completedAt: typeof record.completedAt === "string" ? record.completedAt : null,
        createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
      };
    })
    .filter((item): item is LocalSubtask => item !== null);
}

export function apiErrorMessage(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const sep = raw.indexOf(": ");
  if (sep > -1) {
    try {
      const parsed = JSON.parse(raw.slice(sep + 2)) as { message?: unknown };
      if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message;
    } catch {
      // Keep the raw message below.
    }
  }
  return raw || fallback;
}

export function parseInheritedTaskContext(events: TaskEvent[], taskId: Id): InheritedTaskContext | null {
  const event = events.find((item) => (
    String(item.taskId) === String(taskId) &&
    (item.type === "position_profile_transferred" || item.type === "position_profile_delegated")
  ));
  if (!event) return null;
  try {
    const parsed = JSON.parse(event.note) as Partial<InheritedTaskContext>;
    return {
      profileTitle: typeof parsed.profileTitle === "string" && parsed.profileTitle.trim() ? parsed.profileTitle : "Position Profile",
      fromUserId: parsed.fromUserId ?? null,
      toUserId: parsed.toUserId ?? null,
      mode: typeof parsed.mode === "string" ? parsed.mode : event.type.replace("position_profile_", ""),
      delegateUntil: typeof parsed.delegateUntil === "string" ? parsed.delegateUntil : null,
      inheritedDescription: typeof parsed.inheritedDescription === "string" ? parsed.inheritedDescription : "",
      inheritedCompletionNotes: typeof parsed.inheritedCompletionNotes === "string" ? parsed.inheritedCompletionNotes : "",
      inheritedAt: typeof parsed.inheritedAt === "string" ? parsed.inheritedAt : event.createdAt,
    };
  } catch {
    return {
      profileTitle: "Position Profile",
      fromUserId: null,
      toUserId: null,
      mode: event.type.replace("position_profile_", ""),
      delegateUntil: null,
      inheritedDescription: "",
      inheritedCompletionNotes: event.note,
      inheritedAt: event.createdAt,
    };
  }
}
