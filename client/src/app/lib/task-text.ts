import type { Task, User } from "@/app/types";
import { extractRepeatDetails } from "@/app/lib/repeat";

export function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function positionTitleForUser(user: User) {
  const persona = titleCase(user.persona || "");
  const role = titleCase(user.role || "member");
  if (persona && persona.toLowerCase() !== "operator" && !role.toLowerCase().includes(persona.toLowerCase())) {
    return `${persona} ${role === "Owner" ? "Lead" : role}`;
  }
  if (role === "Owner") return "Founder / Owner";
  if (role === "Admin") return "Workspace Admin";
  if (role === "Manager") return "Department Manager";
  return "Team Member";
}

export function inferTaskCadence(task: Task) {
  const text = `${task.title} ${task.description}`.toLowerCase();
  if (task.recurrence === "annual" || /\bannual|yearly|anniversary|birthday\b/.test(text)) return "Annual";
  if (/\bquarterly|q[1-4]\b/.test(text)) return "Quarterly";
  if (/\bmonthly|month-end|month end\b/.test(text)) return "Monthly";
  if (/\bweekly|every week|friday|monday|tuesday|wednesday|thursday\b/.test(text)) return "Weekly";
  if (/\bdaily|standup|each day|every day\b/.test(text)) return "Daily";
  return task.recurrence !== "none" ? titleCase(task.recurrence) : "As needed";
}

export function taskRepeatLabel(task: Task) {
  if (task.recurrence === "none" && inferTaskCadence(task) === "As needed") return "";
  const details = extractRepeatDetails(task.description);
  return details ? `${inferTaskCadence(task)} / ${details}` : inferTaskCadence(task);
}

export function taskKnowledgeText(task: Task) {
  return [task.description, task.completionNotes]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferToolsFromTasks(tasks: Task[]) {
  const text = tasks.map((task) => `${task.title} ${task.description} ${task.completionNotes}`).join(" ").toLowerCase();
  const tools: Array<[string, RegExp]> = [
    ["Gmail", /\bgmail|email|inbox\b/],
    ["Slack", /\bslack|channel\b/],
    ["Google Calendar", /\bcalendar|meeting|schedule\b/],
    ["LinkedIn", /\blinkedin|recruiting\b/],
    ["Vercel", /\bvercel|deployment|deploy\b/],
    ["Supabase", /\bsupabase|database|auth\b/],
    ["Payroll", /\bpayroll|hris|benefits\b/],
    ["Billing", /\bbilling|invoice|receipt|expense|contract\b/],
  ];
  return tools.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
}
