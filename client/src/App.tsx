import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { Archive, Loader2 } from "lucide-react";
import { queryClient } from "./lib/queryClient";
import { AuthGate } from "@/components/AuthGate";
import LandingPage from "@/app/screens/LandingPage";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import NotFound from "@/pages/not-found";
import { useBootstrap } from "@/app/lib/hooks";
import Wordmark from "@/app/chrome/Wordmark";
import ActivityLogPanel from "@/app/activity/ActivityLogPanel";
import CommandCenter from "@/app/screens/CommandCenter";

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
            <h1 className="work-heading mt-2">Task log</h1>
            <p className="text-sm text-muted-foreground">
              Search previous work by keyword, person, source, status, or note.
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
        <ActivityLogPanel
          events={data.events}
          tasks={data.tasks}
          users={data.users}
          subtasks={data.subtasks ?? []}
          authenticated={Boolean(data.authenticated)}
        />
        <div className="hidden" aria-hidden="true">
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
      <Route path="/" component={LandingPage} />
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
export type { Task, TaskEvent, ChatMessage, EmailSuggestion, AgendaItem, Bootstrap, User } from "@/app/types";
