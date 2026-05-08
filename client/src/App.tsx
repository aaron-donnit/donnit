import { useEffect, useMemo, useRef, useState } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import {
  Archive,
  ArrowDown,
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  CalendarCheck,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Eye,
  FileText,
  GripVertical,
  HelpCircle,
  History,
  Inbox,
  KeyRound,
  ListChecks,
  ListPlus,
  Loader2,
  MailPlus,
  Maximize2,
  Menu,
  Minimize2,
  Moon,
  Paperclip,
  Pencil,
  Play,
  RefreshCcw,
  Repeat2,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  UserPlus,
  UserCog,
  UserRoundCheck,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { queryClient, apiRequest } from "./lib/queryClient";
import { AuthGate, type AuthedContext } from "@/components/AuthGate";
import DonnitLandingPage from "@/components/DonnitLandingPage";
import { supabaseConfig } from "@/lib/supabase";
import { Toaster } from "@/components/ui/toaster";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import NotFound from "@/pages/not-found";

type Id = string | number;

type AgendaItem = {
  taskId: Id;
  order: number;
  title: string;
  estimatedMinutes: number;
  dueDate: string | null;
  urgency: string;
  startAt: string | null;
  endAt: string | null;
  timeZone: string;
  scheduleStatus: "scheduled" | "unscheduled";
};

type AgendaPreference = "deep_work" | "communications" | "mixed";

type AgendaPreferences = {
  workdayStart: string;
  workdayEnd: string;
  lunchStart: string;
  lunchMinutes: number;
  meetingBufferMinutes: number;
  minimumBlockMinutes: number;
  focusBlockMinutes: number;
  morningPreference: AgendaPreference;
  afternoonPreference: AgendaPreference;
};

const DEFAULT_AGENDA_PREFERENCES: AgendaPreferences = {
  workdayStart: "09:00",
  workdayEnd: "17:00",
  lunchStart: "12:00",
  lunchMinutes: 30,
  meetingBufferMinutes: 10,
  minimumBlockMinutes: 15,
  focusBlockMinutes: 90,
  morningPreference: "deep_work",
  afternoonPreference: "communications",
};

type User = {
  id: Id;
  name: string;
  email: string;
  role: string;
  persona: string;
  managerId: Id | null;
  canAssign: boolean;
};

type Task = {
  id: Id;
  title: string;
  description: string;
  status: string;
  urgency: string;
  dueDate: string | null;
  estimatedMinutes: number;
  assignedToId: Id;
  assignedById: Id;
  delegatedToId: Id | null;
  collaboratorIds: Id[];
  source: string;
  recurrence: string;
  reminderDaysBefore: number;
  acceptedAt: string | null;
  deniedAt: string | null;
  completedAt: string | null;
  completionNotes: string;
  createdAt: string;
};

type TaskEvent = {
  id: Id;
  taskId: Id;
  actorId: Id;
  type: string;
  note: string;
  createdAt: string;
};

type LocalSubtask = {
  id: string;
  taskId: Id;
  title: string;
  done: boolean;
  position: number;
  completedAt: string | null;
  createdAt: string;
};

type TaskSubtask = LocalSubtask;

type WorkspaceState = {
  reviewedNotificationIds: string[];
  agenda: {
    excludedTaskIds: string[];
    approved: boolean;
    approvedAt: string | null;
    preferences: AgendaPreferences;
    taskOrder: string[];
  };
  onboarding: {
    dismissed: boolean;
    dismissedAt: string | null;
  };
};

type ChatMessage = {
  id: Id;
  role: string;
  content: string;
  taskId: Id | null;
  createdAt: string;
};

type EmailSuggestion = {
  id: Id;
  fromEmail: string;
  subject: string;
  preview: string;
  body?: string;
  receivedAt?: string | null;
  actionItems?: string[];
  suggestedTitle: string;
  suggestedDueDate: string | null;
  urgency: string;
  status: string;
  assignedToId: Id | null;
  createdAt: string;
};

type SuggestionReplyResult = {
  ok: boolean;
  provider: "email" | "slack" | "sms" | "document";
  delivery: "mailto" | "sent" | "copy";
  target?: string;
  subject?: string;
  href?: string;
  message?: string;
  body?: string;
  fallbackReason?: string;
  providerMessageId?: string | null;
};

type SuggestionPatch = {
  suggestedTitle?: string;
  suggestedDueDate?: string | null;
  urgency?: "low" | "normal" | "high" | "critical";
  preview?: string;
};

type Bootstrap = {
  authenticated?: boolean;
  bootstrapped?: boolean;
  currentUserId: Id;
  email?: string | null;
  orgId?: string;
  users: User[];
  tasks: Task[];
  events: TaskEvent[];
  messages: ChatMessage[];
  suggestions: EmailSuggestion[];
  positionProfiles?: PersistedPositionProfile[];
  subtasks?: TaskSubtask[];
  workspaceState?: WorkspaceState;
  agenda: AgendaItem[];
  integrations: {
    auth: { provider: string; status: string; projectId: string; schema?: string };
    email: { provider: string; sourceId: string; status: string; mode: string };
    slack?: {
      provider: string;
      status: string;
      mode: string;
      webhookConfigured?: boolean;
      botConfigured?: boolean;
      signingSecretConfigured?: boolean;
      eventsConfigured?: boolean;
      userMapping?: string;
      unreadDelayMinutes?: number;
    };
    sms?: {
      provider: string;
      status: string;
      mode: string;
      webhookConfigured?: boolean;
      signatureConfigured?: boolean;
      accountConfigured?: boolean;
      providerConfigured?: boolean;
      fromNumberConfigured?: boolean;
      inboundConfigured?: boolean;
      routing?: string;
    };
    reminders: { channelOrder: string[]; reminderOrder: string[] };
    app: { delivery: string; native: string };
  };
};

type PositionProfile = {
  id: string;
  persisted: boolean;
  title: string;
  owner: User;
  directManagerId: Id | null;
  temporaryOwnerId: Id | null;
  delegateUserId: Id | null;
  delegateUntil: string | null;
  status: "active" | "vacant" | "covered";
  currentIncompleteTasks: Task[];
  recurringTasks: Task[];
  completedTasks: Task[];
  criticalDates: string[];
  howTo: string[];
  tools: string[];
  stakeholders: string[];
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  riskReasons: string[];
  transitionChecklist: string[];
  lastUpdatedAt: string | null;
};

type PersistedPositionProfile = {
  id: string;
  title: string;
  status: "active" | "vacant" | "covered";
  currentOwnerId: Id | null;
  directManagerId: Id | null;
  temporaryOwnerId: Id | null;
  delegateUserId: Id | null;
  delegateUntil: string | null;
  autoUpdateRules: Record<string, unknown>;
  institutionalMemory: Record<string, unknown>;
  riskScore: number;
  riskSummary: string;
  createdAt: string;
  updatedAt: string;
};

type UrgencyClass = "urgency-high" | "urgency-medium" | "urgency-low";

function urgencyClass(urgency: string): UrgencyClass {
  if (urgency === "critical" || urgency === "high") return "urgency-high";
  if (urgency === "normal" || urgency === "medium") return "urgency-medium";
  return "urgency-low";
}

function urgencyLabel(urgency: string) {
  if (urgency === "critical") return "Overdue";
  if (urgency === "high") return "High";
  if (urgency === "normal" || urgency === "medium") return "Medium";
  return "Low";
}

const statusLabels: Record<string, string> = {
  open: "Open",
  pending_acceptance: "Needs acceptance",
  accepted: "Accepted",
  denied: "Denied",
  completed: "Done",
};

function useBootstrap() {
  return useQuery<Bootstrap>({ queryKey: ["/api/bootstrap"] });
}

function invalidateWorkspace() {
  return queryClient.invalidateQueries({ queryKey: ["/api/bootstrap"] });
}

function sortSubtasks(subtasks: TaskSubtask[]) {
  return [...subtasks].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function normalizeLocalSubtasks(taskId: Id, value: unknown): LocalSubtask[] {
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

function apiErrorMessage(error: unknown, fallback: string) {
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

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function positionTitleForUser(user: User) {
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

function inferTaskCadence(task: Task) {
  const text = `${task.title} ${task.description}`.toLowerCase();
  if (task.recurrence === "annual" || /\bannual|yearly|anniversary|birthday\b/.test(text)) return "Annual";
  if (/\bquarterly|q[1-4]\b/.test(text)) return "Quarterly";
  if (/\bmonthly|month-end|month end\b/.test(text)) return "Monthly";
  if (/\bweekly|every week|friday|monday|tuesday|wednesday|thursday\b/.test(text)) return "Weekly";
  if (/\bdaily|standup|each day|every day\b/.test(text)) return "Daily";
  return task.recurrence !== "none" ? titleCase(task.recurrence) : "As needed";
}

function taskKnowledgeText(task: Task) {
  return [task.description, task.completionNotes]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferToolsFromTasks(tasks: Task[]) {
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

function memoryStringArray(memory: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = memory[key];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return [];
}

function mergeProfileRecord(profile: PositionProfile, record: PersistedPositionProfile): PositionProfile {
  const memory = record.institutionalMemory ?? {};
  const howTo = Array.from(new Set([...memoryStringArray(memory, ["howTo", "howToNotes"]), ...profile.howTo])).slice(0, 6);
  const tools = Array.from(new Set([...memoryStringArray(memory, ["tools", "toolAccess"]), ...profile.tools])).slice(0, 8);
  const stakeholders = Array.from(new Set([...memoryStringArray(memory, ["stakeholders", "contacts"]), ...profile.stakeholders])).slice(0, 8);
  const criticalDates = Array.from(new Set([...memoryStringArray(memory, ["criticalDates"]), ...profile.criticalDates])).slice(0, 6);
  const transitionChecklist = Array.from(
    new Set([...memoryStringArray(memory, ["transitionChecklist"]), ...profile.transitionChecklist]),
  ).slice(0, 7);
  const riskReasons = Array.from(
    new Set([record.riskSummary, ...profile.riskReasons].filter((item): item is string => Boolean(item))),
  ).slice(0, 5);
  const riskScore = Math.max(record.riskScore ?? 0, profile.riskScore);

  return {
    ...profile,
    id: record.id,
    persisted: true,
    title: record.title || profile.title,
    status: record.status || profile.status,
    directManagerId: record.directManagerId,
    temporaryOwnerId: record.temporaryOwnerId,
    delegateUserId: record.delegateUserId,
    delegateUntil: record.delegateUntil,
    howTo,
    tools,
    stakeholders,
    criticalDates,
    transitionChecklist,
    riskScore,
    riskLevel: riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low",
    riskReasons,
    lastUpdatedAt: record.updatedAt ?? profile.lastUpdatedAt,
  };
}

function buildEmptyPositionProfile(record: PersistedPositionProfile, users: User[]): PositionProfile | null {
  const owner =
    users.find((user) => String(user.id) === String(record.currentOwnerId)) ??
    users[0] ??
    null;
  if (!owner) return null;
  const base: PositionProfile = {
    id: record.id,
    persisted: true,
    title: record.title,
    owner,
    directManagerId: record.directManagerId,
    temporaryOwnerId: record.temporaryOwnerId,
    delegateUserId: record.delegateUserId,
    delegateUntil: record.delegateUntil,
    status: record.status,
    currentIncompleteTasks: [],
    recurringTasks: [],
    completedTasks: [],
    criticalDates: [],
    howTo: [],
    tools: [],
    stakeholders: [],
    riskScore: record.riskScore ?? 0,
    riskLevel: (record.riskScore ?? 0) >= 60 ? "high" : (record.riskScore ?? 0) >= 30 ? "medium" : "low",
    riskReasons: record.riskSummary ? [record.riskSummary] : [],
    transitionChecklist: [
      "Assign or confirm the current owner for this job title.",
      "Add recurring responsibilities as they are discovered.",
      "Attach tool access and account ownership details.",
      "Review current open work before handoff.",
    ],
    lastUpdatedAt: record.updatedAt ?? record.createdAt,
  };
  return mergeProfileRecord(base, record);
}

function buildPositionProfiles(
  tasks: Task[],
  users: User[],
  events: TaskEvent[],
  persistedProfiles: PersistedPositionProfile[] = [],
): PositionProfile[] {
  const today = new Date().toISOString().slice(0, 10);
  const derivedProfiles: PositionProfile[] = users.map((user) => {
    const owned = tasks.filter((task) => String(task.assignedToId) === String(user.id));
    const currentIncompleteTasks = owned.filter((task) => task.status !== "completed" && task.status !== "denied");
    const completedTasks = owned.filter((task) => task.status === "completed");
    const recurringTasks = owned.filter((task) => task.recurrence !== "none" || inferTaskCadence(task) !== "As needed");
    const criticalDates = Array.from(
      new Set(
        owned
          .filter((task) => task.dueDate && (task.recurrence !== "none" || task.urgency === "critical" || task.urgency === "high"))
          .map((task) => `${task.dueDate}: ${task.title}`),
      ),
    ).slice(0, 4);
    const howTo = Array.from(
      new Set(
        owned
          .map(taskKnowledgeText)
          .filter((text) => text.length >= 30)
          .map((text) => text.slice(0, 180)),
      ),
    ).slice(0, 4);
    const stakeholderNames = users
      .filter((candidate) => String(candidate.id) !== String(user.id))
      .filter((candidate) =>
        owned.some((task) => {
          const text = `${task.title} ${task.description} ${task.completionNotes}`.toLowerCase();
          return text.includes(candidate.name.toLowerCase()) || String(task.assignedById) === String(candidate.id);
        }),
      )
      .map((candidate) => candidate.name)
      .slice(0, 4);
    const overdue = currentIncompleteTasks.filter((task) => task.dueDate && task.dueDate < today);
    const high = currentIncompleteTasks.filter((task) => task.urgency === "critical" || task.urgency === "high");
    const missingHowTo = recurringTasks.filter((task) => taskKnowledgeText(task).length < 30);
    const riskScore = Math.min(
      100,
      overdue.length * 24 +
        high.length * 12 +
        Math.max(0, currentIncompleteTasks.length - 5) * 4 +
        missingHowTo.length * 8 +
        (inferToolsFromTasks(owned).length === 0 && owned.length > 0 ? 8 : 0),
    );
    const riskReasons = [
      overdue.length > 0 ? `${overdue.length} overdue task${overdue.length === 1 ? "" : "s"}` : "",
      high.length > 0 ? `${high.length} high-urgency task${high.length === 1 ? "" : "s"}` : "",
      missingHowTo.length > 0 ? `${missingHowTo.length} recurring item${missingHowTo.length === 1 ? "" : "s"} need better how-to notes` : "",
      currentIncompleteTasks.length > 0 ? `${currentIncompleteTasks.length} active task${currentIncompleteTasks.length === 1 ? "" : "s"} to cover` : "",
    ].filter(Boolean);
    const recentEvents = events
      .filter((event) => owned.some((task) => String(task.id) === String(event.taskId)))
      .map((event) => event.createdAt)
      .sort()
      .at(-1);
    const title = positionTitleForUser(user);
    return {
      id: `position-${String(user.id)}`,
      persisted: false,
      title,
      owner: user,
      directManagerId: user.managerId,
      temporaryOwnerId: null,
      delegateUserId: null,
      delegateUntil: null,
      status: currentIncompleteTasks.some((task) => task.delegatedToId) ? "covered" : "active",
      currentIncompleteTasks,
      recurringTasks,
      completedTasks,
      criticalDates,
      howTo,
      tools: inferToolsFromTasks(owned),
      stakeholders: stakeholderNames,
      riskScore,
      riskLevel: riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low",
      riskReasons,
      transitionChecklist: [
        `Review ${currentIncompleteTasks.length} current incomplete task${currentIncompleteTasks.length === 1 ? "" : "s"}.`,
        recurringTasks.length > 0
          ? `Confirm next occurrence for ${recurringTasks.length} recurring ${recurringTasks.length === 1 ? "responsibility" : "responsibilities"}.`
          : "Confirm whether this role has recurring responsibilities.",
        "Verify tool access, account ownership, billing, and recovery contacts.",
        howTo.length > 0 ? "Review saved how-to context before reassigning." : "Add how-to notes for recurring responsibilities.",
        "Assign the profile owner or set a delegate coverage period.",
      ],
      lastUpdatedAt: recentEvents ?? owned.map((task) => task.createdAt).sort().at(-1) ?? null,
    } satisfies PositionProfile;
  });

  const usedRecordIds = new Set<string>();
  const merged = derivedProfiles.map((profile) => {
    const record = persistedProfiles.find((item) => String(item.currentOwnerId) === String(profile.owner.id));
    if (!record) return profile;
    usedRecordIds.add(record.id);
    return mergeProfileRecord(profile, record);
  });
  for (const record of persistedProfiles) {
    if (usedRecordIds.has(record.id)) continue;
    const profile = buildEmptyPositionProfile(record, users);
    if (profile) merged.push(profile);
  }
  return merged.sort((a, b) => a.title.localeCompare(b.title));
}

function canAdministerProfiles(user: User | null | undefined) {
  return user?.role === "owner" || user?.role === "admin";
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatIcsLocalDateTime(value: string) {
  return value.replace(/[-:]/g, "").replace(/\.\d+$/, "");
}

function formatAgendaTime(value: string | null) {
  if (!value) return "";
  const match = value.match(/T(\d{2}):(\d{2})/);
  if (!match) return "";
  const hour24 = Number(match[1]);
  const minute = match[2];
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute} ${suffix}`;
}

function formatAgendaSlot(item: AgendaItem) {
  if (!item.startAt || !item.endAt || item.scheduleStatus !== "scheduled") {
    return "Needs an open calendar slot";
  }
  return `${item.startAt.slice(0, 10)} / ${formatAgendaTime(item.startAt)}-${formatAgendaTime(item.endAt)}`;
}

function normalizeAgendaPreferences(input?: Partial<AgendaPreferences> | null): AgendaPreferences {
  return {
    ...DEFAULT_AGENDA_PREFERENCES,
    ...(input ?? {}),
    lunchMinutes: Number(input?.lunchMinutes ?? DEFAULT_AGENDA_PREFERENCES.lunchMinutes),
    meetingBufferMinutes: Number(input?.meetingBufferMinutes ?? DEFAULT_AGENDA_PREFERENCES.meetingBufferMinutes),
    minimumBlockMinutes: Number(input?.minimumBlockMinutes ?? DEFAULT_AGENDA_PREFERENCES.minimumBlockMinutes),
    focusBlockMinutes: Number(input?.focusBlockMinutes ?? DEFAULT_AGENDA_PREFERENCES.focusBlockMinutes),
  };
}

function orderAgendaItems(agenda: AgendaItem[], taskOrder: string[]) {
  if (taskOrder.length === 0) return agenda;
  const indexById = new Map(taskOrder.map((id, index) => [id, index]));
  return [...agenda].sort((a, b) => {
    const aIndex = indexById.get(String(a.taskId)) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = indexById.get(String(b.taskId)) ?? Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.order - b.order;
  });
}

function downloadAgendaCalendar(agenda: AgendaItem[]) {
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
  link.download = `donnit-agenda-${new Date().toISOString().slice(0, 10)}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast({
    title: "Calendar file ready",
    description: `Exported ${scheduled.length} scheduled agenda block${scheduled.length === 1 ? "" : "s"} as an .ics file.`,
  });
}

function Wordmark({ onClick }: { onClick?: () => void }) {
  const content = (
    <>
      <span className="brand-mark" aria-hidden="true">
        <Check className="size-4" strokeWidth={3.25} />
      </span>
      <span className="brand-text" aria-hidden="true">
        <span className="brand-text-base">Donn</span>
        <span className="brand-text-accent">it</span>
      </span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className="brand-lockup rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="Go to Donnit home"
        onClick={onClick}
        data-testid="button-donnit-home"
      >
        {content}
      </button>
    );
  }
  return (
    <span className="brand-lockup" aria-label="Donnit">
      {content}
    </span>
  );
}

function ThemeToggle() {
  const [mode, setMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial = prefersDark ? "dark" : "light";
    setMode(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  function toggle() {
    const next = mode === "dark" ? "light" : "dark";
    setMode(next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggle}
      aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
      data-testid="button-theme-toggle"
    >
      {mode === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}

type FunctionAction = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  loading?: boolean;
  primary?: boolean;
  disabled?: boolean;
  hint?: string;
};

type MenuActionGroup = {
  label: string;
  actions: FunctionAction[];
};

type SupportRailView = "today" | "agenda" | "team" | "reports";

type OnboardingStep = {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  actionLabel: string;
  onAction: () => void;
};

function FunctionActionButton({ action }: { action: FunctionAction }) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled || action.loading}
      title={action.hint ?? action.label}
      className={`fn-chip ${action.primary ? "fn-primary" : ""}`}
      data-testid={`button-fn-${action.id}`}
    >
      {action.loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <action.icon className="size-4" />
      )}
      <span>{action.label}</span>
    </button>
  );
}

function FunctionBar({
  addTaskActions,
  primaryActions,
}: {
  addTaskActions: FunctionAction[];
  primaryActions: FunctionAction[];
}) {
  return (
    <div
      className="flex items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0"
      data-testid="bar-functions"
      role="toolbar"
      aria-label="Workspace functions"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button data-testid="button-add-task-menu">
            <ListPlus className="size-4" />
            Add task
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Add task from</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {addTaskActions.map((action) => (
            <DropdownMenuItem
              key={action.id}
              disabled={action.disabled || action.loading}
              onClick={action.onClick}
              data-testid={`menu-add-task-${action.id}`}
            >
              {action.loading ? <Loader2 className="size-4 animate-spin" /> : <action.icon className="size-4" />}
              <span>{action.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {primaryActions.map((action) => (
        <FunctionActionButton key={action.id} action={action} />
      ))}
    </div>
  );
}

const dialogShellClass =
  "flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0";
const dialogHeaderClass = "shrink-0 border-b border-border px-5 py-4 pr-12";
const dialogBodyClass = "min-h-0 flex-1 overflow-y-auto px-5 py-4";
const dialogFooterClass = "shrink-0 border-t border-border px-5 py-3";

function ChatPanel({ messages }: { messages: ChatMessage[] }) {
  const [message, setMessage] = useState("");
  const historyRef = useRef<HTMLDivElement | null>(null);
  const chat = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/chat", { message }),
    onSuccess: async () => {
      setMessage("");
      await invalidateWorkspace();
    },
  });
  useEffect(() => {
    const el = historyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      className="panel flex h-[min(640px,calc(100dvh-7rem))] min-h-[420px] flex-col lg:h-full lg:min-h-0"
      data-testid="panel-chat"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-brand-green" />
          <h2 className="display-font text-base font-bold leading-none">Chat to task</h2>
        </div>
        <span className="ui-label">AI parser</span>
      </div>

      <div
        ref={historyRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4"
        data-testid="panel-chat-history"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            <p className="display-font text-lg font-bold text-foreground">
              Tell Donnit what's on your plate.
            </p>
            <p className="mt-2 max-w-xs text-sm">
              One sentence with the task, due date, and who owns it. Donnit handles the rest.
            </p>
            <p className="mt-4 max-w-xs rounded-md bg-muted px-3 py-2 text-xs">
              "Add urgent payroll reset for Jordan tomorrow, 45 min."
            </p>
          </div>
        ) : (
          messages.map((item) => (
            <div
              key={item.id}
              className={`max-w-[88%] rounded-md px-3 py-2 text-sm leading-relaxed ${
                item.role === "assistant"
                  ? "bg-muted text-foreground"
                  : "ml-auto bg-brand-green text-white"
              }`}
              data-testid={`text-chat-message-${item.id}`}
            >
              {item.content}
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-border px-4 py-3">
        <Label htmlFor="chat-message" className="ui-label mb-1.5 block">
          New entry
        </Label>
        <Textarea
          id="chat-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Add spouse birthday for 2026-05-30, remind me 15 days before."
          rows={3}
          className="h-24 max-h-24 min-h-0 resize-none overflow-y-auto focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-1"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (message.trim().length >= 2 && !chat.isPending) chat.mutate();
            }
          }}
          data-testid="input-chat-message"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Enter to send · Shift + Enter for a new line</span>
          <Button
            onClick={() => chat.mutate()}
            disabled={message.trim().length < 2 || chat.isPending}
            data-testid="button-send-chat"
          >
            {chat.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

const demoMailto =
  "mailto:hello@donnit.ai?subject=Book%20a%20Donnit%20demo&body=I%20want%20to%20see%20how%20Donnit%20can%20help%20my%20team.";
const pricingMailto =
  "mailto:hello@donnit.ai?subject=Donnit%20pricing&body=I%20want%20to%20learn%20which%20Donnit%20plan%20fits%20my%20team.";

function LandingPage() {
  const goToLogin = () => {
    window.location.hash = "/app";
  };
  const integrations = ["Slack", "Gmail", "Outlook", "Teams", "Calendar", "SMS"];
  const proofPoints = [
    "AI task capture",
    "Role memory",
    "Calendar-ready work",
  ];
  const flow = [
    {
      icon: Sparkles,
      title: "Capture",
      copy: "Slack, email, chat, and notes become task suggestions.",
    },
    {
      icon: UserRoundCheck,
      title: "Clarify",
      copy: "Donnit adds owners, deadlines, urgency, and context.",
    },
    {
      icon: BriefcaseBusiness,
      title: "Carry Forward",
      copy: "Recurring work builds a living Position Profile.",
    },
  ];
  const heroSignals = [
    { source: "Email", title: "Vendor renewal attached", meta: "Renew by Friday" },
    { source: "Slack", title: "Jordan needs access", meta: "Send login today" },
    { source: "Recurring", title: "Board packet week", meta: "Prep agenda draft" },
  ];
  const continuitySteps = [
    {
      title: "Before a move",
      copy: "Capture the real rhythm of the role while work is happening.",
    },
    {
      title: "During coverage",
      copy: "Assign temporary ownership without mixing roles together.",
    },
    {
      title: "For the next person",
      copy: "Give them the playbook, not a guessing game.",
    },
  ];
  const dailyTasks = [
    ["Approve suggested renewal task", "AI captured from Gmail", "Today"],
    ["Schedule onboarding access", "Slack request", "45 min"],
    ["Draft transition notes", "Position Profile", "Friday"],
  ];
  const pricingOptions = [
    ["Free trial", "14 days", "One role. One inbox. No card.", "Start free"],
    ["Team pilot", "Guided setup", "Connect tools and prove the handoff workflow.", "Book demo"],
  ] as const;

  return (
    <main className="landing-page min-h-screen bg-background text-foreground" data-testid="page-landing">
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 lg:px-6">
          <Wordmark />
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#how-it-works" className="hover:text-foreground">How it works</a>
            <a href="#continuity" className="hover:text-foreground">Role handoffs</a>
            <a href="#integrations" className="hover:text-foreground">Integrations</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToLogin} data-testid="button-landing-login">
              Login
            </Button>
            <Button size="sm" onClick={goToLogin} data-testid="button-landing-start-top">
              Start free
            </Button>
          </div>
        </div>
      </header>

      <section className="relative isolate overflow-hidden px-4 pb-12 pt-16 lg:px-6 lg:pb-18 lg:pt-24">
        <div className="relative mx-auto max-w-7xl">
          <div className="mx-auto max-w-4xl text-center">
            <p className="ui-label">AI-powered work continuity</p>
            <h1 className="mt-4 text-5xl font-semibold leading-[1.02] text-foreground md:text-7xl">
              Work remembered.
              <span className="block text-brand-green">Handoffs handled.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              Donnit turns Slack, email, and notes into tasks, agendas, and role memory.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="landing-primary-cta" onClick={goToLogin} data-testid="button-landing-start">
                Start free
                <ArrowRight className="size-4" />
              </Button>
              <Button size="lg" variant="outline" asChild data-testid="button-landing-demo-hero">
                <a href={demoMailto}>Book demo</a>
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">14 days. No card. One role to start.</p>
            <div className="landing-proof-strip mt-7">
              {proofPoints.map((point) => (
                <span key={point}>{point}</span>
              ))}
            </div>
          </div>

          <div className="landing-product-stage mt-10" aria-label="Donnit turns work inputs into approved tasks and role memory">
            <div className="landing-stage-column">
              <p className="ui-label">Inputs</p>
              <div className="mt-3 space-y-3">
                {heroSignals.map((signal, index) => (
                  <div key={signal.title} className="landing-stage-card" style={{ animationDelay: `${index * 420}ms` }}>
                    <span>{signal.source}</span>
                    <strong>{signal.title}</strong>
                    <small>{signal.meta}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="landing-ai-core">
              <Sparkles className="size-6" />
              <span>AI intake</span>
            </div>

            <div className="landing-stage-column landing-stage-output">
              <div className="flex items-center justify-between gap-3">
                <p className="ui-label">Donnit</p>
                <span className="rounded-full bg-brand-green/10 px-3 py-1 text-xs font-medium text-brand-green">ready</span>
              </div>
              <div className="mt-3 space-y-2">
                {dailyTasks.map(([task, source, time], index) => (
                  <div key={task} className="landing-stage-task" style={{ animationDelay: `${index * 180}ms` }}>
                    <Check className="size-4" />
                    <div>
                      <strong>{task}</strong>
                      <small>{source}</small>
                    </div>
                    <span>{time}</span>
                  </div>
                ))}
              </div>
              <div className="landing-memory-pill">
                <BriefcaseBusiness className="size-4" />
                Updates Position Profile
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="continuity" className="px-4 py-10 lg:px-6 lg:py-16">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="ui-label">Role handoffs</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">
              Less scramble. Cleaner starts.
            </h2>
            <p className="mt-4 text-lg leading-8 text-muted-foreground">
              Donnit builds Position Profiles from real work, not stale job descriptions.
            </p>
          </div>
          <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-start">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              {continuitySteps.map((step) => (
                <div key={step.title} className="landing-continuity-step rounded-md border border-border bg-card p-4">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-green text-white">
                    <Check className="size-4" />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.copy}</p>
                </div>
              ))}
              <Button asChild className="w-fit sm:col-span-3 lg:col-span-1">
                <a href={demoMailto}>
                  See Position Profile
                  <ArrowRight className="size-4" />
                </a>
              </Button>
            </div>
            <div className="landing-profile-preview rounded-md border border-border bg-card p-4">
              <p className="ui-label">Position profile</p>
              <h3 className="mt-2 text-xl font-semibold">Executive Assistant to the CEO</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Automatically built from recurring tasks, notes, completions, and handoff context.
              </p>
              <div className="mt-5 space-y-2">
                {["Weekly board packet prep", "Annual insurance renewal", "CEO travel hold review", "Vendor invoice reconciliation"].map((task, index) => (
                  <div key={task} className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2">
                    <p className="truncate text-sm font-medium">{task}</p>
                    <span className="text-xs text-muted-foreground">{index === 1 ? "Annual" : "Open"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="px-4 py-10 lg:px-6 lg:py-14">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="ui-label">How it works</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">
              Capture. Clarify. Carry forward.
            </h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {flow.map((item, index) => (
              <div key={item.title} className="landing-flow-step rounded-md border border-border bg-card p-5 text-center">
                <div className="mx-auto flex size-11 items-center justify-center rounded-md bg-brand-green/10 text-brand-green">
                  <item.icon className="size-5" />
                </div>
                <p className="ui-label mt-5">0{index + 1}</p>
                <h3 className="mt-1 text-xl font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-10 lg:px-6 lg:py-14">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div className="max-w-xl">
              <p className="ui-label">Daily work</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">
                Your day, already sorted.
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
                Type it. Approve it. Schedule it. Donnit keeps the context close.
              </p>
            </div>
            <div className="landing-daily-preview rounded-md border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="ui-label">Today</p>
                <span className="rounded-full bg-background px-3 py-1 text-xs text-muted-foreground">AI agenda ready</span>
              </div>
              <div className="mt-4 space-y-2">
                {dailyTasks.map(([task, source, time]) => (
                  <div key={task} className="grid gap-2 rounded-md bg-background px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div>
                      <p className="text-sm font-medium">{task}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{source}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="integrations" className="px-4 py-10 lg:px-6 lg:py-14">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="ui-label">Works where work starts</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">
              Slack, email, calendar, SMS.
            </h2>
          </div>
          <div className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3">
            {integrations.map((name) => (
              <div key={name} className="rounded-md border border-border bg-card px-4 py-4 text-center text-sm font-medium">
                {name}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="px-4 py-10 lg:px-6 lg:py-16">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="ui-label">Pricing</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">Start small. Prove value.</h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Begin with one role or one team. Expand when the workflow is working.
            </p>
          </div>
          <div className="mx-auto mt-8 grid max-w-4xl gap-4 md:grid-cols-2">
            {pricingOptions.map(([name, price, copy, cta]) => (
              <div key={name} className="landing-pricing-card rounded-md border border-border bg-card p-5">
                <p className="ui-label">{name}</p>
                <h3 className="mt-3 text-2xl font-semibold">{price}</h3>
                <p className="mt-3 min-h-12 text-muted-foreground">{copy}</p>
                {cta === "Start free" ? (
                  <Button className="mt-5" onClick={goToLogin}>{cta}</Button>
                ) : (
                  <Button className="mt-5" variant="outline" asChild>
                    <a href={demoMailto}>{cta}</a>
                  </Button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-5 text-center text-sm text-muted-foreground">
            Need procurement details or a larger rollout? <a href={pricingMailto} className="text-foreground underline underline-offset-4">See pricing options</a>.
          </p>
        </div>
      </section>

      <section className="px-4 py-14 lg:px-6 lg:py-20">
        <div className="mx-auto max-w-4xl text-center">
          <p className="ui-label">Get started</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">Try Donnit with one role.</h2>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" className="landing-primary-cta" onClick={goToLogin}>
              Start free
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href={demoMailto}>Book demo</a>
            </Button>
          </div>
        </div>
      </section>
      <footer className="landing-footer border-t border-border px-4 py-8 lg:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <Wordmark />
          <div className="flex flex-wrap gap-4">
            <a href="mailto:hello@donnit.ai" className="hover:text-foreground">Contact</a>
            <a href="mailto:hello@donnit.ai?subject=Donnit%20privacy%20request" className="hover:text-foreground">Privacy</a>
            <a href="mailto:hello@donnit.ai?subject=Donnit%20terms%20request" className="hover:text-foreground">Terms</a>
            <button type="button" onClick={goToLogin} className="hover:text-foreground">Login</button>
          </div>
        </div>
      </footer>
    </main>
  );
}

function WorkspaceMenu({
  primaryActions,
  menuGroups,
}: {
  primaryActions: FunctionAction[];
  menuGroups: MenuActionGroup[];
}) {
  const renderItem = (action: FunctionAction) => (
    <DropdownMenuItem
      key={action.id}
      disabled={action.disabled || action.loading}
      onClick={action.onClick}
      data-testid={`menu-action-${action.id}`}
    >
      {action.loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <action.icon className="size-4" />
      )}
      <span>{action.label}</span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Open workspace menu" data-testid="button-workspace-menu">
          <Menu className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>All options</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ListChecks className="size-4" />
            Daily actions
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {primaryActions.map(renderItem)}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {menuGroups.map((group) => (
          <DropdownMenuSub key={group.label}>
            <DropdownMenuSubTrigger>
              {group.label === "Tools sync" ? (
                <RefreshCcw className="size-4" />
              ) : group.label === "Admin" ? (
                <ShieldCheck className="size-4" />
              ) : (
                <SlidersHorizontal className="size-4" />
              )}
              {group.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              {group.actions.map(renderItem)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OnboardingChecklist({
  steps,
  onDismiss,
}: {
  steps: OnboardingStep[];
  onDismiss: () => void;
}) {
  const doneCount = steps.filter((step) => step.done).length;
  const nextStep = steps.find((step) => !step.done) ?? steps[steps.length - 1];
  return (
    <section className="mb-4 rounded-lg border border-brand-green/30 bg-brand-green/5 p-4" data-testid="panel-onboarding-checklist">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-md bg-brand-green text-white">
              <Sparkles className="size-4" />
            </span>
            <div>
              <p className="display-font text-base font-bold text-foreground">Start strong</p>
              <p className="text-sm text-muted-foreground">
                Get Donnit to first value: capture work, approve it, schedule it, and preserve role memory.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-5">
            {steps.map((step) => (
              <button
                key={step.id}
                type="button"
                onClick={step.onAction}
                className={`rounded-md border p-3 text-left transition hover:border-brand-green/70 ${
                  step.done ? "border-brand-green/40 bg-background" : "border-border bg-card"
                }`}
                data-testid={`button-onboarding-${step.id}`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="ui-label">{step.actionLabel}</span>
                  <span
                    className={`inline-flex size-5 items-center justify-center rounded-full border ${
                      step.done ? "border-brand-green bg-brand-green text-white" : "border-border text-muted-foreground"
                    }`}
                  >
                    {step.done ? <Check className="size-3" /> : null}
                  </span>
                </div>
                <p className="text-sm font-semibold leading-snug text-foreground">{step.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="shrink-0 rounded-md border border-border bg-background p-3 xl:w-56">
          <p className="ui-label">Setup progress</p>
          <p className="display-font mt-1 text-2xl font-bold text-foreground">
            {doneCount}/{steps.length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {doneCount === steps.length ? "Ready for a pilot workflow." : `Next: ${nextStep?.title ?? "Keep going"}`}
          </p>
          <div className="mt-3 flex gap-2">
            {nextStep && !nextStep.done ? (
              <Button size="sm" onClick={nextStep.onAction} data-testid="button-onboarding-next">
                {nextStep.actionLabel}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onDismiss} data-testid="button-onboarding-dismiss">
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function TaskRow({
  task,
  users,
  onComplete,
  onOpen,
  onPin,
  isCompleting,
}: {
  task: Task;
  users: User[];
  onComplete: () => void;
  onOpen: () => void;
  onPin?: () => void;
  isCompleting: boolean;
}) {
  const assignee = users.find((user) => user.id === task.assignedToId);
  const delegate = users.find((user) => String(user.id) === String(task.delegatedToId));
  const collaboratorCount = task.collaboratorIds?.length ?? 0;
  const isDone = task.status === "completed";
  const contextHints = [
    task.recurrence !== "none" || inferTaskCadence(task) !== "As needed"
      ? `${inferTaskCadence(task)} responsibility`
      : "",
    task.description ? task.description.slice(0, 140) : "",
    task.completionNotes ? `Last note: ${task.completionNotes.slice(0, 120)}` : "",
    task.source !== "manual" ? `Source: ${task.source}` : "",
  ].filter(Boolean);

  return (
    <div
      className={`task-row task-row-openable ${urgencyClass(task.urgency)} ${isDone ? "is-done" : ""}`}
      data-testid={`row-task-${task.id}`}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <button
        type="button"
        onClick={onComplete}
        disabled={isCompleting || isDone}
        aria-label={isDone ? "Completed" : "Mark complete"}
        className={`check-circle ${isDone ? "is-checked" : ""}`}
        data-testid={`button-complete-${task.id}`}
      >
        {isCompleting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" strokeWidth={3} />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p
            className="task-title text-sm font-medium leading-snug text-foreground"
            data-testid={`text-task-title-${task.id}`}
          >
            {task.title}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {contextHints.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Show task context"
                    className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
                    data-testid={`button-task-context-${task.id}`}
                  >
                    <HelpCircle className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-1 text-xs">
                    {contextHints.slice(0, 4).map((hint, index) => (
                      <p key={`${task.id}-hint-${index}`}>{hint}</p>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            <span className="ui-label whitespace-nowrap" data-testid={`text-task-urgency-${task.id}`}>
              {urgencyLabel(task.urgency)}
            </span>
          </div>
        </div>
        {task.description && !isDone && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{task.description}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span
            className="inline-flex items-center gap-1"
            data-testid={`text-task-due-${task.id}`}
          >
            <CalendarClock className="size-3.5" />
            {task.dueDate ?? "No due date"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-3.5" />
            {task.estimatedMinutes} min
          </span>
          <span className="inline-flex items-center gap-1">
            <UserRoundCheck className="size-3.5" />
            {assignee?.name ?? "Unassigned"}
          </span>
          {delegate && (
            <span className="inline-flex items-center gap-1">
              <UserPlus className="size-3.5" />
              Delegated to {delegate.name}
            </span>
          )}
          {collaboratorCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" />
              {collaboratorCount} collaborator{collaboratorCount === 1 ? "" : "s"}
            </span>
          )}
          {task.status !== "open" && task.status !== "completed" && (
            <span className="ui-label">{statusLabels[task.status] ?? task.status}</span>
          )}
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-green underline-offset-2 hover:underline"
            data-testid={`button-open-task-${task.id}`}
          >
            <Eye className="size-3.5" />
            Open
          </button>
          {onPin && !isDone && (
            <button
              type="button"
              onClick={onPin}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-green underline-offset-2 hover:underline"
              data-testid={`button-work-task-${task.id}`}
            >
              <Play className="size-3.5" />
              Work
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskList({
  tasks,
  users,
  subtasks = [],
  authenticated = false,
  viewLabel,
  onPinTask,
}: {
  tasks: Task[];
  users: User[];
  subtasks?: TaskSubtask[];
  authenticated?: boolean;
  viewLabel?: string;
  onPinTask?: (taskId: Id) => void;
}) {
  const [completingId, setCompletingId] = useState<Id | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((task) => String(task.id) === selectedTaskId) ?? null;

  const complete = useMutation({
    mutationFn: async (id: Id) =>
      apiRequest("POST", `/api/tasks/${id}/complete`, { note: "Done. That's one less thing." }),
    onMutate: (id: Id) => setCompletingId(id),
    onSuccess: async () => {
      await invalidateWorkspace();
      setCompletingId(null);
    },
    onError: () => setCompletingId(null),
  });

  // Sort for execution: completion last, then time pressure, urgency, shorter work, and age.
  const urgencyRank: Record<string, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    medium: 2,
    low: 3,
  };
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const soonIso = soon.toISOString().slice(0, 10);
  const pressureRank = (task: Task) => {
    if (task.status === "completed") return 99;
    if (task.dueDate && task.dueDate < today) return 0;
    if (task.dueDate === today) return 1;
    if (task.dueDate && task.dueDate <= soonIso) return 2;
    if (!task.dueDate && (task.urgency === "critical" || task.urgency === "high")) return 3;
    if (task.dueDate) return 4;
    return 5;
  };
  const groupForTask = (task: Task) => {
    if (task.dueDate && task.dueDate < today) return { id: "overdue", label: "Do now", detail: "Past due work" };
    if (task.dueDate === today) return { id: "today", label: "Today", detail: "Due today" };
    if (/reply|respond|follow up|follow-up|email|call|message/i.test(`${task.title} ${task.description}`) || ["email", "slack", "sms"].includes(task.source)) {
      return { id: "communications", label: "Communications batch", detail: "Handle together while context is open" };
    }
    if (/review|approve|audit|contract|document|proposal|invoice|reconcile/i.test(`${task.title} ${task.description}`) || task.source === "document") {
      return { id: "review", label: "Review batch", detail: "Read, decide, and approve together" };
    }
    if (/plan|roadmap|strategy|report|presentation|deck|onboarding/i.test(`${task.title} ${task.description}`)) {
      return { id: "planning", label: "Planning batch", detail: "Deep work and manager planning" };
    }
    if (task.dueDate) return { id: "scheduled", label: "Scheduled later", detail: "Upcoming dated work" };
    return { id: "backlog", label: "Backlog", detail: "No due date yet" };
  };

  const sorted = [...tasks].sort((a, b) => {
    const aDone = a.status === "completed" ? 1 : 0;
    const bDone = b.status === "completed" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aPressure = pressureRank(a);
    const bPressure = pressureRank(b);
    if (aPressure !== bPressure) return aPressure - bPressure;
    const urgencyDelta = (urgencyRank[a.urgency] ?? 4) - (urgencyRank[b.urgency] ?? 4);
    if (urgencyDelta !== 0) return urgencyDelta;
    const aDue = a.dueDate ?? "9999-12-31";
    const bDue = b.dueDate ?? "9999-12-31";
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    if (a.estimatedMinutes !== b.estimatedMinutes) return a.estimatedMinutes - b.estimatedMinutes;
    return a.createdAt.localeCompare(b.createdAt);
  });

  const open = sorted.filter((t) => t.status !== "completed");
  const done = sorted.filter((t) => t.status === "completed");
  const grouped = open.reduce<Array<{ id: string; label: string; detail: string; tasks: Task[] }>>((groups, task) => {
    const group = groupForTask(task);
    const existing = groups.find((item) => item.id === group.id);
    if (existing) existing.tasks.push(task);
    else groups.push({ ...group, tasks: [task] });
    return groups;
  }, []);

  return (
    <div className="panel flex flex-col" data-testid="panel-tasks">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="work-heading">To do</h2>
          <p className="ui-label mt-1">
            {viewLabel ? `${viewLabel} - ` : ""}Prioritized and batched by timing/context
          </p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums">
          {open.length} open
        </span>
      </div>

      <div className="flex flex-col gap-2 px-4 py-4">
        {open.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-10 text-center">
            <CheckCircle2 className="mx-auto size-8 text-brand-green" />
            <p className="display-font mt-3 text-base font-bold">Plate's clear.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Done. That's one less thing.
            </p>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.id} className="space-y-2">
              <div className="flex items-center justify-between gap-3 px-1 pt-1">
                <div>
                  <p className="ui-label text-[10px] uppercase tracking-wide text-muted-foreground">{group.label}</p>
                  <p className="text-[11px] text-muted-foreground">{group.detail}</p>
                </div>
                <span className="text-[11px] tabular-nums text-muted-foreground">{group.tasks.length}</span>
              </div>
              {group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  users={users}
                  isCompleting={completingId === task.id && complete.isPending}
                  onComplete={() => complete.mutate(task.id)}
                  onOpen={() => setSelectedTaskId(String(task.id))}
                  onPin={onPinTask ? () => onPinTask(task.id) : undefined}
                />
              ))}
            </div>
          ))
        )}

        {done.length > 0 && (
          <>
            <div className="mt-4 flex items-center gap-2 px-1">
              <span className="ui-label">Just done</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {done.slice(0, 3).map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                users={users}
                isCompleting={false}
                onComplete={() => undefined}
                onOpen={() => setSelectedTaskId(String(task.id))}
                onPin={onPinTask ? () => onPinTask(task.id) : undefined}
              />
            ))}
          </>
        )}
      </div>
      <TaskDetailDialog
        task={selectedTask}
        users={users}
        subtasks={subtasks}
        events={[]}
        authenticated={authenticated}
        open={Boolean(selectedTask)}
        onOpenChange={(open) => {
          if (!open) setSelectedTaskId(null);
        }}
      />
    </div>
  );
}

function TaskDetailDialog({
  task,
  users,
  subtasks: persistedSubtasks = [],
  events = [],
  authenticated = false,
  open,
  onOpenChange,
}: {
  task: Task | null;
  users: User[];
  subtasks?: TaskSubtask[];
  events?: TaskEvent[];
  authenticated?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("open");
  const [urgency, setUrgency] = useState<"low" | "normal" | "high" | "critical">("normal");
  const [dueDate, setDueDate] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState(30);
  const [assignedToId, setAssignedToId] = useState("");
  const [delegatedToId, setDelegatedToId] = useState("");
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [localSubtasks, setLocalSubtasks] = useState<LocalSubtask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description);
    setStatus(task.status);
    setUrgency(task.urgency as "low" | "normal" | "high" | "critical");
    setDueDate(task.dueDate ?? "");
    setEstimatedMinutes(task.estimatedMinutes);
    setAssignedToId(String(task.assignedToId));
    setDelegatedToId(task.delegatedToId ? String(task.delegatedToId) : "");
    setCollaboratorIds((task.collaboratorIds ?? []).map((id) => String(id)));
    setNote(task.completionNotes ?? "");
    setNewSubtaskTitle("");
    if (authenticated) {
      setLocalSubtasks([]);
      return;
    }
    try {
      if (typeof window === "undefined") {
        setLocalSubtasks([]);
      } else {
        setLocalSubtasks(
          normalizeLocalSubtasks(task.id, JSON.parse(window.localStorage.getItem(`donnit.subtasks.${task.id}`) ?? "[]")),
        );
      }
    } catch {
      setLocalSubtasks([]);
    }
  }, [authenticated, task]);

  const save = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error("No task selected.");
      const res = await apiRequest("PATCH", `/api/tasks/${task.id}`, {
        title: title.trim(),
        description: description.trim(),
        status,
        urgency,
        dueDate: dueDate || null,
        estimatedMinutes,
        assignedToId,
        delegatedToId: delegatedToId || null,
        collaboratorIds,
        note: note.trim() || undefined,
      });
      return (await res.json()) as Task;
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Task updated", description: "The task details were saved." });
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not update task",
        description: error instanceof Error ? error.message : "Check the task details and try again.",
        variant: "destructive",
      });
    },
  });

  const updateRelationships = useMutation({
    mutationFn: async (next: {
      assignedToId: string;
      delegatedToId: string;
      collaboratorIds: string[];
    }) => {
      if (!task) throw new Error("No task selected.");
      const res = await apiRequest("PATCH", `/api/tasks/${task.id}`, {
        assignedToId: next.assignedToId,
        delegatedToId: next.delegatedToId || null,
        collaboratorIds: next.collaboratorIds,
      });
      return (await res.json()) as Task;
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Task routing updated", description: "People changes were saved." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not update people",
        description: error instanceof Error ? error.message : "Try that routing change again.",
        variant: "destructive",
      });
    },
  });

  const donnit = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error("No task selected.");
      const res = await apiRequest("POST", `/api/tasks/${task.id}/complete`, { note: note.trim() || "Donnit." });
      return (await res.json()) as Task;
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Donnit", description: "Task completed." });
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not complete task",
        description: error instanceof Error ? error.message : "Try completing it again.",
        variant: "destructive",
      });
    },
  });

  const createSubtask = useMutation({
    mutationFn: async (input: { title: string; position: number }) => {
      if (!task) throw new Error("No task selected.");
      const res = await apiRequest("POST", `/api/tasks/${task.id}/subtasks`, input);
      return (await res.json()) as TaskSubtask;
    },
    onSuccess: async () => {
      setNewSubtaskTitle("");
      await invalidateWorkspace();
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not add subtask",
        description: apiErrorMessage(error, "Apply migration 0010 and try again."),
        variant: "destructive",
      });
    },
  });

  const updateSubtask = useMutation({
    mutationFn: async (input: { subtaskId: Id; done: boolean }) => {
      if (!task) throw new Error("No task selected.");
      const res = await apiRequest("PATCH", `/api/tasks/${task.id}/subtasks/${input.subtaskId}`, { done: input.done });
      return (await res.json()) as TaskSubtask;
    },
    onSuccess: invalidateWorkspace,
    onError: (error: unknown) => {
      toast({
        title: "Could not update subtask",
        description: apiErrorMessage(error, "Try that subtask again."),
        variant: "destructive",
      });
    },
  });

  const removeSubtask = useMutation({
    mutationFn: async (subtaskId: Id) => {
      if (!task) throw new Error("No task selected.");
      await apiRequest("DELETE", `/api/tasks/${task.id}/subtasks/${subtaskId}`);
    },
    onSuccess: invalidateWorkspace,
    onError: (error: unknown) => {
      toast({
        title: "Could not delete subtask",
        description: apiErrorMessage(error, "Try deleting it again."),
        variant: "destructive",
      });
    },
  });

  if (!task) return null;
  const assignee = users.find((user) => String(user.id) === String(task.assignedToId));
  const assigner = users.find((user) => String(user.id) === String(task.assignedById));
  const delegate = users.find((user) => String(user.id) === delegatedToId);
  const selectedCollaborators = users.filter((user) => collaboratorIds.includes(String(user.id)));
  const collaboratorOptions = users.filter(
    (user) => String(user.id) !== assignedToId && !collaboratorIds.includes(String(user.id)),
  );
  const ready = title.trim().length >= 2;
  const addCollaborator = (userId: string) => {
    if (!userId) return;
    const nextCollaborators = collaboratorIds.includes(userId) ? collaboratorIds : [...collaboratorIds, userId];
    setCollaboratorIds(nextCollaborators);
    updateRelationships.mutate({ assignedToId, delegatedToId, collaboratorIds: nextCollaborators });
  };
  const removeCollaborator = (userId: string) => {
    const nextCollaborators = collaboratorIds.filter((id) => id !== userId);
    setCollaboratorIds(nextCollaborators);
    updateRelationships.mutate({ assignedToId, delegatedToId, collaboratorIds: nextCollaborators });
  };
  const reassignOwner = (userId: string) => {
    const nextDelegate = delegatedToId === userId ? "" : delegatedToId;
    const nextCollaborators = collaboratorIds.filter((id) => id !== userId);
    setAssignedToId(userId);
    setDelegatedToId(nextDelegate);
    setCollaboratorIds(nextCollaborators);
    updateRelationships.mutate({ assignedToId: userId, delegatedToId: nextDelegate, collaboratorIds: nextCollaborators });
  };
  const delegateTask = (userId: string) => {
    setDelegatedToId(userId);
    updateRelationships.mutate({ assignedToId, delegatedToId: userId, collaboratorIds });
  };
  const persistSubtasks = (next: LocalSubtask[]) => {
    setLocalSubtasks(next);
    if (task && typeof window !== "undefined") {
      window.localStorage.setItem(`donnit.subtasks.${task.id}`, JSON.stringify(next));
    }
  };
  const subtasks = authenticated
    ? sortSubtasks(persistedSubtasks.filter((item) => String(item.taskId) === String(task.id)))
    : sortSubtasks(localSubtasks);
  const addSubtask = () => {
    const titleText = newSubtaskTitle.trim();
    if (!titleText) return;
    if (authenticated) {
      createSubtask.mutate({ title: titleText, position: subtasks.length });
      return;
    }
    persistSubtasks([
      ...subtasks,
      {
        id: `subtask-${Date.now()}`,
        taskId: task.id,
        title: titleText,
        done: false,
        position: subtasks.length,
        completedAt: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    setNewSubtaskTitle("");
  };
  const toggleSubtask = (subtask: TaskSubtask) => {
    if (authenticated) {
      updateSubtask.mutate({ subtaskId: subtask.id, done: !subtask.done });
      return;
    }
    persistSubtasks(
      subtasks.map((item) =>
        item.id === subtask.id
          ? { ...item, done: !item.done, completedAt: !item.done ? new Date().toISOString() : null }
          : item,
      ),
    );
  };
  const deleteSubtask = (subtaskId: Id) => {
    if (authenticated) {
      removeSubtask.mutate(subtaskId);
      return;
    }
    persistSubtasks(subtasks.filter((item) => String(item.id) !== String(subtaskId)));
  };
  const taskEvents = task
    ? events
        .filter((event) => String(event.taskId) === String(task.id))
        .slice(0, 8)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} sm:max-w-2xl`}>
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12">
          <DialogTitle>Task details</DialogTitle>
          <DialogDescription>
            Owned by {assignee?.name ?? "Unknown"} - assigned by {assigner?.name ?? "Unknown"}
            {delegate ? `, delegated to ${delegate.name}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-detail-title">Title</Label>
            <Input
              id="task-detail-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              data-testid="input-task-detail-title"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="task-detail-status">Status</Label>
              <select
                id="task-detail-status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="select-task-detail-status"
              >
                <option value="open">Open</option>
                <option value="pending_acceptance">Needs acceptance</option>
                <option value="accepted">Accepted</option>
                <option value="denied">Denied</option>
                <option value="completed">Done</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-detail-urgency">Urgency</Label>
              <select
                id="task-detail-urgency"
                value={urgency}
                onChange={(event) => setUrgency(event.target.value as "low" | "normal" | "high" | "critical")}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="select-task-detail-urgency"
              >
                <option value="low">Low</option>
                <option value="normal">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-detail-due">Due</Label>
              <Input
                id="task-detail-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                data-testid="input-task-detail-due"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-detail-estimate">Minutes</Label>
              <Input
                id="task-detail-estimate"
                type="number"
                min={5}
                max={1440}
                step={1}
                value={estimatedMinutes}
                onChange={(event) => setEstimatedMinutes(Number(event.target.value) || 30)}
                data-testid="input-task-detail-estimate"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-detail-description">Description</Label>
            <Textarea
              id="task-detail-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-[90px]"
              maxLength={2000}
              data-testid="input-task-detail-description"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-detail-note">Notes</Label>
            <Textarea
              id="task-detail-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add an update, blocker, or completion note."
              className="min-h-[80px]"
              maxLength={1000}
              data-testid="input-task-detail-note"
            />
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Subtasks</p>
                <p className="text-xs text-muted-foreground">
                  {subtasks.filter((item) => item.done).length}/{subtasks.length} complete
                </p>
              </div>
              <ListChecks className="size-4 text-muted-foreground" />
            </div>
            <div className="flex gap-2">
              <Input
                value={newSubtaskTitle}
                onChange={(event) => setNewSubtaskTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addSubtask();
                  }
                }}
                placeholder="Add a subtask"
                maxLength={160}
                data-testid="input-new-subtask"
              />
              <Button
                type="button"
                variant="outline"
                onClick={addSubtask}
                disabled={!newSubtaskTitle.trim() || createSubtask.isPending}
              >
                {createSubtask.isPending ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />}
                Add
              </Button>
            </div>
            <div className="mt-3 space-y-1.5">
              {subtasks.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                  Break this task into steps as you work.
                </p>
              ) : (
                subtasks.map((subtask) => (
                  <div key={subtask.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-2">
                    <button
                      type="button"
                      onClick={() => toggleSubtask(subtask)}
                      disabled={updateSubtask.isPending}
                      className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${
                        subtask.done ? "border-brand-green bg-brand-green text-white" : "border-border bg-muted"
                      }`}
                      data-testid={`button-subtask-toggle-${subtask.id}`}
                    >
                      {subtask.done && <Check className="size-3.5" />}
                    </button>
                    <span className={`min-w-0 flex-1 truncate text-sm ${subtask.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                      {subtask.title}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => deleteSubtask(subtask.id)}
                      disabled={removeSubtask.isPending}
                      aria-label="Delete subtask"
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
          {taskEvents.length > 0 && (
            <div className="rounded-md border border-border bg-background px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Progress history</p>
                  <p className="text-xs text-muted-foreground">Recent updates, requests, and status changes</p>
                </div>
                <History className="size-4 text-muted-foreground" />
              </div>
              <ul className="space-y-2">
                {taskEvents.map((event) => {
                  const actor = users.find((user) => String(user.id) === String(event.actorId));
                  return (
                    <li key={String(event.id)} className="rounded-md bg-muted/40 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium capitalize text-foreground">{event.type.replace(/_/g, " ")}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {new Date(event.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {actor?.name ?? "Unknown"} - {event.note || "No note added."}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          </div>
        </div>
        <DialogFooter className="flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
          <div className="flex flex-col gap-2 sm:flex-row">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={updateRelationships.isPending} data-testid="button-task-people-menu">
                  {updateRelationships.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Users className="size-4" />
                  )}
                  Reassign / delegate / collaborate
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>Reassign owner</DropdownMenuLabel>
                {users.map((user) => {
                  const userId = String(user.id);
                  return (
                    <DropdownMenuItem
                      key={`owner-${userId}`}
                      onClick={() => reassignOwner(userId)}
                      data-testid={`menu-reassign-${userId}`}
                    >
                      <UserRoundCheck className="size-4" />
                      <span>{user.name}</span>
                      {userId === assignedToId && <Check className="ml-auto size-4" />}
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Delegate task</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => delegateTask("")} data-testid="menu-delegate-none">
                  <X className="size-4" />
                  No delegate
                  {!delegatedToId && <Check className="ml-auto size-4" />}
                </DropdownMenuItem>
                {users
                  .filter((user) => String(user.id) !== assignedToId)
                  .map((user) => {
                    const userId = String(user.id);
                    return (
                      <DropdownMenuItem
                        key={`delegate-${userId}`}
                        onClick={() => delegateTask(userId)}
                        data-testid={`menu-delegate-${userId}`}
                      >
                        <UserPlus className="size-4" />
                        <span>{user.name}</span>
                        {userId === delegatedToId && <Check className="ml-auto size-4" />}
                      </DropdownMenuItem>
                    );
                  })}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Add collaborator</DropdownMenuLabel>
                {collaboratorOptions.length === 0 ? (
                  <DropdownMenuItem disabled>All available people added</DropdownMenuItem>
                ) : (
                  collaboratorOptions.map((user) => {
                    const userId = String(user.id);
                    return (
                      <DropdownMenuItem
                        key={`collaborator-${userId}`}
                        onClick={() => addCollaborator(userId)}
                        data-testid={`menu-add-collaborator-${userId}`}
                      >
                        <Users className="size-4" />
                        {user.name}
                      </DropdownMenuItem>
                    );
                  })
                )}
                {selectedCollaborators.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Current collaborators</DropdownMenuLabel>
                    {selectedCollaborators.map((user) => (
                      <DropdownMenuItem
                        key={`remove-collaborator-${user.id}`}
                        onClick={() => removeCollaborator(String(user.id))}
                        data-testid={`menu-remove-collaborator-${user.id}`}
                      >
                        <X className="size-4" />
                        Remove {user.name}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => save.mutate()} disabled={!ready || save.isPending} data-testid="button-task-detail-save">
              {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Save changes
            </Button>
          </div>
          <Button
            onClick={() => donnit.mutate()}
            disabled={donnit.isPending || task.status === "completed"}
            data-testid="button-task-donnit"
          >
            {donnit.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Donnit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FloatingTaskBox({
  task,
  users,
  onClose,
}: {
  task: Task | null;
  users: User[];
  onClose: () => void;
}) {
  const [position, setPosition] = useState(() => ({
    x: typeof window === "undefined" ? 24 : Math.max(8, window.innerWidth - 364),
    y: 92,
  }));
  const [minimized, setMinimized] = useState(false);
  const [note, setNote] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    setNote(task?.completionNotes ?? "");
    setMinimized(false);
  }, [task?.id]);

  const saveNote = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error("No active task.");
      const noteText = attachmentName.trim()
        ? `${note.trim()}\nAttachment noted: ${attachmentName.trim()}`.trim()
        : note.trim();
      const res = await apiRequest("POST", `/api/tasks/${task.id}/notes`, { note: noteText || "Working update." });
      return (await res.json()) as Task;
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      setAttachmentName("");
      toast({ title: "Task note saved", description: "Your work update was added." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not save note",
        description: error instanceof Error ? error.message : "Try saving the work note again.",
        variant: "destructive",
      });
    },
  });

  if (!task) return null;
  const owner = users.find((user) => String(user.id) === String(task.assignedToId));
  const maxX = typeof window === "undefined" ? 24 : Math.max(8, window.innerWidth - 360);
  const maxY = typeof window === "undefined" ? 92 : Math.max(72, window.innerHeight - (minimized ? 76 : 420));
  const clampedX = Math.min(Math.max(8, position.x), maxX);
  const clampedY = Math.min(Math.max(72, position.y), maxY);

  return (
    <div
      className="fixed z-[70] w-[min(340px,calc(100vw-1rem))] rounded-md border border-border bg-background shadow-2xl"
      style={{ right: "auto", left: clampedX, top: clampedY }}
      data-testid="floating-task-box"
    >
      <div
        className="flex cursor-move items-center justify-between gap-2 border-b border-border px-3 py-2"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          dragRef.current = { startX: event.clientX, startY: event.clientY, originX: clampedX, originY: clampedY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return;
          const nextX = dragRef.current.originX + event.clientX - dragRef.current.startX;
          const nextY = dragRef.current.originY + event.clientY - dragRef.current.startY;
          setPosition({ x: nextX, y: nextY });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <GripVertical className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">Working on</p>
            <p className="truncate text-[11px] text-muted-foreground">{owner?.name ?? "Unassigned"}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setMinimized((value) => !value);
            }}
            aria-label={minimized ? "Expand active task" : "Minimize active task"}
            data-testid="button-floating-task-minimize"
          >
            {minimized ? <Maximize2 className="size-3.5" /> : <Minimize2 className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            aria-label="Close active task"
            data-testid="button-floating-task-close"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      {!minimized && (
        <div className="space-y-3 px-3 py-3">
          <div>
            <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{task.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {task.dueDate ?? "No due date"} / {task.estimatedMinutes} min / {urgencyLabel(task.urgency)}
            </p>
          </div>
          {task.description && (
            <p className="max-h-20 overflow-y-auto rounded-md bg-muted px-2 py-2 text-xs leading-relaxed text-muted-foreground">
              {task.description}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="floating-task-note" className="ui-label">
              Work note
            </Label>
            <Textarea
              id="floating-task-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add an update, blocker, or next step."
              className="h-24 resize-none text-xs"
              maxLength={1000}
              data-testid="input-floating-task-note"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="floating-task-attachment" className="ui-label">
              Attachment note
            </Label>
            <Input
              id="floating-task-attachment"
              value={attachmentName}
              onChange={(event) => setAttachmentName(event.target.value)}
              placeholder="Paste file name or link for now"
              className="h-8 text-xs"
              data-testid="input-floating-task-attachment"
            />
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={() => saveNote.mutate()}
            disabled={saveNote.isPending}
            data-testid="button-floating-task-save"
          >
            {saveNote.isPending ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
            Save update
          </Button>
        </div>
      )}
    </div>
  );
}

function DueTodayPanel({ tasks }: { tasks: Task[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const dueToday = tasks.filter(
    (task) => task.dueDate === today && task.status !== "completed",
  );
  return (
    <div className="panel" data-testid="panel-due-today">
      <div className="border-b border-border px-4 py-3">
        <h3 className="display-font text-sm font-bold">Due today</h3>
        <p className="ui-label mt-1">Cross these off first</p>
      </div>
      <div className="px-4 py-3">
        {dueToday.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing due today.</p>
        ) : (
          <ul className="space-y-2">
            {dueToday.map((task) => (
              <li
                key={task.id}
                className={`task-row ${urgencyClass(task.urgency)}`}
                data-testid={`row-due-today-${task.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug text-foreground">{task.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {task.estimatedMinutes} min · {urgencyLabel(task.urgency)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AgendaPanel({
  agenda,
  excludedTaskIds,
  approved,
  preferences,
  onBuild,
  onToggleTask,
  onMoveTask,
  onPreferencesChange,
  onApprove,
  onOpenWork,
  onExport,
  isBuilding,
}: {
  agenda: AgendaItem[];
  excludedTaskIds: Set<string>;
  approved: boolean;
  preferences: AgendaPreferences;
  onBuild: () => void;
  onToggleTask: (taskId: Id) => void;
  onMoveTask: (taskId: Id, direction: "up" | "down") => void;
  onPreferencesChange: (preferences: AgendaPreferences) => void;
  onApprove: () => void;
  onOpenWork: () => void;
  onExport: () => void;
  isBuilding: boolean;
}) {
  const includedAgenda = agenda.filter((item) => !excludedTaskIds.has(String(item.taskId)));
  const totalMinutes = includedAgenda.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const scheduledCount = includedAgenda.filter((item) => item.scheduleStatus === "scheduled").length;
  const updatePreference = <K extends keyof AgendaPreferences>(key: K, value: AgendaPreferences[K]) => {
    onPreferencesChange({ ...preferences, [key]: value });
  };
  return (
    <div className="panel overflow-hidden" data-testid="panel-agenda" id="panel-agenda">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="display-font text-sm font-bold">Agenda</h3>
          <p className="ui-label mt-1">
            {agenda.length > 0 ? `${scheduledCount}/${agenda.length} scheduled / ${totalMinutes} min` : "No blocks yet"}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center px-2"
            onClick={onBuild}
            disabled={isBuilding}
            data-testid="button-panel-build-agenda"
          >
            {isBuilding ? <Loader2 className="size-4 animate-spin" /> : <Workflow className="size-4" />}
            Build
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center px-2"
            onClick={onOpenWork}
            disabled={includedAgenda.length === 0}
            data-testid="button-panel-work-agenda"
          >
            <Play className="size-4" />
            Work
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center px-2"
            onClick={onExport}
            disabled={includedAgenda.length === 0 || !approved}
            data-testid="button-panel-export-agenda"
          >
            <CalendarPlus className="size-4" />
            Export
          </Button>
        </div>
      </div>
      <div className="px-4 py-3">
        {agenda.length === 0 ? (
          <p className="text-sm text-muted-foreground">Build an agenda after tasks are added.</p>
        ) : (
          <div className="space-y-3">
            <details className="rounded-md border border-border bg-background px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-foreground">
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal className="size-4 text-brand-green" />
                  Schedule preferences
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {preferences.workdayStart}-{preferences.workdayEnd}
                </span>
              </summary>
              <div className="mt-3 grid gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Start</Label>
                    <Input
                      type="time"
                      value={preferences.workdayStart}
                      onChange={(event) => updatePreference("workdayStart", event.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">End</Label>
                    <Input
                      type="time"
                      value={preferences.workdayEnd}
                      onChange={(event) => updatePreference("workdayEnd", event.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Lunch</Label>
                    <Input
                      type="time"
                      value={preferences.lunchStart}
                      onChange={(event) => updatePreference("lunchStart", event.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Lunch min</Label>
                    <Input
                      type="number"
                      min={0}
                      max={120}
                      value={preferences.lunchMinutes}
                      onChange={(event) => updatePreference("lunchMinutes", Number(event.target.value))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-[11px]">Buffer</Label>
                    <Input
                      type="number"
                      min={0}
                      max={45}
                      value={preferences.meetingBufferMinutes}
                      onChange={(event) => updatePreference("meetingBufferMinutes", Number(event.target.value))}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Min block</Label>
                    <Input
                      type="number"
                      min={5}
                      max={60}
                      value={preferences.minimumBlockMinutes}
                      onChange={(event) => updatePreference("minimumBlockMinutes", Number(event.target.value))}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Focus</Label>
                    <Input
                      type="number"
                      min={30}
                      max={180}
                      value={preferences.focusBlockMinutes}
                      onChange={(event) => updatePreference("focusBlockMinutes", Number(event.target.value))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Morning</Label>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={preferences.morningPreference}
                      onChange={(event) => updatePreference("morningPreference", event.target.value as AgendaPreference)}
                    >
                      <option value="deep_work">Deep work</option>
                      <option value="communications">Messages</option>
                      <option value="mixed">Mixed</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-[11px]">Afternoon</Label>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={preferences.afternoonPreference}
                      onChange={(event) => updatePreference("afternoonPreference", event.target.value as AgendaPreference)}
                    >
                      <option value="deep_work">Deep work</option>
                      <option value="communications">Messages</option>
                      <option value="mixed">Mixed</option>
                    </select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Rebuild after changing preferences so Donnit can repair the schedule against your calendar.
                </p>
              </div>
            </details>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Review, reorder, remove anything that should not be scheduled, then approve before export.
                </p>
                <Button
                  size="sm"
                  onClick={onApprove}
                  disabled={includedAgenda.length === 0 || approved}
                  data-testid="button-approve-agenda"
                >
                  <Check className="size-4" />
                  {approved ? "Approved" : "Approve agenda"}
                </Button>
              </div>
            </div>
            <ol className="space-y-2">
              {agenda.map((item, index) => {
                const excluded = excludedTaskIds.has(String(item.taskId));
                return (
                  <li
                    key={`${item.taskId}-${item.order}`}
                    className={`task-row ${urgencyClass(item.urgency)} ${excluded ? "opacity-55" : ""}`}
                    data-testid={`row-agenda-${item.taskId}`}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold tabular-nums">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug text-foreground">{item.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatAgendaSlot(item)} / {item.estimatedMinutes} min / {urgencyLabel(item.urgency)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-8 p-0"
                        aria-label="Move task earlier"
                        onClick={() => onMoveTask(item.taskId, "up")}
                        disabled={index === 0}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-8 p-0"
                        aria-label="Move task later"
                        onClick={() => onMoveTask(item.taskId, "down")}
                        disabled={index === agenda.length - 1}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onToggleTask(item.taskId)}
                        data-testid={`button-agenda-toggle-${item.taskId}`}
                      >
                        {excluded ? "Add" : "Remove"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

function AgendaWorkDialog({
  open,
  onOpenChange,
  agenda,
  tasks,
  users,
  subtasks = [],
  authenticated = false,
  onPinTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agenda: AgendaItem[];
  tasks: Task[];
  users: User[];
  subtasks?: TaskSubtask[];
  authenticated?: boolean;
  onPinTask: (taskId: Id) => void;
}) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((task) => String(task.id) === selectedTaskId) ?? null;
  const totalMinutes = agenda.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const scheduledCount = agenda.filter((item) => item.scheduleStatus === "scheduled").length;
  const nextItem = agenda.find((item) => item.scheduleStatus === "scheduled") ?? agenda[0] ?? null;
  const nextTask = nextItem ? tasks.find((task) => String(task.id) === String(nextItem.taskId)) ?? null : null;

  useEffect(() => {
    if (!open) setSelectedTaskId(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} sm:max-w-3xl`}>
        <DialogHeader className={dialogHeaderClass}>
          <DialogTitle>Daily agenda</DialogTitle>
          <DialogDescription>
            Work through approved agenda blocks in order. Pin a task to keep notes open while working.
          </DialogDescription>
        </DialogHeader>
        <div className={`${dialogBodyClass} space-y-3`}>
          <div className="grid gap-2 sm:grid-cols-3">
            <ReportMetric label="Agenda items" value={String(agenda.length)} />
            <ReportMetric label="Scheduled" value={String(scheduledCount)} />
            <ReportMetric label="Total time" value={`${totalMinutes}m`} />
          </div>
          {agenda.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Build and approve an agenda before opening the work screen.
            </p>
          ) : (
            <div className="space-y-3">
              {nextItem && (
                <div className="rounded-md border border-brand-green/30 bg-brand-green-pale/40 px-3 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="ui-label">Up next</p>
                      <h4 className="mt-1 truncate text-sm font-semibold text-foreground">{nextItem.title}</h4>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatAgendaSlot(nextItem)} / {nextItem.estimatedMinutes} min
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => nextTask && setSelectedTaskId(String(nextTask.id))}
                        disabled={!nextTask}
                      >
                        <Eye className="size-4" />
                        Open
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          onPinTask(nextItem.taskId);
                          toast({ title: "Task pinned", description: "The work box is ready for notes." });
                        }}
                      >
                        <Play className="size-4" />
                        Work
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              <ol className="space-y-2">
              {agenda.map((item, index) => {
                const task = tasks.find((candidate) => String(candidate.id) === String(item.taskId));
                const taskSubtasks = subtasks.filter((subtask) => String(subtask.taskId) === String(item.taskId));
                const doneSubtasks = taskSubtasks.filter((subtask) => subtask.done).length;
                const progressPct =
                  taskSubtasks.length > 0
                    ? Math.round((doneSubtasks / taskSubtasks.length) * 100)
                    : task?.status === "completed"
                      ? 100
                      : task?.status === "accepted"
                        ? 20
                        : 0;
                return (
                  <li key={`${item.taskId}-${item.order}`} className={`task-row ${urgencyClass(item.urgency)}`}>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold tabular-nums">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug text-foreground">{item.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatAgendaSlot(item)} / {item.estimatedMinutes} min / {urgencyLabel(item.urgency)}
                      </p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-brand-green" style={{ width: `${progressPct}%` }} />
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => task && setSelectedTaskId(String(task.id))}
                        disabled={!task}
                        data-testid={`button-agenda-work-open-${item.taskId}`}
                      >
                        <Eye className="size-4" />
                        Open
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          onPinTask(item.taskId);
                          toast({ title: "Task pinned", description: "The work box is ready for notes." });
                        }}
                      >
                        <Play className="size-4" />
                        Work
                      </Button>
                    </div>
                  </li>
                );
              })}
              </ol>
            </div>
          )}
        </div>
        <DialogFooter className={dialogFooterClass}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
      <TaskDetailDialog
        task={selectedTask}
        users={users}
        subtasks={subtasks}
        authenticated={authenticated}
        open={Boolean(selectedTask)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedTaskId(null);
        }}
      />
    </Dialog>
  );
}

function ReportingPanel({
  tasks,
  suggestions,
  currentUserId,
}: {
  tasks: Task[];
  suggestions: EmailSuggestion[];
  currentUserId: Id;
}) {
  const now = new Date();
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === "completed");
  const incomplete = tasks.filter((task) => task.status !== "completed" && task.status !== "denied");
  const overdue = incomplete.filter((task) => task.dueDate && new Date(`${task.dueDate}T23:59:59`) < now);
  const delegatedOutstanding = incomplete.filter(
    (task) => String(task.assignedById) === String(currentUserId) && String(task.assignedToId) !== String(currentUserId),
  );
  const completionDurations = completed
    .map((task) => {
      if (!task.completedAt) return null;
      const start = Date.parse(task.createdAt);
      const end = Date.parse(task.completedAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
      return end - start;
    })
    .filter((value): value is number => value !== null);
  const avgHours =
    completionDurations.length > 0
      ? completionDurations.reduce((sum, value) => sum + value, 0) / completionDurations.length / 36e5
      : null;
  const incompletePct = total > 0 ? Math.round((incomplete.length / total) * 100) : 0;
  const reviewedSuggestions = suggestions.filter((suggestion) => suggestion.status !== "pending");
  const approvedSuggestions = suggestions.filter((suggestion) => suggestion.status === "approved");
  const dismissedSuggestions = suggestions.filter((suggestion) => suggestion.status === "dismissed");
  const approvalRate =
    reviewedSuggestions.length > 0
      ? Math.round((approvedSuggestions.length / reviewedSuggestions.length) * 100)
      : null;
  const bySource = tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.source] = (acc[task.source] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="panel" data-testid="panel-reporting" id="panel-reporting">
      <div className="border-b border-border px-4 py-3">
        <h3 className="display-font text-sm font-bold">Manager report</h3>
        <p className="ui-label mt-1">Completion, overdue, delegated</p>
      </div>
      <div className="grid grid-cols-2 gap-2 px-4 py-3">
        <ReportMetric label="Incomplete" value={`${incompletePct}%`} />
        <ReportMetric label="Overdue" value={String(overdue.length)} />
        <ReportMetric label="Delegated" value={String(delegatedOutstanding.length)} />
        <ReportMetric label="Avg done" value={avgHours === null ? "N/A" : `${avgHours < 1 ? Math.round(avgHours * 60) + "m" : avgHours.toFixed(1) + "h"}`} />
        <ReportMetric label="Accepted AI" value={approvalRate === null ? "N/A" : `${approvalRate}%`} />
        <ReportMetric label="Dismissed" value={String(dismissedSuggestions.length)} />
      </div>
      {Object.keys(bySource).length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <p className="ui-label mb-2">Source mix</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(bySource).map(([source, count]) => (
              <span key={source} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                {source}: {count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TeamViewPanel({
  tasks,
  suggestions,
  events,
  users,
  subtasks = [],
  authenticated = false,
  currentUserId,
}: {
  tasks: Task[];
  suggestions: EmailSuggestion[];
  events: TaskEvent[];
  users: User[];
  subtasks?: TaskSubtask[];
  authenticated?: boolean;
  currentUserId: Id;
}) {
  const currentUser = users.find((user) => String(user.id) === String(currentUserId));
  const canViewTeam = Boolean(currentUser && ["owner", "admin", "manager"].includes(currentUser.role));
  const teamMembers = users.filter((user) => {
    if (!currentUser) return false;
    if (currentUser.role === "owner" || currentUser.role === "admin") return String(user.id) !== String(currentUserId);
    return String(user.managerId) === String(currentUserId);
  });
  const [selectedUserId, setSelectedUserId] = useState(String(teamMembers[0]?.id ?? ""));
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<"7d" | "30d" | "all">("30d");
  const urgencyRankClient = (urgency: string) =>
    urgency === "critical" ? 0 : urgency === "high" ? 1 : urgency === "normal" || urgency === "medium" ? 2 : 3;

  useEffect(() => {
    if (!teamMembers.some((member) => String(member.id) === selectedUserId)) {
      setSelectedUserId(String(teamMembers[0]?.id ?? ""));
    }
  }, [selectedUserId, teamMembers]);

  if (!canViewTeam) return null;
  const member = teamMembers.find((user) => String(user.id) === selectedUserId) ?? teamMembers[0];
  const memberTasks = member ? tasks.filter((task) => String(task.assignedToId) === String(member.id)) : [];
  const active = memberTasks.filter((task) => task.status !== "completed" && task.status !== "denied");
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date();
  soon.setDate(soon.getDate() + 2);
  const soonIso = soon.toISOString().slice(0, 10);
  const sinceDate = (() => {
    if (timeframe === "all") return null;
    const days = timeframe === "7d" ? 7 : 30;
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  })();
  const inTimeframe = (iso: string | null | undefined) => {
    if (!sinceDate || !iso) return true;
    return iso.slice(0, 10) >= sinceDate;
  };
  const overdue = active.filter((task) => task.dueDate && task.dueDate < today);
  const dueSoon = active.filter((task) => task.dueDate && task.dueDate >= today && task.dueDate <= soonIso);
  const completed = memberTasks.filter((task) => task.status === "completed");
  const completedInRange = completed.filter((task) => inTimeframe(task.completedAt ?? task.createdAt));
  const delegated = active.filter((task) => task.delegatedToId);
  const pendingAcceptance = active.filter((task) => task.status === "pending_acceptance");
  const workloadMinutes = active.reduce((sum, task) => sum + task.estimatedMinutes, 0);
  const reviewedSuggestions = suggestions.filter(
    (suggestion) =>
      suggestion.status !== "pending" &&
      (!member || String(suggestion.assignedToId ?? "") === String(member.id)) &&
      inTimeframe(suggestion.createdAt),
  );
  const approvedSuggestions = reviewedSuggestions.filter((suggestion) => suggestion.status === "approved");
  const approvalRate =
    reviewedSuggestions.length > 0
      ? Math.round((approvedSuggestions.length / reviewedSuggestions.length) * 100)
      : null;
  const sourceMix = memberTasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.source] = (acc[task.source] ?? 0) + 1;
    return acc;
  }, {});
  const sourceTotal = Math.max(1, Object.values(sourceMix).reduce((sum, count) => sum + count, 0));
  const teamStats = teamMembers.map((user) => {
    const owned = tasks.filter((task) => String(task.assignedToId) === String(user.id));
    const open = owned.filter((task) => task.status !== "completed" && task.status !== "denied");
    const userOverdue = open.filter((task) => task.dueDate && task.dueDate < today);
    const userDueSoon = open.filter((task) => task.dueDate && task.dueDate >= today && task.dueDate <= soonIso);
    const userWorkload = open.reduce((sum, task) => sum + task.estimatedMinutes, 0);
    const attention = userOverdue.length * 3 + userDueSoon.length + open.filter((task) => task.urgency === "critical" || task.urgency === "high").length * 2;
    return { user, open, overdue: userOverdue, dueSoon: userDueSoon, workload: userWorkload, attention };
  });
  const teamOpen = teamStats.reduce((sum, item) => sum + item.open.length, 0);
  const teamOverdue = teamStats.reduce((sum, item) => sum + item.overdue.length, 0);
  const teamDueSoon = teamStats.reduce((sum, item) => sum + item.dueSoon.length, 0);
  const attentionQueue = active
    .filter(
      (task) =>
        (task.dueDate && task.dueDate <= soonIso) ||
        task.urgency === "critical" ||
        task.urgency === "high" ||
        task.status === "pending_acceptance",
    )
    .sort((a, b) => {
      const aOverdue = a.dueDate && a.dueDate < today ? 0 : 1;
      const bOverdue = b.dueDate && b.dueDate < today ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      const urgencyDiff = (urgencyRankClient(a.urgency) - urgencyRankClient(b.urgency));
      if (urgencyDiff !== 0) return urgencyDiff;
      return (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
    });
  const visibleTasks = attentionQueue.length > 0 ? attentionQueue : active;
  const selectedTask = tasks.find((task) => String(task.id) === selectedTaskId) ?? null;
  const seedDemoTeam = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/seed-demo-team"),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({
        title: "Demo team added",
        description: "The Team dashboard now has sample members and tasks to test.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not add demo team",
        description: apiErrorMessage(error, "Confirm you are an admin and SUPABASE_SERVICE_ROLE_KEY is set."),
        variant: "destructive",
      });
    },
  });
  const requestUpdate = useMutation({
    mutationFn: async ({ task, owner }: { task: Task; owner?: User }) =>
      apiRequest("POST", `/api/tasks/${task.id}/request-update`, {
        note: `Please add a status update for ${task.title}${owner ? `, ${owner.name}` : ""}.`,
      }),
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({
        title: "Update requested",
        description: "The request was added to the task history.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not request update",
        description: apiErrorMessage(error, "Try requesting the update again."),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="panel" data-testid="panel-team-view">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="display-font text-sm font-bold">Team</h3>
            <p className="ui-label mt-1">Support, coverage, attention</p>
          </div>
          <Users className="size-4 text-brand-green" />
        </div>
      </div>
      <div className="space-y-3 px-4 py-3">
        {teamMembers.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-4 text-center">
            <Users className="mx-auto size-6 text-brand-green" />
            <p className="mt-2 text-sm font-medium text-foreground">No team members yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add sample members to test manager reporting before inviting real users.
            </p>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => seedDemoTeam.mutate()}
              disabled={seedDemoTeam.isPending}
              data-testid="button-seed-demo-team"
            >
              {seedDemoTeam.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              Add demo team
            </Button>
          </div>
        ) : (
          <>
            <select
              value={String(member?.id ?? "")}
              onChange={(event) => setSelectedUserId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="select-team-member"
            >
              {teamMembers.map((user) => (
                <option key={String(user.id)} value={String(user.id)}>
                  {user.name}
                </option>
              ))}
            </select>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <ReportMetric label="Team open" value={String(teamOpen)} />
              <ReportMetric label="Overdue" value={String(teamOverdue)} />
              <ReportMetric label="Due soon" value={String(teamDueSoon)} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="ui-label">Team workload</p>
                <select
                  value={timeframe}
                  onChange={(event) => setTimeframe(event.target.value as "7d" | "30d" | "all")}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  data-testid="select-team-timeframe"
                >
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                  <option value="all">All time</option>
                </select>
              </div>
              <div className="space-y-1.5">
                {teamStats
                  .sort((a, b) => b.attention - a.attention || b.workload - a.workload)
                  .slice(0, 5)
                  .map((item) => {
                    const selected = String(item.user.id) === String(member?.id);
                    return (
                      <button
                        key={String(item.user.id)}
                        type="button"
                        onClick={() => setSelectedUserId(String(item.user.id))}
                        className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs transition ${
                          selected ? "border-brand-green bg-brand-green/5" : "border-border bg-background hover:border-brand-green/60"
                        }`}
                        data-testid={`button-team-member-${item.user.id}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{item.user.name}</span>
                          <span className="block truncate text-muted-foreground">
                            {item.open.length} open / {Math.round(item.workload / 60)}h planned
                          </span>
                        </span>
                        <span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
                          item.overdue.length > 0
                            ? "bg-destructive/10 text-destructive"
                            : item.dueSoon.length > 0
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              : "bg-muted text-muted-foreground"
                        }`}>
                          {item.overdue.length > 0 ? `${item.overdue.length} overdue` : `${item.dueSoon.length} soon`}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <ReportMetric label="Open" value={String(active.length)} />
              <ReportMetric label="Past due" value={String(overdue.length)} />
              <ReportMetric label="Done" value={String(completedInRange.length)} />
              <ReportMetric label="Delegated" value={String(delegated.length)} />
              <ReportMetric label="Pending" value={String(pendingAcceptance.length)} />
              <ReportMetric label="AI accepted" value={approvalRate === null ? "N/A" : `${approvalRate}%`} />
            </div>

            {member && (
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">{member.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {workloadMinutes < 60 ? `${workloadMinutes} min` : `${(workloadMinutes / 60).toFixed(1)}h`} active workload / {completedInRange.length} completed in view
                    </p>
                  </div>
                  <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                    {member.role}
                  </span>
                </div>
              </div>
            )}

            {Object.keys(sourceMix).length > 0 && (
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="ui-label mb-2">Source mix</p>
                <div className="space-y-2">
                  {Object.entries(sourceMix)
                    .sort((a, b) => b[1] - a[1])
                    .map(([source, count]) => (
                      <div key={source} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="capitalize text-foreground">{source}</span>
                          <span className="text-muted-foreground">{count}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-brand-green"
                            style={{ width: `${Math.max(8, Math.round((count / sourceTotal) * 100))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="ui-label">Needs attention</p>
                <span className="text-xs text-muted-foreground">{visibleTasks.length} item{visibleTasks.length === 1 ? "" : "s"}</span>
              </div>
              {visibleTasks.slice(0, 7).map((task) => {
                const taskSubtasks = subtasks.filter((subtask) => String(subtask.taskId) === String(task.id));
                const doneSubtasks = taskSubtasks.filter((subtask) => subtask.done).length;
                const lastEvent = events.find((event) => String(event.taskId) === String(task.id));
                const progressPct =
                  taskSubtasks.length > 0
                    ? Math.round((doneSubtasks / taskSubtasks.length) * 100)
                    : task.status === "completed"
                      ? 100
                      : task.status === "accepted"
                        ? 35
                        : task.status === "pending_acceptance"
                          ? 10
                          : 20;
                return (
                  <div
                    key={String(task.id)}
                    className={`w-full rounded-md border border-border bg-background px-3 py-2 text-left text-xs transition hover:border-brand-green/60 ${urgencyClass(task.urgency)}`}
                    data-testid={`button-team-task-${task.id}`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTaskId(String(task.id))}
                      className="block w-full text-left"
                    >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{task.title}</span>
                        <span className="mt-0.5 block truncate text-muted-foreground">
                          {task.dueDate ?? "No due date"} / {urgencyLabel(task.urgency)} / {task.estimatedMinutes} min
                        </span>
                      </span>
                      <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                        {statusLabels[task.status] ?? task.status}
                      </span>
                    </span>
                    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-brand-green"
                        style={{ width: `${progressPct}%` }}
                      />
                    </span>
                    {(task.description || task.completionNotes || taskSubtasks.length > 0 || lastEvent) && (
                      <span className="mt-1 block truncate text-muted-foreground">
                        {taskSubtasks.length > 0
                          ? `${doneSubtasks}/${taskSubtasks.length} subtasks`
                          : task.completionNotes || task.description || lastEvent?.note}
                      </span>
                    )}
                    </button>
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
                      <span className="text-[11px] text-muted-foreground">
                        {lastEvent ? `Last: ${lastEvent.type.replace(/_/g, " ")}` : "No updates yet"}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => requestUpdate.mutate({ task, owner: member ?? undefined })}
                        disabled={requestUpdate.isPending}
                        data-testid={`button-team-request-update-${task.id}`}
                      >
                        {requestUpdate.isPending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                        Request update
                      </Button>
                    </div>
                  </div>
                );
              })}
              {active.length === 0 && (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-sm text-muted-foreground">
                  No active tasks for this team member.
                </p>
              )}
            </div>
          </>
        )}
      </div>
      <TaskDetailDialog
        task={selectedTask}
        users={users}
        subtasks={subtasks}
        events={events}
        authenticated={authenticated}
        open={Boolean(selectedTask)}
        onOpenChange={(open) => {
          if (!open) setSelectedTaskId(null);
        }}
      />
    </div>
  );
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <p className="ui-label">{label}</p>
      <p className="display-font mt-1 text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

function PositionProfilesPanel({
  profiles,
  users,
  currentUserId,
  authenticated,
}: {
  profiles: PositionProfile[];
  users: User[];
  currentUserId: Id;
  authenticated: boolean;
}) {
  const currentUser = users.find((user) => String(user.id) === String(currentUserId));
  const canManageProfiles = canAdministerProfiles(currentUser);
  const [customProfileMetas, setCustomProfileMetas] = useState<Array<{ id: string; title: string; ownerId: string }>>(() => {
    try {
      if (typeof window === "undefined") return [];
      return JSON.parse(window.localStorage.getItem("donnit.customPositionProfiles") ?? "[]");
    } catch {
      return [];
    }
  });
  const [deletedProfileIds, setDeletedProfileIds] = useState<Set<string>>(() => {
    try {
      if (typeof window === "undefined") return new Set();
      return new Set(JSON.parse(window.localStorage.getItem("donnit.deletedPositionProfiles") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [renamedProfileTitles, setRenamedProfileTitles] = useState<Record<string, string>>(() => {
    try {
      if (typeof window === "undefined") return {};
      return JSON.parse(window.localStorage.getItem("donnit.renamedPositionProfiles") ?? "{}");
    } catch {
      return {};
    }
  });
  const [newProfileTitle, setNewProfileTitle] = useState("");
  const [newProfileOwnerId, setNewProfileOwnerId] = useState(String(users[0]?.id ?? ""));
  const [viewMode, setViewMode] = useState<"list" | "detail">("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [assignmentFocus, setAssignmentFocus] = useState<"delegate" | "transfer" | null>(null);
  const customProfiles = useMemo(
    () =>
      customProfileMetas
        .map((meta) => {
          const owner = users.find((user) => String(user.id) === meta.ownerId) ?? users[0];
          if (!owner) return null;
          const base = profiles.find((profile) => String(profile.owner.id) === String(owner.id));
          return {
            ...(base ?? {
              persisted: false,
              currentIncompleteTasks: [],
              recurringTasks: [],
              completedTasks: [],
              criticalDates: [],
              howTo: [],
              tools: [],
              stakeholders: [],
              riskScore: 0,
              riskLevel: "low" as const,
              riskReasons: [],
              transitionChecklist: [
                "Assign an owner for this job title.",
                "Add recurring responsibilities as they are discovered.",
                "Attach tool access and account ownership details.",
              ],
              lastUpdatedAt: null,
              status: "active" as const,
              directManagerId: owner.managerId,
              temporaryOwnerId: null,
              delegateUserId: null,
              delegateUntil: null,
            }),
            id: meta.id,
            title: meta.title,
            owner,
          } satisfies PositionProfile;
        })
        .filter((profile): profile is PositionProfile => Boolean(profile)),
    [customProfileMetas, profiles, users],
  );
  const repositoryProfiles = useMemo(
    () => {
      if (authenticated) return [...profiles].sort((a, b) => a.title.localeCompare(b.title));
      return [
        ...profiles
          .filter((profile) => !deletedProfileIds.has(profile.id))
          .map((profile) => ({ ...profile, title: renamedProfileTitles[profile.id] ?? profile.title })),
        ...customProfiles,
      ].sort((a, b) => a.title.localeCompare(b.title));
    },
    [authenticated, customProfiles, deletedProfileIds, profiles, renamedProfileTitles],
  );
  const [selectedProfileId, setSelectedProfileId] = useState(repositoryProfiles[0]?.id ?? "");
  const selectedProfile = repositoryProfiles.find((profile) => profile.id === selectedProfileId);
  const targetUsers = useMemo(
    () => users.filter((user) => selectedProfile && String(user.id) !== String(selectedProfile.owner.id)),
    [selectedProfile, users],
  );
  const [targetUserId, setTargetUserId] = useState("");
  const [mode, setMode] = useState<"delegate" | "transfer">("delegate");
  const [delegateUntil, setDelegateUntil] = useState("");

  useEffect(() => {
    if (repositoryProfiles.length === 0) {
      if (selectedProfileId) setSelectedProfileId("");
      setViewMode("list");
      return;
    }
    if (!repositoryProfiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(repositoryProfiles[0].id);
    }
  }, [repositoryProfiles, selectedProfileId]);

  useEffect(() => {
    if (!selectedProfile) {
      setTargetUserId("");
      return;
    }
    const fallback = targetUsers.find((user) => String(user.id) === String(currentUserId)) ?? targetUsers[0];
    setTargetUserId(fallback ? String(fallback.id) : "");
  }, [selectedProfile?.id, currentUserId, targetUsers]);

  const createProfile = useMutation({
    mutationFn: async (input: { title: string; ownerId: Id | null; status?: "active" | "vacant" | "covered" }) => {
      const res = await apiRequest("POST", "/api/position-profiles", {
        title: input.title,
        ownerId: input.ownerId === null ? null : String(input.ownerId),
        status: input.status,
      });
      return (await res.json()) as PersistedPositionProfile;
    },
    onSuccess: async (profile) => {
      await invalidateWorkspace();
      setSelectedProfileId(profile.id);
      setViewMode("detail");
      toast({ title: "Position Profile saved", description: `${profile.title} is now a durable admin record.` });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not save Position Profile",
        description: error instanceof Error ? error.message : "Apply the Position Profiles migration and try again.",
        variant: "destructive",
      });
    },
  });

  const updateProfile = useMutation({
    mutationFn: async (input: { id: string; patch: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/position-profiles/${input.id}`, input.patch);
      return (await res.json()) as PersistedPositionProfile;
    },
    onSuccess: async (profile) => {
      await invalidateWorkspace();
      setSelectedProfileId(profile.id);
      toast({ title: "Position Profile updated", description: `${profile.title} was saved.` });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not update Position Profile",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const deletePersistedProfile = useMutation({
    mutationFn: async (profileId: string) => apiRequest("DELETE", `/api/position-profiles/${profileId}`),
    onSuccess: async () => {
      await invalidateWorkspace();
      setSelectedProfileId("");
      setViewMode("list");
      toast({ title: "Position Profile deleted", description: "The saved admin record was removed." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not delete Position Profile",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const persistCustomProfiles = (next: Array<{ id: string; title: string; ownerId: string }>) => {
    setCustomProfileMetas(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("donnit.customPositionProfiles", JSON.stringify(next));
    }
  };
  const persistDeletedProfiles = (next: Set<string>) => {
    setDeletedProfileIds(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("donnit.deletedPositionProfiles", JSON.stringify(Array.from(next)));
    }
  };
  const persistRenamedProfiles = (next: Record<string, string>) => {
    setRenamedProfileTitles(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("donnit.renamedPositionProfiles", JSON.stringify(next));
    }
  };
  const renameProfile = (profileId: string, title: string) => {
    const trimmed = title.trim();
    if (trimmed.length < 2) return;
    if (authenticated) {
      const profile = repositoryProfiles.find((item) => item.id === profileId);
      if (!profile) return;
      if (profile.persisted) {
        updateProfile.mutate({ id: profile.id, patch: { title: trimmed } });
      } else {
        createProfile.mutate({ title: trimmed, ownerId: profile.owner.id, status: profile.status });
      }
      return;
    }
    if (profileId.startsWith("custom-position-")) {
      persistCustomProfiles(
        customProfileMetas.map((profile) => (profile.id === profileId ? { ...profile, title: trimmed } : profile)),
      );
      return;
    }
    persistRenamedProfiles({ ...renamedProfileTitles, [profileId]: trimmed });
  };
  const addProfile = () => {
    const title = newProfileTitle.trim();
    if (!title) return;
    if (authenticated) {
      createProfile.mutate({
        title,
        ownerId: newProfileOwnerId || null,
        status: newProfileOwnerId ? "active" : "vacant",
      });
      setNewProfileTitle("");
      setCreateOpen(false);
      return;
    }
    if (!newProfileOwnerId) return;
    const id = `custom-position-${Date.now()}`;
    persistCustomProfiles([...customProfileMetas, { id, title, ownerId: newProfileOwnerId }]);
    setSelectedProfileId(id);
    setNewProfileTitle("");
    setCreateOpen(false);
    setViewMode("detail");
  };
  const deleteProfile = () => {
    if (!selectedProfile) return;
    if (authenticated) {
      if (!selectedProfile.persisted) {
        toast({
          title: "Generated profile cannot be deleted",
          description: "This profile is generated from active task history. Rename or create it first to save an admin record.",
        });
        return;
      }
      deletePersistedProfile.mutate(selectedProfile.id);
      return;
    }
    if (selectedProfile.id.startsWith("custom-position-")) {
      persistCustomProfiles(customProfileMetas.filter((profile) => profile.id !== selectedProfile.id));
    } else {
      const next = new Set(deletedProfileIds);
      next.add(selectedProfile.id);
      persistDeletedProfiles(next);
    }
    setSelectedProfileId(repositoryProfiles.find((profile) => profile.id !== selectedProfile.id)?.id ?? "");
    setViewMode("list");
  };
  const openProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    setCreateOpen(false);
    setViewMode("detail");
  };
  const openAssignment = (nextMode: "delegate" | "transfer") => {
    setMode(nextMode);
    setAssignmentFocus(nextMode);
    setCreateOpen(false);
    if (!selectedProfile && repositoryProfiles[0]) {
      setSelectedProfileId(repositoryProfiles[0].id);
    }
    if (repositoryProfiles.length > 0) {
      setViewMode("detail");
    }
  };

  const assign = useMutation({
    mutationFn: async () => {
      if (!selectedProfile || !targetUserId) throw new Error("Choose a profile and target user.");
      let profileId = selectedProfile.persisted ? selectedProfile.id : undefined;
      if (authenticated && !profileId) {
        const createRes = await apiRequest("POST", "/api/position-profiles", {
          title: selectedProfile.title,
          ownerId: String(selectedProfile.owner.id),
          status: selectedProfile.status,
        });
        const created = (await createRes.json()) as PersistedPositionProfile;
        profileId = created.id;
      }
      const res = await apiRequest("POST", "/api/position-profiles/assign", {
        profileId,
        fromUserId: selectedProfile.owner.id,
        toUserId: targetUserId,
        mode,
        delegateUntil: delegateUntil || null,
        profileTitle: selectedProfile.title,
      });
      return (await res.json()) as { ok: boolean; updated: number; mode: string; profile?: PersistedPositionProfile | null };
    },
    onSuccess: async (result) => {
      await invalidateWorkspace();
      if (result.profile?.id) setSelectedProfileId(result.profile.id);
      toast({
        title: mode === "transfer" ? "Profile transferred" : "Coverage delegated",
        description: `${result.updated} active task${result.updated === 1 ? "" : "s"} updated for ${selectedProfile?.title ?? "the profile"}.`,
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not assign profile",
        description: error instanceof Error ? error.message : "Check the profile assignment and try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="rounded-md border border-border" data-testid="panel-position-profiles">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="display-font text-sm font-bold">Position Profiles</h3>
            <p className="ui-label mt-1">Admin repository by job title</p>
          </div>
          <BriefcaseBusiness className="size-4 text-brand-green" />
        </div>
      </div>
      <div className="space-y-3 px-4 py-3">
        {!canManageProfiles && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Position Profiles are restricted to admins.
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              setCreateOpen((open) => !open);
              setViewMode("list");
            }}
            disabled={!canManageProfiles}
            data-testid="button-position-profile-create"
          >
            <ListPlus className="size-4" />
            Create Position Profile
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openAssignment("transfer")}
            disabled={!canManageProfiles || repositoryProfiles.length === 0}
            data-testid="button-position-profile-reassign"
          >
            <UserCog className="size-4" />
            Reassign Position Profile
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openAssignment("delegate")}
            disabled={!canManageProfiles || repositoryProfiles.length === 0}
            data-testid="button-position-profile-delegate"
          >
            <UserPlus className="size-4" />
            Delegate Access
          </Button>
        </div>
        {canManageProfiles && (
          <div className={`${createOpen ? "block" : "hidden"} rounded-md border border-border bg-background px-3 py-3`}>
            <p className="mb-2 text-xs font-medium text-foreground">Create a job-title profile</p>
            <div className="grid gap-2">
              <Input
                value={newProfileTitle}
                onChange={(event) => setNewProfileTitle(event.target.value)}
                placeholder="Executive Assistant to the CEO"
                maxLength={160}
                data-testid="input-position-profile-title"
              />
              <select
                value={newProfileOwnerId}
                onChange={(event) => setNewProfileOwnerId(event.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="select-position-profile-owner"
              >
                {authenticated && <option value="">Vacant / no current owner</option>}
                {users.map((user) => (
                  <option key={String(user.id)} value={String(user.id)}>
                    {user.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={addProfile}
                disabled={newProfileTitle.trim().length < 2 || createProfile.isPending}
                data-testid="button-position-profile-add"
              >
                {createProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />}
                Add profile
              </Button>
            </div>
          </div>
        )}

        {viewMode === "list" || !selectedProfile ? (
          <div className="space-y-2">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Current Position Profiles</h4>
              <p className="text-xs text-muted-foreground">
                Click a job title to view institutional memory, current work, and transition controls.
              </p>
            </div>
            {repositoryProfiles.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-background px-3 py-6 text-center text-sm text-muted-foreground">
                No role memory yet. Create a profile or let Donnit build one as tasks are assigned and completed.
              </div>
            ) : (
              <div className="space-y-2" data-testid="position-profile-list">
                {repositoryProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => openProfile(profile.id)}
                    className="w-full rounded-md border border-border bg-background px-3 py-3 text-left transition hover:border-brand-green/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    data-testid={`position-profile-row-${profile.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{profile.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {profile.status === "vacant" ? "Vacant" : `Owner: ${profile.owner.name}`} - {profile.status}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase ${
                            profile.riskLevel === "high"
                              ? "bg-destructive/10 text-destructive"
                              : profile.riskLevel === "medium"
                                ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                : "bg-brand-green/10 text-brand-green"
                          }`}
                        >
                          Risk {profile.riskScore}
                        </span>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                          {profile.persisted ? "Saved" : "Generated"}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-5">
                      <span className="rounded-md bg-muted px-2 py-2">
                        <strong className="block text-foreground">{profile.currentIncompleteTasks.length}</strong>
                        open
                      </span>
                      <span className="rounded-md bg-muted px-2 py-2">
                        <strong className="block text-foreground">{profile.recurringTasks.length}</strong>
                        recurring
                      </span>
                      <span className="rounded-md bg-muted px-2 py-2">
                        <strong className="block text-foreground">{profile.completedTasks.length}</strong>
                        learned
                      </span>
                      <span className="rounded-md bg-muted px-2 py-2">
                        <strong className="block text-foreground">{profile.tools.length}</strong>
                        tools
                      </span>
                      <span className="rounded-md bg-muted px-2 py-2">
                        <strong className="block text-foreground">{profile.stakeholders.length}</strong>
                        contacts
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAssignmentFocus(null);
                  setViewMode("list");
                }}
                data-testid="button-position-profile-list"
              >
                <BriefcaseBusiness className="size-4" />
                All profiles
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={deleteProfile}
                disabled={!canManageProfiles || deletePersistedProfile.isPending || (authenticated && !selectedProfile.persisted)}
                data-testid="button-position-profile-delete"
              >
                {deletePersistedProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                Delete
              </Button>
            </div>

            <div className="rounded-md border border-border bg-background px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{selectedProfile.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {selectedProfile.status === "vacant" ? "Vacant profile" : `Owner: ${selectedProfile.owner.name}`} - {selectedProfile.status} -{" "}
                    {selectedProfile.persisted ? "saved admin record" : "generated from task history"}
                  </p>
                </div>
                <span
                  className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase ${
                    selectedProfile.riskLevel === "high"
                      ? "bg-destructive/10 text-destructive"
                      : selectedProfile.riskLevel === "medium"
                        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        : "bg-brand-green/10 text-brand-green"
                  }`}
                >
                  Risk {selectedProfile.riskScore}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md bg-muted px-2 py-2">
                  <p className="font-semibold tabular-nums text-foreground">
                    {selectedProfile.currentIncompleteTasks.length}
                  </p>
                  <p className="text-muted-foreground">open</p>
                </div>
                <div className="rounded-md bg-muted px-2 py-2">
                  <p className="font-semibold tabular-nums text-foreground">{selectedProfile.recurringTasks.length}</p>
                  <p className="text-muted-foreground">recurring</p>
                </div>
                <div className="rounded-md bg-muted px-2 py-2">
                  <p className="font-semibold tabular-nums text-foreground">{selectedProfile.completedTasks.length}</p>
                  <p className="text-muted-foreground">learned</p>
                </div>
              </div>
              {canManageProfiles && (
                <div className="mt-3 space-y-1.5">
                  <Label htmlFor="position-profile-rename" className="ui-label">
                    Admin name
                  </Label>
                  <Input
                    id="position-profile-rename"
                    key={selectedProfile.id}
                    defaultValue={selectedProfile.title}
                    maxLength={160}
                    disabled={updateProfile.isPending || createProfile.isPending}
                    onBlur={(event) => renameProfile(selectedProfile.id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        renameProfile(selectedProfile.id, event.currentTarget.value);
                        event.currentTarget.blur();
                      }
                    }}
                    data-testid="input-position-profile-rename"
                  />
                </div>
              )}
              {canManageProfiles && authenticated && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {!selectedProfile.persisted ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        createProfile.mutate({
                          title: selectedProfile.title,
                          ownerId: selectedProfile.owner.id,
                          status: selectedProfile.status,
                        })
                      }
                      disabled={createProfile.isPending}
                      data-testid="button-position-profile-save-generated"
                    >
                      {createProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                      Save admin record
                    </Button>
                  ) : (
                    <>
                      <select
                        value={selectedProfile.status}
                        onChange={(event) =>
                          updateProfile.mutate({
                            id: selectedProfile.id,
                            patch: {
                              status: event.target.value,
                              currentOwnerId: event.target.value === "vacant" ? null : selectedProfile.owner.id,
                            },
                          })
                        }
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        data-testid="select-position-profile-status"
                      >
                        <option value="active">Active</option>
                        <option value="vacant">Vacant</option>
                        <option value="covered">Covered temporarily</option>
                      </select>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          updateProfile.mutate({
                            id: selectedProfile.id,
                            patch: {
                              status: "vacant",
                              currentOwnerId: null,
                              temporaryOwnerId: null,
                              delegateUserId: null,
                              delegateUntil: null,
                              riskSummary: "Marked vacant by admin. Use delegate access or transfer when coverage is assigned.",
                            },
                          })
                        }
                        disabled={updateProfile.isPending}
                        data-testid="button-position-profile-vacant"
                      >
                        {updateProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
                        Mark vacant
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>

            {selectedProfile.riskReasons.length > 0 && (
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <div className="mb-1 flex items-center gap-2">
                  <AlertTriangle className="size-4 text-muted-foreground" />
                  <p className="text-xs font-medium text-foreground">Continuity risk</p>
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {selectedProfile.riskReasons.slice(0, 3).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-md border border-border bg-background px-3 py-2">
              <p className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
                <ListChecks className="size-4 text-muted-foreground" />
                Transition checklist
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {selectedProfile.transitionChecklist.slice(0, 5).map((item) => (
                  <li key={item} className="flex gap-2">
                    <Check className="mt-0.5 size-3 shrink-0 text-brand-green" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {selectedProfile.currentIncompleteTasks.length > 0 && (
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="mb-2 text-xs font-medium text-foreground">Current incomplete work</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {selectedProfile.currentIncompleteTasks.slice(0, 4).map((task) => (
                    <li key={String(task.id)} className="truncate">
                      {task.dueDate ?? "No date"} - {task.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedProfile.recurringTasks.length > 0 && (
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
                  <Repeat2 className="size-4 text-muted-foreground" />
                  Recurring responsibilities
                </p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {selectedProfile.recurringTasks.slice(0, 4).map((task) => (
                    <li key={String(task.id)} className="truncate">
                      {inferTaskCadence(task)} - {task.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-md border border-border bg-background px-3 py-2">
              <p className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
                <HelpCircle className="size-4 text-muted-foreground" />
                How-to memory
              </p>
              {selectedProfile.howTo.length > 0 ? (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {selectedProfile.howTo.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Donnit needs richer notes on recurring tasks for this profile.
                </p>
              )}
            </div>

            <div className="rounded-md border border-border bg-background px-3 py-2">
              <p className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
                <KeyRound className="size-4 text-muted-foreground" />
                Tool access
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(selectedProfile.tools.length > 0 ? selectedProfile.tools : ["Credential vault pending"]).map((tool) => (
                  <span key={tool} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                    {tool}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-border bg-background px-3 py-3">
              <p className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
                <UserCog className="size-4 text-muted-foreground" />
                {assignmentFocus === "transfer"
                  ? "Reassign selected profile"
                  : assignmentFocus === "delegate"
                    ? "Delegate access"
                    : "Assign / reassign"}
              </p>
              <div className="grid gap-2">
                <select
                  value={mode}
                  onChange={(event) => {
                    const nextMode = event.target.value as "delegate" | "transfer";
                    setMode(nextMode);
                    setAssignmentFocus(nextMode);
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  data-testid="select-position-assignment-mode"
                >
                  <option value="delegate">Delegate coverage</option>
                  <option value="transfer">Transfer to new owner</option>
                </select>
                <select
                  value={targetUserId}
                  onChange={(event) => setTargetUserId(event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  data-testid="select-position-assignment-user"
                >
                  {targetUsers.map((user) => (
                    <option key={String(user.id)} value={String(user.id)}>
                      {user.name}
                    </option>
                  ))}
                </select>
                {mode === "delegate" && (
                  <Input
                    type="date"
                    value={delegateUntil}
                    onChange={(event) => setDelegateUntil(event.target.value)}
                    className="h-9 text-xs"
                    data-testid="input-position-delegate-until"
                  />
                )}
                <Button
                  size="sm"
                  onClick={() => assign.mutate()}
                  disabled={!targetUserId || assign.isPending || !canManageProfiles}
                  data-testid="button-position-assign"
                >
                  {assign.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserCog className="size-4" />}
                  {mode === "transfer" ? "Transfer profile" : "Start coverage"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AcceptancePanel({
  tasks,
  suggestions,
  onOpenInbox,
}: {
  tasks: Task[];
  suggestions: EmailSuggestion[];
  onOpenInbox: () => void;
}) {
  const waiting = tasks.filter((task) => task.status === "pending_acceptance");
  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");

  const VISIBLE_LIMIT = 2;
  const visibleWaiting = waiting.slice(0, VISIBLE_LIMIT);
  const remainingWaiting = Math.max(0, waiting.length - visibleWaiting.length);
  const remainingSuggestions = pendingSuggestions.length;
  const overflowParts: string[] = [];
  if (remainingWaiting > 0) {
    overflowParts.push(
      `+${remainingWaiting} more acceptance${remainingWaiting === 1 ? "" : "s"}`,
    );
  }
  if (remainingSuggestions > 0) {
    overflowParts.push(
      `+${remainingSuggestions} approval item${remainingSuggestions === 1 ? "" : "s"}`,
    );
  }
  const overflowLabel = overflowParts.length > 0 ? overflowParts.join(" · ") : null;

  const accept = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/tasks/${id}/accept`),
    onSuccess: invalidateWorkspace,
  });
  const deny = useMutation({
    mutationFn: async (id: Id) =>
      apiRequest("POST", `/api/tasks/${id}/deny`, { note: "Not the right owner." }),
    onSuccess: invalidateWorkspace,
  });
  const approveSuggestion = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/suggestions/${id}/approve`),
    onSuccess: invalidateWorkspace,
  });
  const dismissSuggestion = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/suggestions/${id}/dismiss`),
    onSuccess: invalidateWorkspace,
  });
  const updateSuggestion = useMutation({
    mutationFn: async ({ id, patch }: { id: Id; patch: SuggestionPatch }) =>
      apiRequest("PATCH", `/api/suggestions/${id}`, patch),
    onSuccess: invalidateWorkspace,
  });

  const visibleSuggestions = pendingSuggestions.slice(0, 3);
  const remainingSuggestionsAfterVisible = Math.max(
    0,
    pendingSuggestions.length - visibleSuggestions.length,
  );

  return (
    <div className="panel" data-testid="panel-acceptance">
      <div className="border-b border-border px-4 py-3">
        <h3 className="display-font text-sm font-bold">Waiting on you</h3>
        <p className="ui-label mt-1">Acceptances and approval queue</p>
      </div>
      <div className="space-y-3 px-4 py-3">
        {waiting.length === 0 && pendingSuggestions.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing waiting. Nice.</p>
        )}

        {visibleWaiting.map((task) => (
          <div
            key={task.id}
            className={`task-row ${urgencyClass(task.urgency)} flex-col items-stretch`}
            data-testid={`row-waiting-${task.id}`}
          >
            <p className="text-sm font-medium text-foreground break-words">{task.title}</p>
            <p className="text-xs text-muted-foreground">{task.dueDate ?? "No due date"}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => accept.mutate(task.id)}
                data-testid={`button-accept-${task.id}`}
              >
                <Check className="size-4" /> Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => deny.mutate(task.id)}
                data-testid={`button-deny-${task.id}`}
              >
                <X className="size-4" /> Deny
              </Button>
            </div>
          </div>
        ))}

        {visibleSuggestions.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="ui-label text-[10px] uppercase tracking-wider text-muted-foreground">
              Approval queue
            </p>
            {visibleSuggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                onApprove={() => approveSuggestion.mutate(suggestion.id)}
                onDismiss={() => dismissSuggestion.mutate(suggestion.id)}
                onSaveEdits={(id, patch) => updateSuggestion.mutate({ id, patch })}
                approving={approveSuggestion.isPending}
                dismissing={dismissSuggestion.isPending}
                saving={updateSuggestion.isPending}
              />
            ))}
          </div>
        )}

        {(overflowLabel || remainingSuggestionsAfterVisible > 0) && (
          <button
            type="button"
            onClick={onOpenInbox}
            className="flex w-full items-center justify-between rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-brand-green hover:text-foreground"
            data-testid="button-waiting-overflow"
          >
            <span className="inline-flex items-center gap-1.5">
              <MailPlus className="size-3.5" />
              {overflowLabel ??
                `+${remainingSuggestionsAfterVisible} approval item${
                  remainingSuggestionsAfterVisible === 1 ? "" : "s"
                }`}
            </span>
            <span className="ui-label">Open</span>
          </button>
        )}
      </div>
    </div>
  );
}

function formatReceivedAt(value: string | null | undefined): string {
  if (!value) return "Unknown date";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value.slice(0, 24);
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseSuggestionInsight(actionItems: string[]) {
  const take = (prefix: string) => {
    const found = actionItems.find((item) => item.toLowerCase().startsWith(prefix.toLowerCase()));
    return found ? found.slice(prefix.length).trim() : null;
  };
  const metaPrefixes = [
    "Why Donnit suggested this:",
    "Confidence:",
    "Estimated time:",
    "Source excerpt:",
  ];
  return {
    why: take("Why Donnit suggested this:"),
    confidence: take("Confidence:"),
    estimate: take("Estimated time:"),
    excerpt: take("Source excerpt:"),
    nextSteps: actionItems.filter(
      (item) => !metaPrefixes.some((prefix) => item.toLowerCase().startsWith(prefix.toLowerCase())),
    ),
  };
}

function SuggestionCard({
  suggestion,
  onApprove,
  onDismiss,
  onSaveEdits,
  approving,
  dismissing,
  saving,
}: {
  suggestion: EmailSuggestion;
  onApprove: () => void;
  onDismiss: () => void;
  onSaveEdits?: (id: Id, patch: SuggestionPatch) => void;
  approving: boolean;
  dismissing: boolean;
  saving?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [draftTitle, setDraftTitle] = useState(suggestion.suggestedTitle);
  const [draftDueDate, setDraftDueDate] = useState(suggestion.suggestedDueDate ?? "");
  const [draftUrgency, setDraftUrgency] = useState<"low" | "normal" | "high" | "critical">(
    ["low", "normal", "high", "critical"].includes(suggestion.urgency)
      ? (suggestion.urgency as "low" | "normal" | "high" | "critical")
      : "normal",
  );
  const [draftPreview, setDraftPreview] = useState(suggestion.preview ?? "");
  const actionItems = suggestion.actionItems ?? [];
  const insight = parseSuggestionInsight(actionItems);
  const body = (suggestion.body ?? "").trim();
  const preview = (suggestion.preview ?? body.slice(0, 240)).trim();
  const fromLower = suggestion.fromEmail.toLowerCase();
  const sourceLabel = fromLower.startsWith("slack:")
    ? "Slack"
    : fromLower.startsWith("sms:")
      ? "SMS"
      : fromLower.startsWith("document:")
        ? "Document"
        : "Email";
  const canReplyToSource = sourceLabel !== "Document" && (sourceLabel !== "Email" || suggestion.fromEmail.includes("@"));
  const replyTarget =
    sourceLabel === "Email"
      ? suggestion.fromEmail
      : sourceLabel === "Slack"
        ? suggestion.subject.replace(/^slack:\s*/i, "") || suggestion.fromEmail
        : suggestion.fromEmail.replace(/^sms:/i, "") || suggestion.fromEmail;
  const replyHelp =
    sourceLabel === "Email"
      ? "Donnit will open your email draft with the message filled in."
      : sourceLabel === "Slack"
        ? "Donnit will send through Slack when the bot is connected, or prepare the reply to copy."
        : "Donnit will send through Twilio when SMS is configured, or prepare the reply to copy.";
  const sendReply = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/suggestions/${suggestion.id}/reply`, {
        message: replyBody.trim(),
      });
      return (await res.json()) as SuggestionReplyResult;
    },
    onSuccess: async (result) => {
      if (result.delivery === "mailto" && result.href) {
        window.location.href = result.href;
        setReplyOpen(false);
        toast({
          title: "Email draft opened",
          description: "Review and send it from your mail app.",
        });
        return;
      }
      if (result.delivery === "sent") {
        setReplyOpen(false);
        setReplyBody("");
        toast({
          title: "Reply sent",
          description: result.message ?? "Donnit sent the response.",
        });
        return;
      }
      const copyText = result.body ?? replyBody.trim();
      try {
        await navigator.clipboard?.writeText(copyText);
        toast({
          title: "Reply copied",
          description: result.message ?? "Paste it into the source tool to send.",
        });
      } catch {
        toast({
          title: "Reply ready",
          description: result.message ?? "Copy the message from this popup and send it in the source tool.",
        });
      }
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not prepare reply",
        description: apiErrorMessage(error, "Try that reply again."),
        variant: "destructive",
      });
    },
  });
  useEffect(() => {
    setDraftTitle(suggestion.suggestedTitle);
    setDraftDueDate(suggestion.suggestedDueDate ?? "");
    setDraftUrgency(
      ["low", "normal", "high", "critical"].includes(suggestion.urgency)
        ? (suggestion.urgency as "low" | "normal" | "high" | "critical")
      : "normal",
    );
    setDraftPreview(suggestion.preview ?? "");
    setReplyBody("");
  }, [suggestion.id, suggestion.preview, suggestion.suggestedDueDate, suggestion.suggestedTitle, suggestion.urgency]);
  const saveEdits = () => {
    if (!onSaveEdits || draftTitle.trim().length < 2) return;
    onSaveEdits(suggestion.id, {
      suggestedTitle: draftTitle.trim(),
      suggestedDueDate: draftDueDate || null,
      urgency: draftUrgency,
      preview: draftPreview.trim() || suggestion.preview,
    });
    setEditing(false);
  };
  return (
    <>
      <div
        className={`task-row ${urgencyClass(suggestion.urgency)} flex-col items-stretch`}
        data-testid={`row-suggestion-${suggestion.id}`}
      >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              maxLength={160}
              className="h-9 text-sm"
              data-testid={`input-suggestion-title-${suggestion.id}`}
            />
          ) : (
            <p className="text-sm font-medium text-foreground break-words" data-testid={`text-suggestion-title-${suggestion.id}`}>
              {suggestion.suggestedTitle}
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground break-words" data-testid={`text-suggestion-from-${suggestion.id}`}>
            {sourceLabel} - {suggestion.fromEmail} - {formatReceivedAt(suggestion.receivedAt ?? null)}
          </p>
          <p className="mt-0.5 text-xs italic text-muted-foreground break-words">
            Source: {suggestion.subject}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {insight.confidence && (
            <span className="rounded-md bg-brand-green/10 px-2 py-1 text-[10px] font-semibold uppercase text-brand-green">
              {insight.confidence}
            </span>
          )}
          {suggestion.suggestedDueDate && !editing && (
            <span className="ui-label whitespace-nowrap text-[10px]">
              Due {suggestion.suggestedDueDate}
            </span>
          )}
          <span className="ui-label whitespace-nowrap text-[10px]">
            {urgencyLabel(suggestion.urgency)}
          </span>
        </div>
      </div>

      {editing && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_150px_150px]">
          <Textarea
            value={draftPreview}
            onChange={(event) => setDraftPreview(event.target.value)}
            className="min-h-[76px] text-xs sm:col-span-3"
            maxLength={600}
            data-testid={`input-suggestion-rationale-${suggestion.id}`}
          />
          <Input
            type="date"
            value={draftDueDate}
            onChange={(event) => setDraftDueDate(event.target.value)}
            className="h-9 text-xs"
            data-testid={`input-suggestion-due-${suggestion.id}`}
          />
          <select
            value={draftUrgency}
            onChange={(event) => setDraftUrgency(event.target.value as "low" | "normal" | "high" | "critical")}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid={`select-suggestion-urgency-${suggestion.id}`}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      )}

      {insight.why && !editing && (
        <div className="mt-2 rounded-sm border border-brand-green/15 bg-brand-green/5 px-2 py-1.5 text-xs text-foreground">
          <p className="font-medium">Why Donnit suggested this</p>
          <p className="mt-0.5 text-muted-foreground">{insight.why}</p>
          {(insight.estimate || insight.excerpt) && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {[insight.estimate, insight.excerpt ? `Source: ${insight.excerpt}` : null].filter(Boolean).join(" / ")}
            </p>
          )}
        </div>
      )}

      {insight.nextSteps.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-foreground" data-testid={`list-action-items-${suggestion.id}`}>
          {insight.nextSteps.map((item, index) => (
            <li key={`${suggestion.id}-ai-${index}`}>{item}</li>
          ))}
        </ul>
      )}

      {(preview || body) && (
        <div className="mt-2 rounded-sm bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
          {expanded && body ? (
            <div className="space-y-2">
              <p className="font-medium text-foreground">Donnit interpretation</p>
              <p className="break-words" data-testid={`text-suggestion-preview-${suggestion.id}`}>
                {preview}
              </p>
              <p className="font-medium text-foreground">Original email excerpt</p>
              <pre className="whitespace-pre-wrap break-words font-sans" data-testid={`text-suggestion-body-${suggestion.id}`}>
                {body}
              </pre>
            </div>
          ) : (
            <div>
              <p className="font-medium text-foreground">Donnit interpretation</p>
              <p className="line-clamp-3 break-words" data-testid={`text-suggestion-preview-${suggestion.id}`}>
                {preview || body.slice(0, 240)}
              </p>
            </div>
          )}
          {body && body.length > preview.length && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-[11px] font-medium text-brand-green hover:underline"
              data-testid={`button-suggestion-expand-${suggestion.id}`}
            >
              {expanded ? "Show less" : "Show full email"}
            </button>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button
              size="sm"
              onClick={saveEdits}
              disabled={saving || draftTitle.trim().length < 2}
              data-testid={`button-suggestion-save-${suggestion.id}`}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(false)}
              disabled={saving}
              data-testid={`button-suggestion-cancel-edit-${suggestion.id}`}
            >
              Cancel
            </Button>
          </>
        ) : onSaveEdits ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(true)}
            disabled={approving || dismissing}
            data-testid={`button-suggestion-edit-${suggestion.id}`}
          >
            <Pencil className="size-4" /> Edit
          </Button>
        ) : null}
        <Button
          size="sm"
          onClick={onApprove}
          disabled={approving || dismissing || editing}
          data-testid={`button-suggestion-approve-${suggestion.id}`}
        >
          <Check className="size-4" /> Add as task
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onDismiss}
          disabled={approving || dismissing}
          data-testid={`button-suggestion-dismiss-${suggestion.id}`}
        >
          <X className="size-4" /> Dismiss
        </Button>
        {canReplyToSource && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReplyOpen(true)}
            data-testid={`button-suggestion-reply-${suggestion.id}`}
          >
            <Send className="size-4" /> Reply
          </Button>
        )}
      </div>
      </div>
      <Dialog open={replyOpen} onOpenChange={setReplyOpen}>
        <DialogContent className={`${dialogShellClass} max-w-lg`}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle>Reply to source</DialogTitle>
            <DialogDescription>
              Draft a response to {replyTarget}. {replyHelp}
            </DialogDescription>
          </DialogHeader>
          <div className={dialogBodyClass}>
            <Textarea
              value={replyBody}
              onChange={(event) => setReplyBody(event.target.value)}
              placeholder="Thanks. I received this and will follow up shortly."
              className="min-h-[140px]"
              maxLength={4000}
              data-testid={`input-suggestion-reply-${suggestion.id}`}
            />
          </div>
          <DialogFooter className={dialogFooterClass}>
            <Button variant="outline" onClick={() => setReplyOpen(false)} disabled={sendReply.isPending}>
              Cancel
            </Button>
            <Button onClick={() => sendReply.mutate()} disabled={replyBody.trim().length < 2 || sendReply.isPending}>
              {sendReply.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {sourceLabel === "Email" ? "Open draft" : "Send reply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DoneLogPanel({
  events,
  tasks,
  users,
}: {
  events: TaskEvent[];
  tasks: Task[];
  users: User[];
}) {
  const recent = events.slice(0, 6);
  return (
    <div className="panel" data-testid="panel-log">
      <div className="border-b border-border px-4 py-3">
        <h3 className="display-font text-sm font-bold">Activity log</h3>
        <p className="ui-label mt-1">Every action, who, when</p>
      </div>
      <div className="px-4 py-3">
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {recent.map((event) => {
              const task = tasks.find((t) => t.id === event.taskId);
              const user = users.find((u) => u.id === event.actorId);
              const isComplete = event.type === "completed";
              return (
                <li
                  key={event.id}
                  className="flex gap-2.5"
                  data-testid={`row-event-${event.id}`}
                >
                  <span
                    className={`mt-1 size-2 shrink-0 rounded-full ${
                      isComplete ? "bg-brand-green" : "bg-muted-foreground/40"
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-snug text-foreground">
                      {event.type.replace(/_/g, " ")} ·{" "}
                      {task?.title ?? `Task ${event.taskId}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {user?.name ?? "Unknown"} ·{" "}
                      {new Date(event.createdAt).toLocaleString()}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function SupportRail({
  view,
  onViewChange,
  tasks,
  suggestions,
  users,
  subtasks = [],
  authenticated = false,
  currentUserId,
  events,
  agenda,
  excludedTaskIds,
  agendaApproved,
  agendaPreferences,
  onOpenInbox,
  onBuildAgenda,
  onToggleAgendaTask,
  onMoveAgendaTask,
  onUpdateAgendaPreferences,
  onApproveAgenda,
  onOpenAgendaWork,
  onExportAgenda,
  isBuildingAgenda,
}: {
  view: SupportRailView;
  onViewChange: (view: SupportRailView) => void;
  tasks: Task[];
  suggestions: EmailSuggestion[];
  users: User[];
  subtasks?: TaskSubtask[];
  authenticated?: boolean;
  currentUserId: Id;
  events: TaskEvent[];
  agenda: AgendaItem[];
  excludedTaskIds: Set<string>;
  agendaApproved: boolean;
  agendaPreferences: AgendaPreferences;
  onOpenInbox: () => void;
  onBuildAgenda: () => void;
  onToggleAgendaTask: (taskId: Id) => void;
  onMoveAgendaTask: (taskId: Id, direction: "up" | "down") => void;
  onUpdateAgendaPreferences: (preferences: AgendaPreferences) => void;
  onApproveAgenda: () => void;
  onOpenAgendaWork: () => void;
  onExportAgenda: () => void;
  isBuildingAgenda: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const dueTodayCount = tasks.filter(
    (task) => task.dueDate === today && task.status !== "completed" && task.status !== "denied",
  ).length;
  const approvalCount =
    tasks.filter((task) => task.status === "pending_acceptance").length +
    suggestions.filter((suggestion) => suggestion.status === "pending").length;
  const activeTeamCount = tasks.filter(
    (task) => String(task.assignedToId) !== String(currentUserId) && task.status !== "completed" && task.status !== "denied",
  ).length;
  const incompleteCount = tasks.filter((task) => task.status !== "completed" && task.status !== "denied").length;
  const tabs: Array<{
    id: SupportRailView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count: number;
  }> = [
    { id: "today", label: "Today", icon: CheckCircle2, count: dueTodayCount + approvalCount },
    { id: "agenda", label: "Agenda", icon: CalendarClock, count: agenda.length },
    { id: "team", label: "Team", icon: Users, count: activeTeamCount },
    { id: "reports", label: "Reports", icon: BarChart3, count: incompleteCount },
  ];

  return (
    <div className="space-y-3" data-testid="rail-support">
      <div
        className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/40 p-1 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4"
        role="tablist"
        aria-label="Command rail"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = tab.id === view;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onViewChange(tab.id)}
              className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-[6px] px-2 text-xs font-medium transition ${
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
              }`}
              data-testid={`button-rail-${tab.id}`}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{tab.label}</span>
              {tab.count > 0 && (
                <span
                  className={`ml-0.5 inline-flex min-w-5 justify-center rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                    selected ? "bg-brand-green-pale text-brand-green" : "bg-background text-muted-foreground"
                  }`}
                >
                  {tab.count > 99 ? "99+" : tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {view === "today" && (
        <div className="space-y-3" data-testid="rail-panel-today">
          <DueTodayPanel tasks={tasks} />
          <AcceptancePanel tasks={tasks} suggestions={suggestions} onOpenInbox={onOpenInbox} />
        </div>
      )}

      {view === "agenda" && (
        <AgendaPanel
          agenda={agenda}
          excludedTaskIds={excludedTaskIds}
          approved={agendaApproved}
          preferences={agendaPreferences}
          onBuild={onBuildAgenda}
          onToggleTask={onToggleAgendaTask}
          onMoveTask={onMoveAgendaTask}
          onPreferencesChange={onUpdateAgendaPreferences}
          onApprove={onApproveAgenda}
          onOpenWork={onOpenAgendaWork}
          onExport={onExportAgenda}
          isBuilding={isBuildingAgenda}
        />
      )}

      {view === "team" && (
        <TeamViewPanel
          tasks={tasks}
          suggestions={suggestions}
          events={events}
          users={users}
          subtasks={subtasks}
          authenticated={authenticated}
          currentUserId={currentUserId}
        />
      )}

      {view === "reports" && (
        <div className="space-y-3" data-testid="rail-panel-reports">
          <ReportingPanel tasks={tasks} suggestions={suggestions} currentUserId={currentUserId} />
          <DoneLogPanel events={events} tasks={tasks} users={users} />
        </div>
      )}
    </div>
  );
}

type DerivedNotification = {
  id: string;
  title: string;
  detail: string;
  severity: "high" | "normal" | "low";
  source: "approval" | "task";
  taskId?: Id;
  suggestionId?: Id;
};

function buildNotifications(tasks: Task[], suggestions: EmailSuggestion[]): DerivedNotification[] {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date();
  soon.setDate(soon.getDate() + 2);
  const soonIso = soon.toISOString().slice(0, 10);
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

  for (const task of active) {
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

function NotificationCenter({
  notifications,
  onReviewed,
  onOpenNotification,
}: {
  notifications: DerivedNotification[];
  onReviewed: (ids: string[]) => void;
  onOpenNotification: (notification: DerivedNotification) => void;
}) {
  const highCount = notifications.filter((item) => item.severity === "high").length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Open notifications" data-testid="button-notifications">
          <span className="relative inline-flex">
            <Bell className="size-4" />
            {notifications.length > 0 && (
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-green px-1 text-[10px] font-bold text-white">
                {notifications.length}
              </span>
            )}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>
          Notifications{highCount > 0 ? ` - ${highCount} urgent` : ""}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <DropdownMenuItem disabled>No task alerts right now.</DropdownMenuItem>
        ) : (
          notifications.map((item) => (
            <DropdownMenuItem
              key={item.id}
              className="items-start gap-2"
              onClick={() => {
                onReviewed([item.id]);
                onOpenNotification(item);
              }}
              data-testid={`notification-item-${item.id}`}
            >
              <span
                className={`mt-1 size-2 shrink-0 rounded-full ${
                  item.severity === "high"
                    ? "bg-destructive"
                    : item.severity === "normal"
                      ? "bg-brand-green"
                      : "bg-muted-foreground"
                }`}
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
              </span>
            </DropdownMenuItem>
          ))
        )}
        {notifications.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onReviewed(notifications.map((item) => item.id))}>
              <Check className="size-4" />
              Clear reviewed
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ApprovalInboxDialog({
  open,
  onOpenChange,
  tasks,
  suggestions,
  onScanEmail,
  scanningEmail,
  onOpenManualImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  suggestions: EmailSuggestion[];
  onScanEmail?: () => void;
  scanningEmail?: boolean;
  onOpenManualImport?: () => void;
}) {
  const waiting = tasks.filter((task) => task.status === "pending_acceptance");
  const pendingSuggestions = suggestions.filter((suggestion) => suggestion.status === "pending");
  const total = waiting.length + pendingSuggestions.length;

  const accept = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/tasks/${id}/accept`),
    onSuccess: invalidateWorkspace,
  });
  const deny = useMutation({
    mutationFn: async (id: Id) =>
      apiRequest("POST", `/api/tasks/${id}/deny`, { note: "Not the right owner." }),
    onSuccess: invalidateWorkspace,
  });
  const approveSuggestion = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/suggestions/${id}/approve`),
    onSuccess: invalidateWorkspace,
  });
  const dismissSuggestion = useMutation({
    mutationFn: async (id: Id) => apiRequest("POST", `/api/suggestions/${id}/dismiss`),
    onSuccess: invalidateWorkspace,
  });
  const updateSuggestion = useMutation({
    mutationFn: async ({ id, patch }: { id: Id; patch: SuggestionPatch }) =>
      apiRequest("PATCH", `/api/suggestions/${id}`, patch),
    onSuccess: invalidateWorkspace,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} max-w-4xl`}>
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Inbox className="size-5 text-brand-green" />
            Approval inbox
          </DialogTitle>
          <DialogDescription>
            {total > 0
              ? `${total} item${total === 1 ? "" : "s"} waiting for manager review.`
              : "No pending approvals or email suggestions."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {total === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/35 px-4 py-10 text-center">
              <CheckCircle2 className="mx-auto size-8 text-brand-green" />
              <p className="display-font mt-3 text-base font-bold">Queue is clear.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Scan email or assign work to create new approval items.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {onScanEmail && (
                  <Button size="sm" onClick={onScanEmail} disabled={scanningEmail} data-testid="button-empty-inbox-scan-email">
                    {scanningEmail ? <Loader2 className="size-4 animate-spin" /> : <Inbox className="size-4" />}
                    Scan email
                  </Button>
                )}
                {onOpenManualImport && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onOpenManualImport}
                    data-testid="button-empty-inbox-manual-email"
                  >
                    <MailPlus className="size-4" />
                    Import email
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {waiting.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="ui-label">Assigned to you</p>
                    <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums">
                      {waiting.length}
                    </span>
                  </div>
                  {waiting.map((task) => (
                    <div
                      key={task.id}
                      className={`task-row ${urgencyClass(task.urgency)} flex-col items-stretch`}
                      data-testid={`row-approval-task-${task.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground break-words">{task.title}</p>
                          {task.description && (
                            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                              {task.description}
                            </p>
                          )}
                        </div>
                        <span className="ui-label whitespace-nowrap">{urgencyLabel(task.urgency)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>Due {task.dueDate ?? "not set"}</span>
                        <span>{task.estimatedMinutes} min</span>
                        <span>Source: {task.source}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => accept.mutate(task.id)}
                          disabled={accept.isPending || deny.isPending}
                          data-testid={`button-inbox-accept-${task.id}`}
                        >
                          <Check className="size-4" />
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deny.mutate(task.id)}
                          disabled={accept.isPending || deny.isPending}
                          data-testid={`button-inbox-deny-${task.id}`}
                        >
                          <X className="size-4" />
                          Deny
                        </Button>
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {pendingSuggestions.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="ui-label">Suggested from email</p>
                    <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums">
                      {pendingSuggestions.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {pendingSuggestions.map((suggestion) => (
                      <SuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
                        onApprove={() => approveSuggestion.mutate(suggestion.id)}
                        onDismiss={() => dismissSuggestion.mutate(suggestion.id)}
                        onSaveEdits={(id, patch) => updateSuggestion.mutate({ id, patch })}
                        approving={approveSuggestion.isPending}
                        dismissing={dismissSuggestion.isPending}
                        saving={updateSuggestion.isPending}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-approval-inbox-close">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignTaskDialog({
  open,
  onOpenChange,
  users,
  currentUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: User[];
  currentUserId: Id;
}) {
  const assignableUsers = useMemo(
    () =>
      users.length > 0
        ? users
        : [{ id: currentUserId, name: "You", email: "", role: "", persona: "", managerId: null, canAssign: true }],
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
  const [estimatedMinutes, setEstimatedMinutes] = useState(30);
  const [urgency, setUrgency] = useState<"low" | "normal" | "high" | "critical">("normal");

  useEffect(() => {
    if (!open) return;
    setAssignedToId(defaultAssigneeId);
  }, [open, defaultAssigneeId]);

  const create = useMutation({
    mutationFn: async () => {
      const assignee = assignableUsers.find((user) => String(user.id) === assignedToId);
      const assignedTo = assignee?.id ?? currentUserId;
      const assignedBy = currentUserId;
      const isSelfAssigned = String(assignedTo) === String(assignedBy);
      const res = await apiRequest("POST", "/api/tasks", {
        title: title.trim(),
        description: description.trim(),
        status: isSelfAssigned ? "open" : "pending_acceptance",
        urgency,
        dueDate: dueDate || null,
        estimatedMinutes,
        assignedToId: assignedTo,
        assignedById: assignedBy,
        source: "manual",
        recurrence: "none",
        reminderDaysBefore: 0,
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
      setEstimatedMinutes(30);
      setUrgency("normal");
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
          <DialogTitle>Assign task</DialogTitle>
          <DialogDescription>
            Create a task for yourself or another workspace member.
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
              onChange={(event) => setAssignedToId(event.target.value)}
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
            Assign task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManualEmailImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fromEmail, setFromEmail] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/email/manual", {
        subject: subject.trim(),
        body: body.trim(),
        fromEmail: fromEmail.trim() || undefined,
      });
      return (await res.json()) as { ok: boolean };
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({
        title: "Email added",
        description: "Pasted email is queued in the approval inbox.",
      });
      setSubject("");
      setBody("");
      setFromEmail("");
      onOpenChange(false);
    },
    onError: () => {
      toast({
        title: "Could not import email",
        description: "Check the subject and body and try again.",
        variant: "destructive",
      });
    },
  });

  const ready = subject.trim().length >= 1 && body.trim().length >= 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} max-w-lg`}>
        <DialogHeader className={dialogHeaderClass}>
          <DialogTitle>Manual email import (diagnostic)</DialogTitle>
          <DialogDescription>
            Donnit's primary email flow is "Scan email", which reads unread Gmail directly. Use this
            paste form only as a one-off diagnostic when Gmail OAuth is not yet configured.
          </DialogDescription>
        </DialogHeader>
        <div className={`${dialogBodyClass} space-y-3`}>
          <div>
            <Label htmlFor="manual-email-from" className="ui-label mb-1.5 block">
              From (optional)
            </Label>
            <Input
              id="manual-email-from"
              value={fromEmail}
              onChange={(event) => setFromEmail(event.target.value)}
              placeholder="alex@example.com"
              data-testid="input-manual-email-from"
            />
          </div>
          <div>
            <Label htmlFor="manual-email-subject" className="ui-label mb-1.5 block">
              Subject
            </Label>
            <Input
              id="manual-email-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Action required: review Q2 contract"
              maxLength={240}
              data-testid="input-manual-email-subject"
            />
          </div>
          <div>
            <Label htmlFor="manual-email-body" className="ui-label mb-1.5 block">
              Body
            </Label>
            <Textarea
              id="manual-email-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Paste the relevant excerpt — the suggested task title, due date, and urgency will be inferred."
              className="min-h-[140px]"
              maxLength={4000}
              data-testid="input-manual-email-body"
            />
          </div>
        </div>
        <DialogFooter className={dialogFooterClass}>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-manual-email-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!ready || create.isPending}
            data-testid="button-manual-email-submit"
          >
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <MailPlus className="size-4" />}
            Add to queue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentImportDialog({
  open,
  onOpenChange,
  onOpenApprovalInbox,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenApprovalInbox: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a PDF, Word, or text file first.");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("Could not read the document."));
        reader.readAsDataURL(file);
      });
      const dataBase64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      const res = await apiRequest("POST", "/api/documents/suggest", {
        fileName: file.name,
        mimeType: file.type,
        dataBase64,
      });
      return (await res.json()) as { ok: boolean; created: number };
    },
    onSuccess: async (result) => {
      await invalidateWorkspace();
      toast({
        title: "Document scanned",
        description:
          result.created > 0
            ? `Queued ${result.created} task suggestion${result.created === 1 ? "" : "s"} for approval.`
            : "No task suggestions were found.",
      });
      setFile(null);
      onOpenChange(false);
      if (result.created > 0) onOpenApprovalInbox();
    },
    onError: (error: unknown) => {
      toast({
        title: "Document scan failed",
        description: error instanceof Error ? error.message : "Upload a PDF, Word .docx, or text file.",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} max-w-lg`}>
        <DialogHeader className={dialogHeaderClass}>
          <DialogTitle>Import document</DialogTitle>
          <DialogDescription>
            Upload a PDF, Word .docx, or text file and Donnit will queue task suggestions for approval.
          </DialogDescription>
        </DialogHeader>
        <div className={dialogBodyClass}>
          <div className="space-y-2">
            <Label htmlFor="document-import-file">Document</Label>
            <Input
              id="document-import-file"
              type="file"
              accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              data-testid="input-document-import-file"
            />
            <p className="text-xs text-muted-foreground">
              Files are parsed into the approval inbox before anything becomes a task.
            </p>
          </div>
        </div>
        <DialogFooter className={dialogFooterClass}>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-document-import-cancel">
            Cancel
          </Button>
          <Button
            onClick={() => upload.mutate()}
            disabled={!file || upload.isPending}
            data-testid="button-document-import-submit"
          >
            {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
            Scan document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CalendarExportDialog({
  open,
  onOpenChange,
  agenda,
  oauthStatus,
  onDownload,
  onExportGoogle,
  onReconnectGoogle,
  isExportingGoogle,
  isReconnectingGoogle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agenda: AgendaItem[];
  oauthStatus?: GmailOAuthStatus;
  onDownload: () => void;
  onExportGoogle: () => void;
  onReconnectGoogle: () => void;
  isExportingGoogle: boolean;
  isReconnectingGoogle: boolean;
}) {
  const calendarReady = Boolean(oauthStatus?.connected && oauthStatus.calendarConnected);
  const needsCalendarReconnect = Boolean(oauthStatus?.connected && oauthStatus.calendarRequiresReconnect);
  const scheduledCount = agenda.filter((item) => item.startAt && item.endAt && item.scheduleStatus === "scheduled").length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} max-w-lg`}>
        <DialogHeader className={dialogHeaderClass}>
          <DialogTitle>Calendar export</DialogTitle>
          <DialogDescription>
            {scheduledCount > 0
              ? `${scheduledCount} scheduled agenda block${scheduledCount === 1 ? "" : "s"} ready.`
              : "Build an agenda before exporting."}
          </DialogDescription>
        </DialogHeader>
        <div className={`${dialogBodyClass} space-y-3`}>
          <div className="rounded-md border border-border px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Google Calendar</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {calendarReady
                    ? oauthStatus?.email ?? "Connected"
                    : needsCalendarReconnect
                      ? "Reconnect Google to enable direct calendar sync."
                      : "Connect Google before direct calendar sync."}
                </p>
              </div>
              <span className="ui-label">
                {calendarReady ? "Ready" : needsCalendarReconnect ? "Reconnect" : "Not connected"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={onExportGoogle}
                disabled={!calendarReady || scheduledCount === 0 || isExportingGoogle}
                data-testid="button-google-calendar-export"
              >
                {isExportingGoogle ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />}
                Add to Google Calendar
              </Button>
              {!calendarReady && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onReconnectGoogle}
                  disabled={isReconnectingGoogle}
                  data-testid="button-google-calendar-reconnect"
                >
                  {isReconnectingGoogle ? <Loader2 className="size-4 animate-spin" /> : <MailPlus className="size-4" />}
                  {needsCalendarReconnect ? "Reconnect Google" : "Connect Google"}
                </Button>
              )}
            </div>
          </div>
          <div className="rounded-md border border-border px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Calendar file</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Downloads an .ics file; your computer chooses which calendar app opens it.
                </p>
              </div>
              <CalendarPlus className="size-4 text-muted-foreground" />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onDownload}
                disabled={scheduledCount === 0}
                data-testid="button-download-calendar-file"
              >
                <CalendarPlus className="size-4" />
                Download .ics
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href="https://calendar.google.com/calendar/u/0/r/settings/export"
                  target="_blank"
                  rel="noreferrer"
                  data-testid="link-google-calendar-import"
                >
                  <ExternalLink className="size-4" />
                  Open Google Calendar
                </a>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToolStatusBadge({ status }: { status: "ready" | "warning" | "setup" }) {
  const label = status === "ready" ? "Ready" : status === "warning" ? "Needs attention" : "Setup";
  const classes =
    status === "ready"
      ? "border-brand-green/30 bg-brand-green/10 text-brand-green"
      : status === "warning"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-border bg-muted text-muted-foreground";
  return (
    <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${classes}`}>
      {label}
    </span>
  );
}

function ConnectedToolRow({
  icon: Icon,
  name,
  detail,
  status,
  actionLabel,
  action,
  loading,
  disabled,
  secondaryActionLabel,
  secondaryAction,
  secondaryLoading,
  secondaryDisabled,
}: {
  icon: typeof Inbox;
  name: string;
  detail: string;
  status: "ready" | "warning" | "setup";
  actionLabel: string;
  action: () => void;
  loading?: boolean;
  disabled?: boolean;
  secondaryActionLabel?: string;
  secondaryAction?: () => void;
  secondaryLoading?: boolean;
  secondaryDisabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">{name}</p>
            <ToolStatusBadge status={status} />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {secondaryAction && secondaryActionLabel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={secondaryAction}
            disabled={secondaryDisabled || secondaryLoading}
            data-testid={`button-tool-${name.toLowerCase().replace(/\s+/g, "-")}-secondary`}
          >
            {secondaryLoading ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
            {secondaryActionLabel}
          </Button>
        )}
        <Button
          type="button"
          variant={status === "ready" ? "outline" : "default"}
          size="sm"
          onClick={action}
          disabled={disabled || loading}
          data-testid={`button-tool-${name.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

function WorkspaceSettingsDialog({
  open,
  onOpenChange,
  currentUser,
  authenticated,
  users,
  positionProfiles,
  currentUserId,
  integrations,
  oauthStatus,
  onConnectGmail,
  onDisconnectGmail,
  onScanEmail,
  onOpenCalendarExport,
  isConnectingGmail,
  isDisconnectingGmail,
  isScanningEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser: User | null;
  authenticated: boolean;
  users: User[];
  positionProfiles: PositionProfile[];
  currentUserId: Id;
  integrations: Bootstrap["integrations"];
  oauthStatus?: GmailOAuthStatus;
  onConnectGmail: () => void;
  onDisconnectGmail: () => void;
  onScanEmail: () => void;
  onOpenCalendarExport: () => void;
  isConnectingGmail: boolean;
  isDisconnectingGmail: boolean;
  isScanningEmail: boolean;
}) {
  const isAdmin = currentUser?.role === "owner" || currentUser?.role === "admin" || currentUser?.role === "manager";
  const canManagePositionProfiles = canAdministerProfiles(currentUser);
  const managers = users.filter((user) => user.role === "owner" || user.role === "admin" || user.role === "manager");
  const calendarReady = Boolean(oauthStatus?.connected && oauthStatus.calendarConnected);
  const needsGoogleReconnect = Boolean(oauthStatus?.requiresReconnect || oauthStatus?.calendarRequiresReconnect);
  const gmailReady = Boolean(oauthStatus?.connected && oauthStatus.gmailScopeConnected && !oauthStatus.tokenExpiresSoon);
  const slackStatus = useSlackIntegrationStatus(authenticated);
  const slackData = slackStatus.data;
  const slackEventsReady = Boolean(slackData?.eventsConfigured ?? integrations.slack?.eventsConfigured);
  const slackBotReady = Boolean(slackData?.botConfigured ?? integrations.slack?.botConfigured);
  const slackHealth: "ready" | "warning" | "setup" = slackEventsReady ? (slackBotReady ? "ready" : "warning") : "setup";
  const smsStatus = useSmsIntegrationStatus(authenticated);
  const smsData = smsStatus.data;
  const smsInboundReady = Boolean(smsData?.inboundConfigured ?? integrations.sms?.inboundConfigured);
  const smsProviderReady = Boolean(smsData?.signatureConfigured ?? integrations.sms?.signatureConfigured ?? integrations.sms?.providerConfigured);
  const smsHealth: "ready" | "warning" | "setup" = smsInboundReady ? (smsProviderReady ? "ready" : "warning") : "setup";
  const googleHealthLabel =
    oauthStatus?.health === "ready"
      ? "Ready"
      : oauthStatus?.health === "calendar_scope_missing"
        ? "Calendar permission missing"
        : oauthStatus?.health === "gmail_scope_missing"
          ? "Gmail permission missing"
          : oauthStatus?.health === "needs_reconnect"
            ? "Reconnect required"
            : oauthStatus?.health === "oauth_not_configured"
              ? "OAuth not configured"
              : "Not connected";
  const [autoEmailScan, setAutoEmailScan] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("donnit.autoEmailScan") === "true";
  });
  const [autoSlackScan, setAutoSlackScan] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("donnit.autoSlackScan") === "true";
  });
  const [unreadDelayMinutes, setUnreadDelayMinutes] = useState(() => {
    if (typeof window === "undefined") return 2;
    return Number(window.localStorage.getItem("donnit.unreadDelayMinutes") ?? "2") || 2;
  });
  const slackDelay = slackData?.unreadDelayMinutes ?? integrations.slack?.unreadDelayMinutes ?? unreadDelayMinutes;
  const updateAutoEmailScan = (value: boolean) => {
    setAutoEmailScan(value);
    if (typeof window !== "undefined") window.localStorage.setItem("donnit.autoEmailScan", String(value));
  };
  const updateAutoSlackScan = (value: boolean) => {
    setAutoSlackScan(value);
    if (typeof window !== "undefined") window.localStorage.setItem("donnit.autoSlackScan", String(value));
  };
  const updateUnreadDelay = (value: number) => {
    const next = Math.min(60, Math.max(1, Math.round(value) || 2));
    setUnreadDelayMinutes(next);
    if (typeof window !== "undefined") window.localStorage.setItem("donnit.unreadDelayMinutes", String(next));
  };
  const testSlack = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/slack/suggest", {
        text: "Please assign follow-up on the Slack integration test by Friday, 15 minutes",
        from: currentUser?.name ?? "Donnit test",
        channel: "donnit-test",
        subject: "Slack: integration test",
      });
      return (await res.json()) as { ok: boolean };
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({
        title: "Slack test queued",
        description: "Open Approval inbox to review the Slack test suggestion.",
      });
    },
    onError: () => {
      toast({
        title: "Slack test failed",
        description: "Donnit could not queue a Slack test suggestion.",
        variant: "destructive",
      });
    },
  });
  const testSms = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/sms/inbound", {
        text: "Remind me to call the payroll vendor tomorrow, urgent",
        from: "+15555555555",
        subject: "SMS integration test",
      });
      return (await res.json()) as { ok: boolean };
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({
        title: "SMS test queued",
        description: "Open Approval inbox to review the SMS test suggestion.",
      });
    },
    onError: () => {
      toast({
        title: "SMS test failed",
        description: "Donnit could not queue an SMS test suggestion.",
        variant: "destructive",
      });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} sm:max-w-3xl`}>
        <DialogHeader className={dialogHeaderClass}>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-5 text-brand-green" />
            Workspace settings
          </DialogTitle>
          <DialogDescription>
            {isAdmin
              ? "Admin and manager controls for Donnit."
              : "Your workspace controls. Admin-only options are locked."}
          </DialogDescription>
        </DialogHeader>
        <div className={dialogBodyClass}>
          <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border px-3 py-3">
              <p className="ui-label">Your role</p>
              <p className="mt-1 text-sm font-medium text-foreground">{currentUser?.role ?? "member"}</p>
            </div>
            <div className="rounded-md border border-border px-3 py-3">
              <p className="ui-label">Members</p>
              <p className="mt-1 text-sm font-medium text-foreground">{users.length}</p>
            </div>
            <div className="rounded-md border border-border px-3 py-3">
              <p className="ui-label">Google</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {googleHealthLabel}
              </p>
            </div>
          </div>

          {canManagePositionProfiles && (
            <PositionProfilesPanel
              profiles={positionProfiles}
              users={users}
              currentUserId={currentUserId}
              authenticated={authenticated}
            />
          )}

          <div className="rounded-md border border-border">
            <div className="border-b border-border px-3 py-2">
              <p className="text-sm font-medium text-foreground">Connected tools</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Review status and queue safe test suggestions.
              </p>
            </div>
            <div className="grid gap-2 px-3 py-3">
              <ConnectedToolRow
                icon={MailPlus}
                name="Gmail"
                status={gmailReady ? "ready" : needsGoogleReconnect || oauthStatus?.health === "gmail_scope_missing" ? "warning" : "setup"}
                detail={
                  gmailReady
                    ? `Scanning ${oauthStatus?.email ?? "connected Gmail"}. Last scan: ${oauthStatus?.lastScannedAt ? formatReceivedAt(oauthStatus.lastScannedAt) : "not yet scanned"}.`
                    : needsGoogleReconnect
                      ? "Google authorization needs to be refreshed before scanning email."
                      : oauthStatus?.health === "gmail_scope_missing"
                        ? "Reconnect Google and approve Gmail read access to scan unread messages."
                      : oauthStatus?.configured
                        ? "OAuth is configured; connect a Gmail account to scan unread messages."
                        : "Google OAuth environment variables are not configured."
                }
                actionLabel={gmailReady ? "Scan email" : needsGoogleReconnect || oauthStatus?.health === "gmail_scope_missing" ? "Reconnect" : "Connect"}
                action={gmailReady ? onScanEmail : onConnectGmail}
                loading={isScanningEmail || isConnectingGmail}
                disabled={!gmailReady && !oauthStatus?.configured}
                secondaryActionLabel={oauthStatus?.connected ? "Disconnect" : undefined}
                secondaryAction={oauthStatus?.connected ? onDisconnectGmail : undefined}
                secondaryLoading={isDisconnectingGmail}
              />
              <ConnectedToolRow
                icon={CalendarCheck}
                name="Google Calendar"
                status={calendarReady ? "ready" : needsGoogleReconnect ? "warning" : "setup"}
                detail={
                  calendarReady
                    ? "Agenda export can read availability and sync scheduled task blocks."
                    : needsGoogleReconnect
                      ? "Reconnect Google to grant Calendar access."
                      : "Connect Google with Calendar access before direct agenda sync."
                }
                actionLabel={calendarReady ? "Open export" : needsGoogleReconnect ? "Reconnect" : "Connect"}
                action={calendarReady ? onOpenCalendarExport : onConnectGmail}
                loading={isConnectingGmail}
                disabled={!calendarReady && !oauthStatus?.configured}
                secondaryActionLabel={oauthStatus?.connected ? "Disconnect" : undefined}
                secondaryAction={oauthStatus?.connected ? onDisconnectGmail : undefined}
                secondaryLoading={isDisconnectingGmail}
              />
              <ConnectedToolRow
                icon={Inbox}
                name="Slack"
                status={slackHealth}
                detail={
                  slackEventsReady
                    ? slackBotReady
                      ? `Events are ready. Donnit maps Slack users by profile email/name, then queues suggestions after a ${slackDelay} minute delay.`
                      : `Events can ingest with the Slack signing secret or ingest token. Add SLACK_BOT_TOKEN for stronger user email mapping.`
                    : "Slack events are not configured yet. Add SLACK_SIGNING_SECRET or DONNIT_SLACK_WEBHOOK_TOKEN."
                }
                actionLabel="Queue test"
                action={() => testSlack.mutate()}
                loading={testSlack.isPending}
              />
              <ConnectedToolRow
                icon={Send}
                name="SMS"
                status={smsHealth}
                detail={
                  smsInboundReady
                    ? smsProviderReady
                      ? `Inbound SMS is ready. Messages route to ${smsData?.routing.defaultAssigneeConfigured ? "the configured assignee" : "the workspace owner"} for approval.`
                      : "Inbound SMS token is configured. Add TWILIO_AUTH_TOKEN to verify real Twilio webhooks."
                    : "No SMS ingest token or Twilio signature verification is configured yet."
                }
                actionLabel="Queue test"
                action={() => testSms.mutate()}
                loading={testSms.isPending}
              />
            </div>
          </div>

          <div className="rounded-md border border-border">
            <div className="border-b border-border px-3 py-2">
              <p className="text-sm font-medium text-foreground">Automation settings</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Controls for live task suggestion behavior as provider webhooks are connected.
              </p>
            </div>
            <div className="grid gap-3 px-3 py-3">
              <label className="flex items-start justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                <span>
                  <span className="block text-sm font-medium text-foreground">Auto-suggest unread Gmail tasks</span>
                  <span className="block text-xs text-muted-foreground">
                    When enabled, Donnit should queue suggestions after unread messages remain unanswered.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={autoEmailScan}
                  onChange={(event) => updateAutoEmailScan(event.target.checked)}
                  className="mt-1"
                  data-testid="toggle-auto-email-scan"
                />
              </label>
              <label className="flex items-start justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                <span>
                  <span className="block text-sm font-medium text-foreground">Auto-suggest unread Slack tasks</span>
                  <span className="block text-xs text-muted-foreground">
                    Slack messages should wait for the unread delay before Donnit asks for task approval.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={autoSlackScan}
                  onChange={(event) => updateAutoSlackScan(event.target.checked)}
                  className="mt-1"
                  data-testid="toggle-auto-slack-scan"
                />
              </label>
              <div className="grid gap-1.5 rounded-md border border-border bg-background px-3 py-2 sm:grid-cols-[1fr_120px] sm:items-center">
                <div>
                  <Label htmlFor="automation-unread-delay" className="text-sm font-medium text-foreground">
                    Unread delay
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Default is 2 minutes so answered messages do not create noisy prompts.
                  </p>
                </div>
                <Input
                  id="automation-unread-delay"
                  type="number"
                  min={1}
                  max={60}
                  value={unreadDelayMinutes}
                  onChange={(event) => updateUnreadDelay(Number(event.target.value))}
                  className="h-9"
                  data-testid="input-automation-unread-delay"
                />
              </div>
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="text-sm font-medium text-foreground">Slack event bridge</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Endpoint: <span className="font-mono">{slackData?.eventEndpoint ?? "/api/integrations/slack/events"}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  User mapping: {slackData?.userMapping.mappedByEmail ?? 0}/{slackData?.userMapping.totalMembers ?? users.length} workspace members have email-backed mapping.
                </p>
              </div>
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="text-sm font-medium text-foreground">SMS inbound bridge</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Endpoint: <span className="font-mono">{smsData?.inboundEndpoint ?? "/api/integrations/sms/inbound"}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Routing: {smsData?.routing.defaultAssigneeConfigured ? "configured default assignee" : "workspace owner fallback"}.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
              <p className="text-sm font-medium text-foreground">People and roles</p>
              <span className="ui-label">{managers.length} manager{managers.length === 1 ? "" : "s"}</span>
            </div>
            <div className="max-h-56 overflow-y-auto px-3 py-2">
              {users.map((user) => (
                <div key={String(user.id)} className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <span className="ui-label whitespace-nowrap">{user.role}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        </div>
        <DialogFooter className={dialogFooterClass}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={!isAdmin}
            onClick={() => {
              toast({
                title: "Settings noted",
                description: "Persistent admin settings are queued for the next database slice.",
              });
              onOpenChange(false);
            }}
            data-testid="button-settings-save"
          >
            <Settings className="size-4" />
            Save settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type GmailOAuthStatus = {
  configured: boolean;
  authenticated: boolean;
  connected: boolean;
  gmailScopeConnected?: boolean;
  calendarConnected?: boolean;
  calendarRequiresReconnect?: boolean;
  requiresReconnect?: boolean;
  tokenExpiresSoon?: boolean;
  health?: "ready" | "oauth_not_configured" | "not_connected" | "needs_reconnect" | "gmail_scope_missing" | "calendar_scope_missing";
  email?: string | null;
  connectedAt?: string | null;
  expiresAt?: string | null;
  lastScannedAt?: string | null;
  status?: string | null;
};

type SlackIntegrationStatus = {
  ok: boolean;
  health: "ready" | "events_without_profile_lookup" | "setup";
  webhookConfigured: boolean;
  signingSecretConfigured: boolean;
  botConfigured: boolean;
  eventsConfigured: boolean;
  eventEndpoint: string;
  suggestEndpoint: string;
  unreadDelayMinutes: number;
  userMapping: {
    mode: string;
    mappedByEmail: number;
    totalMembers: number;
  };
};

type SmsIntegrationStatus = {
  ok: boolean;
  health: "ready" | "webhook_only" | "setup";
  inboundConfigured: boolean;
  webhookConfigured: boolean;
  signatureConfigured: boolean;
  accountConfigured: boolean;
  fromNumberConfigured: boolean;
  inboundEndpoint: string;
  routing: {
    mode: string;
    defaultAssigneeConfigured: boolean;
    totalMembers: number;
  };
};

function useGmailOAuthStatus(authenticated: boolean) {
  return useQuery<GmailOAuthStatus>({
    queryKey: ["/api/integrations/gmail/oauth/status"],
    enabled: authenticated,
  });
}

function useSlackIntegrationStatus(authenticated: boolean) {
  return useQuery<SlackIntegrationStatus>({
    queryKey: ["/api/integrations/slack/status"],
    enabled: authenticated,
  });
}

function useSmsIntegrationStatus(authenticated: boolean) {
  return useQuery<SmsIntegrationStatus>({
    queryKey: ["/api/integrations/sms/status"],
    enabled: authenticated,
  });
}

function CommandCenter({ auth }: { auth: AuthedContext }) {
  const { data, isLoading, isError } = useBootstrap();
  const [manualImportOpen, setManualImportOpen] = useState(false);
  const [documentImportOpen, setDocumentImportOpen] = useState(false);
  const [assignTaskOpen, setAssignTaskOpen] = useState(false);
  const [calendarExportOpen, setCalendarExportOpen] = useState(false);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [approvalInboxOpen, setApprovalInboxOpen] = useState(false);
  const [agendaWorkOpen, setAgendaWorkOpen] = useState(false);
  const [notificationTaskId, setNotificationTaskId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(() => {
    try {
      if (typeof window === "undefined") return null;
      return window.localStorage.getItem("donnit.activeTaskId");
    } catch {
      return null;
    }
  });
  const [agendaExcludedTaskIds, setAgendaExcludedTaskIds] = useState<Set<string>>(new Set());
  const [agendaApproved, setAgendaApproved] = useState(false);
  const [agendaPreferences, setAgendaPreferences] = useState<AgendaPreferences>(DEFAULT_AGENDA_PREFERENCES);
  const [agendaTaskOrder, setAgendaTaskOrder] = useState<string[]>([]);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [onboardingManuallyOpen, setOnboardingManuallyOpen] = useState(false);
  const [supportView, setSupportView] = useState<SupportRailView>("today");
  const [googleConnectPolling, setGoogleConnectPolling] = useState(false);
  const [reviewedNotificationIds, setReviewedNotificationIds] = useState<Set<string>>(() => {
    try {
      if (typeof window === "undefined") return new Set();
      return new Set(JSON.parse(window.localStorage.getItem("donnit.reviewedNotifications") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const oauthStatus = useGmailOAuthStatus(auth.authenticated);
  const persistedReviewedNotificationIds = data?.workspaceState?.reviewedNotificationIds.join("|") ?? "";
  const persistedAgendaExcludedTaskIds = data?.workspaceState?.agenda.excludedTaskIds.join("|") ?? "";
  const persistedAgendaApproved = data?.workspaceState?.agenda.approved ?? false;
  const persistedAgendaPreferences = JSON.stringify(data?.workspaceState?.agenda.preferences ?? DEFAULT_AGENDA_PREFERENCES);
  const persistedAgendaTaskOrder = data?.workspaceState?.agenda.taskOrder.join("|") ?? "";
  const persistedOnboardingDismissed = data?.workspaceState?.onboarding.dismissed ?? false;

  const persistWorkspaceState = (input: { key: "reviewed_notifications" | "agenda_state" | "onboarding_state"; value: Record<string, unknown> }) => {
    if (!data?.authenticated) return;
    apiRequest("PATCH", "/api/workspace-state", input).catch((error: unknown) => {
      console.warn("[donnit] workspace state persistence failed", error);
    });
  };

  const persistAgendaState = (
    excludedTaskIds: Set<string>,
    approved: boolean,
    approvedAt: string | null = null,
    preferences = agendaPreferences,
    taskOrder = agendaTaskOrder,
  ) => {
    persistWorkspaceState({
      key: "agenda_state",
      value: {
        excludedTaskIds: Array.from(excludedTaskIds),
        approved,
        approvedAt,
        preferences,
        taskOrder,
      },
    });
  };

  useEffect(() => {
    if (!data?.authenticated || !data.workspaceState) return;
    const ids = data.workspaceState.reviewedNotificationIds;
    setReviewedNotificationIds(new Set(ids));
    if (typeof window !== "undefined") {
      window.localStorage.setItem("donnit.reviewedNotifications", JSON.stringify(ids.slice(-200)));
    }
  }, [data?.authenticated, persistedReviewedNotificationIds]);

  useEffect(() => {
    if (!data?.authenticated || !data.workspaceState) return;
    setAgendaExcludedTaskIds(new Set(data.workspaceState.agenda.excludedTaskIds));
    setAgendaApproved(data.workspaceState.agenda.approved);
    setAgendaPreferences(normalizeAgendaPreferences(data.workspaceState.agenda.preferences));
    setAgendaTaskOrder(data.workspaceState.agenda.taskOrder);
  }, [data?.authenticated, persistedAgendaApproved, persistedAgendaExcludedTaskIds, persistedAgendaPreferences, persistedAgendaTaskOrder]);

  useEffect(() => {
    if (!data?.authenticated || !data.workspaceState) return;
    setOnboardingDismissed(data.workspaceState.onboarding.dismissed);
  }, [data?.authenticated, persistedOnboardingDismissed]);

  useEffect(() => {
    if (!googleConnectPolling) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/gmail/oauth/status"] });
      if (Date.now() - startedAt > 120_000) {
        window.clearInterval(timer);
        setGoogleConnectPolling(false);
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [googleConnectPolling]);

  useEffect(() => {
    if (!googleConnectPolling || !oauthStatus.data?.connected) return;
    setGoogleConnectPolling(false);
    queryClient.invalidateQueries({ queryKey: ["/api/bootstrap"] });
    toast({
      title: "Google connected",
      description: "Donnit stayed open while Google authorization completed.",
    });
  }, [googleConnectPolling, oauthStatus.data?.connected]);

  // The Gmail OAuth callback redirects to "/?gmail=<reason>" after Google
  // sends the user back. Detect that on mount, surface a typed toast, and
  // strip the param from the URL so a refresh doesn't re-trigger the toast.
  // We also invalidate the OAuth status query so the dashboard reflects the
  // new connection without requiring a manual refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const gmailParam = url.searchParams.get("gmail");
    if (!gmailParam) return;
    // Google's documented `error` / `error_description` fields, surfaced by
    // the callback handler on the redirect URL. Safe to display: they
    // describe what Google rejected, never the auth code, secret, or token.
    const googleError = url.searchParams.get("gmail_error");
    const googleErrorDescription = url.searchParams.get("gmail_error_description");
    url.searchParams.delete("gmail");
    url.searchParams.delete("gmail_error");
    url.searchParams.delete("gmail_error_description");
    const cleaned = url.pathname + (url.search ? url.search : "") + url.hash;
    window.history.replaceState({}, "", cleaned);
    queryClient.invalidateQueries({ queryKey: ["/api/integrations/gmail/oauth/status"] });
    if (gmailParam === "connected") {
      toast({
        title: "Gmail connected",
        description: "Click Scan email to pull unread Gmail and queue suggested tasks.",
      });
      return;
    }
    const map: Record<string, { title: string; description: string }> = {
      denied: {
        title: "Gmail connect cancelled",
        description: "Permission was not granted. Click Connect Gmail to try again.",
      },
      missing_params: {
        title: "Gmail connect link incomplete",
        description: "Click Connect Gmail to start a fresh authorization.",
      },
      bad_state: {
        title: "Gmail connect link invalid",
        description: "The connect link couldn't be verified. Click Connect Gmail to start again.",
      },
      expired: {
        title: "Gmail connect link expired",
        description: "Click Connect Gmail to start a fresh authorization (links last 10 minutes).",
      },
      not_configured: {
        title: "Gmail OAuth not configured",
        description: "Server admin must set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI, then redeploy.",
      },
      server_misconfigured: {
        title: "Server admin: SUPABASE_SERVICE_ROLE_KEY not configured",
        description: "Donnit cannot persist Gmail tokens without the service-role key. Add it on Vercel and redeploy.",
      },
      token_exchange_failed: {
        title: "Gmail token exchange failed",
        description:
          "Google rejected the token request. Server admin: check the function log line `[donnit] gmail token exchange failed` for Google's `googleError` / `googleErrorDescription`. Then click Connect Gmail to try again.",
      },
      redirect_mismatch: {
        title: "Gmail redirect URI mismatch",
        description:
          "GOOGLE_REDIRECT_URI on the server does not match an Authorized redirect URI on the Google OAuth client. Server admin must align them and redeploy.",
      },
      invalid_client: {
        title: "Gmail OAuth client rejected",
        description:
          "Google did not accept GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Server admin must verify the secret matches the client (no whitespace, same project, not rotated) and redeploy.",
      },
      invalid_grant: {
        title: "Gmail authorization could not be completed",
        description:
          "The authorization code was expired or already used (often from a double redirect or browser back). Click Connect Gmail to start a fresh authorization.",
      },
      invalid_request: {
        title: "Gmail token request was malformed",
        description:
          "Google rejected the token request as invalid_request. This usually means a required field (often redirect_uri) is missing or malformed in the server config. Server admin: check the function log line `[donnit] gmail token exchange failed` for the offending field.",
      },
      persist_failed: {
        title: "Could not save Gmail connection",
        description: "Database write failed. Click Connect Gmail to try again, or contact support if it persists.",
      },
      missing_table: {
        title: "Gmail table not found in Supabase",
        description:
          "donnit.gmail_accounts does not exist. Server admin: apply supabase/migrations/0006_email_suggestions_body_and_gmail_accounts.sql to project bchwrbqaacdijavtugdt and ensure the donnit schema is exposed in Project Settings → API → Exposed schemas.",
      },
      schema_not_exposed: {
        title: "donnit schema not exposed in Supabase",
        description:
          "Server admin: in Supabase → Project Settings → API → Exposed schemas, add 'donnit' alongside 'public', then redeploy.",
      },
      fk_missing_profile_or_org: {
        title: "Profile or workspace not bootstrapped",
        description:
          "The donnit profile or organization referenced by your account does not exist yet. Sign out, sign back in to bootstrap your workspace, then click Connect Gmail again.",
      },
      missing_required_column: {
        title: "Gmail account row missing a required column",
        description:
          "Server admin: see function log line `[donnit] gmail upsert failed` for the column that was null. Most often signals a stale schema.",
      },
      rls_denied: {
        title: "Gmail save blocked by Supabase RLS",
        description:
          "Postgres rejected the write with a row-level-security violation. If /api/health/db reports OK, the service-role key is fine — re-sign-in to bootstrap your donnit profile and try again, or check the function log line `[donnit] gmail upsert failed` for code/details/hint.",
      },
      permission_denied_grants_missing: {
        title: "Gmail save blocked: missing table grants",
        description:
          "Postgres returned 42501 permission denied. The service-role key is valid (health/db OK) but the donnit schema is missing INSERT/UPDATE grants for service_role. Server admin: apply supabase/migrations/0007_grant_service_role_donnit_tables.sql and redeploy.",
      },
      gmail_persist_error: {
        title: "Could not save Gmail connection",
        description:
          "The Gmail tokens were obtained but Supabase rejected the write. The service-role key is valid (preflight HEAD succeeded). Server admin: see the function log line `[donnit] gmail upsert failed` for the exact code, message, details, and hint.",
      },
      invalid_column: {
        title: "Gmail schema mismatch",
        description:
          "donnit.gmail_accounts is missing a column the server expects. Server admin: re-apply migration 0006 to project bchwrbqaacdijavtugdt.",
      },
      network_unreachable: {
        title: "Supabase unreachable from Vercel",
        description:
          "The server could not reach Supabase to save the Gmail connection. Server admin: verify SUPABASE_URL is correct and the project is not paused, then call /api/health/db for details.",
      },
      invalid_service_role_or_url: {
        title: "Supabase rejected the server key",
        description:
          "Supabase returned 401/403 for the service-role request. Server admin: rotate SUPABASE_SERVICE_ROLE_KEY in Vercel to the project's service_role key (not anon), confirm SUPABASE_URL points at the same project, and redeploy.",
      },
      wrong_project_or_key: {
        title: "Supabase project / key mismatch",
        description:
          "The deployed SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY appear to come from different projects (donnit.profiles and donnit.gmail_accounts both fail). Server admin: copy URL + service_role from the SAME project (bchwrbqaacdijavtugdt) and redeploy.",
      },
      postgrest_error: {
        title: "Supabase returned an error",
        description:
          "PostgREST refused the write. Server admin: hit /api/health/db for the exact code/message and the response body.",
      },
      unknown_with_message: {
        title: "Could not save Gmail connection",
        description:
          "Database write failed with an unrecognized error. Server admin: see /api/health/db for the exact message and the response body.",
      },
      unexpected: {
        title: "Gmail connect failed",
        description: "An unexpected error occurred. Click Connect Gmail to try again.",
      },
    };
    const entry = map[gmailParam] ?? {
      title: "Gmail connect failed",
      description: "Click Connect Gmail to try again.",
    };
    // Append Google's own short description if present so the operator sees
    // exactly what Google said (e.g. "Bad Request", "redirect_uri_mismatch").
    // Already clamped to 200 chars on the server.
    const description = googleError
      ? `${entry.description} (Google: ${googleError}${googleErrorDescription ? ` — ${googleErrorDescription}` : ""})`
      : entry.description;
    toast({ title: entry.title, description, variant: "destructive" });
  }, []);

  const connectGmail = useMutation({
    mutationFn: async (popup?: Window | null) => {
      const res = await apiRequest("POST", "/api/integrations/gmail/oauth/connect");
      const result = (await res.json()) as { ok: boolean; url?: string };
      return { ...result, popup };
    },
    onSuccess: (result) => {
      if (!result?.url) return;
      if (result.popup && !result.popup.closed) {
        result.popup.location.href = result.url;
        setGoogleConnectPolling(true);
        toast({
          title: "Google opened separately",
          description: "Finish authorization in the Google window. Donnit will stay open here.",
        });
        return;
      }
      toast({
        title: "Allow popups to connect Google",
        description: "Donnit keeps you signed in by opening Google authorization in a separate window.",
        variant: "destructive",
      });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const isNotConfigured = message.startsWith("412:");
      toast({
        title: isNotConfigured ? "Gmail OAuth not configured" : "Could not start Gmail connect",
        description: isNotConfigured
          ? "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI on the server, then redeploy."
          : "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const startGoogleConnect = () => {
    let popup: Window | null = null;
    if (typeof window !== "undefined") {
      popup = window.open("", "donnit-google-connect", "popup,width=560,height=720");
      if (popup) {
        popup.document.title = "Connect Google";
        popup.document.body.innerHTML = "<p style=\"font-family: sans-serif; padding: 24px;\">Opening Google authorization...</p>";
      }
    }
    connectGmail.mutate(popup);
  };

  const disconnectGmail = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/integrations/gmail/oauth/disconnect");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/integrations/gmail/oauth/status"] });
      await invalidateWorkspace();
      toast({ title: "Gmail disconnected", description: "Donnit will no longer scan this Gmail account." });
    },
  });

  const scan = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/gmail/scan");
      return (await res.json()) as {
        ok: boolean;
        source?: "connector" | "oauth";
        scannedCandidates?: number;
        createdSuggestions?: number;
      };
    },
    onSuccess: async (result) => {
      await invalidateWorkspace();
      await queryClient.invalidateQueries({ queryKey: ["/api/integrations/gmail/oauth/status"] });
      const created = result?.createdSuggestions ?? 0;
      const scanned = result?.scannedCandidates ?? 0;
      toast({
        title: "Email scan complete",
        description:
          created > 0
            ? `Added ${created} new unread email${created === 1 ? "" : "s"} to your queue.`
            : scanned > 0
              ? "No new unread emails to add. Existing suggestions are already queued."
              : "No matching unread emails found.",
      });
      if (created > 0) {
        setApprovalInboxOpen(true);
      }
    },
    onError: (error: unknown) => {
      // apiRequest throws Error("<status>: <body>") on non-2xx. Parse the body
      // so we can surface a typed message rather than raw JSON. We never
      // display server JSON to users — only the strings below.
      const message = error instanceof Error ? error.message : String(error);
      const sep = message.indexOf(": ");
      let parsed: {
        reason?: string;
        message?: unknown;
        googleStatus?: number;
        googleError?: { status?: string; message?: string; reason?: string; domain?: string };
      } = {};
      if (sep > -1) {
        try {
          parsed = JSON.parse(message.slice(sep + 2));
        } catch {
          // body wasn't JSON; fall through to generic copy
        }
      }
      const reason = parsed.reason;
      const serverMessage =
        typeof parsed.message === "string"
          ? parsed.message
          : parsed.message && typeof parsed.message === "object"
            ? JSON.stringify(parsed.message).slice(0, 300)
            : undefined;
      const oauthConfigured = oauthStatus.data?.configured ?? false;

      // Reason -> {title, description, action} map. The action drives the
      // toast button so the user can connect/reconnect Gmail directly from
      // the failure toast instead of hunting for the right control.
      let title: string;
      let description: string;
      let action: { label: string; run: () => void } | null = null;

      if (reason === "gmail_oauth_not_connected") {
        title = "Connect Gmail to scan";
        description =
          "Donnit needs permission to read unread Gmail. Click Connect Gmail to authorize.";
        action = { label: "Connect Gmail", run: startGoogleConnect };
      } else if (
        reason === "gmail_oauth_token_invalid" ||
        reason === "gmail_auth_required" ||
        reason === "gmail_reconnect_required"
      ) {
        title = "Reconnect Gmail";
        description =
          serverMessage ??
          "Gmail authorization expired. Reconnect Gmail and try again.";
        action = { label: "Reconnect Gmail", run: startGoogleConnect };
      } else if (reason === "gmail_scope_missing") {
        title = "Reconnect Gmail with read access";
        description =
          serverMessage ??
          "Donnit's Gmail authorization is missing the gmail.readonly scope. Reconnect Gmail and accept the 'Read your email' permission on Google's consent screen.";
        action = { label: "Reconnect Gmail", run: startGoogleConnect };
      } else if (reason === "gmail_api_not_enabled") {
        title = "Enable Gmail API in Google Cloud";
        description =
          serverMessage ??
          "Gmail API is not enabled in the Google Cloud project tied to this OAuth client. Open console.cloud.google.com → APIs & Services → Library → Gmail API → Enable, then redeploy and try Scan email again.";
      } else if (reason === "gmail_api_forbidden") {
        title = "Gmail API access denied";
        description =
          serverMessage ??
          "Google rejected the Gmail API request as forbidden. Confirm the OAuth client and Gmail API are in the same Google Cloud project, and that your account is allowed to use this app.";
      } else if (reason === "gmail_rate_limited") {
        title = "Gmail API rate limit hit";
        description =
          serverMessage ?? "Wait about a minute and click Scan email again.";
      } else if (reason === "gmail_api_unavailable") {
        title = "Gmail API temporarily unavailable";
        description =
          serverMessage ?? "Google reports the Gmail API is unavailable. Try again shortly.";
      } else if (reason === "gmail_api_bad_request") {
        title = "Gmail API rejected the request";
        description =
          serverMessage ?? "Donnit sent a request Gmail rejected as malformed. Please report this.";
      } else if (reason === "gmail_oauth_not_configured") {
        title = "Email scan not available";
        description =
          "Google OAuth is not configured on this server. Ask the operator to set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI, then redeploy.";
      } else if (reason === "gmail_runtime_unavailable" || message.startsWith("503:")) {
        if (oauthConfigured) {
          title = "Email scan paused";
          description =
            "Gmail is temporarily unavailable. Try again in a moment.";
        } else {
          title = "Email scan not available";
          description =
            "Google OAuth is not configured on this server. Ask the operator to set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI, then redeploy.";
        }
      } else if (reason === "gmail_suggestion_persist_failed") {
        title = "Email suggestions could not be saved";
        description =
          serverMessage ??
          "Gmail was scanned, but Donnit could not save the suggestions. Check Supabase migrations and try again.";
      } else if (reason === "gmail_api_call_failed") {
        title = "Email scan unavailable";
        description =
          serverMessage ?? "Gmail API call failed. Try again shortly.";
      } else {
        title = "Email scan unavailable";
        description =
          serverMessage ??
          "Gmail scan failed. Try again shortly.";
      }

      toast({
        title,
        description,
        variant: "destructive",
        action: action
          ? (
              <ToastAction altText={action.label} onClick={action.run}>
                {action.label}
              </ToastAction>
            )
          : undefined,
      });
      // IMPORTANT: do NOT auto-open manual import. Manual paste is not the
      // primary product behavior; Scan email must always mean "scan unread
      // Gmail itself." The user can still reach manual import from the
      // diagnostic menu if they explicitly choose to.
    },
  });

  const buildAgenda = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/agenda");
      const agenda = (await res.json()) as AgendaItem[];
      await invalidateWorkspace();
      return agenda;
    },
    onSuccess: (agenda) => {
      setAgendaExcludedTaskIds(new Set());
      setAgendaApproved(false);
      persistAgendaState(new Set(), false, null, agendaPreferences, agendaTaskOrder);
      const minutes = agenda.reduce((sum, item) => sum + item.estimatedMinutes, 0);
      const scheduled = agenda.filter((item) => item.scheduleStatus === "scheduled").length;
      toast({
        title: "Agenda built",
        description:
          agenda.length > 0
            ? `${scheduled}/${agenda.length} task${agenda.length === 1 ? "" : "s"} scheduled for about ${minutes} minutes.`
            : "No open tasks are ready for today's agenda.",
      });
      window.setTimeout(() => {
        document.getElementById("panel-agenda")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
    },
  });

  const exportGoogleCalendar = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/google/calendar/export", {
        excludedTaskIds: Array.from(agendaExcludedTaskIds),
        preferences: agendaPreferences,
        taskOrder: agendaTaskOrder,
      });
      return (await res.json()) as { ok: boolean; exported: number; updated: number; skipped: number; total: number };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/gmail/oauth/status"] });
      const synced = result.exported + result.updated;
      toast({
        title: "Google Calendar updated",
        description: `${synced} scheduled block${synced === 1 ? "" : "s"} synced${result.skipped ? `, ${result.skipped} still needs a slot` : ""}.`,
      });
      setCalendarExportOpen(false);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      const needsReconnect =
        message.includes("calendar_scope_missing") ||
        message.includes("google_oauth_token_invalid") ||
        message.includes("google_oauth_not_connected");
      toast({
        title: needsReconnect ? "Reconnect Google" : "Calendar export failed",
        description: needsReconnect
          ? "Authorize Google Calendar access, then export the agenda again."
          : "Donnit could not add the agenda to Google Calendar. The .ics file export is still available.",
        variant: "destructive",
      });
    },
  });

  const metrics = useMemo(() => {
    const tasks = data?.tasks ?? [];
    const suggestions = data?.suggestions ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const waitingTasks = tasks.filter((t) => t.status === "pending_acceptance").length;
    const pendingSuggestions = suggestions.filter((s) => s.status === "pending").length;
    return {
      open: tasks.filter((t) => !["completed", "denied"].includes(t.status)).length,
      dueToday: tasks.filter((t) => t.dueDate === today && t.status !== "completed").length,
      needsAcceptance: waitingTasks,
      emailQueue: pendingSuggestions,
      completed: tasks.filter((t) => t.status === "completed").length,
    };
  }, [data?.tasks, data?.suggestions]);

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    [],
  );
  const rawNotifications = useMemo(
    () => buildNotifications(data?.tasks ?? [], data?.suggestions ?? []),
    [data?.tasks, data?.suggestions],
  );
  const notifications = useMemo(
    () => rawNotifications.filter((item) => !reviewedNotificationIds.has(item.id)),
    [rawNotifications, reviewedNotificationIds],
  );
  const positionProfiles = useMemo(
    () => buildPositionProfiles(data?.tasks ?? [], data?.users ?? [], data?.events ?? [], data?.positionProfiles ?? []),
    [data?.tasks, data?.users, data?.events, data?.positionProfiles],
  );
  const orderedAgenda = useMemo(
    () => orderAgendaItems(data?.agenda ?? [], agendaTaskOrder),
    [agendaTaskOrder, data?.agenda],
  );
  const approvedAgenda = useMemo(
    () => orderedAgenda.filter((item) => !agendaExcludedTaskIds.has(String(item.taskId))),
    [agendaExcludedTaskIds, orderedAgenda],
  );
  const markNotificationsReviewed = (ids: string[]) => {
    if (ids.length === 0) return;
    setReviewedNotificationIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.add(id));
      const nextIds = Array.from(next).slice(-200);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("donnit.reviewedNotifications", JSON.stringify(nextIds));
      }
      persistWorkspaceState({ key: "reviewed_notifications", value: { ids: nextIds } });
      return next;
    });
  };
  const setActiveWorkTask = (taskId: Id | null) => {
    const next = taskId === null ? null : String(taskId);
    setActiveTaskId(next);
    if (typeof window === "undefined") return;
    if (next) window.localStorage.setItem("donnit.activeTaskId", next);
    else window.localStorage.removeItem("donnit.activeTaskId");
  };
  useEffect(() => {
    if (!activeTaskId || !data?.tasks) return;
    const taskStillActive = data.tasks.some(
      (task) => String(task.id) === activeTaskId && task.status !== "completed" && task.status !== "denied",
    );
    if (!taskStillActive) setActiveWorkTask(null);
  }, [activeTaskId, data?.tasks]);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="panel max-w-md p-6 text-center">
          <p className="display-font text-lg font-bold">Could not load Donnit</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Restart the development server and try again.
          </p>
        </div>
      </main>
    );
  }

  const oauthData = oauthStatus.data;
  const currentUser = data.users.find((user) => String(user.id) === String(data.currentUserId)) ?? null;
  const activeTask = data.tasks.find((task) => String(task.id) === activeTaskId) ?? null;
  const notificationTask = data.tasks.find((task) => String(task.id) === notificationTaskId) ?? null;
  const canManagePositionProfiles = canAdministerProfiles(currentUser);
  const showConnectGmail = Boolean(oauthData?.configured && !oauthData?.connected);
  const needsReconnect = Boolean(oauthData?.requiresReconnect);
  const focusChatInput = () => {
    const el = document.getElementById("chat-message") as HTMLTextAreaElement | null;
    el?.focus();
  };
  const dismissOnboarding = (dismissed: boolean) => {
    setOnboardingDismissed(dismissed);
    setOnboardingManuallyOpen(false);
    persistWorkspaceState({
      key: "onboarding_state",
      value: {
        dismissed,
        dismissedAt: dismissed ? new Date().toISOString() : null,
      },
    });
  };
  const onboardingSteps: OnboardingStep[] = [
    {
      id: "connect-google",
      title: "Connect Google",
      detail: "Enable Gmail scan and calendar scheduling from the same account.",
      done: Boolean(oauthData?.connected),
      actionLabel: oauthData?.connected ? "Connected" : needsReconnect ? "Reconnect" : "Connect",
      onAction: startGoogleConnect,
    },
    {
      id: "capture-work",
      title: "Capture first work",
      detail: "Use chat, import a document, or scan email to create the first work queue.",
      done: data.tasks.length > 0 || data.suggestions.length > 0,
      actionLabel: "Capture",
      onAction: focusChatInput,
    },
    {
      id: "approve-queue",
      title: "Review suggestions",
      detail: "Approve, edit, or dismiss AI-suggested tasks before they enter the list.",
      done: data.suggestions.some((suggestion) => suggestion.status !== "pending") || data.tasks.some((task) => ["email", "slack", "sms", "document"].includes(task.source)),
      actionLabel: "Review",
      onAction: () => setApprovalInboxOpen(true),
    },
    {
      id: "agenda",
      title: "Build agenda",
      detail: "Turn open work into a day plan before exporting to calendar.",
      done: orderedAgenda.length > 0 || agendaApproved,
      actionLabel: "Build",
      onAction: () => {
        setSupportView("agenda");
        buildAgenda.mutate();
      },
    },
    {
      id: "position-profile",
      title: "Confirm role memory",
      detail: "Open Position Profiles and make sure recurring work has a home.",
      done: positionProfiles.some((profile) => profile.persisted || profile.currentIncompleteTasks.length > 0 || profile.recurringTasks.length > 0),
      actionLabel: "Open",
      onAction: () => setWorkspaceSettingsOpen(true),
    },
  ];
  const openOnboardingChecklist = () => {
    setOnboardingDismissed(false);
    setOnboardingManuallyOpen(true);
    persistWorkspaceState({
      key: "onboarding_state",
      value: {
        dismissed: false,
        dismissedAt: null,
      },
    });
    window.setTimeout(() => {
      document.getElementById("panel-onboarding-checklist")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };
  const showOnboarding = onboardingManuallyOpen || (!onboardingDismissed && onboardingSteps.some((step) => !step.done));
  const scrollToReporting = () => {
    setSupportView("reports");
    window.setTimeout(() => {
      document.getElementById("panel-reporting")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };
  const goHome = () => {
    setManualImportOpen(false);
    setDocumentImportOpen(false);
    setAssignTaskOpen(false);
    setCalendarExportOpen(false);
    setWorkspaceSettingsOpen(false);
    setApprovalInboxOpen(false);
    setAgendaWorkOpen(false);
    setNotificationTaskId(null);
    setSupportView("today");
    window.location.hash = "/app";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const addTaskActions: FunctionAction[] = [
    {
      id: "create-todo",
      label: "Chat to task",
      icon: ListPlus,
      primary: true,
      onClick: focusChatInput,
      hint: "Focus chat to dictate a new list",
    },
    {
      id: "import-document",
      label: "Import doc",
      icon: FileText,
      onClick: () => setDocumentImportOpen(true),
      hint: "Upload a PDF or Word document and queue task suggestions",
    },
    {
      id: "import-email",
      label: "Import email",
      icon: MailPlus,
      onClick: () => setManualImportOpen(true),
      hint: "Paste an email into the approval queue",
    },
    {
      id: "assign-task",
      label: "Assign task",
      icon: UserPlus,
      onClick: () => setAssignTaskOpen(true),
      hint: "Create and assign a task",
    },
  ];
  const dailyActions: FunctionAction[] = [
    {
      id: "approval-inbox",
      label: "Approval inbox",
      icon: Inbox,
      primary: metrics.emailQueue + metrics.needsAcceptance > 0,
      onClick: () => setApprovalInboxOpen(true),
      hint: "Approve suggested and assigned tasks",
    },
    {
      id: "scan-email",
      label: "Scan email",
      icon: Inbox,
      onClick: () => scan.mutate(),
      loading: scan.isPending,
      hint: oauthData?.connected
        ? `Scan unread Gmail for ${oauthData.email ?? "your inbox"}`
        : "Scan unread Gmail and queue suggested tasks",
    },
    {
      id: "build-agenda",
      label: "Build agenda",
      icon: Workflow,
      onClick: () => {
        setSupportView("agenda");
        buildAgenda.mutate();
      },
      loading: buildAgenda.isPending,
      hint: "Refresh and confirm today's priority order",
    },
  ];
  const toolsSyncActions: FunctionAction[] = [
    {
      id: "export-calendar",
      label: "Export calendar",
      icon: CalendarPlus,
      onClick: () => setCalendarExportOpen(true),
      disabled: !agendaApproved || approvedAgenda.length === 0,
      hint: agendaApproved
        ? "Add the approved agenda to Google Calendar or download an .ics file"
        : "Approve the agenda before exporting",
    },
    {
      id: "manual-email-import",
      label: "Import email",
      icon: MailPlus,
      onClick: () => setManualImportOpen(true),
      hint: "Paste an email into the approval queue",
    },
    ...(showConnectGmail
      ? [
          {
            id: "connect-gmail",
            label: needsReconnect ? "Reconnect Gmail" : "Connect Gmail",
            icon: MailPlus,
            primary: needsReconnect,
            onClick: startGoogleConnect,
            loading: connectGmail.isPending,
            hint: needsReconnect
              ? "Gmail authorization expired - re-authorize to resume scans"
              : "Authorize Donnit to scan your unread Gmail",
          } satisfies FunctionAction,
        ]
      : []),
    ...(oauthData?.connected
      ? [
          {
            id: "disconnect-gmail",
            label: "Disconnect Gmail",
            icon: MailPlus,
            onClick: () => disconnectGmail.mutate(),
            loading: disconnectGmail.isPending,
            hint: oauthData.email
              ? `Stop scanning ${oauthData.email}`
              : "Stop scanning Gmail",
          } satisfies FunctionAction,
        ]
      : []),
  ];
  const adminActions: FunctionAction[] = [
    ...(canManagePositionProfiles
      ? [
          {
            id: "position-profiles",
            label: "Position Profiles",
            icon: BriefcaseBusiness,
            onClick: () => setWorkspaceSettingsOpen(true),
            hint: "Open the admin repository of job-title profiles",
          } satisfies FunctionAction,
        ]
      : []),
    {
      id: "workspace-settings",
      label: "Workspace settings",
      icon: Settings,
      onClick: () => setWorkspaceSettingsOpen(true),
      hint: "Admin, manager, integration, and role settings",
    },
  ];
  const workspaceActions: FunctionAction[] = [
    {
      id: "setup-checklist",
      label: "Setup checklist",
      icon: Sparkles,
      onClick: openOnboardingChecklist,
      hint: "Show the first-value onboarding checklist",
    },
    {
      id: "manager-report",
      label: "Reporting",
      icon: BarChart3,
      onClick: scrollToReporting,
      hint: "Review manager metrics and source mix",
    },
    {
      id: "view-log",
      label: "View log",
      icon: History,
      onClick: () => {
        window.location.hash = "/log";
      },
    },
  ];
  const menuGroups: MenuActionGroup[] = [
    { label: "Tools sync", actions: toolsSyncActions },
    { label: "Admin", actions: adminActions },
    { label: "Workspace", actions: workspaceActions },
  ].filter((group) => group.actions.length > 0);

  return (
    <main
      className="min-h-screen bg-background"
      data-testid="page-command-center"
    >
      {/* Top bar with brand + status + theme + sign out */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <Wordmark onClick={goHome} />
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Chat it in. Cross it off. Done.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="hidden text-xs text-muted-foreground md:inline"
              data-testid="text-app-mode"
            >
              {auth.authenticated
                ? `signed in as ${auth.email ?? "you"}`
                : supabaseConfig.configured
                ? "build preview"
                : "demo (Supabase not configured)"}
            </span>
            <WorkspaceMenu primaryActions={dailyActions} menuGroups={menuGroups} />
            <NotificationCenter
              notifications={notifications}
              onReviewed={markNotificationsReviewed}
              onOpenNotification={(notification) => {
                if (notification.source === "approval") {
                  setApprovalInboxOpen(true);
                  return;
                }
                if (notification.taskId) {
                  setNotificationTaskId(String(notification.taskId));
                }
              }}
            />
            <ThemeToggle />
            {auth.authenticated && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => auth.signOut()}
                data-testid="button-signout"
              >
                Sign out
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Workspace: chat left, work area right (To-do dominant) */}
      <section className="mx-auto max-w-[1600px] px-4 py-3 lg:px-6">
        <div className="grid gap-4 lg:grid-cols-12">
          {/* Chat — left */}
          <div className="lg:sticky lg:top-[4.75rem] lg:col-span-4 lg:h-[calc(100dvh-5.75rem)] lg:self-start xl:col-span-3">
            <ChatPanel messages={data.messages} />
          </div>

          {/* Work area — right */}
          <div className="lg:col-span-8 xl:col-span-9">
            {showOnboarding && (
              <OnboardingChecklist
                steps={onboardingSteps}
                onDismiss={() => dismissOnboarding(true)}
              />
            )}
            <div className="mb-4 flex flex-col gap-3 border-b border-border pb-3">
              <FunctionBar addTaskActions={addTaskActions} primaryActions={dailyActions} />
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span className="ui-label">Today - {todayLabel}</span>
                <Stat label="Open" value={metrics.open} />
                <Stat label="Due today" value={metrics.dueToday} />
                <Stat label="Needs acceptance" value={metrics.needsAcceptance} />
                <Stat label="Approval queue" value={metrics.emailQueue} />
                <Stat label="Completed" value={metrics.completed} />
              </div>
            </div>
            <div className="grid gap-4 xl:grid-cols-12">
              {/* Wide To-do column */}
              <div className="xl:col-span-8">
                <TaskList
                  tasks={data.tasks}
                  users={data.users}
                  subtasks={data.subtasks ?? []}
                  authenticated={Boolean(data.authenticated)}
                  viewLabel="All workspace work"
                  onPinTask={(taskId) => setActiveWorkTask(taskId)}
                />
              </div>
              {/* Focused command rail */}
              <div className="xl:col-span-4">
                <SupportRail
                  view={supportView}
                  onViewChange={setSupportView}
                  tasks={data.tasks}
                  suggestions={data.suggestions}
                  users={data.users}
                  subtasks={data.subtasks ?? []}
                  authenticated={Boolean(data.authenticated)}
                  currentUserId={data.currentUserId}
                  events={data.events}
                  agenda={orderedAgenda}
                  excludedTaskIds={agendaExcludedTaskIds}
                  agendaApproved={agendaApproved}
                  agendaPreferences={agendaPreferences}
                  onOpenInbox={() => setApprovalInboxOpen(true)}
                  onBuildAgenda={() => buildAgenda.mutate()}
                  onToggleAgendaTask={(taskId) => {
                    setAgendaApproved(false);
                    setAgendaExcludedTaskIds((current) => {
                      const next = new Set(current);
                      const id = String(taskId);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      persistAgendaState(next, false, null, agendaPreferences, agendaTaskOrder);
                      return next;
                    });
                  }}
                  onMoveAgendaTask={(taskId, direction) => {
                    setAgendaApproved(false);
                    setAgendaTaskOrder((current) => {
                      const ids = orderedAgenda.map((item) => String(item.taskId));
                      const next = current.length > 0 ? [...current] : ids;
                      for (const id of ids) {
                        if (!next.includes(id)) next.push(id);
                      }
                      const index = next.indexOf(String(taskId));
                      const target = direction === "up" ? index - 1 : index + 1;
                      if (index < 0 || target < 0 || target >= next.length) return next;
                      [next[index], next[target]] = [next[target], next[index]];
                      persistAgendaState(agendaExcludedTaskIds, false, null, agendaPreferences, next);
                      return next;
                    });
                  }}
                  onUpdateAgendaPreferences={(preferences) => {
                    const next = normalizeAgendaPreferences(preferences);
                    setAgendaApproved(false);
                    setAgendaPreferences(next);
                    persistAgendaState(agendaExcludedTaskIds, false, null, next, agendaTaskOrder);
                  }}
                  onApproveAgenda={() => {
                    setAgendaApproved(true);
                    persistAgendaState(agendaExcludedTaskIds, true, new Date().toISOString(), agendaPreferences, agendaTaskOrder);
                    toast({ title: "Agenda approved", description: "Approved agenda blocks are ready for calendar export." });
                  }}
                  onOpenAgendaWork={() => setAgendaWorkOpen(true)}
                  onExportAgenda={() => setCalendarExportOpen(true)}
                  isBuildingAgenda={buildAgenda.isPending}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <ManualEmailImportDialog open={manualImportOpen} onOpenChange={setManualImportOpen} />
      <DocumentImportDialog
        open={documentImportOpen}
        onOpenChange={setDocumentImportOpen}
        onOpenApprovalInbox={() => setApprovalInboxOpen(true)}
      />
      <ApprovalInboxDialog
        open={approvalInboxOpen}
        onOpenChange={setApprovalInboxOpen}
        tasks={data.tasks}
        suggestions={data.suggestions}
        onScanEmail={() => scan.mutate()}
        scanningEmail={scan.isPending}
        onOpenManualImport={() => setManualImportOpen(true)}
      />
      <AgendaWorkDialog
        open={agendaWorkOpen}
        onOpenChange={setAgendaWorkOpen}
        agenda={approvedAgenda}
        tasks={data.tasks}
        users={data.users}
        subtasks={data.subtasks ?? []}
        authenticated={Boolean(data.authenticated)}
        onPinTask={(taskId) => setActiveWorkTask(taskId)}
      />
      <CalendarExportDialog
        open={calendarExportOpen}
        onOpenChange={setCalendarExportOpen}
        agenda={approvedAgenda}
        oauthStatus={oauthData}
        onDownload={() => downloadAgendaCalendar(approvedAgenda)}
        onExportGoogle={() => exportGoogleCalendar.mutate()}
        onReconnectGoogle={startGoogleConnect}
        isExportingGoogle={exportGoogleCalendar.isPending}
        isReconnectingGoogle={connectGmail.isPending}
      />
      <AssignTaskDialog
        open={assignTaskOpen}
        onOpenChange={setAssignTaskOpen}
        users={data.users}
        currentUserId={data.currentUserId}
      />
      <WorkspaceSettingsDialog
        open={workspaceSettingsOpen}
        onOpenChange={setWorkspaceSettingsOpen}
        currentUser={currentUser}
        authenticated={Boolean(data.authenticated)}
        users={data.users}
        positionProfiles={positionProfiles}
        currentUserId={data.currentUserId}
        integrations={data.integrations}
        oauthStatus={oauthData}
        onConnectGmail={startGoogleConnect}
        onDisconnectGmail={() => disconnectGmail.mutate()}
        onScanEmail={() => scan.mutate()}
        onOpenCalendarExport={() => setCalendarExportOpen(true)}
        isConnectingGmail={connectGmail.isPending}
        isDisconnectingGmail={disconnectGmail.isPending}
        isScanningEmail={scan.isPending}
      />
      <TaskDetailDialog
        task={notificationTask}
        users={data.users}
        subtasks={data.subtasks ?? []}
        authenticated={Boolean(data.authenticated)}
        open={Boolean(notificationTask)}
        onOpenChange={(open) => {
          if (!open) setNotificationTaskId(null);
        }}
      />
      <FloatingTaskBox task={activeTask} users={data.users} onClose={() => setActiveWorkTask(null)} />

      <footer className="border-t border-border bg-background/80">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground lg:px-6">
          <span>
            Auth: {data.integrations.auth.provider} · Email loop:{" "}
            {data.integrations.email.provider}
            {oauthData?.connected
              ? ` · Gmail OAuth: ${oauthData.email ?? "connected"}`
              : oauthData?.requiresReconnect
                ? " · Gmail OAuth: needs reconnect"
                : oauthData?.configured && !oauthData?.connected
                  ? " · Gmail OAuth: not connected"
                  : !oauthData?.configured
                    ? " · Gmail OAuth: not configured"
                    : null}
          </span>
          <span className="flex items-center gap-3">
            <span>
              Reminders: {data.integrations.reminders.channelOrder.join(" → ")}
            </span>
          </span>
        </div>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="ui-label" style={{ color: "hsl(var(--muted-foreground))" }}>
        {label}
      </span>
      <span className="font-display text-base font-bold tabular-nums text-foreground">
        {value}
      </span>
    </span>
  );
}

function LogPage() {
  const { data, isLoading } = useBootstrap();
  if (isLoading || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-background p-4 lg:p-6" data-testid="page-log">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <Wordmark />
            <h1 className="work-heading mt-2">Audit log</h1>
            <p className="text-sm text-muted-foreground">
              Every task action with actor and timestamp.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              window.location.hash = "/app";
            }}
          >
            Back to workspace
          </Button>
        </div>
        <div className="panel">
          <div className="border-b border-border px-4 py-3">
            <h2 className="display-font text-sm font-bold">
              <Archive className="mr-2 inline size-4" />
              Activity
            </h2>
          </div>
          <ul className="divide-y divide-border">
            {data.events.map((event) => {
              const task = data.tasks.find((t) => t.id === event.taskId);
              const user = data.users.find((u) => u.id === event.actorId);
              const isComplete = event.type === "completed";
              return (
                <li key={event.id} className="px-4 py-3" data-testid={`row-event-${event.id}`}>
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-2 size-2 shrink-0 rounded-full ${
                        isComplete ? "bg-brand-green" : "bg-muted-foreground/40"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {event.type.replace(/_/g, " ")} ·{" "}
                        {task?.title ?? `Task ${event.taskId}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {user?.name ?? "Unknown"} ·{" "}
                        {new Date(event.createdAt).toLocaleString()}
                      </p>
                      {event.note && (
                        <p className="mt-1 text-xs text-foreground">{event.note}</p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </main>
  );
}

function ProtectedCommandCenter() {
  return <AuthGate>{(auth) => <CommandCenter auth={auth} />}</AuthGate>;
}

function ProtectedLogPage() {
  return <AuthGate>{() => <LogPage />}</AuthGate>;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={DonnitLandingPage} />
      <Route path="/app" component={ProtectedCommandCenter} />
      <Route path="/log" component={ProtectedLogPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppShell() {
  return (
    <Router hook={useHashLocation}>
      <AppRouter />
    </Router>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppShell />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

// Type-only re-exports kept for compatibility with any other modules that
// imported these from App.tsx historically.
export type {
  Task,
  TaskEvent,
  ChatMessage,
  EmailSuggestion,
  AgendaItem,
  Bootstrap,
  User,
};
