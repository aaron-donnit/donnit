import type { Task } from "@/app/types";
import { CLIENT_TIME_ZONE } from "@/app/constants";

export function localDateIso(value: Date | string = new Date(), timeZone = CLIENT_TIME_ZONE) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addLocalDays(days: number, baseDate = localDateIso()) {
  const parsed = new Date(`${baseDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return baseDate;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function localTimeHHMM(value = new Date(), timeZone = CLIENT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

export function normalizeTimeLabel(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function taskDueLabel(task: Pick<Task, "dueDate" | "dueTime" | "startTime" | "isAllDay">) {
  if (!task.dueDate) return "No due date";
  if (task.isAllDay) return `${task.dueDate} · all day`;
  const time = normalizeTimeLabel(task.startTime ?? task.dueTime);
  return time ? `${task.dueDate} · ${time}` : task.dueDate;
}
