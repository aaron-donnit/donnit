import { useEffect, useMemo, useState } from "react";
import { Switch, Route, Router, Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import {
  Archive,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Inbox,
  ListChecks,
  Loader2,
  MailPlus,
  MessageSquareText,
  Moon,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRoundCheck,
  X,
} from "lucide-react";
import type { ChatMessage, EmailSuggestion, Task, TaskEvent, User } from "@shared/schema";
import { queryClient, apiRequest } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import NotFound from "@/pages/not-found";

type AgendaItem = {
  taskId: number;
  order: number;
  title: string;
  estimatedMinutes: number;
  dueDate: string | null;
  urgency: string;
};

type Bootstrap = {
  currentUserId: number;
  users: User[];
  tasks: Task[];
  events: TaskEvent[];
  messages: ChatMessage[];
  suggestions: EmailSuggestion[];
  agenda: AgendaItem[];
  integrations: {
    auth: {
      provider: string;
      status: string;
      projectId: string;
    };
    email: {
      provider: string;
      sourceId: string;
      status: string;
      mode: string;
    };
    reminders: {
      channelOrder: string[];
      reminderOrder: string[];
    };
    app: {
      delivery: string;
      native: string;
    };
  };
};

const urgencyTone: Record<string, string> = {
  low: "border-transparent bg-muted text-muted-foreground",
  normal: "border-transparent bg-secondary text-secondary-foreground",
  high: "border-transparent bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-200",
  critical: "border-transparent bg-destructive text-destructive-foreground",
};

const statusLabels: Record<string, string> = {
  open: "Open",
  pending_acceptance: "Needs acceptance",
  accepted: "Accepted",
  denied: "Denied",
  completed: "Completed",
};

function useBootstrap() {
  return useQuery<Bootstrap>({
    queryKey: ["/api/bootstrap"],
  });
}

function invalidateWorkspace() {
  return queryClient.invalidateQueries({ queryKey: ["/api/bootstrap"] });
}

function LogoMark() {
  return (
    <svg aria-label="Donnit logo" viewBox="0 0 36 36" className="size-9 text-primary" fill="none">
      <path
        d="M8 18c0-6.1 4.4-10 10-10h3.5C26 8 29 11 29 15.5S26 23 21.5 23H17"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M7 18c0 6.1 4.4 10 10 10h10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M14 17.5 18 21l8-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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

function AppSidebar() {
  const [location] = useLocation();
  const items = [
    { title: "Command", url: "/", icon: MessageSquareText },
    { title: "Task log", url: "/log", icon: Archive },
  ];

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-3 px-2 py-2">
          <LogoMark />
          <div>
            <p className="text-sm font-semibold leading-none" data-testid="text-product-name">
              Donnit
            </p>
            <p className="text-xs text-muted-foreground">AI task command</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2 py-3 text-xs text-muted-foreground">
          Founder preview. Email scanning, reminders, and org permissions are simulated until production services are connected.
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof ListChecks }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold tabular-nums" data-testid={`text-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
            {value}
          </p>
        </div>
        <Icon className="size-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

function TaskCard({ task, users }: { task: Task; users: User[] }) {
  const [note, setNote] = useState("");
  const assignee = users.find((user) => user.id === task.assignedToId);
  const creator = users.find((user) => user.id === task.assignedById);

  const complete = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/tasks/${task.id}/complete`, { note: note || "Completed." }),
    onSuccess: invalidateWorkspace,
  });

  const accept = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/tasks/${task.id}/accept`),
    onSuccess: invalidateWorkspace,
  });

  const deny = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/tasks/${task.id}/deny`, { note: note || "Not the right owner." }),
    onSuccess: invalidateWorkspace,
  });

  const isDone = task.status === "completed";

  return (
    <Card className={isDone ? "opacity-70" : ""} data-testid={`card-task-${task.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-snug" data-testid={`text-task-title-${task.id}`}>
              {task.title}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
          </div>
          <Badge variant="outline" className={urgencyTone[task.urgency] ?? urgencyTone.normal}>
            {task.urgency}
          </Badge>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1" data-testid={`text-task-due-${task.id}`}>
            <CalendarClock className="size-3.5" />
            {task.dueDate ?? "No due date"}
          </span>
          <span className="flex items-center gap-1">
            <Clock3 className="size-3.5" />
            {task.estimatedMinutes} min
          </span>
          <span className="flex items-center gap-1">
            <UserRoundCheck className="size-3.5" />
            {assignee?.name ?? "Unassigned"}
          </span>
          <span className="flex items-center gap-1">
            <ShieldCheck className="size-3.5" />
            {statusLabels[task.status] ?? task.status}
          </span>
        </div>

        {task.recurrence === "annual" && (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid={`text-task-recurring-${task.id}`}>
            Annual reminder, {task.reminderDaysBefore} days before the date.
          </p>
        )}

        {task.status === "completed" && task.completionNotes && (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs" data-testid={`text-task-note-${task.id}`}>
            Completion note: {task.completionNotes}
          </p>
        )}

        {!isDone && (
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`note-${task.id}`}>Completion or denial note</Label>
              <Input
                id={`note-${task.id}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Add context before closing"
                data-testid={`input-task-note-${task.id}`}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {task.status === "pending_acceptance" && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => accept.mutate()} data-testid={`button-accept-${task.id}`}>
                    <Check className="size-4" />
                    Accept
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => deny.mutate()} data-testid={`button-deny-${task.id}`}>
                    <X className="size-4" />
                    Deny
                  </Button>
                </>
              )}
              <Button size="sm" onClick={() => complete.mutate()} disabled={complete.isPending} data-testid={`button-complete-${task.id}`}>
                {complete.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Complete
              </Button>
            </div>
          </div>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          Assigned by {creator?.name ?? "Unknown"} from {task.source}
        </p>
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Talk to Donnit</CardTitle>
            <CardDescription>
              Type naturally. Donnit extracts the task, due date, urgency, assignee, estimate, and annual reminder rules.
            </CardDescription>
          </div>
          <Badge variant="outline" className="gap-1">
            <Sparkles className="size-3.5" />
            Parser v0
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="min-h-56 space-y-3 rounded-md bg-muted/60 p-3" data-testid="panel-chat-history">
          {messages.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center text-center text-muted-foreground">
              <MessageSquareText className="mb-3 size-8" />
              <p className="max-w-sm text-sm">Start by dictating one task, due date, assignee, and urgency in a single sentence.</p>
              <p className="mt-2 max-w-sm text-xs">Example: “Add urgent payroll reset ticket for Jordan tomorrow 45 minutes.”</p>
            </div>
          ) : (
            messages.slice(-8).map((item) => (
              <div
                key={item.id}
                className={`max-w-[86%] rounded-md px-3 py-2 text-sm ${
                  item.role === "assistant" ? "bg-card text-card-foreground" : "ml-auto bg-primary text-primary-foreground"
                }`}
                data-testid={`text-chat-message-${item.id}`}
              >
                {item.content}
              </div>
            ))
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="chat-message">New task command</Label>
          <Textarea
            id="chat-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Add spouse birthday reminder for 2026-05-30, remind me 15 days before"
            data-testid="input-chat-message"
          />
          <div className="flex justify-end">
            <Button onClick={() => chat.mutate()} disabled={message.trim().length < 2 || chat.isPending} data-testid="button-send-chat">
              {chat.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Add task
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmailSuggestions({ suggestions }: { suggestions: EmailSuggestion[] }) {
  const scan = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/integrations/gmail/scan"),
    onSuccess: invalidateWorkspace,
  });
  const approve = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/suggestions/${id}/approve`),
    onSuccess: invalidateWorkspace,
  });
  const dismiss = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/suggestions/${id}/dismiss`),
    onSuccess: invalidateWorkspace,
  });

  const pending = suggestions.filter((suggestion) => suggestion.status === "pending");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MailPlus className="size-5" />
              Email scan queue
            </CardTitle>
            <CardDescription>Donnit asks before creating tasks from scanned emails.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => scan.mutate()} disabled={scan.isPending} data-testid="button-scan-gmail">
            {scan.isPending ? <Loader2 className="size-4 animate-spin" /> : <Inbox className="size-4" />}
            Scan
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {pending.length === 0 ? (
          <p className="rounded-md bg-muted px-3 py-4 text-sm text-muted-foreground">No pending email suggestions.</p>
        ) : (
          pending.map((suggestion) => (
            <div key={suggestion.id} className="rounded-md border border-card-border bg-card p-3" data-testid={`card-suggestion-${suggestion.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{suggestion.suggestedTitle}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{suggestion.subject}</p>
                </div>
                <Badge variant="outline" className={urgencyTone[suggestion.urgency] ?? urgencyTone.normal}>
                  {suggestion.urgency}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{suggestion.preview}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => approve.mutate(suggestion.id)} data-testid={`button-approve-suggestion-${suggestion.id}`}>
                  <Check className="size-4" />
                  Add
                </Button>
                <Button size="sm" variant="outline" onClick={() => dismiss.mutate(suggestion.id)} data-testid={`button-dismiss-suggestion-${suggestion.id}`}>
                  Dismiss
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function AgendaPanel({ agenda }: { agenda: AgendaItem[] }) {
  const total = agenda.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-5" />
          Daily agenda
        </CardTitle>
        <CardDescription>Built from sorted tasks and estimated completion time.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-md bg-muted px-3 py-2 text-sm" data-testid="text-agenda-total">
          Planned workload: <span className="font-semibold tabular-nums">{total}</span> minutes
        </div>
        <div className="space-y-3">
          {agenda.map((item) => (
            <div key={item.taskId} className="flex gap-3" data-testid={`row-agenda-${item.taskId}`}>
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-xs font-semibold">
                {item.order}
              </div>
              <div>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">
                  {item.estimatedMinutes} min · {item.dueDate ?? "no due date"} · {item.urgency}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function IntegrationStatus({ integrations }: { integrations: Bootstrap["integrations"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5" />
          v0.2 foundation
        </CardTitle>
        <CardDescription>Approved production direction captured in the codebase.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
          <span>Auth</span>
          <Badge variant="outline">{integrations.auth.provider}: {integrations.auth.status}</Badge>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
          <span>Email</span>
          <Badge variant="outline">{integrations.email.provider}: approval loop</Badge>
        </div>
        <div className="rounded-md bg-muted px-3 py-2">
          <p className="font-medium">Reminder order</p>
          <p className="mt-1 text-xs text-muted-foreground" data-testid="text-reminder-order">
            {integrations.reminders.channelOrder.join(" → ")}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
          <span>App strategy</span>
          <Badge variant="outline">{integrations.app.delivery.replace(/_/g, " ")}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityLog({ events, tasks, users, compact = false }: { events: TaskEvent[]; tasks: Task[]; users: User[]; compact?: boolean }) {
  const visibleEvents = compact ? events.slice(0, 5) : events;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive className="size-5" />
          Completion and audit log
        </CardTitle>
        <CardDescription>Every task action is recorded with actor and timestamp.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {visibleEvents.map((event) => {
          const task = tasks.find((item) => item.id === event.taskId);
          const user = users.find((item) => item.id === event.actorId);
          return (
            <div key={event.id} className="rounded-md bg-muted/70 px-3 py-2" data-testid={`row-event-${event.id}`}>
              <p className="text-sm font-medium">
                {event.type.replace(/_/g, " ")} · {task?.title ?? `Task ${event.taskId}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {user?.name ?? "Unknown"} · {new Date(event.createdAt).toLocaleString()}
              </p>
              {event.note && <p className="mt-1 text-xs">{event.note}</p>}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function CommandCenter() {
  const { data, isLoading, isError } = useBootstrap();

  const metrics = useMemo(() => {
    const tasks = data?.tasks ?? [];
    return {
      open: tasks.filter((task) => !["completed", "denied"].includes(task.status)).length,
      dueToday: tasks.filter((task) => task.dueDate === new Date().toISOString().slice(0, 10) && task.status !== "completed").length,
      waiting: tasks.filter((task) => task.status === "pending_acceptance").length,
      completed: tasks.filter((task) => task.status === "completed").length,
    };
  }, [data?.tasks]);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Could not load Donnit</CardTitle>
            <CardDescription>Restart the development server and try again.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background p-4 lg:p-6" data-testid="page-command-center">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
        <section className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Founder workspace</p>
            <h1 className="text-xl font-semibold tracking-tight">Command tasks by conversation, then let Donnit keep the trail.</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="gap-1">
              <Bell className="size-3.5" />
              Reminder engine planned
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Inbox className="size-3.5" />
              Email approval loop
            </Badge>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Open tasks" value={metrics.open} icon={ListChecks} />
          <Stat label="Due today" value={metrics.dueToday} icon={CalendarClock} />
          <Stat label="Need acceptance" value={metrics.waiting} icon={UserRoundCheck} />
          <Stat label="Completed" value={metrics.completed} icon={CheckCircle2} />
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(320px,0.9fr)_minmax(420px,1.25fr)_minmax(320px,0.9fr)]">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Sorted task list</h2>
              <Badge variant="secondary">Due date, then urgency</Badge>
            </div>
            <div className="space-y-3">
              {data.tasks.map((task) => (
                <TaskCard key={task.id} task={task} users={data.users} />
              ))}
            </div>
          </div>

          <ChatPanel messages={data.messages} />

          <div className="space-y-5">
            <IntegrationStatus integrations={data.integrations} />
            <AgendaPanel agenda={data.agenda} />
            <EmailSuggestions suggestions={data.suggestions} />
            <ActivityLog events={data.events} tasks={data.tasks} users={data.users} compact />
          </div>
        </section>
      </div>
    </main>
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
      <div className="mx-auto max-w-4xl">
        <ActivityLog events={data.events} tasks={data.tasks} users={data.users} />
      </div>
    </main>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={CommandCenter} />
      <Route path="/log" component={LogPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppShell() {
  const style = {
    "--sidebar-width": "17rem",
    "--sidebar-width-icon": "4rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-50 flex h-14 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur">
            <div className="flex items-center gap-2">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <Separator orientation="vertical" className="h-5" />
              <span className="text-sm text-muted-foreground">donnit.ai build preview</span>
            </div>
            <ThemeToggle />
          </header>
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </div>
      </div>
    </SidebarProvider>
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
