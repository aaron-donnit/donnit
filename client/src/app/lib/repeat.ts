import { REPEAT_DETAILS_PREFIX } from "@/app/constants";

export function extractRepeatDetails(description: string) {
  const match = description.match(/(?:^|\n)\s*Repeat(?: details)?:\s*(.+)\s*$/i);
  return match?.[1]?.trim() ?? "";
}

export function stripRepeatDetails(description: string) {
  return description.replace(/(?:\n{0,2})\s*Repeat(?: details)?:\s*.+\s*$/i, "").trim();
}

export function descriptionWithRepeatDetails(description: string, repeatDetails: string) {
  const cleanDescription = stripRepeatDetails(description);
  const cleanRepeat = repeatDetails.trim();
  if (!cleanRepeat) return cleanDescription;
  return `${cleanDescription}${cleanDescription ? "\n\n" : ""}${REPEAT_DETAILS_PREFIX} ${cleanRepeat}`;
}

export function defaultRepeatDetails(recurrence: string, dueDate: string) {
  if (recurrence === "none") return "";
  const date = dueDate ? new Date(`${dueDate}T12:00:00`) : null;
  const validDate = date && Number.isFinite(date.getTime()) ? date : null;
  const weekday = validDate ? new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(validDate) : "selected weekday";
  const monthDay = validDate ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(validDate) : "selected date";
  if (recurrence === "daily") return "Every weekday";
  if (recurrence === "weekly") return `Every ${weekday}`;
  if (recurrence === "monthly") return `Monthly on the same day, or first ${weekday}`;
  if (recurrence === "quarterly") return "Quarterly on the same schedule";
  if (recurrence === "annual") return `Every year on ${monthDay}`;
  return "";
}
