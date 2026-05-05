import { useEffect, useMemo, useState } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import {
  Archive,
  Bell,
  CalendarClock,
  CalendarCheck,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Eye,
  FileText,
  History,
  Inbox,
  ListChecks,
  ListPlus,
  Loader2,
  MailPlus,
  Menu,
  Moon,
  RefreshCcw,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  UserPlus,
  UserRoundCheck,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { queryClient, apiRequest } from "./lib/queryClient";
import { AuthGate, type AuthedContext } from "@/components/AuthGate";
import { supabaseConfig } from "@/lib/supabase";
import { Toaster } from "@/components/ui/toaster";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
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
  agenda: AgendaItem[];
  integrations: {
    auth: { provider: string; status: string; projectId: string; schema?: string };
    email: { provider: string; sourceId: string; status: string; mode: string };
    slack?: { provider: string; status: string; mode: string };
    sms?: { provider: string; status: string; mode: string };
    reminders: { channelOrder: string[]; reminderOrder: string[] };
    app: { delivery: string; native: string };
  };
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

function Wordmark() {
  return (
    <span className="brand-lockup" aria-label="Donnit">
      <span className="brand-mark" aria-hidden="true">
        <Check className="size-4" strokeWidth={3.25} />
      </span>
      <span className="brand-text" aria-hidden="true">
        <span className="brand-text-base">Donn</span>
        <span className="brand-text-accent">it</span>
      </span>
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

function FunctionBar({ primaryActions }: { primaryActions: FunctionAction[] }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="bar-functions"
      role="toolbar"
      aria-label="Workspace functions"
    >
      {primaryActions.map((action) => (
        <FunctionActionButton key={action.id} action={action} />
      ))}
    </div>
  );
}

function ChatPanel({ messages }: { messages: ChatMessage[] }) {
  const [message, setMessage] = useState("");
  const chat = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/chat", { message }),
    onSuccess: async () => {
      setMessage("");
      await invalidateWorkspace();
    },
  });

  return (
    <div className="panel flex h-[520px] max-h-[calc(100vh-10.5rem)] min-h-[420px] flex-col lg:h-[calc(100vh-10.5rem)]" data-testid="panel-chat">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-brand-green" />
          <h2 className="display-font text-base font-bold leading-none">Quick add</h2>
        </div>
        <span className="ui-label">AI parser</span>
      </div>

      <div
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
          className="h-20 max-h-20 min-h-0 resize-none overflow-y-auto focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-1"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              if (message.trim().length >= 2) chat.mutate();
            }
          }}
          data-testid="input-chat-message"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Ctrl + Enter to send</span>
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

function TaskRow({
  task,
  users,
  onComplete,
  onOpen,
  isCompleting,
}: {
  task: Task;
  users: User[];
  onComplete: () => void;
  onOpen: () => void;
  isCompleting: boolean;
}) {
  const assignee = users.find((user) => user.id === task.assignedToId);
  const delegate = users.find((user) => String(user.id) === String(task.delegatedToId));
  const collaboratorCount = task.collaboratorIds?.length ?? 0;
  const isDone = task.status === "completed";

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
          <span className="ui-label whitespace-nowrap" data-testid={`text-task-urgency-${task.id}`}>
            {urgencyLabel(task.urgency)}
          </span>
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
        </div>
      </div>
    </div>
  );
}

