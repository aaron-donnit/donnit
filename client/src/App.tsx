import { useEffect, useMemo, useState } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import {
  Archive,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckCircle2,
  Clock3,
  History,
  Inbox,
  ListChecks,
  ListPlus,
  Loader2,
  MailPlus,
  Moon,
  Send,
  Sparkles,
  Sun,
  UserPlus,
  UserRoundCheck,
  Workflow,
  X,
} from "lucide-react";
import { queryClient, apiRequest } from "./lib/queryClient";
import { AuthGate, type AuthedContext } from "@/components/AuthGate";
import { supabaseConfig } from "@/lib/supabase";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import NotFound from "@/pages/not-found";

type Id = string | number;

type AgendaItem = {
  taskId: Id;
  order: number;
  title: string;
  estimatedMinutes: number;
  dueDate: string | null;
  urgency: string;
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

function Wordmark() {
  return (
    <span className="wordmark text-2xl">
      Donn<span className="accent">it</span>
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

function FunctionBar({ actions }: { actions: FunctionAction[] }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="bar-functions"
      role="toolbar"
      aria-label="Workspace functions"
    >
      {actions.map((action) => (
        <button
          key={action.id}
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

  const recent = messages.slice(-12);

  return (
    <div className="panel flex h-full min-h-[520px] flex-col" data-testid="panel-chat">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-brand-green" />
          <h2 className="display-font text-base font-bold leading-none">Chat it in</h2>
        </div>
        <span className="ui-label">Donnit parser</span>
      </div>

      <div
        className="flex-1 space-y-2 overflow-y-auto px-4 py-4"
        data-testid="panel-chat-history"
      >
        {recent.length === 0 ? (
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
          recent.map((item) => (
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

      <div className="border-t border-border px-4 py-3">
        <Label htmlFor="chat-message" className="ui-label mb-1.5 block">
          New entry
        </Label>
        <Textarea
          id="chat-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Add spouse birthday for 2026-05-30, remind me 15 days before."
          className="min-h-[72px] resize-none"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              if (message.trim().length >= 2) chat.mutate();
            }
          }}
          data-testid="input-chat-message"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">⌘/Ctrl + Enter to send</span>
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

function TaskRow({
  task,
  users,
  onComplete,
  isCompleting,
}: {
  task: Task;
  users: User[];
  onComplete: () => void;
  isCompleting: boolean;
}) {
  const assignee = users.find((user) => user.id === task.assignedToId);
  const isDone = task.status === "completed";

  return (
    <div
      className={`task-row ${urgencyClass(task.urgency)} ${isDone ? "is-done" : ""}`}
      data-testid={`row-task-${task.id}`}
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
          {task.status !== "open" && task.status !== "completed" && (
            <span className="ui-label">{statusLabels[task.status] ?? task.status}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskList({ tasks, users }: { tasks: Task[]; users: User[] }) {
  const [completingId, setCompletingId] = useState<Id | null>(null);

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
              />
            ))}
          </>
        )}
      </div>
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

function AcceptancePanel({
  tasks,
  suggestions,
}: {
  tasks: Task[];
  suggestions: EmailSuggestion[];
}) {
  const waiting = tasks.filter((task) => task.status === "pending_acceptance");
  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");

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
    <div className="panel" data-testid="panel-acceptance">
      <div className="border-b border-border px-4 py-3">
        <h3 className="display-font text-sm font-bold">Waiting on you</h3>
        <p className="ui-label mt-1">Accept, deny, or add</p>
      </div>
      <div className="space-y-3 px-4 py-3">
        {waiting.length === 0 && pendingSuggestions.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing waiting. Nice.</p>
        )}

        {waiting.map((task) => (
          <div
            key={task.id}
            className={`task-row ${urgencyClass(task.urgency)} flex-col items-stretch`}
            data-testid={`row-waiting-${task.id}`}
          >
            <p className="text-sm font-medium text-foreground">{task.title}</p>
            <p className="text-xs text-muted-foreground">{task.dueDate ?? "No due date"}</p>
            <div className="mt-2 flex gap-2">
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

        {pendingSuggestions.map((suggestion) => (
          <div
            key={suggestion.id}
            className={`task-row ${urgencyClass(suggestion.urgency)} flex-col items-stretch`}
            data-testid={`row-suggestion-${suggestion.id}`}
          >
            <div className="flex items-center gap-2">
              <MailPlus className="size-3.5 text-muted-foreground" />
              <span className="ui-label">From email</span>
            </div>
            <p className="mt-1 text-sm font-medium text-foreground">{suggestion.suggestedTitle}</p>
            <p className="text-xs text-muted-foreground">{suggestion.subject}</p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() => approveSuggestion.mutate(suggestion.id)}
                data-testid={`button-approve-suggestion-${suggestion.id}`}
              >
                <Check className="size-4" /> Add
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => dismissSuggestion.mutate(suggestion.id)}
                data-testid={`button-dismiss-suggestion-${suggestion.id}`}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ))}
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
        <h3 className="display-font text-sm font-bold">Done · log</h3>
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

function CommandCenter({ auth }: { auth: AuthedContext }) {
  const { data, isLoading, isError } = useBootstrap();

  const scan = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/integrations/gmail/scan"),
    onSuccess: invalidateWorkspace,
  });

  const buildAgenda = useMutation({
    mutationFn: async () => {
      // Agenda is computed server-side on each bootstrap; refreshing pulls a fresh sort.
      await invalidateWorkspace();
      return null;
    },
  });

  const metrics = useMemo(() => {
    const tasks = data?.tasks ?? [];
    const today = new Date().toISOString().slice(0, 10);
    return {
      open: tasks.filter((t) => !["completed", "denied"].includes(t.status)).length,
      dueToday: tasks.filter((t) => t.dueDate === today && t.status !== "completed").length,
      waiting: tasks.filter((t) => t.status === "pending_acceptance").length,
      completed: tasks.filter((t) => t.status === "completed").length,
    };
  }, [data?.tasks]);

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

  const actions: FunctionAction[] = [
    {
      id: "create-todo",
      label: "Create to-do list",
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
    },
    {
      id: "build-agenda",
      label: "Build agenda",
      icon: Workflow,
      onClick: () => buildAgenda.mutate(),
      loading: buildAgenda.isPending,
      hint: "Sort by due date and urgency",
    },
    {
      id: "export-calendar",
      label: "Export to calendar",
      icon: CalendarPlus,
      disabled: true,
      hint: "Calendar export — coming soon",
    },
    {
      id: "assign-task",
      label: "Assign task",
      icon: UserPlus,
      disabled: true,
      hint: "Assign through chat for now",
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
          <FunctionBar actions={actions} />
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span className="ui-label">Today</span>
            <Stat label="Open" value={metrics.open} />
            <Stat label="Due today" value={metrics.dueToday} />
            <Stat label="Waiting" value={metrics.waiting} />
            <Stat label="Done" value={metrics.completed} />
          </div>
        </div>
      </section>

      {/* Workspace: chat left, work area right (To-do dominant) */}
      <section className="mx-auto max-w-[1600px] px-4 py-5 lg:px-6">
        <div className="grid gap-4 lg:grid-cols-12">
          {/* Chat — left */}
          <div className="lg:col-span-4 xl:col-span-3">
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
                <AcceptancePanel tasks={data.tasks} suggestions={data.suggestions} />
                <DoneLogPanel events={data.events} tasks={data.tasks} users={data.users} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-background/80">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground lg:px-6">
          <span>
            Auth: {data.integrations.auth.provider} · Email loop:{" "}
            {data.integrations.email.provider}
          </span>
          <span>
            Reminders: {data.integrations.reminders.channelOrder.join(" → ")}
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
