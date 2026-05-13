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
  Bold,
  BriefcaseBusiness,
  CalendarClock,
  CalendarCheck,
  CalendarPlus,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  ExternalLink,
  Eye,
  FileText,
  GripVertical,
  HelpCircle,
  History,
  Home,
  Inbox,
  KeyRound,
  List,
  ListChecks,
  ListOrdered,
  ListPlus,
  Loader2,
  MailPlus,
  Maximize2,
  Menu,
  Minimize2,
  Moon,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  Play,
  RefreshCcw,
  Repeat2,
  Search,
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

import type {
  Id,
  AgendaItem,
  AgendaPreference,
  AgendaPreferences,
  AgendaSchedule,
  User,
  Task,
  TaskEvent,
  InheritedTaskContext,
  LocalSubtask,
  TaskSubtask,
  TaskTemplateSubtask,
  TaskTemplate,
  WorkspaceState,
  ChatMessage,
  EmailSuggestion,
  SuggestionReplyResult,
  SuggestionDraftReplyResult,
  SuggestionPatch,
  Bootstrap,
  PositionProfile,
  ProfileAccessItem,
  PersistedPositionProfile,
  ContinuityPreviewTask,
  ContinuityAssignmentPreview,
  UrgencyClass,
} from "@/app/types";
import {
  DEFAULT_AGENDA_PREFERENCES,
  DEFAULT_AGENDA_SCHEDULE,
  CLIENT_TIME_ZONE,
  dialogShellClass,
  dialogHeaderClass,
  dialogBodyClass,
  dialogFooterClass,
  REPEAT_DETAILS_PREFIX,
  EMAIL_SIGNATURE_TEMPLATES,
  EMAIL_SIGNATURE_TEMPLATE_KEY,
  EMAIL_SIGNATURE_CUSTOM_KEY,
} from "@/app/constants";
import { localDateIso, addLocalDays, localTimeHHMM, normalizeTimeLabel, taskDueLabel } from "@/app/lib/date";
import { urgencyClass, urgencyLabel, statusLabels } from "@/app/lib/urgency";
import { useBootstrap, invalidateWorkspace } from "@/app/lib/hooks";
import { sortSubtasks, normalizeLocalSubtasks, apiErrorMessage, parseInheritedTaskContext } from "@/app/lib/tasks";
import { titleCase, positionTitleForUser, inferTaskCadence, taskRepeatLabel, taskKnowledgeText, inferToolsFromTasks } from "@/app/lib/task-text";
import {
  LearnedHowToNote,
  LearnedRecurringResponsibility,
  LearnedTaskSignal,
  memoryStringArray,
  memoryRecordArray,
  memoryHowToNotes,
  memoryRecurringResponsibilities,
  recurringResponsibilitiesFromTasks,
  mergeRecurringResponsibilities,
  memoryRecentSignals,
  memorySourceMix,
  memoryAccessItems,
} from "@/app/lib/memory";
import { canAdministerProfiles, canManageWorkspaceMembers, canViewManagerReports, isActiveUser, teamMembersForUser, isVisibleWorkTask, latestOpenUpdateRequest } from "@/app/lib/permissions";
import { mergeProfileRecord, buildEmptyPositionProfile, buildPositionProfiles, profilePrimaryOwnerId, profilesForUser, profileAssignmentLabel } from "@/app/lib/profiles";
import { escapeIcsText, formatIcsLocalDateTime, formatAgendaTime, formatAgendaSlot, normalizeAgendaPreferences, normalizeAgendaSchedule, isTimeAtOrAfter, orderAgendaItems, downloadAgendaCalendar } from "@/app/lib/agenda";
import { activityEventLabel, eventSearchText } from "@/app/lib/activity";
import { formatReceivedAt, parseSuggestionInsight, readCustomEmailSignature, readPreferredEmailSignatureTemplate, resolveEmailSignature, applyEmailSignature } from "@/app/lib/suggestions";
import { type DerivedNotification, buildNotifications } from "@/app/lib/notifications";
import { extractRepeatDetails, stripRepeatDetails, descriptionWithRepeatDetails, defaultRepeatDetails } from "@/app/lib/repeat";
import type { AppView } from "@/app/types";
import type { FunctionAction, MenuActionGroup } from "@/app/chrome/FunctionBar";
import Wordmark from "@/app/chrome/Wordmark";
import ThemeToggle from "@/app/chrome/ThemeToggle";
import FunctionBar, { FunctionActionButton } from "@/app/chrome/FunctionBar";
import WorkspaceMenu from "@/app/chrome/WorkspaceMenu";
import AppShellNav from "@/app/chrome/AppShellNav";
import NotificationCenter from "@/app/chrome/NotificationCenter";
import ChatPanel from "@/app/screens/home/ChatPanel";
import OnboardingChecklist, { type OnboardingStep } from "@/app/screens/home/OnboardingChecklist";
import DemoWorkspaceGuide from "@/app/screens/home/DemoWorkspaceGuide";
import MvpReadinessPanel from "@/app/screens/home/MvpReadinessPanel";
import DueTodayPanel from "@/app/screens/home/DueTodayPanel";
import TaskRow from "@/app/tasks/TaskRow";
import TaskList from "@/app/tasks/TaskList";
import TaskDetailDialog from "@/app/tasks/TaskDetailDialog";
import RichNoteEditor from "@/app/tasks/RichNoteEditor";
import FloatingTaskBox from "@/app/tasks/FloatingTaskBox";
import AcceptancePanel from "@/app/tasks/AcceptancePanel";
import AssignTaskDialog from "@/app/tasks/AssignTaskDialog";
import SuggestionCard from "@/app/inbox/SuggestionCard";
import AgendaPanel from "@/app/agenda/AgendaPanel";
import AgendaWorkDialog from "@/app/agenda/AgendaWorkDialog";
import ReportMetric from "@/app/reports/ReportMetric";
import ApprovalInboxDialog from "@/app/inbox/ApprovalInboxDialog";
import ManualEmailImportDialog from "@/app/inbox/ManualEmailImportDialog";
import DocumentImportDialog from "@/app/inbox/DocumentImportDialog";
import ReportingPanel from "@/app/reports/ReportingPanel";
import TeamViewPanel from "@/app/reports/TeamViewPanel";
import PositionProfilesPanel from "@/app/profiles/PositionProfilesPanel";
import ToolStatusBadge from "@/app/admin/ToolStatusBadge";
import DoneLogPanel from "@/app/activity/DoneLogPanel";
import ActivityLogPanel from "@/app/activity/ActivityLogPanel";
import CalendarExportDialog from "@/app/admin/CalendarExportDialog";
import ConnectedToolRow from "@/app/admin/ConnectedToolRow";
import WorkspaceMembersPanel from "@/app/admin/WorkspaceMembersPanel";
import WorkspaceMemberRow from "@/app/admin/WorkspaceMemberRow";
import TaskTemplatesPanel from "@/app/admin/TaskTemplatesPanel";
import WorkspaceSettingsDialog, { type GmailOAuthStatus, useGmailOAuthStatus, useSlackIntegrationStatus, useSmsIntegrationStatus } from "@/app/admin/WorkspaceSettingsDialog";
import LandingPage from "@/app/screens/LandingPage";
import SupportRail, { type SupportRailView } from "@/app/chrome/SupportRail";
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
export type { Task, TaskEvent, ChatMessage, EmailSuggestion, AgendaItem, Bootstrap, User } from "@/app/types";
