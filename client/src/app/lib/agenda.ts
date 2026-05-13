import type { AgendaItem, AgendaPreferences, AgendaSchedule } from "@/app/types";
import { DEFAULT_AGENDA_PREFERENCES, DEFAULT_AGENDA_SCHEDULE } from "@/app/constants";
import { localDateIso } from "@/app/lib/date";
import { toast } from "@/hooks/use-toast";

export function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function formatIcsLocalDateTime(value: string) {
  return value.replace(/[-:]/g, "").replace(/\.\d+$/, "");
}

export function formatAgendaTime(value: string | null) {
  if (!value) return "";
  const match = value.match(/T(\d{2}):(\d{2})/);
  if (!match) return "";
  const hour24 = Number(match[1]);
  const minute = match[2];
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute} ${suffix}`;
}

export function formatAgendaSlot(item: AgendaItem) {
  if (!item.startAt || !item.endAt || item.scheduleStatus !== "scheduled") {
    return "Needs an open calendar slot";
  }
  return `${item.startAt.slice(0, 10)} / ${formatAgendaTime(item.startAt)}-${formatAgendaTime(item.endAt)}`;
}

export function normalizeAgendaPreferences(input?: Partial<AgendaPreferences> | null): AgendaPreferences {
  return {
    ...DEFAULT_AGENDA_PREFERENCES,
    ...(input ?? {}),
    lunchMinutes: Number(input?.lunchMinutes ?? DEFAULT_AGENDA_PREFERENCES.lunchMinutes),
    meetingBufferMinutes: Number(input?.meetingBufferMinutes ?? DEFAULT_AGENDA_PREFERENCES.meetingBufferMinutes),
    minimumBlockMinutes: Number(input?.minimumBlockMinutes ?? DEFAULT_AGENDA_PREFERENCES.minimumBlockMinutes),
    focusBlockMinutes: Number(input?.focusBlockMinutes ?? DEFAULT_AGENDA_PREFERENCES.focusBlockMinutes),
  };
}

export function normalizeAgendaSchedule(input?: Partial<AgendaSchedule> | null): AgendaSchedule {
  const buildTime = /^\d{1,2}:\d{2}$/.test(String(input?.buildTime ?? ""))
    ? String(input?.buildTime)
    : DEFAULT_AGENDA_SCHEDULE.buildTime;
  return {
    autoBuildEnabled: input?.autoBuildEnabled === true,
    buildTime,
    lastAutoBuildDate: typeof input?.lastAutoBuildDate === "string" ? input.lastAutoBuildDate : null,
  };
}

export function isTimeAtOrAfter(current: string, target: string) {
  return current.localeCompare(target) >= 0;
}

export function orderAgendaItems(agenda: AgendaItem[], taskOrder: string[]) {
  if (taskOrder.length === 0) return agenda;
  const indexById = new Map(taskOrder.map((id, index) => [id, index]));
  return [...agenda].sort((a, b) => {
    const aIndex = indexById.get(String(a.taskId)) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = indexById.get(String(b.taskId)) ?? Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.order - b.order;
  });
}

export function downloadAgendaCalendar(agenda: AgendaItem[]) {
  const scheduled = agenda.filter((item) => item.startAt && item.endAt && item.scheduleStatus === "scheduled");
  if (scheduled.length === 0) {
    toast({
      title: "No scheduled blocks to export",
      description: "Build the agenda after connecting Google Calendar so Donnit can find open times.",
    });
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const events = scheduled.map((item) => {
    return [
      "BEGIN:VEVENT",
      `UID:donnit-${item.taskId}-${stamp}@donnit`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${item.timeZone}:${formatIcsLocalDateTime(item.startAt!)}`,
      `DTEND;TZID=${item.timeZone}:${formatIcsLocalDateTime(item.endAt!)}`,
      `SUMMARY:${escapeIcsText(item.title)}`,
      `DESCRIPTION:${escapeIcsText(`${item.urgency} urgency / ${item.estimatedMinutes} minutes`)}`,
      "END:VEVENT",
    ].join("\r\n");
  });

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Donnit//Agenda Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `donnit-agenda-${localDateIso()}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast({
    title: "Calendar file ready",
    description: `Exported ${scheduled.length} scheduled agenda block${scheduled.length === 1 ? "" : "s"} as an .ics file.`,
  });
}