function TaskList({ tasks, users }: { tasks: Task[]; users: User[] }) {
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

  // Sort: due date asc (nulls last), then urgency, then completion last.
  const urgencyRank: Record<string, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    medium: 2,
    low: 3,
  };

  const sorted = [...tasks].sort((a, b) => {
    const aDone = a.status === "completed" ? 1 : 0;
    const bDone = b.status === "completed" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return (urgencyRank[a.urgency] ?? 4) - (urgencyRank[b.urgency] ?? 4);
  });

  const open = sorted.filter((t) => t.status !== "completed");
  const done = sorted.filter((t) => t.status === "completed");

  return (
    <div className="panel flex flex-col" data-testid="panel-tasks">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="work-heading">To do</h2>
          <p className="ui-label mt-1">Sorted by due date, then urgency</p>
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
          open.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              users={users}
              isCompleting={completingId === task.id && complete.isPending}
              onComplete={() => complete.mutate(task.id)}
              onOpen={() => setSelectedTaskId(String(task.id))}
            />
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
              />
            ))}
          </>
        )}
      </div>
      <TaskDetailDialog
        task={selectedTask}
        users={users}
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
  open,
  onOpenChange,
}: {
  task: Task | null;
  users: User[];
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
  }, [task]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
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
                max={480}
                step={5}
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
  onBuild,
  onExport,
  isBuilding,
}: {
  agenda: AgendaItem[];
  onBuild: () => void;
  onExport: () => void;
  isBuilding: boolean;
}) {
  const totalMinutes = agenda.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const scheduledCount = agenda.filter((item) => item.scheduleStatus === "scheduled").length;
  return (
    <div className="panel" data-testid="panel-agenda" id="panel-agenda">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="display-font text-sm font-bold">Agenda</h3>
          <p className="ui-label mt-1">
            {agenda.length > 0 ? `${scheduledCount}/${agenda.length} scheduled / ${totalMinutes} min` : "No blocks yet"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
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
            onClick={onExport}
            disabled={agenda.length === 0}
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
          <ol className="space-y-2">
            {agenda.map((item) => (
              <li
                key={`${item.taskId}-${item.order}`}
                className={`task-row ${urgencyClass(item.urgency)}`}
                data-testid={`row-agenda-${item.taskId}`}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold tabular-nums">
                  {item.order}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug text-foreground">{item.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatAgendaSlot(item)} / {item.estimatedMinutes} min / {urgencyLabel(item.urgency)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
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
    <div className="panel" data-testid="panel-reporting">
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

function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <p className="ui-label">{label}</p>
      <p className="display-font mt-1 text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

function TeamProfilesPanel({ tasks, users }: { tasks: Task[]; users: User[] }) {
  const profiles = users.map((user) => {
    const owned = tasks.filter((task) => String(task.assignedToId) === String(user.id));
    const open = owned.filter((task) => task.status !== "completed" && task.status !== "denied");
    const recurring = owned.filter((task) => task.recurrence !== "none");
    const completed = owned.filter((task) => task.status === "completed");
    const sources = Array.from(new Set(owned.map((task) => task.source))).slice(0, 3);
    return { user, owned, open, recurring, completed, sources };
  });

  return (
    <div className="panel" data-testid="panel-team-profiles">
      <div className="border-b border-border px-4 py-3">
        <h3 className="display-font text-sm font-bold">Team memory</h3>
        <p className="ui-label mt-1">Work profile and handoff signal</p>
      </div>
      <div className="space-y-2 px-4 py-3">
        {profiles.map((profile) => (
          <div key={String(profile.user.id)} className="rounded-md border border-border bg-background px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{profile.user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{profile.user.role} - {profile.user.persona}</p>
              </div>
              <span className="ui-label whitespace-nowrap">{profile.open.length} open</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              <span className="rounded-md bg-muted px-2 py-1">{profile.completed.length} done</span>
              <span className="rounded-md bg-muted px-2 py-1">{profile.recurring.length} recurring</span>
              {profile.sources.map((source) => (
                <span key={`${profile.user.id}-${source}`} className="rounded-md bg-muted px-2 py-1">
                  {source}
                </span>
              ))}
            </div>
          </div>
        ))}
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

  const visibleSuggestions = pendingSuggestions.slice(0, 3);
  const remainingSuggestionsAfterVisible = Math.max(
    0,
    pendingSuggestions.length - visibleSuggestions.length,
  );

  return (
    <div className="panel" data-testid="panel-acceptance">
      <div className="border-b border-border px-4 py-3">
        <h3 className="display-font text-sm font-bold">Waiting on you</h3>
        <p className="ui-label mt-1">Acceptances above · email queue below</p>
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
                approving={approveSuggestion.isPending}
                dismissing={dismissSuggestion.isPending}
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

function SuggestionCard({
  suggestion,
  onApprove,
  onDismiss,
  approving,
  dismissing,
}: {
  suggestion: EmailSuggestion;
  onApprove: () => void;
  onDismiss: () => void;
  approving: boolean;
  dismissing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const actionItems = suggestion.actionItems ?? [];
  const body = (suggestion.body ?? "").trim();
  const preview = (suggestion.preview ?? body.slice(0, 240)).trim();
  const sourceLabel = suggestion.fromEmail.toLowerCase().startsWith("slack:")
    ? "Slack"
    : suggestion.fromEmail.toLowerCase().startsWith("sms:")
      ? "SMS"
      : "Email";
  return (
    <div
      className={`task-row ${urgencyClass(suggestion.urgency)} flex-col items-stretch`}
      data-testid={`row-suggestion-${suggestion.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground break-words" data-testid={`text-suggestion-title-${suggestion.id}`}>
            {suggestion.suggestedTitle}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground break-words" data-testid={`text-suggestion-from-${suggestion.id}`}>
            {sourceLabel} - {suggestion.fromEmail} - {formatReceivedAt(suggestion.receivedAt ?? null)}
          </p>
          <p className="mt-0.5 text-xs italic text-muted-foreground break-words">
            Source: {suggestion.subject}
          </p>
        </div>
        {suggestion.suggestedDueDate && (
          <span className="ui-label whitespace-nowrap text-[10px]">
            Due {suggestion.suggestedDueDate}
          </span>
        )}
      </div>

      {actionItems.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-foreground" data-testid={`list-action-items-${suggestion.id}`}>
          {actionItems.map((item, index) => (
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
        <Button
          size="sm"
          onClick={onApprove}
          disabled={approving || dismissing}
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
      </div>
    </div>
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

type DerivedNotification = {
  id: string;
  title: string;
  detail: string;
  severity: "high" | "normal" | "low";
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
    });
  }

  for (const task of active) {
    if (task.dueDate && task.dueDate < today) {
      items.push({
        id: `overdue-${task.id}`,
        title: "Past due",
        detail: task.title,
        severity: "high",
      });
    } else if (task.dueDate && task.dueDate <= soonIso) {
      items.push({
        id: `soon-${task.id}`,
        title: task.dueDate === today ? "Due today" : "Due soon",
        detail: task.title,
        severity: task.urgency === "critical" || task.urgency === "high" ? "high" : "normal",
      });
    }
    if (task.status === "pending_acceptance") {
      items.push({
        id: `acceptance-${task.id}`,
        title: "Needs acceptance",
        detail: task.title,
        severity: "normal",
      });
    }
    if (task.delegatedToId) {
      items.push({
        id: `delegated-${task.id}`,
        title: "Delegated work open",
        detail: task.title,
        severity: "low",
      });
    }
  }

  return items.slice(0, 12);
}

function NotificationCenter({ notifications }: { notifications: DerivedNotification[] }) {
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
            <DropdownMenuItem key={item.id} className="items-start gap-2">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ApprovalInboxDialog({
  open,
  onOpenChange,
  tasks,
  suggestions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  suggestions: EmailSuggestion[];
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-4xl flex-col overflow-hidden p-0">
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
                        approving={approveSuggestion.isPending}
                        dismissing={dismissSuggestion.isPending}
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign task</DialogTitle>
          <DialogDescription>
            Create a task for yourself or another workspace member.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
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
                max={480}
                step={5}
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
        <DialogFooter>
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
        description: "Pasted email is queued in Waiting on you.",
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manual email import (diagnostic)</DialogTitle>
          <DialogDescription>
            Donnit's primary email flow is "Scan email", which reads unread Gmail directly. Use this
            paste form only as a one-off diagnostic when Gmail OAuth is not yet configured.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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
        <DialogFooter>
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Calendar export</DialogTitle>
          <DialogDescription>
            {scheduledCount > 0
              ? `${scheduledCount} scheduled agenda block${scheduledCount === 1 ? "" : "s"} ready.`
              : "Build an agenda before exporting."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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

function WorkspaceSettingsDialog({
  open,
  onOpenChange,
  currentUser,
  users,
  integrations,
  oauthStatus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser: User | null;
  users: User[];
  integrations: Bootstrap["integrations"];
  oauthStatus?: GmailOAuthStatus;
}) {
  const isAdmin = currentUser?.role === "owner" || currentUser?.role === "admin" || currentUser?.role === "manager";
  const managers = users.filter((user) => user.role === "owner" || user.role === "admin" || user.role === "manager");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
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
        <div className="grid gap-4 py-2">
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
                {oauthStatus?.connected ? "Connected" : "Not connected"}
              </p>
            </div>
          </div>

          <div className="rounded-md border border-border">
            <div className="border-b border-border px-3 py-2">
              <p className="text-sm font-medium text-foreground">Task automation</p>
            </div>
            <div className="grid gap-2 px-3 py-3 text-sm">
              {([
                ["Email suggestions require approval", true],
                ["Delegated tasks stay visible until complete", true],
                ["Agenda schedules around Google Calendar", Boolean(oauthStatus?.calendarConnected)],
                ["Slack ingestion: " + (integrations.slack?.status ?? "scaffolded"), true],
                ["SMS ingestion: " + (integrations.sms?.status ?? "scaffolded"), true],
                ["Reminder channels: " + integrations.reminders.channelOrder.join(" / "), true],
              ] as Array<[string, boolean]>).map(([label, checked]) => (
                <label key={String(label)} className="flex items-center justify-between gap-3 rounded-md bg-muted/35 px-3 py-2">
                  <span>{label}</span>
                  <input type="checkbox" checked={Boolean(checked)} readOnly disabled={!isAdmin} className="size-4" />
                </label>
              ))}
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
        <DialogFooter>
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
  calendarConnected?: boolean;
  calendarRequiresReconnect?: boolean;
  requiresReconnect?: boolean;
  email?: string | null;
  lastScannedAt?: string | null;
  status?: string | null;
};

function useGmailOAuthStatus(authenticated: boolean) {
  return useQuery<GmailOAuthStatus>({
    queryKey: ["/api/integrations/gmail/oauth/status"],
    enabled: authenticated,
  });
}

function CommandCenter({ auth }: { auth: AuthedContext }) {
  const { data, isLoading, isError } = useBootstrap();
  const [manualImportOpen, setManualImportOpen] = useState(false);
  const [assignTaskOpen, setAssignTaskOpen] = useState(false);
  const [calendarExportOpen, setCalendarExportOpen] = useState(false);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [approvalInboxOpen, setApprovalInboxOpen] = useState(false);
  const oauthStatus = useGmailOAuthStatus(auth.authenticated);
  const showDebugTools = import.meta.env.DEV;

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
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/gmail/oauth/connect");
      return (await res.json()) as { ok: boolean; url?: string };
    },
    onSuccess: (result) => {
      if (result?.url) {
        window.location.href = result.url;
      }
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

  const disconnectGmail = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/integrations/gmail/oauth/disconnect");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/integrations/gmail/oauth/status"] });
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
        action = { label: "Connect Gmail", run: () => connectGmail.mutate() };
      } else if (
        reason === "gmail_oauth_token_invalid" ||
        reason === "gmail_auth_required" ||
        reason === "gmail_reconnect_required"
      ) {
        title = "Reconnect Gmail";
        description =
          serverMessage ??
          "Gmail authorization expired. Reconnect Gmail and try again.";
        action = { label: "Reconnect Gmail", run: () => connectGmail.mutate() };
      } else if (reason === "gmail_scope_missing") {
        title = "Reconnect Gmail with read access";
        description =
          serverMessage ??
          "Donnit's Gmail authorization is missing the gmail.readonly scope. Reconnect Gmail and accept the 'Read your email' permission on Google's consent screen.";
        action = { label: "Reconnect Gmail", run: () => connectGmail.mutate() };
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
      const res = await apiRequest("POST", "/api/integrations/google/calendar/export", {});
      return (await res.json()) as { ok: boolean; exported: number; updated: number; skipped: number; total: number };
    },
    onSuccess: (result) => {
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
  const notifications = useMemo(
    () => buildNotifications(data?.tasks ?? [], data?.suggestions ?? []),
    [data?.tasks, data?.suggestions],
  );

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
  const showConnectGmail = Boolean(oauthData?.configured && !oauthData?.connected);
  const needsReconnect = Boolean(oauthData?.requiresReconnect);
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
      id: "create-todo",
      label: "Quick add",
      icon: ListPlus,
      primary: true,
      onClick: () => {
        const el = document.getElementById("chat-message") as HTMLTextAreaElement | null;
        el?.focus();
      },
      hint: "Focus chat to dictate a new list",
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
      onClick: () => buildAgenda.mutate(),
      loading: buildAgenda.isPending,
      hint: "Refresh and confirm today's priority order",
    },
    {
      id: "assign-task",
      label: "Assign task",
      icon: UserPlus,
      onClick: () => setAssignTaskOpen(true),
      hint: "Create and assign a task",
    },
  ];
  const toolsSyncActions: FunctionAction[] = [
    {
      id: "export-calendar",
      label: "Export calendar",
      icon: CalendarPlus,
      onClick: () => setCalendarExportOpen(true),
      hint: "Add the agenda to Google Calendar or download an .ics file",
    },
    ...(showConnectGmail
      ? [
          {
            id: "connect-gmail",
            label: needsReconnect ? "Reconnect Gmail" : "Connect Gmail",
            icon: MailPlus,
            primary: needsReconnect,
            onClick: () => connectGmail.mutate(),
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
      id: "view-log",
      label: "View log",
      icon: History,
      onClick: () => {
        window.location.hash = "/log";
      },
    },
    ...(showDebugTools
      ? [
          {
            id: "manual-email-debug",
            label: "Manual import",
            icon: FileText,
            onClick: () => setManualImportOpen(true),
            hint: "Diagnostic manual email import",
          } satisfies FunctionAction,
        ]
      : []),
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
            <Wordmark />
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
            <NotificationCenter notifications={notifications} />
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

      {/* Function bar */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-3 lg:px-6">
          <FunctionBar primaryActions={dailyActions} />
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span className="ui-label">Today · {todayLabel}</span>
            <Stat label="Open" value={metrics.open} />
            <Stat label="Due today" value={metrics.dueToday} />
            <Stat label="Needs acceptance" value={metrics.needsAcceptance} />
            <Stat label="Approval queue" value={metrics.emailQueue} />
            <Stat label="Completed" value={metrics.completed} />
          </div>
        </div>
      </section>

      {/* Workspace: chat left, work area right (To-do dominant) */}
      <section className="mx-auto max-w-[1600px] px-4 pt-4 pb-8 lg:px-6">
        <div className="grid gap-4 lg:grid-cols-12">
          {/* Chat — left */}
          <div className="lg:sticky lg:top-[8.25rem] lg:col-span-4 lg:self-start xl:col-span-3">
            <ChatPanel messages={data.messages} />
          </div>

          {/* Work area — right */}
          <div className="lg:col-span-8 xl:col-span-9">
            <div className="grid gap-4 xl:grid-cols-12">
              {/* Wide To-do column */}
              <div className="xl:col-span-8">
                <TaskList tasks={data.tasks} users={data.users} />
              </div>
              {/* Narrower supporting column stack */}
              <div className="flex flex-col gap-4 xl:col-span-4">
                <DueTodayPanel tasks={data.tasks} />
                <AgendaPanel
                  agenda={data.agenda}
                  onBuild={() => buildAgenda.mutate()}
                  onExport={() => setCalendarExportOpen(true)}
                  isBuilding={buildAgenda.isPending}
                />
                <AcceptancePanel
                  tasks={data.tasks}
                  suggestions={data.suggestions}
                  onOpenInbox={() => setApprovalInboxOpen(true)}
                />
                <ReportingPanel
                  tasks={data.tasks}
                  suggestions={data.suggestions}
                  currentUserId={data.currentUserId}
                />
                <TeamProfilesPanel tasks={data.tasks} users={data.users} />
                <DoneLogPanel events={data.events} tasks={data.tasks} users={data.users} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <ManualEmailImportDialog open={manualImportOpen} onOpenChange={setManualImportOpen} />
      <ApprovalInboxDialog
        open={approvalInboxOpen}
        onOpenChange={setApprovalInboxOpen}
        tasks={data.tasks}
        suggestions={data.suggestions}
      />
      <CalendarExportDialog
        open={calendarExportOpen}
        onOpenChange={setCalendarExportOpen}
        agenda={data.agenda}
        oauthStatus={oauthData}
        onDownload={() => downloadAgendaCalendar(data.agenda)}
        onExportGoogle={() => exportGoogleCalendar.mutate()}
        onReconnectGoogle={() => connectGmail.mutate()}
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
        users={data.users}
        integrations={data.integrations}
        oauthStatus={oauthData}
      />

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
              window.location.hash = "/";
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

function AppRouter({ auth }: { auth: AuthedContext }) {
  return (
    <Switch>
      <Route path="/" component={() => <CommandCenter auth={auth} />} />
      <Route path="/log" component={LogPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppShell({ auth }: { auth: AuthedContext }) {
  return (
    <Router hook={useHashLocation}>
      <AppRouter auth={auth} />
    </Router>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthGate>{(auth) => <AppShell auth={auth} />}</AuthGate>
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
