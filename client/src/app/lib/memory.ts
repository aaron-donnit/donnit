import type { Task, ProfileAccessItem } from "@/app/types";
import { titleCase, inferTaskCadence, taskRepeatLabel } from "@/app/lib/task-text";
import { extractRepeatDetails } from "@/app/lib/repeat";

export type LearnedHowToNote = {
  taskId: string;
  title: string;
  note: string;
  source: string;
  capturedAt: string | null;
};

export type LearnedRecurringResponsibility = {
  taskId: string;
  title: string;
  cadence: string;
  repeatDetails: string;
  dueDate: string | null;
  showEarlyDays: number;
  updatedAt: string | null;
};

export type LearnedTaskSignal = {
  taskId: string;
  title: string;
  status: string;
  urgency: string;
  dueDate: string | null;
  source: string;
  recurrence: string;
  eventType: string;
  capturedAt: string | null;
};

export function memoryStringArray(memory: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = memory[key];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return [];
}

export function memoryRecordArray(memory: Record<string, unknown>, key: string) {
  const value = memory[key];
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

export function memoryHowToNotes(memory: Record<string, unknown>): LearnedHowToNote[] {
  return memoryRecordArray(memory, "howToNotes")
    .map((record): LearnedHowToNote | null => {
      const note = typeof record.note === "string" ? record.note.trim() : "";
      if (!note) return null;
      return {
        taskId: String(record.taskId ?? ""),
        title: typeof record.title === "string" && record.title.trim() ? record.title : "Task context",
        note,
        source: typeof record.source === "string" ? record.source : "task",
        capturedAt: typeof record.capturedAt === "string" ? record.capturedAt : null,
      };
    })
    .filter((item): item is LearnedHowToNote => item !== null)
    .slice(0, 8);
}

export function memoryRecurringResponsibilities(memory: Record<string, unknown>): LearnedRecurringResponsibility[] {
  return memoryRecordArray(memory, "recurringResponsibilities")
    .map((record): LearnedRecurringResponsibility | null => {
      const title = typeof record.title === "string" ? record.title.trim() : "";
      if (!title) return null;
      return {
        taskId: String(record.taskId ?? title),
        title,
        cadence: typeof record.cadence === "string" && record.cadence !== "none" ? titleCase(record.cadence) : "Recurring",
        repeatDetails: typeof record.repeatDetails === "string" ? record.repeatDetails.trim() : "",
        dueDate: typeof record.dueDate === "string" ? record.dueDate : null,
        showEarlyDays: typeof record.showEarlyDays === "number" ? record.showEarlyDays : 0,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
      };
    })
    .filter((item): item is LearnedRecurringResponsibility => item !== null)
    .slice(0, 8);
}

export function recurringResponsibilitiesFromTasks(tasks: Task[]): LearnedRecurringResponsibility[] {
  return tasks
    .filter((task) => task.recurrence !== "none" || inferTaskCadence(task) !== "As needed")
    .map((task) => ({
      taskId: String(task.id),
      title: task.title,
      cadence: taskRepeatLabel(task) || inferTaskCadence(task),
      repeatDetails: extractRepeatDetails(task.description),
      dueDate: task.dueDate,
      showEarlyDays: task.reminderDaysBefore ?? 0,
      updatedAt: task.createdAt ?? null,
    }))
    .slice(0, 12);
}

export function mergeRecurringResponsibilities(
  learned: LearnedRecurringResponsibility[],
  liveTasks: LearnedRecurringResponsibility[],
) {
  const seen = new Set<string>();
  const output: LearnedRecurringResponsibility[] = [];
  for (const item of [...learned, ...liveTasks]) {
    const key = `${item.taskId || ""}:${item.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output.slice(0, 12);
}

export function memoryRecentSignals(memory: Record<string, unknown>): LearnedTaskSignal[] {
  return memoryRecordArray(memory, "recentTaskSignals")
    .map((record): LearnedTaskSignal | null => {
      const title = typeof record.title === "string" ? record.title.trim() : "";
      if (!title) return null;
      return {
        taskId: String(record.taskId ?? title),
        title,
        status: typeof record.status === "string" ? record.status : "open",
        urgency: typeof record.urgency === "string" ? record.urgency : "normal",
        dueDate: typeof record.dueDate === "string" ? record.dueDate : null,
        source: typeof record.source === "string" ? record.source : "task",
        recurrence: typeof record.recurrence === "string" ? record.recurrence : "none",
        eventType: typeof record.eventType === "string" ? record.eventType : "updated",
        capturedAt: typeof record.capturedAt === "string" ? record.capturedAt : null,
      };
    })
    .filter((item): item is LearnedTaskSignal => item !== null)
    .slice(0, 8);
}

export function memorySourceMix(memory: Record<string, unknown>) {
  const sourceMix = memory.sourceMix;
  if (!sourceMix || typeof sourceMix !== "object" || Array.isArray(sourceMix)) return [];
  return Object.entries(sourceMix as Record<string, unknown>)
    .map(([source, count]) => ({ source, count: typeof count === "number" ? count : Number(count) || 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

export function memoryAccessItems(memory: Record<string, unknown>): ProfileAccessItem[] {
  const value = memory.accessItems;
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index): ProfileAccessItem | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const toolName = typeof record.toolName === "string" ? record.toolName.trim() : "";
      if (!toolName) return null;
      const status = typeof record.status === "string" && ["active", "needs_grant", "needs_reset", "remove_access", "pending"].includes(record.status)
        ? record.status as ProfileAccessItem["status"]
        : "pending";
      return {
        id: typeof record.id === "string" && record.id ? record.id : `access-${Date.now()}-${index}`,
        toolName,
        loginUrl: typeof record.loginUrl === "string" ? record.loginUrl : "",
        accountOwner: typeof record.accountOwner === "string" ? record.accountOwner : "",
        billingNotes: typeof record.billingNotes === "string" ? record.billingNotes : "",
        status,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
      };
    })
    .filter((item): item is ProfileAccessItem => item !== null)
    .slice(0, 40);
}
