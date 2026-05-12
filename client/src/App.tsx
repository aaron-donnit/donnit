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

type SupportRailView = "today" | "agenda" | "team" | "reports";

const demoMailto =
  "mailto:hello@donnit.ai?subject=Book%20a%20Donnit%20demo&body=I%20want%20to%20see%20how%20Donnit%20can%20help%20my%20team.";
const pricingMailto =
  "mailto:hello@donnit.ai?subject=Donnit%20pricing&body=I%20want%20to%20learn%20which%20Donnit%20plan%20fits%20my%20team.";

function LandingPage() {
  const goToLogin = () => {
    window.location.hash = "/app";
  };
  const integrations = ["Slack", "Gmail", "Outlook", "Teams", "Calendar", "SMS soon"];
  const proofPoints = ["AI task capture", "Role memory", "Calendar-ready work"];
  const flow = [
    { icon: Sparkles, title: "Capture", copy: "Slack, email, chat, and notes become task suggestions." },
    { icon: UserRoundCheck, title: "Clarify", copy: "Donnit adds owners, deadlines, urgency, and context." },
    { icon: BriefcaseBusiness, title: "Carry Forward", copy: "Recurring work builds a living Position Profile." },
  ];
  const heroSignals = [
    { source: "Email", title: "Vendor renewal attached", meta: "Renew by Friday" },
    { source: "Slack", title: "Jordan needs access", meta: "Send login today" },
    { source: "Recurring", title: "Board packet week", meta: "Prep agenda draft" },
  ];
  const continuitySteps = [
    { title: "Before a move", copy: "Capture the real rhythm of the role while work is happening." },
    { title: "During coverage", copy: "Assign temporary ownership without mixing roles together." },
    { title: "For the next person", copy: "Give them the playbook, not a guessing game." },
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
            <Button variant="outline" size="sm" onClick={goToLogin} data-testid="button-landing-login">Login</Button>
            <Button size="sm" onClick={goToLogin} data-testid="button-landing-start-top">Start free</Button>
          </div>
        </div>
      </header>

      <section className="relative isolate overflow-hidden px-4 pb-12 pt-16 lg:px-6 lg:pb-18 lg:pt-24">
        <div className="relative mx-auto max-w-7xl">
          <div className="mx-auto max-w-4xl text-center">
            <p className="ui-label">AI-powered work continuity</p>
            <h1 className="mt-4 text-5xl font-semibold leading-[1.02] text-foreground md:text-7xl">
              Work remembered.<span className="block text-brand-green">Handoffs handled.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              Donnit turns Slack, email, and notes into tasks, agendas, and role memory.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="landing-primary-cta" onClick={goToLogin} data-testid="button-landing-start">
                Start free<ArrowRight className="size-4" />
              </Button>
              <Button size="lg" variant="outline" asChild data-testid="button-landing-demo-hero">
                <a href={demoMailto}>Book demo</a>
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">14 days. No card. One role to start.</p>
            <div className="landing-proof-strip mt-7">{proofPoints.map((point) => <span key={point}>{point}</span>)}</div>
          </div>
          <div className="landing-product-stage mt-10" aria-label="Donnit turns work inputs into approved tasks and role memory">
            <div className="landing-stage-column">
              <p className="ui-label">Inputs</p>
              <div className="mt-3 space-y-3">
                {heroSignals.map((signal, index) => (
                  <div key={signal.title} className="landing-stage-card" style={{ animationDelay: `${index * 420}ms` }}>
                    <span>{signal.source}</span><strong>{signal.title}</strong><small>{signal.meta}</small>
                  </div>
                ))}
              </div>
            </div>
            <div className="landing-ai-core"><Sparkles className="size-6" /><span>AI intake</span></div>
            <div className="landing-stage-column landing-stage-output">
              <div className="flex items-center justify-between gap-3">
                <p className="ui-label">Donnit</p>
                <span className="rounded-full bg-brand-green/10 px-3 py-1 text-xs font-medium text-brand-green">ready</span>
              </div>
              <div className="mt-3 space-y-2">
                {dailyTasks.map(([task, source, time], index) => (
                  <div key={task} className="landing-stage-task" style={{ animationDelay: `${index * 180}ms` }}>
                    <Check className="size-4" /><div><strong>{task}</strong><small>{source}</small></div><span>{time}</span>
                  </div>
                ))}
              </div>
              <div className="landing-memory-pill"><BriefcaseBusiness className="size-4" />Updates Position Profile</div>
            </div>
          </div>
        </div>
      </section>

      <section id="continuity" className="px-4 py-10 lg:px-6 lg:py-16">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="ui-label">Role handoffs</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">Less scramble. Cleaner starts.</h2>
            <p className="mt-4 text-lg leading-8 text-muted-foreground">Donnit builds Position Profiles from real work, not stale job descriptions.</p>
          </div>
          <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-start">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              {continuitySteps.map((step) => (
                <div key={step.title} className="landing-continuity-step rounded-md border border-border bg-card p-4">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-green text-white"><Check className="size-4" /></span>
                  <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.copy}</p>
                </div>
              ))}
              <Button asChild className="w-fit sm:col-span-3 lg:col-span-1">
                <a href={demoMailto}>See Position Profile<ArrowRight className="size-4" /></a>
              </Button>
            </div>
            <div className="landing-profile-preview rounded-md border border-border bg-card p-4">
              <p className="ui-label">Position profile</p>
              <h3 className="mt-2 text-xl font-semibold">Executive Assistant to the CEO</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Automatically built from recurring tasks, notes, completions, and handoff context.</p>
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
            <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">Capture. Clarify. Carry forward.</h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {flow.map((item, index) => (
              <div key={item.title} className="landing-flow-step rounded-md border border-border bg-card p-5 text-center">
                <div className="mx-auto flex size-11 items-center justify-center rounded-md bg-brand-green/10 text-brand-green"><item.icon className="size-5" /></div>
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
              <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">Your day, already sorted.</h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">Type it. Approve it. Schedule it. Donnit keeps the context close.</p>
            </div>
            <div className="landing-daily-preview rounded-md border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="ui-label">Today</p>
                <span className="rounded-full bg-background px-3 py-1 text-xs text-muted-foreground">AI agenda ready</span>
              </div>
              <div className="mt-4 space-y-2">
                {dailyTasks.map(([task, source, time]) => (
                  <div key={task} className="grid gap-2 rounded-md bg-background px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div><p className="text-sm font-medium">{task}</p><p className="mt-1 text-xs text-muted-foreground">{source}</p></div>
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
            <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">Slack, email, and calendar first. SMS next.</h2>
          </div>
          <div className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3">
            {integrations.map((name) => (
              <div key={name} className="rounded-md border border-border bg-card px-4 py-4 text-center text-sm font-medium">{name}</div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="px-4 py-10 lg:px-6 lg:py-16">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="ui-label">Pricing</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">Start small. Prove value.</h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">Begin with one role or one team. Expand when the workflow is working.</p>
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
                  <Button className="mt-5" variant="outline" asChild><a href={demoMailto}>{cta}</a></Button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-5 text-center text-sm text-muted-foreground">
            Need procurement details or a larger rollout?{" "}
            <a href={pricingMailto} className="text-foreground underline underline-offset-4">See pricing options</a>.
          </p>
        </div>
      </section>

      <section className="px-4 py-14 lg:px-6 lg:py-20">
        <div className="mx-auto max-w-4xl text-center">
          <p className="ui-label">Get started</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight md:text-5xl">Try Donnit with one role.</h2>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" className="landing-primary-cta" onClick={goToLogin}>Start free</Button>
            <Button size="lg" variant="outline" asChild><a href={demoMailto}>Book demo</a></Button>
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



function ReportingPanel({
  tasks,
  suggestions,
  agenda,
  positionProfiles,
  currentUserId,
}: {
  tasks: Task[];
  suggestions: EmailSuggestion[];
  agenda: AgendaItem[];
  positionProfiles: PositionProfile[];
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
  const pendingSuggestions = suggestions.filter((suggestion) => suggestion.status === "pending");
  const capturedSignals = tasks.length + suggestions.length;
  const sourcedTasks = tasks.filter((task) => task.source !== "manual");
  const automationShare = total > 0 ? Math.round((sourcedTasks.length / total) * 100) : 0;
  const completionRate = total > 0 ? Math.round((completed.length / total) * 100) : 0;
  const reviewedRate = suggestions.length > 0 ? Math.round((reviewedSuggestions.length / suggestions.length) * 100) : 0;
  const scheduledAgenda = agenda.filter((item) => item.scheduleStatus === "scheduled");
  const agendaMinutes = scheduledAgenda.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const profilesWithMemory = positionProfiles.filter(
    (profile) =>
      profile.persisted ||
      profile.recurringTasks.length > 0 ||
      profile.howTo.length > 0 ||
      profile.currentIncompleteTasks.length > 0,
  );
  const continuityCoverage =
    positionProfiles.length > 0 ? Math.round((profilesWithMemory.length / positionProfiles.length) * 100) : 0;
  const highRiskProfiles = positionProfiles.filter((profile) => profile.riskLevel === "high");
  const pilotSignals = [
    {
      label: "Captured",
      value: String(capturedSignals),
      detail: `${tasks.length} tasks / ${suggestions.length} suggestions`,
    },
    {
      label: "AI quality",
      value: approvalRate === null ? "N/A" : `${approvalRate}%`,
      detail: `${reviewedRate}% reviewed / ${dismissedSuggestions.length} dismissed`,
    },
    {
      label: "Automation",
      value: `${automationShare}%`,
      detail: `${sourcedTasks.length} tasks from connected or AI-assisted sources`,
    },
    {
      label: "Work health",
      value: `${completionRate}%`,
      detail: `${overdue.length} overdue / ${incomplete.length} open`,
    },
    {
      label: "Agenda habit",
      value: scheduledAgenda.length > 0 ? `${scheduledAgenda.length}` : "0",
      detail: `${agendaMinutes} scheduled minutes ready for calendar`,
    },
    {
      label: "Continuity",
      value: `${continuityCoverage}%`,
      detail: `${profilesWithMemory.length}/${positionProfiles.length || 0} profiles with live memory`,
    },
  ];
  const pilotRisks = [
    pendingSuggestions.length > 0 ? `${pendingSuggestions.length} suggestion${pendingSuggestions.length === 1 ? "" : "s"} waiting for approval` : "",
    overdue.length > 0 ? `${overdue.length} overdue task${overdue.length === 1 ? "" : "s"} need attention` : "",
    delegatedOutstanding.length > 0 ? `${delegatedOutstanding.length} delegated task${delegatedOutstanding.length === 1 ? "" : "s"} still accountable to you` : "",
    highRiskProfiles.length > 0 ? `${highRiskProfiles.length} high-risk Position Profile${highRiskProfiles.length === 1 ? "" : "s"}` : "",
    capturedSignals === 0 ? "No captured work yet; start with chat, Gmail scan, or document import" : "",
  ].filter(Boolean).slice(0, 4);

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
      <div className="border-t border-border px-4 py-3" data-testid="panel-pilot-analytics">
        <div className="mb-3">
          <h4 className="display-font text-sm font-bold text-foreground">Pilot analytics</h4>
          <p className="ui-label mt-1">Behavior change and continuity signals</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {pilotSignals.map((signal) => (
            <div key={signal.label} className="rounded-md border border-border bg-background px-3 py-2">
              <p className="ui-label">{signal.label}</p>
              <p className="display-font mt-1 text-lg font-bold text-foreground">{signal.value}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{signal.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-md border border-border bg-muted/35 px-3 py-2">
          <p className="ui-label">Pilot readout</p>
          {pilotRisks.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
              {pilotRisks.map((risk) => (
                <li key={risk} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600" />
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Core loop is active: captured work is being reviewed, scheduled, and retained in role memory.
            </p>
          )}
        </div>
      </div>
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
  const teamMembers = teamMembersForUser(users, currentUser, currentUserId);
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
  const today = localDateIso();
  const soonIso = addLocalDays(2, today);
  const sinceDate = (() => {
    if (timeframe === "all") return null;
    const days = timeframe === "7d" ? 7 : 30;
    return addLocalDays(-days, today);
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
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/seed-demo-team");
      return (await res.json()) as { message?: string; tasks?: number; suggestions?: number; positionProfiles?: number };
    },
    onSuccess: async (result) => {
      await invalidateWorkspace();
      toast({
        title: "Demo workspace ready",
        description: result.message ?? "The Team dashboard now has sample members, tasks, approvals, and profiles to test.",
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
              Add a pilot demo workspace before inviting real users.
            </p>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => seedDemoTeam.mutate()}
              disabled={seedDemoTeam.isPending}
              data-testid="button-seed-demo-team"
            >
              {seedDemoTeam.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              Seed demo workspace
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


function PositionProfilesPanel({
  profiles,
  users,
  currentUserId,
  authenticated,
  subtasks = [],
  events = [],
}: {
  profiles: PositionProfile[];
  users: User[];
  currentUserId: Id;
  authenticated: boolean;
  subtasks?: TaskSubtask[];
  events?: TaskEvent[];
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
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const customProfiles = useMemo(
    () =>
      customProfileMetas
        .map((meta): PositionProfile | null => {
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
              accessItems: [],
              institutionalMemory: {},
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
              currentOwnerId: owner.id,
              directManagerId: owner.managerId,
              temporaryOwnerId: null,
              delegateUserId: null,
              delegateUntil: null,
            }),
            id: meta.id,
            title: meta.title,
            owner,
            currentOwnerId: owner.id,
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
    () => users.filter((user) => selectedProfile && isActiveUser(user) && String(user.id) !== String(selectedProfile.currentOwnerId ?? selectedProfile.owner.id)),
    [selectedProfile, users],
  );
  const assignmentUsers = useMemo(() => users.filter(isActiveUser), [users]);
  const [targetUserId, setTargetUserId] = useState("");
  const [mode, setMode] = useState<"delegate" | "transfer">("delegate");
  const [delegateUntil, setDelegateUntil] = useState("");
  const [showProfileHistory, setShowProfileHistory] = useState(false);
  const [profileTaskSearch, setProfileTaskSearch] = useState("");
  const [selectedProfileTaskId, setSelectedProfileTaskId] = useState<string | null>(null);
  const [accessDraft, setAccessDraft] = useState<{
    toolName: string;
    loginUrl: string;
    accountOwner: string;
    billingNotes: string;
    status: ProfileAccessItem["status"];
  }>({ toolName: "", loginUrl: "", accountOwner: "", billingNotes: "", status: "needs_grant" });
  const assignmentRef = useRef<HTMLDivElement | null>(null);
  const assignmentPreviewQuery = useQuery({
    queryKey: [
      "position-profile-assignment-preview",
      selectedProfile?.id ?? "",
      selectedProfile?.persisted ? selectedProfile.id : "",
      selectedProfile ? String(selectedProfile.currentOwnerId ?? selectedProfile.owner.id) : "",
      targetUserId,
      mode,
      delegateUntil,
      authenticated,
    ],
    enabled: Boolean(authenticated && assignmentDialogOpen && selectedProfile && targetUserId),
    queryFn: async () => {
      if (!selectedProfile || !targetUserId) throw new Error("Choose a profile and target user.");
      const res = await apiRequest("POST", "/api/position-profiles/assign/preview", {
        profileId: selectedProfile.persisted ? selectedProfile.id : undefined,
        fromUserId: String(selectedProfile.currentOwnerId ?? selectedProfile.owner.id),
        toUserId: targetUserId,
        mode,
        delegateUntil: delegateUntil || null,
        profileTitle: selectedProfile.title,
        includeUnboundOwnerTasks: !selectedProfile.persisted,
      });
      const data = (await res.json()) as { ok: boolean; preview: ContinuityAssignmentPreview };
      return data.preview;
    },
  });
  const assignmentPreview = assignmentPreviewQuery.data ?? null;

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
    setShowProfileHistory(false);
    setProfileTaskSearch("");
    setSelectedProfileTaskId(null);
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
    setAssignmentDialogOpen(true);
  };

  const saveAccessInventory = (items: ProfileAccessItem[]) => {
    if (!selectedProfile) return;
    if (!authenticated || !selectedProfile.persisted) {
      toast({
        title: "Save the Position Profile first",
        description: "Access inventory is stored on saved admin Position Profiles.",
      });
      return;
    }
    updateProfile.mutate({
      id: selectedProfile.id,
      patch: {
        institutionalMemory: {
          ...selectedProfile.institutionalMemory,
          accessItems: items,
        },
      },
    });
  };
  const addAccessItem = () => {
    if (!selectedProfile) return;
    const toolName = accessDraft.toolName.trim();
    if (!toolName) return;
    saveAccessInventory([
      ...selectedProfile.accessItems,
      {
        id: `access-${Date.now()}`,
        toolName,
        loginUrl: accessDraft.loginUrl.trim(),
        accountOwner: accessDraft.accountOwner.trim(),
        billingNotes: accessDraft.billingNotes.trim(),
        status: accessDraft.status,
        updatedAt: new Date().toISOString(),
      },
    ]);
    setAccessDraft({ toolName: "", loginUrl: "", accountOwner: "", billingNotes: "", status: "needs_grant" });
  };
  const setAccessStatus = (id: string, status: ProfileAccessItem["status"]) => {
    if (!selectedProfile) return;
    saveAccessInventory(
      selectedProfile.accessItems.map((item) =>
        item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item,
      ),
    );
  };
  const removeAccessItem = (id: string) => {
    if (!selectedProfile) return;
    saveAccessInventory(selectedProfile.accessItems.filter((item) => item.id !== id));
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
        fromUserId: selectedProfile.currentOwnerId ?? selectedProfile.owner.id,
        toUserId: targetUserId,
        mode,
        delegateUntil: delegateUntil || null,
        profileTitle: selectedProfile.title,
        includeUnboundOwnerTasks: !selectedProfile.persisted,
      });
      return (await res.json()) as {
        ok: boolean;
        updated: number;
        mode: string;
        profile?: PersistedPositionProfile | null;
        preview?: ContinuityAssignmentPreview;
      };
    },
    onSuccess: async (result) => {
      await invalidateWorkspace();
      if (result.profile?.id) setSelectedProfileId(result.profile.id);
      setAssignmentDialogOpen(false);
      const recurring = result.preview?.summary.recurringTasks ?? 0;
      const future = result.preview?.summary.futureRecurringTasks ?? 0;
      toast({
        title: mode === "transfer" ? "Profile transferred" : "Coverage delegated",
        description: `${result.updated} active task${result.updated === 1 ? "" : "s"} updated. ${recurring} recurring ${recurring === 1 ? "item" : "items"} retained${future > 0 ? `, ${future} hidden until due window` : ""}.`,
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
  const normalizedProfileTaskSearch = profileTaskSearch.trim().toLowerCase();
  const allSelectedProfileTasks = selectedProfile
    ? [
        ...selectedProfile.currentIncompleteTasks,
        ...selectedProfile.recurringTasks,
        ...selectedProfile.completedTasks,
      ].filter((task, index, items) => items.findIndex((item) => String(item.id) === String(task.id)) === index)
    : [];
  const selectedProfileTask = allSelectedProfileTasks.find((task) => String(task.id) === selectedProfileTaskId) ?? null;
  const profileTaskMatches = (task: Task) => {
    if (!normalizedProfileTaskSearch) return true;
    const haystack = [
      task.title,
      task.description,
      task.completionNotes,
      task.source,
      task.urgency,
      task.status,
      task.dueDate ?? "",
      users.find((user) => String(user.id) === String(task.assignedToId))?.name ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedProfileTaskSearch);
  };
  const visibleProfileCurrentTasks = selectedProfile?.currentIncompleteTasks.filter(profileTaskMatches) ?? [];
  const visibleProfileRecurringTasks = selectedProfile?.recurringTasks.filter(profileTaskMatches) ?? [];
  const visibleProfileCompletedTasks = selectedProfile?.completedTasks.filter(profileTaskMatches) ?? [];
  const handoffOwner = selectedProfile ? users.find((user) => String(user.id) === String(selectedProfile.currentOwnerId)) : null;
  const temporaryOwner = selectedProfile ? users.find((user) => String(user.id) === String(selectedProfile.temporaryOwnerId)) : null;
  const delegateOwner = selectedProfile ? users.find((user) => String(user.id) === String(selectedProfile.delegateUserId)) : null;
  const handoffReadiness = !selectedProfile
    ? null
    : selectedProfile.status === "vacant"
      ? {
          label: "Coverage needed",
          tone: "warning" as const,
          action: "Assign temporary coverage or transfer the profile before showing this in a live handoff.",
        }
      : selectedProfile.riskLevel === "high"
        ? {
            label: "Needs manager review",
            tone: "warning" as const,
            action: "Review overdue work and add how-to notes for recurring responsibilities.",
          }
        : selectedProfile.recurringTasks.length === 0 && selectedProfile.completedTasks.length === 0
          ? {
              label: "Learning",
              tone: "setup" as const,
              action: "Capture recurring tasks and completion notes so this role has transferable memory.",
            }
          : {
              label: "Handoff ready",
              tone: "ready" as const,
              action: "This profile has enough work memory to support a coverage or replacement conversation.",
            };
  const accessStatusLabels: Record<ProfileAccessItem["status"], string> = {
    active: "Active",
    needs_grant: "Grant access",
    needs_reset: "Reset needed",
    remove_access: "Remove access",
    pending: "Pending",
  };
  const selectedMemory = selectedProfile?.institutionalMemory ?? {};
  const learnedHowToNotes = memoryHowToNotes(selectedMemory);
  const learnedRecurringResponsibilities = mergeRecurringResponsibilities(
    memoryRecurringResponsibilities(selectedMemory),
    recurringResponsibilitiesFromTasks(selectedProfile?.recurringTasks ?? []),
  );
  const learnedTaskSignals = memoryRecentSignals(selectedMemory);
  const learnedSourceMix = memorySourceMix(selectedMemory);
  const learnedStats = selectedMemory.stats && typeof selectedMemory.stats === "object" && !Array.isArray(selectedMemory.stats)
    ? selectedMemory.stats as Record<string, unknown>
    : {};
  const learnedRecurringCount = Math.max(Number(learnedStats.recurringTasks ?? 0) || 0, learnedRecurringResponsibilities.length);
  const recurringKnowledgeGaps = (selectedProfile?.recurringTasks ?? [])
    .filter((task) => taskKnowledgeText(task).length < 30)
    .slice(0, 4);
  const profileReadinessItems = selectedProfile
    ? [
        {
          label: "Owner or coverage assigned",
          detail: temporaryOwner
            ? `Temporarily covered by ${temporaryOwner.name}`
            : delegateOwner
              ? `Delegated to ${delegateOwner.name}`
              : handoffOwner
                ? `Owned by ${handoffOwner.name}`
                : "No owner assigned",
          done: Boolean(handoffOwner || temporaryOwner || delegateOwner),
        },
        {
          label: "Current work captured",
          detail: `${selectedProfile.currentIncompleteTasks.length} open task${selectedProfile.currentIncompleteTasks.length === 1 ? "" : "s"}`,
          done: selectedProfile.currentIncompleteTasks.length > 0 || selectedProfile.completedTasks.length > 0,
        },
        {
          label: "Recurring work mapped",
          detail: `${selectedProfile.recurringTasks.length} recurring responsibilit${selectedProfile.recurringTasks.length === 1 ? "y" : "ies"}`,
          done: selectedProfile.recurringTasks.length > 0,
        },
        {
          label: "Historical memory available",
          detail: `${selectedProfile.completedTasks.length} historical task${selectedProfile.completedTasks.length === 1 ? "" : "s"} plus ${learnedHowToNotes.length} how-to note${learnedHowToNotes.length === 1 ? "" : "s"}`,
          done: selectedProfile.completedTasks.length > 0 || learnedHowToNotes.length > 0,
        },
        {
          label: "Recurring how-to context",
          detail: recurringKnowledgeGaps.length === 0
            ? "No recurring context gaps detected"
            : `${recurringKnowledgeGaps.length} recurring item${recurringKnowledgeGaps.length === 1 ? "" : "s"} need notes`,
          done: selectedProfile.recurringTasks.length > 0 && recurringKnowledgeGaps.length === 0,
        },
        {
          label: "Tool access documented",
          detail: `${selectedProfile.accessItems.length} access item${selectedProfile.accessItems.length === 1 ? "" : "s"} recorded`,
          done: selectedProfile.accessItems.length > 0,
        },
      ]
    : [];
  const profileReadinessDone = profileReadinessItems.filter((item) => item.done).length;
  const handoffPacketSections = selectedProfile
    ? [
        {
          label: "Open work",
          empty: "No open work captured",
          items: selectedProfile.currentIncompleteTasks
            .slice(0, 3)
            .map((task) => `${task.title}${task.dueDate ? ` / due ${task.dueDate}` : ""}`),
        },
        {
          label: "Recurring work",
          empty: "No recurring rhythm mapped",
          items: selectedProfile.recurringTasks
            .slice(0, 3)
            .map((task) => `${task.title}${taskRepeatLabel(task) ? ` / ${taskRepeatLabel(task)}` : ""}`),
        },
        {
          label: "Knowledge gaps",
          empty: "No recurring gaps detected",
          items: recurringKnowledgeGaps.slice(0, 3).map((task) => `${task.title} needs notes`),
        },
        {
          label: "Tool access",
          empty: "No access items recorded",
          items: selectedProfile.accessItems.slice(0, 3).map((item) => `${item.toolName} / ${accessStatusLabels[item.status]}`),
        },
        {
          label: "Historical memory",
          empty: "No historical work captured",
          items: [
            ...selectedProfile.completedTasks.slice(0, 2).map((task) => task.title),
            ...learnedHowToNotes.slice(0, 1).map((item) => `${item.title}: ${item.note.slice(0, 90)}`),
          ].slice(0, 3),
        },
      ]
    : [];
  const lastLearnedAt = typeof selectedMemory.lastAutoUpdatedAt === "string" ? selectedMemory.lastAutoUpdatedAt : null;
  const renderProfileTaskButton = (task: Task, meta: string) => (
    <button
      key={String(task.id)}
      type="button"
      onClick={() => setSelectedProfileTaskId(String(task.id))}
      className="flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-muted"
      data-testid={`button-position-profile-task-${task.id}`}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-foreground">{task.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{meta}</span>
      </span>
      <Eye className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );

  return (
    <div className="position-profiles-shell rounded-md border border-border" data-testid="panel-position-profiles">
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
              <div className="profile-list-grid" data-testid="position-profile-list">
                {repositoryProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => openProfile(profile.id)}
                    className="profile-item-card w-full rounded-md border border-border bg-background px-3 py-3 text-left transition hover:border-brand-green/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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

            <div
              ref={assignmentRef}
              className={`profile-detail-hero rounded-md border bg-background px-3 py-3 ${
                assignmentFocus ? "border-brand-green shadow-sm shadow-brand-green/10" : "border-border"
              }`}
            >
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
              {handoffReadiness && (
                <div className="mt-3 rounded-md border border-brand-green/25 bg-brand-green/5 px-3 py-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">Handoff packet</p>
                        <ToolStatusBadge status={handoffReadiness.tone} label={handoffReadiness.label} />
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Built for HR/Ops and people managers: current work, recurring responsibilities, historical context, and coverage controls in one place.
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          selectedProfile.persisted &&
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
                        disabled={!canManageProfiles || !selectedProfile.persisted || updateProfile.isPending}
                        data-testid="button-handoff-mark-vacant"
                      >
                        <AlertTriangle className="size-4" />
                        Mark vacant
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openAssignment("delegate")}
                        disabled={!canManageProfiles}
                        data-testid="button-handoff-delegate"
                      >
                        <UserPlus className="size-4" />
                        Delegate
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => openAssignment("transfer")}
                        disabled={!canManageProfiles}
                        data-testid="button-handoff-transfer"
                      >
                        <UserCog className="size-4" />
                        Transfer
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
                    <div className="rounded-md bg-background px-3 py-2">
                      <p className="ui-label">Coverage</p>
                      <p className="mt-1 text-foreground">
                        {selectedProfile.status === "vacant"
                          ? "Vacant"
                          : temporaryOwner
                            ? `Covered by ${temporaryOwner.name}`
                            : delegateOwner
                              ? `Delegated to ${delegateOwner.name}`
                              : `Owned by ${handoffOwner?.name ?? selectedProfile.owner.name}`}
                      </p>
                      {selectedProfile.delegateUntil && (
                        <p className="mt-1 text-muted-foreground">Through {selectedProfile.delegateUntil}</p>
                      )}
                    </div>
                    <div className="rounded-md bg-background px-3 py-2">
                      <p className="ui-label">Included</p>
                      <p className="mt-1 text-foreground">
                        {selectedProfile.currentIncompleteTasks.length} open / {selectedProfile.recurringTasks.length} recurring / {selectedProfile.completedTasks.length} historical
                      </p>
                      <p className="mt-1 text-muted-foreground">Personal work excluded; confidential work access-controlled.</p>
                    </div>
                    <div className="rounded-md bg-background px-3 py-2">
                      <p className="ui-label">Next action</p>
                      <p className="mt-1 leading-5 text-foreground">{handoffReadiness.action}</p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-md border border-border bg-background px-3 py-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground">Replacement brief</p>
                      <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                        Live packet
                      </span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {handoffPacketSections.map((section) => (
                        <div key={section.label} className="rounded-md bg-muted/45 px-2 py-2">
                          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                            {section.label}
                          </p>
                          {section.items.length > 0 ? (
                            <ul className="space-y-1 text-xs text-foreground">
                              {section.items.map((item) => (
                                <li key={item} className="line-clamp-2">
                                  {item}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-muted-foreground">{section.empty}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
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

            <div className="rounded-md border border-border bg-background px-3 py-3" data-testid="panel-position-role-intelligence">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <Sparkles className="size-4 text-brand-green" />
                    Role intelligence
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Automatically learned from task creation, completions, notes, recurrence, and handoffs.
                  </p>
                </div>
                <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                  {lastLearnedAt ? `Updated ${new Date(lastLearnedAt).toLocaleDateString()}` : "Learning"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md bg-muted px-2 py-2">
                  <p className="font-semibold tabular-nums text-foreground">{Number(learnedStats.taskSignals ?? learnedTaskSignals.length) || 0}</p>
                  <p className="text-muted-foreground">signals</p>
                </div>
                <div className="rounded-md bg-muted px-2 py-2">
                  <p className="font-semibold tabular-nums text-foreground">{learnedRecurringCount}</p>
                  <p className="text-muted-foreground">recurring</p>
                </div>
                <div className="rounded-md bg-muted px-2 py-2">
                  <p className="font-semibold tabular-nums text-foreground">{learnedHowToNotes.length}</p>
                  <p className="text-muted-foreground">how-to</p>
                </div>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="rounded-md border border-border bg-muted/25 px-3 py-2">
                  <p className="mb-2 text-xs font-medium text-foreground">Learned recurring work</p>
                  {learnedRecurringResponsibilities.length > 0 ? (
                    <div className="space-y-1.5">
                      {learnedRecurringResponsibilities.slice(0, 4).map((item) => (
                        <div key={`${item.taskId}-${item.title}`} className="rounded-md bg-background px-2 py-2 text-xs">
                          <p className="truncate font-medium text-foreground">{item.title}</p>
                          <p className="mt-0.5 text-muted-foreground">
                            {item.repeatDetails || item.cadence}{item.dueDate ? ` / due ${item.dueDate}` : ""}{item.showEarlyDays > 0 ? ` / shows ${item.showEarlyDays} days early` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-border bg-background px-3 py-3 text-center text-xs text-muted-foreground">
                      No recurring pattern has been learned yet.
                    </p>
                  )}
                </div>
                <div className="rounded-md border border-border bg-muted/25 px-3 py-2">
                  <p className="mb-2 text-xs font-medium text-foreground">Recent learned signals</p>
                  {learnedTaskSignals.length > 0 ? (
                    <div className="space-y-1.5">
                      {learnedTaskSignals.slice(0, 4).map((item) => (
                        <div key={`${item.taskId}-${item.eventType}`} className="rounded-md bg-background px-2 py-2 text-xs">
                          <p className="truncate font-medium text-foreground">{item.title}</p>
                          <p className="mt-0.5 text-muted-foreground">
                            {titleCase(item.eventType)} / {titleCase(item.source)} / {urgencyLabel(item.urgency)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-border bg-background px-3 py-3 text-center text-xs text-muted-foreground">
                      Donnit will populate this as tasks are added or completed.
                    </p>
                  )}
                </div>
              </div>
              {recurringKnowledgeGaps.length > 0 && (
                <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-foreground">Recurring work needs context</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Add notes or completion details so a replacement can run these without guessing.
                      </p>
                    </div>
                    <span className="rounded-md bg-background px-2 py-1 text-[11px] text-muted-foreground">
                      {recurringKnowledgeGaps.length}
                    </span>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {recurringKnowledgeGaps.map((task) => (
                      <button
                        key={String(task.id)}
                        type="button"
                        onClick={() => setSelectedProfileTaskId(String(task.id))}
                        className="rounded-md bg-background px-2 py-2 text-left text-xs transition hover:bg-muted"
                        data-testid={`button-position-profile-knowledge-gap-${task.id}`}
                      >
                        <span className="block truncate font-medium text-foreground">{task.title}</span>
                        <span className="mt-0.5 block truncate text-muted-foreground">{taskRepeatLabel(task) || "Recurring responsibility"}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_.8fr]">
                <div className="rounded-md border border-border bg-muted/25 px-3 py-2">
                  <p className="mb-2 text-xs font-medium text-foreground">How-to notes Donnit captured</p>
                  {learnedHowToNotes.length > 0 ? (
                    <ul className="space-y-1.5 text-xs text-muted-foreground">
                      {learnedHowToNotes.slice(0, 4).map((item) => (
                        <li key={`${item.taskId}-${item.note}`} className="rounded-md bg-background px-2 py-2">
                          <span className="block font-medium text-foreground">{item.title}</span>
                          <span className="mt-0.5 line-clamp-2 block">{item.note}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-md border border-dashed border-border bg-background px-3 py-3 text-center text-xs text-muted-foreground">
                      Add completion notes to recurring tasks to build role instructions.
                    </p>
                  )}
                </div>
                <div className="rounded-md border border-border bg-muted/25 px-3 py-2">
                  <p className="mb-2 text-xs font-medium text-foreground">Source mix</p>
                  {learnedSourceMix.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {learnedSourceMix.map((item) => (
                        <span key={item.source} className="rounded-md bg-background px-2 py-1 text-xs text-muted-foreground">
                          {titleCase(item.source)}: {item.count}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-border bg-background px-3 py-3 text-center text-xs text-muted-foreground">
                      Sources appear after chat, email, Slack, SMS, or document tasks are captured.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border bg-background px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-foreground">Profile memory search</p>
                  <p className="text-xs text-muted-foreground">
                    Search current work, recurring responsibilities, history, owners, sources, and notes.
                  </p>
                </div>
                <Search className="size-4 text-muted-foreground" />
              </div>
              <Input
                value={profileTaskSearch}
                onChange={(event) => setProfileTaskSearch(event.target.value)}
                placeholder="Search this Position Profile"
                className="h-9 text-xs"
                data-testid="input-position-profile-task-search"
              />
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
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <ListChecks className="size-4 text-muted-foreground" />
                    Handoff readiness
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    What Donnit needs before this role can be safely covered or reassigned.
                  </p>
                </div>
                <span className="rounded-md bg-muted px-2 py-1 text-[11px] tabular-nums text-muted-foreground">
                  {profileReadinessDone}/{profileReadinessItems.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {profileReadinessItems.map((item) => (
                  <div key={item.label} className="flex items-start gap-2 rounded-md bg-muted/45 px-2 py-2 text-xs">
                    {item.done ? (
                      <Check className="mt-0.5 size-3.5 shrink-0 text-brand-green" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                    )}
                    <span className="min-w-0">
                      <span className="block font-medium text-foreground">{item.label}</span>
                      <span className="mt-0.5 block text-muted-foreground">{item.detail}</span>
                    </span>
                  </div>
                ))}
              </div>
              {selectedProfile.transitionChecklist.length > 0 && (
                <div className="mt-3 border-t border-border pt-2">
                  <p className="mb-1 text-xs font-medium text-foreground">Next transition steps</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {selectedProfile.transitionChecklist.slice(0, 4).map((item) => (
                      <li key={item} className="flex gap-2">
                        <Check className="mt-0.5 size-3 shrink-0 text-brand-green" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="rounded-md border border-border bg-background px-3 py-3">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <KeyRound className="size-4 text-muted-foreground" />
                    Access inventory
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Admin record for role tools, access owner, billing context, and reset/removal status.
                  </p>
                </div>
                <span className="rounded-md bg-muted px-2 py-1 text-[11px] tabular-nums text-muted-foreground">
                  {selectedProfile.accessItems.length}
                </span>
              </div>
              <div className="grid gap-2">
                {selectedProfile.accessItems.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                    No tools recorded for this role yet.
                  </p>
                ) : (
                  selectedProfile.accessItems.map((item) => (
                    <div key={item.id} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-foreground">{item.toolName}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {item.accountOwner || "No owner noted"}{item.loginUrl ? ` / ${item.loginUrl}` : ""}
                          </p>
                        </div>
                        <span className="rounded-md bg-background px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                          {accessStatusLabels[item.status]}
                        </span>
                      </div>
                      {item.billingNotes && (
                        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{item.billingNotes}</p>
                      )}
                      {canManageProfiles && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(["active", "needs_grant", "needs_reset", "remove_access"] as ProfileAccessItem["status"][]).map((status) => (
                            <Button
                              key={`${item.id}-${status}`}
                              type="button"
                              variant={item.status === status ? "default" : "outline"}
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => setAccessStatus(item.id, status)}
                              disabled={updateProfile.isPending}
                              data-testid={`button-profile-access-${status}-${item.id}`}
                            >
                              {accessStatusLabels[status]}
                            </Button>
                          ))}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => removeAccessItem(item.id)}
                            disabled={updateProfile.isPending}
                            data-testid={`button-profile-access-remove-${item.id}`}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
              {canManageProfiles && (
                <div className="mt-3 grid gap-2 rounded-md border border-border bg-muted/30 px-3 py-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={accessDraft.toolName}
                      onChange={(event) => setAccessDraft((current) => ({ ...current, toolName: event.target.value }))}
                      placeholder="Tool or account"
                      className="h-8 text-xs"
                      data-testid="input-profile-access-tool"
                    />
                    <Input
                      value={accessDraft.loginUrl}
                      onChange={(event) => setAccessDraft((current) => ({ ...current, loginUrl: event.target.value }))}
                      placeholder="Login URL or vault reference"
                      className="h-8 text-xs"
                      data-testid="input-profile-access-url"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_140px]">
                    <Input
                      value={accessDraft.accountOwner}
                      onChange={(event) => setAccessDraft((current) => ({ ...current, accountOwner: event.target.value }))}
                      placeholder="Owner/contact"
                      className="h-8 text-xs"
                      data-testid="input-profile-access-owner"
                    />
                    <Input
                      value={accessDraft.billingNotes}
                      onChange={(event) => setAccessDraft((current) => ({ ...current, billingNotes: event.target.value }))}
                      placeholder="Billing or reset notes"
                      className="h-8 text-xs"
                      data-testid="input-profile-access-notes"
                    />
                    <select
                      value={accessDraft.status}
                      onChange={(event) => setAccessDraft((current) => ({ ...current, status: event.target.value as ProfileAccessItem["status"] }))}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      data-testid="select-profile-access-status"
                    >
                      <option value="needs_grant">Grant access</option>
                      <option value="needs_reset">Reset needed</option>
                      <option value="remove_access">Remove access</option>
                      <option value="active">Active</option>
                      <option value="pending">Pending</option>
                    </select>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={addAccessItem}
                    disabled={accessDraft.toolName.trim().length < 2 || updateProfile.isPending}
                    data-testid="button-profile-access-add"
                  >
                    {updateProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />}
                    Add access item
                  </Button>
                </div>
              )}
            </div>

            {selectedProfile.currentIncompleteTasks.length > 0 && (
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="mb-2 text-xs font-medium text-foreground">Current incomplete work</p>
                <div className="space-y-1">
                  {visibleProfileCurrentTasks.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                      No current work matches this search.
                    </p>
                  ) : (
                    visibleProfileCurrentTasks
                      .slice(0, 6)
                      .map((task) => renderProfileTaskButton(task, `${task.dueDate ?? "No date"} / ${urgencyLabel(task.urgency)} / ${task.estimatedMinutes} min`))
                  )}
                </div>
              </div>
            )}

            {selectedProfile.recurringTasks.length > 0 && (
              <div className="rounded-md border border-border bg-background px-3 py-2">
                <p className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
                  <Repeat2 className="size-4 text-muted-foreground" />
                  Recurring responsibilities
                </p>
                <div className="space-y-1">
                  {visibleProfileRecurringTasks.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                      No recurring responsibility matches this search.
                    </p>
                  ) : (
                    visibleProfileRecurringTasks
                      .slice(0, 6)
                      .map((task) => renderProfileTaskButton(task, `${inferTaskCadence(task)} / due ${task.dueDate ?? "not set"} / visible ${task.visibleFrom ?? "now"}`))
                  )}
                </div>
              </div>
            )}

            <div className="rounded-md border border-border bg-background px-3 py-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <History className="size-4 text-muted-foreground" />
                  Historical task memory
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowProfileHistory((value) => !value)}
                  data-testid="button-position-profile-history-toggle"
                >
                  {showProfileHistory ? "Hide context" : "Show context"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Personal tasks are excluded. Confidential work stays in role memory but remains access-controlled.
              </p>
              {showProfileHistory && (
                <div className="mt-3 space-y-2">
                  {selectedProfile.completedTasks.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                      No completed work has been captured for this profile yet.
                    </p>
                  ) : visibleProfileCompletedTasks.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                      No historical task matches this search.
                    </p>
                  ) : (
                    visibleProfileCompletedTasks.slice(0, 10).map((task) => (
                      <div key={String(task.id)} className="rounded-md bg-muted/45 px-3 py-2 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedProfileTaskId(String(task.id))}
                            className="min-w-0 text-left font-medium text-foreground hover:text-brand-green"
                            data-testid={`button-position-profile-history-task-${task.id}`}
                          >
                            {task.title}
                          </button>
                          <span className="shrink-0 text-muted-foreground">{task.completedAt ? new Date(task.completedAt).toLocaleDateString() : task.dueDate ?? ""}</span>
                        </div>
                        {(task.description || task.completionNotes) && (
                          <p className="mt-1 line-clamp-3 text-muted-foreground">
                            {[task.description, task.completionNotes].filter(Boolean).join(" ")}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

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
      <TaskDetailDialog
        task={selectedProfileTask}
        users={users}
        subtasks={subtasks}
        events={events}
        authenticated={authenticated}
        positionProfiles={repositoryProfiles}
        open={Boolean(selectedProfileTask)}
        onOpenChange={(open) => {
          if (!open) setSelectedProfileTaskId(null);
        }}
      />
      <Dialog open={assignmentDialogOpen && Boolean(selectedProfile)} onOpenChange={setAssignmentDialogOpen}>
        <DialogContent className={`${dialogShellClass} sm:max-w-2xl`}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle>
              {mode === "transfer" ? "Transfer Position Profile" : "Delegate Position Profile"}
            </DialogTitle>
            <DialogDescription>
              Choose who should receive {selectedProfile?.title ?? "this profile"}. Employees can own more than one Position Profile.
            </DialogDescription>
          </DialogHeader>
          <div className={`${dialogBodyClass} space-y-4`}>
            <div className="grid gap-3 rounded-md border border-border bg-muted/25 p-3 sm:grid-cols-[1fr_1fr]">
              <div>
                <p className="ui-label">Selected profile</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{selectedProfile?.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Current owner: {selectedProfile ? profileAssignmentLabel(selectedProfile, users) : "Not selected"}
                </p>
              </div>
              <div className="grid gap-2">
                <select
                  value={mode}
                  onChange={(event) => {
                    const nextMode = event.target.value as "delegate" | "transfer";
                    setMode(nextMode);
                    setAssignmentFocus(nextMode);
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  data-testid="select-profile-transfer-mode"
                >
                  <option value="transfer">Transfer ownership</option>
                  <option value="delegate">Delegate temporary coverage</option>
                </select>
                {mode === "delegate" && (
                  <Input
                    type="date"
                    value={delegateUntil}
                    onChange={(event) => setDelegateUntil(event.target.value)}
                    className="h-9 text-xs"
                    data-testid="input-profile-transfer-delegate-until"
                  />
                )}
              </div>
            </div>
            <div className="rounded-md border border-border bg-background px-3 py-3" data-testid="panel-profile-transfer-preview">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Continuity preview</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Donnit will move current role work, preserve recurring timing, and keep historical context available behind the task history toggle.
                  </p>
                </div>
                {assignmentPreviewQuery.isFetching && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
              </div>
              {assignmentPreviewQuery.isError ? (
                <p className="mt-3 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  Could not load the preview. The transfer can still run, but review the profile after it finishes.
                </p>
              ) : assignmentPreview ? (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <ReportMetric label="Will move" value={String(assignmentPreview.summary.activeTasks)} />
                    <ReportMetric label="Recurring" value={String(assignmentPreview.summary.recurringTasks)} />
                    <ReportMetric label="History" value={String(assignmentPreview.summary.historicalTasks)} />
                    <ReportMetric label="Excluded" value={String(assignmentPreview.summary.personalTasksExcluded)} />
                  </div>
                  {assignmentPreview.includedTasks.length > 0 ? (
                    <div className="space-y-1.5">
                      {assignmentPreview.includedTasks.slice(0, 4).map((task) => (
                        <div key={task.id} className="flex items-start justify-between gap-3 rounded-md bg-muted/45 px-3 py-2 text-xs">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">{task.title}</span>
                            <span className="block truncate text-muted-foreground">
                              {task.dueDate ?? "No date"} / {urgencyLabel(task.urgency)} / {task.recurrence === "none" ? "one-time" : task.recurrence}
                              {task.visibleFrom ? ` / visible ${task.visibleFrom}` : ""}
                            </span>
                          </span>
                          {task.visibility === "confidential" && (
                            <span className="shrink-0 rounded-md bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                              Confidential
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                      No active profile tasks will move. Historical context will remain attached to the profile.
                    </p>
                  )}
                  {assignmentPreview.warnings.length > 0 && (
                    <ul className="space-y-1 text-xs leading-5 text-muted-foreground">
                      {assignmentPreview.warnings.map((warning) => (
                        <li key={warning} className="flex gap-2">
                          <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600" />
                          <span>{warning}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">Choose a target employee to preview the transition.</p>
              )}
            </div>
            <div className="grid gap-3">
              {assignmentUsers.map((user) => {
                const userProfiles = profilesForUser(repositoryProfiles, user.id);
                const isCurrentOwner = selectedProfile && String(profilePrimaryOwnerId(selectedProfile)) === String(user.id);
                const isSelected = String(targetUserId) === String(user.id);
                return (
                  <button
                    key={String(user.id)}
                    type="button"
                    onClick={() => setTargetUserId(String(user.id))}
                    disabled={Boolean(isCurrentOwner && mode === "transfer")}
                    className={`rounded-md border px-3 py-3 text-left transition ${
                      isSelected
                        ? "border-brand-green bg-brand-green/10"
                        : "border-border bg-background hover:border-brand-green/60 hover:bg-muted/40"
                    } ${isCurrentOwner && mode === "transfer" ? "cursor-not-allowed opacity-60" : ""}`}
                    data-testid={`button-profile-transfer-target-${user.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{user.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {titleCase(user.role)} {isCurrentOwner ? "/ current owner" : ""}
                        </p>
                      </div>
                      {isSelected && <Check className="size-4 shrink-0 text-brand-green" />}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {userProfiles.length === 0 ? (
                        <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                          No assigned Position Profiles
                        </span>
                      ) : (
                        userProfiles.map((profile) => (
                          <span key={profile.id} className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                            {profile.title}
                            {String(profile.delegateUserId ?? "") === String(user.id) ? " (delegate)" : ""}
                            {String(profile.temporaryOwnerId ?? "") === String(user.id) ? " (coverage)" : ""}
                          </span>
                        ))
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <DialogFooter className={dialogFooterClass}>
            <Button variant="outline" onClick={() => setAssignmentDialogOpen(false)} disabled={assign.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => assign.mutate()}
              disabled={!targetUserId || assign.isPending || !canManageProfiles}
              data-testid="button-profile-transfer-confirm"
            >
              {assign.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserCog className="size-4" />}
              {mode === "transfer" ? "Transfer profile" : "Start coverage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function ActivityLogPanel({
  events,
  tasks,
  users,
  subtasks = [],
  authenticated = false,
  compact = false,
}: {
  events: TaskEvent[];
  tasks: Task[];
  users: User[];
  subtasks?: TaskSubtask[];
  authenticated?: boolean;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const taskById = useMemo(() => new Map(tasks.map((task) => [String(task.id), task])), [tasks]);
  const userById = useMemo(() => new Map(users.map((user) => [String(user.id), user])), [users]);
  const filtered = useMemo(() => {
    if (!normalizedQuery) return events;
    return events.filter((event) => {
      const task = taskById.get(String(event.taskId));
      const user = userById.get(String(event.actorId));
      return eventSearchText(event, task, user).includes(normalizedQuery);
    });
  }, [events, normalizedQuery, taskById, userById]);
  const visible = compact && !normalizedQuery ? filtered.slice(0, 6) : filtered.slice(0, compact ? 10 : 150);
  const selectedTask = selectedTaskId ? taskById.get(selectedTaskId) ?? null : null;

  return (
    <div className="panel" data-testid={compact ? "panel-log" : "panel-activity-log"}>
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="display-font text-sm font-bold">
              <Archive className="mr-2 inline size-4" />
              Task log
            </h3>
            <p className="ui-label mt-1">Search prior tasks, notes, owners, and updates</p>
          </div>
          <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium tabular-nums text-muted-foreground">
            {filtered.length} result{filtered.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search task title, notes, person, source, or date"
            className="h-9 pl-9"
            data-testid="input-task-log-search"
          />
        </div>
      </div>
      <div className="px-4 py-3">
        {visible.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            {normalizedQuery ? "No matching task history found." : "No activity yet."}
          </p>
        ) : (
          <ul className={compact ? "space-y-2.5" : "divide-y divide-border"}>
            {visible.map((event) => {
              const task = taskById.get(String(event.taskId));
              const user = userById.get(String(event.actorId));
              const isComplete = event.type === "completed";
              return (
                <li
                  key={event.id}
                  className={compact ? "flex gap-2.5" : "py-3"}
                  data-testid={`row-event-${event.id}`}
                >
                  <div className="flex w-full items-start gap-3">
                    <span
                      className={`mt-2 size-2 shrink-0 rounded-full ${
                        isComplete ? "bg-brand-green" : "bg-muted-foreground/40"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-snug text-foreground">
                            {task?.title ?? `Task ${event.taskId}`}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {activityEventLabel(event.type)} by {user?.name ?? "Unknown"} · {new Date(event.createdAt).toLocaleString()}
                          </p>
                        </div>
                        {task && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => setSelectedTaskId(String(event.taskId))}
                            data-testid={`button-open-log-task-${event.id}`}
                          >
                            <Eye className="size-3" />
                            Open
                          </Button>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                        {task?.dueDate && <span className="rounded bg-muted px-1.5 py-0.5">Due {task.dueDate}</span>}
                        {task?.source && <span className="rounded bg-muted px-1.5 py-0.5">{titleCase(task.source)}</span>}
                        {task?.status && <span className="rounded bg-muted px-1.5 py-0.5">{statusLabels[task.status] ?? task.status}</span>}
                      </div>
                      {event.note && <p className="mt-1.5 line-clamp-3 text-xs text-foreground">{event.note}</p>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {filtered.length > visible.length && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Showing {visible.length} of {filtered.length}. Refine the search to narrow the log.
          </p>
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
  positionProfiles,
  excludedTaskIds,
  agendaApproved,
  agendaPreferences,
  agendaSchedule,
  onOpenInbox,
  onBuildAgenda,
  onToggleAgendaTask,
  onMoveAgendaTask,
  onUpdateAgendaPreferences,
  onUpdateAgendaSchedule,
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
  positionProfiles: PositionProfile[];
  excludedTaskIds: Set<string>;
  agendaApproved: boolean;
  agendaPreferences: AgendaPreferences;
  agendaSchedule: AgendaSchedule;
  onOpenInbox: () => void;
  onBuildAgenda: () => void;
  onToggleAgendaTask: (taskId: Id) => void;
  onMoveAgendaTask: (taskId: Id, direction: "up" | "down") => void;
  onUpdateAgendaPreferences: (preferences: AgendaPreferences) => void;
  onUpdateAgendaSchedule: (schedule: AgendaSchedule) => void;
  onApproveAgenda: () => void;
  onOpenAgendaWork: () => void;
  onExportAgenda: () => void;
  isBuildingAgenda: boolean;
}) {
  const today = localDateIso();
  const dueTodayCount = tasks.filter(
    (task) => task.dueDate === today && task.status !== "completed" && task.status !== "denied",
  ).length;
  const approvalCount =
    tasks.filter((task) => task.status === "pending_acceptance").length +
    suggestions.filter((suggestion) => suggestion.status === "pending").length;
  const activeTeamCount = tasks.filter(
    (task) => String(task.assignedToId) !== String(currentUserId) && task.status !== "completed" && task.status !== "denied",
  ).length;
  const tabs: Array<{
    id: SupportRailView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count: number;
  }> = [
    { id: "today", label: "Today", icon: CheckCircle2, count: dueTodayCount + approvalCount },
    { id: "agenda", label: "Agenda", icon: CalendarClock, count: agenda.length },
    { id: "team", label: "Team", icon: Users, count: activeTeamCount },
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
          schedule={agendaSchedule}
          onBuild={onBuildAgenda}
          onToggleTask={onToggleAgendaTask}
          onMoveTask={onMoveAgendaTask}
          onPreferencesChange={onUpdateAgendaPreferences}
          onScheduleChange={onUpdateAgendaSchedule}
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

    </div>
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

function ToolStatusBadge({ status, label: customLabel }: { status: "ready" | "warning" | "setup"; label?: string }) {
  const label = customLabel ?? (status === "ready" ? "Ready" : status === "warning" ? "Needs attention" : "Setup");
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

const MEMBER_ROLE_OPTIONS = ["owner", "admin", "manager", "member", "viewer"] as const;
const MEMBER_STATUS_OPTIONS = ["active", "inactive"] as const;

function WorkspaceMembersPanel({
  users,
  currentUser,
  currentUserId,
  positionProfiles,
}: {
  users: User[];
  currentUser: User | null;
  currentUserId: Id;
  positionProfiles: PositionProfile[];
}) {
  const canManage = canManageWorkspaceMembers(currentUser);
  const activeUsers = users.filter(isActiveUser);
  const managerOptions = activeUsers.filter((user) => ["owner", "admin", "manager"].includes(user.role));
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof MEMBER_ROLE_OPTIONS)[number]>("member");
  const [persona, setPersona] = useState("operator");
  const [managerId, setManagerId] = useState("");
  const [canAssign, setCanAssign] = useState(false);
  const [positionProfileId, setPositionProfileId] = useState("");
  const availablePositionProfiles = positionProfiles
    .filter((profile) => profile.persisted)
    .filter((profile) => {
      if (!profile.currentOwnerId) return true;
      const owner = users.find((user) => String(user.id) === String(profile.currentOwnerId));
      return owner?.status === "inactive";
    });

  const addMember = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/members", {
        fullName: fullName.trim(),
        email: email.trim(),
        role,
        persona: persona.trim() || "operator",
        managerId: managerId || null,
        canAssign,
        positionProfileId: positionProfileId || null,
      });
      return await res.json();
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({
        title: "Member added",
        description: "The user is staged in Donnit and can now receive assigned work.",
      });
      setFullName("");
      setEmail("");
      setRole("member");
      setPersona("operator");
      setManagerId("");
      setCanAssign(false);
      setPositionProfileId("");
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not add member",
        description: apiErrorMessage(error, "Apply the member management migration and try again."),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <p className="text-sm font-medium text-foreground">Members and access</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Stage users, reporting lines, and workspace permissions.
          </p>
        </div>
        <span className="ui-label">
          {activeUsers.length}/{users.length} active
        </span>
      </div>
      {canManage ? (
        <div className="grid gap-3 border-b border-border bg-muted/25 px-3 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="member-full-name">Name</Label>
              <Input
                id="member-full-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Jordan Lee"
                data-testid="input-member-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-email">Email</Label>
              <Input
                id="member-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="jordan@company.com"
                data-testid="input-member-email"
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="member-role">Role</Label>
              <select
                id="member-role"
                value={role}
                onChange={(event) => setRole(event.target.value as (typeof MEMBER_ROLE_OPTIONS)[number])}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                data-testid="select-member-role"
              >
                {MEMBER_ROLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {titleCase(option)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-manager">Manager</Label>
              <select
                id="member-manager"
                value={managerId}
                onChange={(event) => setManagerId(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                data-testid="select-member-manager"
              >
                <option value="">No manager</option>
                {managerOptions.map((user) => (
                  <option key={String(user.id)} value={String(user.id)}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-persona">Persona</Label>
              <Input
                id="member-persona"
                value={persona}
                onChange={(event) => setPersona(event.target.value)}
                placeholder="operator"
                data-testid="input-member-persona"
              />
            </div>
            <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm">
              <input
                type="checkbox"
                checked={canAssign}
                onChange={(event) => setCanAssign(event.target.checked)}
                data-testid="checkbox-member-can-assign"
              />
              Can assign
            </label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="member-position-profile">Position Profile</Label>
            <select
              id="member-position-profile"
              value={positionProfileId}
              onChange={(event) => setPositionProfileId(event.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              data-testid="select-member-position-profile"
            >
              <option value="">Choose available Position Profile</option>
              {availablePositionProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.title}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              One active employee can own each Position Profile at a time.
            </p>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => addMember.mutate()}
              disabled={addMember.isPending || fullName.trim().length < 2 || !email.includes("@") || (availablePositionProfiles.length > 0 && !positionProfileId)}
              data-testid="button-member-add"
            >
              {addMember.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              Add member
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-b border-border px-3 py-3 text-sm text-muted-foreground">
          Only workspace owners and admins can change user access.
        </div>
      )}
      <div className="max-h-72 overflow-y-auto px-3 py-2">
        {users.map((user) => (
          <WorkspaceMemberRow
            key={String(user.id)}
            user={user}
            users={users}
            currentUserId={currentUserId}
            canManage={canManage}
            positionProfiles={positionProfiles}
          />
        ))}
      </div>
    </div>
  );
}

function WorkspaceMemberRow({
  user,
  users,
  currentUserId,
  canManage,
  positionProfiles,
}: {
  user: User;
  users: User[];
  currentUserId: Id;
  canManage: boolean;
  positionProfiles: PositionProfile[];
}) {
  const [fullName, setFullName] = useState(user.name);
  const [role, setRole] = useState<(typeof MEMBER_ROLE_OPTIONS)[number]>(
    MEMBER_ROLE_OPTIONS.includes(user.role as (typeof MEMBER_ROLE_OPTIONS)[number])
      ? (user.role as (typeof MEMBER_ROLE_OPTIONS)[number])
      : "member",
  );
  const [persona, setPersona] = useState(user.persona || "operator");
  const [managerId, setManagerId] = useState(user.managerId ? String(user.managerId) : "");
  const [canAssign, setCanAssign] = useState(Boolean(user.canAssign));
  const [status, setStatus] = useState<(typeof MEMBER_STATUS_OPTIONS)[number]>(user.status ?? "active");
  const [profileId, setProfileId] = useState("");
  const [lastAccessLink, setLastAccessLink] = useState("");
  const savedProfiles = positionProfiles
    .filter((profile) => profile.persisted)
    .filter((profile) => {
      if (!profile.currentOwnerId || String(profile.currentOwnerId) === String(user.id)) return true;
      const owner = users.find((candidate) => String(candidate.id) === String(profile.currentOwnerId));
      return owner?.status === "inactive";
    });
  const managerOptions = users.filter(
    (candidate) =>
      isActiveUser(candidate) &&
      ["owner", "admin", "manager"].includes(candidate.role) &&
      String(candidate.id) !== String(user.id),
  );
  const isSelf = String(user.id) === String(currentUserId);
  const copyAccessLink = async (value: string) => {
    setLastAccessLink(value);
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "Link copied", description: "Send it to the user through your preferred channel." });
    } catch {
      toast({ title: "Access link ready", description: "Copy the link from the member row." });
    }
  };
  const saveMember = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/admin/members/${encodeURIComponent(String(user.id))}`, {
        fullName: fullName.trim(),
        role,
        persona: persona.trim() || "operator",
        managerId: managerId || null,
        canAssign,
        status,
      });
      return await res.json();
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      toast({ title: "Member updated", description: `${fullName.trim() || user.name} was saved.` });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not update member",
        description: apiErrorMessage(error, "Check role/status rules and try again."),
        variant: "destructive",
      });
    },
  });
  const accessAction = useMutation({
    mutationFn: async (action: "invite" | "reset-access" | "remove-access") => {
      const res = await apiRequest("POST", `/api/admin/members/${encodeURIComponent(String(user.id))}/${action}`);
      return {
        action,
        result: (await res.json()) as { ok: boolean; message?: string; actionLink?: string },
      };
    },
    onSuccess: async ({ action, result }) => {
      await invalidateWorkspace();
      if (result.actionLink) {
        await copyAccessLink(result.actionLink);
        return;
      }
      toast({
        title: action === "remove-access" ? "Access removed" : "Access updated",
        description: result.message ?? "Member access was updated.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not update access",
        description: apiErrorMessage(error, "Check Supabase service role configuration and try again."),
        variant: "destructive",
      });
    },
  });
  const assignPositionProfile = useMutation({
    mutationFn: async () => {
      if (!profileId) throw new Error("Choose a Position Profile.");
      const profile = savedProfiles.find((item) => item.id === profileId);
      const res = await apiRequest("POST", "/api/position-profiles/assign", {
        profileId,
        fromUserId: profile?.currentOwnerId ?? user.id,
        toUserId: user.id,
        mode: "transfer",
        profileTitle: profile?.title ?? "Position Profile",
      });
      return (await res.json()) as { ok: boolean; updated: number; profile?: PersistedPositionProfile | null };
    },
    onSuccess: async (result) => {
      await invalidateWorkspace();
      toast({ title: "Profile assigned", description: `${result.profile?.title ?? "Position Profile"} is now assigned to ${fullName.trim() || user.name}.` });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not assign profile",
        description: apiErrorMessage(error, "Confirm the profile is saved and try again."),
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    setFullName(user.name);
    setRole(
      MEMBER_ROLE_OPTIONS.includes(user.role as (typeof MEMBER_ROLE_OPTIONS)[number])
        ? (user.role as (typeof MEMBER_ROLE_OPTIONS)[number])
        : "member",
    );
    setPersona(user.persona || "operator");
    setManagerId(user.managerId ? String(user.managerId) : "");
    setCanAssign(Boolean(user.canAssign));
    setStatus(user.status ?? "active");
  }, [user.id, user.name, user.role, user.persona, user.managerId, user.canAssign, user.status]);

  return (
    <div className="grid gap-2 border-b border-border/60 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`ui-label ${status === "inactive" ? "text-muted-foreground" : ""}`}>{status}</span>
          <span className="ui-label">{titleCase(user.role || "member")}</span>
        </div>
      </div>
      {canManage && (
        <div className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-[1.2fr_.85fr_.9fr_.9fr_.7fr_auto] sm:items-center">
            <Input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              aria-label={`${user.name} name`}
              className="h-9"
              data-testid={`input-member-row-name-${user.id}`}
            />
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as (typeof MEMBER_ROLE_OPTIONS)[number])}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              disabled={isSelf && role === "owner"}
              aria-label={`${user.name} role`}
              data-testid={`select-member-row-role-${user.id}`}
            >
              {MEMBER_ROLE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {titleCase(option)}
                </option>
              ))}
            </select>
            <select
              value={managerId}
              onChange={(event) => setManagerId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              aria-label={`${user.name} manager`}
              data-testid={`select-member-row-manager-${user.id}`}
            >
              <option value="">No manager</option>
              {managerOptions.map((candidate) => (
                <option key={String(candidate.id)} value={String(candidate.id)}>
                  {candidate.name}
                </option>
              ))}
            </select>
            <Input
              value={persona}
              onChange={(event) => setPersona(event.target.value)}
              aria-label={`${user.name} persona`}
              className="h-9"
              data-testid={`input-member-row-persona-${user.id}`}
            />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as (typeof MEMBER_STATUS_OPTIONS)[number])}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              disabled={isSelf}
              aria-label={`${user.name} status`}
              data-testid={`select-member-row-status-${user.id}`}
            >
              {MEMBER_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {titleCase(option)}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-end gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={canAssign}
                  onChange={(event) => setCanAssign(event.target.checked)}
                  aria-label={`${user.name} can assign`}
                />
                Assign
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => saveMember.mutate()}
                disabled={saveMember.isPending || fullName.trim().length < 2}
                data-testid={`button-member-row-save-${user.id}`}
              >
                {saveMember.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Save
              </Button>
            </div>
          </div>
          <div className="grid gap-2 rounded-md bg-muted/35 px-2 py-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <select
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
              aria-label={`Assign Position Profile to ${user.name}`}
              data-testid={`select-member-row-position-profile-${user.id}`}
            >
              <option value="">Assign Position Profile</option>
              {savedProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.title}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => assignPositionProfile.mutate()}
              disabled={!profileId || assignPositionProfile.isPending || user.status === "inactive"}
              data-testid={`button-member-row-assign-profile-${user.id}`}
            >
              {assignPositionProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : <BriefcaseBusiness className="size-4" />}
              Assign profile
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => accessAction.mutate("invite")}
              disabled={accessAction.isPending || user.status === "inactive"}
              data-testid={`button-member-row-invite-${user.id}`}
            >
              {accessAction.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Invite link
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => accessAction.mutate("reset-access")}
              disabled={accessAction.isPending || user.status === "inactive"}
              data-testid={`button-member-row-reset-${user.id}`}
            >
              {accessAction.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
              Reset access
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => accessAction.mutate("remove-access")}
              disabled={accessAction.isPending || user.status === "inactive" || isSelf}
              data-testid={`button-member-row-remove-access-${user.id}`}
            >
              {accessAction.isPending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              Remove access
            </Button>
          </div>
          {lastAccessLink && (
            <div className="grid gap-2 rounded-md border border-dashed border-border px-2 py-2 sm:grid-cols-[1fr_auto]">
              <Input readOnly value={lastAccessLink} className="h-9 text-xs" aria-label={`${user.name} access link`} />
              <Button type="button" size="sm" variant="outline" onClick={() => copyAccessLink(lastAccessLink)}>
                Copy link
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskTemplatesPanel({
  templates,
  authenticated,
}: {
  templates: TaskTemplate[];
  authenticated: boolean;
}) {
  const [editingId, setEditingId] = useState<string>("");
  const editingTemplate = templates.find((template) => String(template.id) === editingId) ?? null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerPhrases, setTriggerPhrases] = useState("");
  const [defaultUrgency, setDefaultUrgency] = useState<"low" | "normal" | "high" | "critical">("normal");
  const [defaultEstimatedMinutes, setDefaultEstimatedMinutes] = useState(30);
  const [defaultRecurrence, setDefaultRecurrence] = useState<"none" | "daily" | "weekly" | "monthly" | "quarterly" | "annual">("none");
  const [subtasks, setSubtasks] = useState("");

  useEffect(() => {
    if (!editingTemplate) {
      setName("");
      setDescription("");
      setTriggerPhrases("");
      setDefaultUrgency("normal");
      setDefaultEstimatedMinutes(30);
      setDefaultRecurrence("none");
      setSubtasks("");
      return;
    }
    setName(editingTemplate.name);
    setDescription(editingTemplate.description);
    setTriggerPhrases(editingTemplate.triggerPhrases.join(", "));
    setDefaultUrgency(editingTemplate.defaultUrgency);
    setDefaultEstimatedMinutes(editingTemplate.defaultEstimatedMinutes);
    setDefaultRecurrence(editingTemplate.defaultRecurrence);
    setSubtasks(editingTemplate.subtasks.map((subtask) => subtask.title).join("\n"));
  }, [editingTemplate?.id]);

  const payload = () => ({
    name: name.trim(),
    description: description.trim(),
    triggerPhrases: triggerPhrases
      .split(",")
      .map((phrase) => phrase.trim())
      .filter(Boolean),
    defaultUrgency,
    defaultEstimatedMinutes,
    defaultRecurrence,
    subtasks: subtasks
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = payload();
      const res = editingTemplate
        ? await apiRequest("PATCH", `/api/task-templates/${editingTemplate.id}`, body)
        : await apiRequest("POST", "/api/task-templates", body);
      return (await res.json()) as TaskTemplate;
    },
    onSuccess: async (template) => {
      await invalidateWorkspace();
      setEditingId(String(template.id));
      toast({
        title: "Template saved",
        description: "Matching tasks will now inherit this subtask sequence.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not save template",
        description: apiErrorMessage(error, "Apply the task templates migration, then try again."),
        variant: "destructive",
      });
    },
  });

  const remove = useMutation({
    mutationFn: async (templateId: Id) => {
      await apiRequest("DELETE", `/api/task-templates/${templateId}`);
    },
    onSuccess: async () => {
      await invalidateWorkspace();
      setEditingId("");
      toast({ title: "Template deleted", description: "New tasks will no longer use that sequence." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not delete template",
        description: apiErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    },
  });

  const currentPayload = payload();
  const ready = authenticated && currentPayload.name.length >= 2 && currentPayload.subtasks.length > 0;

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <p className="text-sm font-medium text-foreground">Task templates</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Build reusable subtask sequences Donnit can attach from chat or scanned work.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditingId("")} data-testid="button-new-task-template">
          <ListPlus className="size-4" />
          New template
        </Button>
      </div>
      <div className="grid gap-3 px-3 py-3 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="grid content-start gap-2">
          {templates.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              No templates yet. Create one for repeatable work like onboarding, renewals, or quarterly reviews.
            </div>
          ) : (
            templates.map((template) => (
              <button
                key={String(template.id)}
                type="button"
                onClick={() => setEditingId(String(template.id))}
                className={`rounded-md border px-3 py-2 text-left transition ${
                  String(template.id) === editingId ? "border-brand-green bg-brand-green/10" : "border-border bg-background hover:border-brand-green/60"
                }`}
                data-testid={`button-task-template-${template.id}`}
              >
                <span className="block text-sm font-medium text-foreground">{template.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {template.subtasks.length} subtask{template.subtasks.length === 1 ? "" : "s"} · {template.triggerPhrases.slice(0, 3).join(", ") || "name match"}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1.5">
              <Label htmlFor="template-name">Name</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Onboard new employee"
                maxLength={120}
                data-testid="input-template-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-minutes">Default minutes</Label>
              <Input
                id="template-minutes"
                type="number"
                min={5}
                max={1440}
                value={defaultEstimatedMinutes}
                onChange={(event) => setDefaultEstimatedMinutes(Math.max(5, Math.min(1440, Number(event.target.value) || 30)))}
                data-testid="input-template-minutes"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-triggers">Trigger words</Label>
            <Input
              id="template-triggers"
              value={triggerPhrases}
              onChange={(event) => setTriggerPhrases(event.target.value)}
              placeholder="onboard, onboarding, new hire"
              data-testid="input-template-triggers"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="template-urgency">Default urgency</Label>
              <select
                id="template-urgency"
                value={defaultUrgency}
                onChange={(event) => setDefaultUrgency(event.target.value as "low" | "normal" | "high" | "critical")}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="select-template-urgency"
              >
                <option value="low">Low</option>
                <option value="normal">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-recurrence">Default repeat</Label>
              <select
                id="template-recurrence"
                value={defaultRecurrence}
                onChange={(event) => setDefaultRecurrence(event.target.value as "none" | "daily" | "weekly" | "monthly" | "quarterly" | "annual")}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                data-testid="select-template-recurrence"
              >
                <option value="none">No</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-description">Template notes</Label>
            <Textarea
              id="template-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this sequence is for."
              className="min-h-[70px]"
              data-testid="input-template-description"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="template-subtasks">Subtasks</Label>
            <Textarea
              id="template-subtasks"
              value={subtasks}
              onChange={(event) => setSubtasks(event.target.value)}
              placeholder={"Create account\nSend benefits packet\nSchedule manager check-in"}
              className="min-h-[110px]"
              data-testid="input-template-subtasks"
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {editingTemplate && (
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => remove.mutate(editingTemplate.id)}
                disabled={remove.isPending}
                data-testid="button-delete-task-template"
              >
                {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                Delete
              </Button>
            )}
            <Button type="button" onClick={() => save.mutate()} disabled={!ready || save.isPending} data-testid="button-save-task-template">
              {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <ListChecks className="size-4" />}
              Save template
            </Button>
          </div>
        </div>
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
  subtasks,
  events,
  taskTemplates,
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
  subtasks: TaskSubtask[];
  events: TaskEvent[];
  taskTemplates: TaskTemplate[];
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
  const calendarReady = Boolean(oauthStatus?.connected && oauthStatus.calendarConnected);
  const needsGoogleReconnect = Boolean(oauthStatus?.requiresReconnect || oauthStatus?.calendarRequiresReconnect);
  const gmailReady = Boolean(oauthStatus?.connected && oauthStatus.gmailScopeConnected && !oauthStatus.tokenExpiresSoon);
  const gmailSendReady = Boolean(oauthStatus?.connected && oauthStatus.gmailSendScopeConnected);
  const slackStatus = useSlackIntegrationStatus(authenticated);
  const slackData = slackStatus.data;
  const slackEventsReady = Boolean(slackData?.eventsConfigured ?? integrations.slack?.eventsConfigured);
  const slackBotReady = Boolean(slackData?.botConfigured ?? integrations.slack?.botConfigured);
  const slackHealth: "ready" | "warning" | "setup" = slackEventsReady ? (slackBotReady ? "ready" : "warning") : "setup";
  const smsStatus = useSmsIntegrationStatus(authenticated);
  const smsData = smsStatus.data;
  const googleHealthLabel =
    oauthStatus?.health === "ready"
      ? "Ready"
      : oauthStatus?.health === "calendar_scope_missing"
        ? "Calendar permission missing"
        : oauthStatus?.health === "gmail_scope_missing"
          ? "Gmail permission missing"
          : oauthStatus?.health === "gmail_send_scope_missing"
            ? "Gmail send permission missing"
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
  const [emailSignature, setEmailSignature] = useState(() => currentUser?.emailSignature ?? readCustomEmailSignature());
  useEffect(() => {
    const nextSignature = currentUser?.emailSignature ?? readCustomEmailSignature();
    setEmailSignature(nextSignature);
    if (typeof window !== "undefined" && nextSignature.trim()) {
      window.localStorage.setItem(EMAIL_SIGNATURE_CUSTOM_KEY, nextSignature);
      if (!window.localStorage.getItem(EMAIL_SIGNATURE_TEMPLATE_KEY)) {
        window.localStorage.setItem(EMAIL_SIGNATURE_TEMPLATE_KEY, "custom");
      }
    }
  }, [currentUser?.id, currentUser?.emailSignature]);
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
  const saveEmailSignature = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/profile/signature", {
        emailSignature,
      });
      return (await res.json()) as { ok: boolean; emailSignature: string };
    },
    onSuccess: async (result) => {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(EMAIL_SIGNATURE_CUSTOM_KEY, result.emailSignature ?? emailSignature.trim());
        window.localStorage.setItem(EMAIL_SIGNATURE_TEMPLATE_KEY, "custom");
      }
      await invalidateWorkspace();
      toast({
        title: "Signature saved",
        description: "Generated replies will use your custom signature by default.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not save signature",
        description: apiErrorMessage(error, "Apply the latest Supabase migration, then try again."),
        variant: "destructive",
      });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogShellClass} sm:max-w-4xl`}>
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
              <p className="mt-1 text-sm font-medium text-foreground">
                {users.filter(isActiveUser).length}/{users.length} active
              </p>
            </div>
            <div className="rounded-md border border-border px-3 py-3">
              <p className="ui-label">Google</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {googleHealthLabel}
              </p>
            </div>
          </div>

          <div className="rounded-md border border-border">
            <div className="border-b border-border px-3 py-2">
              <p className="text-sm font-medium text-foreground">Email signature</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Donnit adds this to generated email replies when you choose your custom signature.
              </p>
            </div>
            <div className="grid gap-3 px-3 py-3">
              <div className="grid gap-1.5">
                <Label htmlFor="workspace-email-signature" className="ui-label">
                  Personal default
                </Label>
                <Textarea
                  id="workspace-email-signature"
                  value={emailSignature}
                  onChange={(event) => setEmailSignature(event.target.value)}
                  placeholder={`Best regards,\n${currentUser?.name ?? "Your name"}\nCEO & Founder, Donnit`}
                  className="min-h-[110px] text-sm"
                  maxLength={1000}
                  disabled={!authenticated || saveEmailSignature.isPending}
                  data-testid="input-email-signature"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Each user controls their own signature. Admins do not need to set this for the team.
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => saveEmailSignature.mutate()}
                  disabled={!authenticated || saveEmailSignature.isPending}
                  data-testid="button-save-email-signature"
                >
                  {saveEmailSignature.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Save signature
                </Button>
              </div>
            </div>
          </div>

          {authenticated && (
            <TaskTemplatesPanel
              templates={taskTemplates}
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
                status={gmailReady ? (gmailSendReady ? "ready" : "warning") : needsGoogleReconnect || oauthStatus?.health === "gmail_scope_missing" ? "warning" : "setup"}
                detail={
                  gmailReady
                    ? `${gmailSendReady ? "Scanning and replies are connected" : "Scanning works; reconnect Google to send approved replies from Donnit"}. Last scan: ${oauthStatus?.lastScannedAt ? formatReceivedAt(oauthStatus.lastScannedAt) : "not yet scanned"}.`
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
                      ? `MVP channel. Events are ready, user mapping is active, and Donnit queues suggestions after a ${slackDelay} minute delay.`
                      : `MVP channel. Events can ingest with the Slack signing secret or ingest token. Add SLACK_BOT_TOKEN for stronger user email mapping.`
                    : "MVP channel. Configure SLACK_SIGNING_SECRET or DONNIT_SLACK_WEBHOOK_TOKEN so Slack messages can become approval suggestions."
                }
                actionLabel="Queue test"
                action={() => testSlack.mutate()}
                loading={testSlack.isPending}
              />
              <ConnectedToolRow
                icon={Send}
                name="SMS"
                status="setup"
                detail={`Coming soon after the MVP. For Thursday, present SMS as the next mobile command surface, not a live MVP channel. Test endpoint: ${smsData?.inboundEndpoint ?? "/api/integrations/sms/inbound"}.`}
                actionLabel="Coming soon"
                action={() => undefined}
                disabled
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
                <p className="text-sm font-medium text-foreground">SMS inbound bridge - coming soon</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  SMS is intentionally outside the Thursday MVP. Endpoint for later testing: <span className="font-mono">{smsData?.inboundEndpoint ?? "/api/integrations/sms/inbound"}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Future routing: {smsData?.routing.defaultAssigneeConfigured ? "configured default assignee" : "workspace owner fallback"}.
                </p>
              </div>
            </div>
          </div>

          <WorkspaceMembersPanel
            users={users}
            currentUser={currentUser}
            currentUserId={currentUserId}
            positionProfiles={positionProfiles}
          />
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
  gmailSendScopeConnected?: boolean;
  calendarConnected?: boolean;
  calendarRequiresReconnect?: boolean;
  requiresReconnect?: boolean;
  tokenExpiresSoon?: boolean;
  health?: "ready" | "oauth_not_configured" | "not_connected" | "needs_reconnect" | "gmail_scope_missing" | "gmail_send_scope_missing" | "calendar_scope_missing";
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
  const [managerReportOpen, setManagerReportOpen] = useState(false);
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
  const [agendaSchedule, setAgendaSchedule] = useState<AgendaSchedule>(DEFAULT_AGENDA_SCHEDULE);
  const [agendaTaskOrder, setAgendaTaskOrder] = useState<string[]>([]);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [onboardingManuallyOpen, setOnboardingManuallyOpen] = useState(false);
  const [demoGuideDismissed, setDemoGuideDismissed] = useState(false);
  const [demoGuideManuallyOpen, setDemoGuideManuallyOpen] = useState(false);
  const [mvpReadinessDismissed, setMvpReadinessDismissed] = useState(() => {
    try {
      if (typeof window === "undefined") return false;
      return window.localStorage.getItem("donnit.mvpReadinessDismissed") === "true";
    } catch {
      return false;
    }
  });
  const [mvpReadinessManuallyOpen, setMvpReadinessManuallyOpen] = useState(false);
  const [appView, setAppView] = useState<AppView>("home");
  const [supportView, setSupportView] = useState<SupportRailView>("today");
  const [workspaceTaskScope, setWorkspaceTaskScope] = useState<"mine" | "team">("mine");
  const [selectedTeamViewUserId, setSelectedTeamViewUserId] = useState("");
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
  const persistedAgendaSchedule = JSON.stringify(data?.workspaceState?.agenda.schedule ?? DEFAULT_AGENDA_SCHEDULE);
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
    schedule = agendaSchedule,
  ) => {
    persistWorkspaceState({
      key: "agenda_state",
      value: {
        excludedTaskIds: Array.from(excludedTaskIds),
        approved,
        approvedAt,
        preferences,
        taskOrder,
        schedule,
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
    setAgendaSchedule(normalizeAgendaSchedule(data.workspaceState.agenda.schedule));
    setAgendaTaskOrder(data.workspaceState.agenda.taskOrder);
  }, [data?.authenticated, persistedAgendaApproved, persistedAgendaExcludedTaskIds, persistedAgendaPreferences, persistedAgendaSchedule, persistedAgendaTaskOrder]);

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
      } else if (reason === "gmail_send_scope_missing") {
        title = "Reconnect Gmail with send access";
        description =
          serverMessage ??
          "Donnit can scan email, but needs Gmail send permission before approved replies can be sent from Donnit.";
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
    mutationFn: async (_input?: { schedule?: AgendaSchedule }) => {
      const res = await apiRequest("GET", "/api/agenda");
      const agenda = (await res.json()) as AgendaItem[];
      await invalidateWorkspace();
      return agenda;
    },
    onSuccess: (agenda, input) => {
      setAgendaExcludedTaskIds(new Set());
      setAgendaApproved(false);
      persistAgendaState(new Set(), false, null, agendaPreferences, agendaTaskOrder, input?.schedule ?? agendaSchedule);
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

  useEffect(() => {
    if (!data?.authenticated || !agendaSchedule.autoBuildEnabled) return;
    const maybeBuildDailyAgenda = () => {
      const today = localDateIso();
      if (agendaSchedule.lastAutoBuildDate === today) return;
      if (!isTimeAtOrAfter(localTimeHHMM(), agendaSchedule.buildTime)) return;
      if (buildAgenda.isPending) return;
      const hasOpenTasks = (data?.tasks ?? [])
        .filter(isVisibleWorkTask)
        .some((task) => task.status !== "completed" && task.status !== "denied");
      if (!hasOpenTasks) return;
      const nextSchedule = { ...agendaSchedule, lastAutoBuildDate: today };
      setAgendaSchedule(nextSchedule);
      setAgendaApproved(false);
      setSupportView("agenda");
      persistAgendaState(agendaExcludedTaskIds, false, null, agendaPreferences, agendaTaskOrder, nextSchedule);
      buildAgenda.mutate({ schedule: nextSchedule });
    };
    maybeBuildDailyAgenda();
    const interval = window.setInterval(maybeBuildDailyAgenda, 60 * 1000);
    return () => window.clearInterval(interval);
  }, [
    agendaExcludedTaskIds,
    agendaPreferences,
    agendaSchedule,
    agendaTaskOrder,
    buildAgenda,
    data?.authenticated,
    data?.tasks,
  ]);

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

  const seedDemoWorkspace = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/seed-demo-team");
      return (await res.json()) as {
        message?: string;
        users?: number;
        tasks?: number;
        subtasks?: number;
        suggestions?: number;
        positionProfiles?: number;
      };
    },
    onSuccess: async (result) => {
      await invalidateWorkspace();
      setSupportView("team");
      setDemoGuideDismissed(false);
      setDemoGuideManuallyOpen(true);
      toast({
        title: "Demo workspace ready",
        description: result.message ?? "Demo data was added to this workspace. Use the demo guide to open Team, Approvals, Reports, and Profiles.",
      });
      window.setTimeout(() => {
        document.getElementById("panel-demo-workspace-guide")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not seed demo workspace",
        description: apiErrorMessage(error, "Confirm you are an admin and SUPABASE_SERVICE_ROLE_KEY is set."),
        variant: "destructive",
      });
    },
  });

  const displayTasks = useMemo(() => (data?.tasks ?? []).filter(isVisibleWorkTask), [data?.tasks]);
  const currentWorkspaceUser = useMemo(
    () => data?.users.find((user) => String(user.id) === String(data.currentUserId)) ?? null,
    [data?.currentUserId, data?.users],
  );
  const managerTeamMembers = useMemo(
    () => teamMembersForUser(data?.users ?? [], currentWorkspaceUser, data?.currentUserId),
    [currentWorkspaceUser, data?.currentUserId, data?.users],
  );
  const selectedTeamViewUser =
    managerTeamMembers.find((user) => String(user.id) === selectedTeamViewUserId) ?? managerTeamMembers[0] ?? null;
  const canUseTeamWorkspaceView = managerTeamMembers.length > 0;
  const teamWorkspaceViewActive = workspaceTaskScope === "team" && canUseTeamWorkspaceView && Boolean(selectedTeamViewUser);
  const activeTaskListUserId = teamWorkspaceViewActive && selectedTeamViewUser ? selectedTeamViewUser.id : data?.currentUserId;
  const scopedDisplayTasks = useMemo(() => {
    const ownerId = String(activeTaskListUserId ?? "");
    if (!ownerId) return displayTasks;
    return displayTasks.filter(
      (task) =>
        String(task.assignedToId) === ownerId ||
        String(task.delegatedToId ?? "") === ownerId ||
        (task.collaboratorIds ?? []).some((id) => String(id) === ownerId),
    );
  }, [activeTaskListUserId, displayTasks]);

  useEffect(() => {
    if (!canUseTeamWorkspaceView) {
      if (workspaceTaskScope === "team") setWorkspaceTaskScope("mine");
      if (selectedTeamViewUserId) setSelectedTeamViewUserId("");
      return;
    }
    if (!selectedTeamViewUserId || !managerTeamMembers.some((user) => String(user.id) === selectedTeamViewUserId)) {
      setSelectedTeamViewUserId(String(managerTeamMembers[0]?.id ?? ""));
    }
  }, [canUseTeamWorkspaceView, managerTeamMembers, selectedTeamViewUserId, workspaceTaskScope]);

  const metrics = useMemo(() => {
    const tasks = scopedDisplayTasks;
    const suggestions = data?.suggestions ?? [];
    const today = localDateIso();
    const waitingTasks = tasks.filter((t) => t.status === "pending_acceptance").length;
    const pendingSuggestions = suggestions.filter((s) => s.status === "pending").length;
    return {
      open: tasks.filter((t) => !["completed", "denied"].includes(t.status)).length,
      dueToday: tasks.filter((t) => t.dueDate === today && t.status !== "completed").length,
      needsAcceptance: waitingTasks,
      emailQueue: pendingSuggestions,
      completed: tasks.filter((t) => t.status === "completed").length,
    };
  }, [scopedDisplayTasks, data?.suggestions]);

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    [],
  );
  const rawNotifications = useMemo(
    () => buildNotifications(displayTasks, data?.suggestions ?? [], data?.events ?? [], data?.currentUserId),
    [displayTasks, data?.suggestions, data?.events, data?.currentUserId],
  );
  const notifications = useMemo(
    () => rawNotifications.filter((item) => !reviewedNotificationIds.has(item.id)),
    [rawNotifications, reviewedNotificationIds],
  );
  const positionProfiles = useMemo(
    () => buildPositionProfiles(data?.tasks ?? [], data?.users ?? [], data?.events ?? [], data?.positionProfiles ?? []),
    [data?.tasks, data?.users, data?.events, data?.positionProfiles],
  );
  const hasDemoData = useMemo(() => {
    const users = data?.users ?? [];
    const tasks = data?.tasks ?? [];
    const suggestions = data?.suggestions ?? [];
    return (
      users.some((user) => String(user.email ?? "").endsWith("@example.invalid")) ||
      tasks.some((task) =>
        [
          "Confirm Friday client coverage plan",
          "Follow up on ACME renewal blockers",
          "Reconcile ChatGPT expense receipt",
          "Review payroll access request from Gmail",
        ].includes(task.title),
      ) ||
      suggestions.some((suggestion) => String(suggestion.fromEmail).endsWith("@example.com"))
    );
  }, [data?.suggestions, data?.tasks, data?.users]);
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
  useEffect(() => {
    if (typeof window === "undefined") return;
    const signature = data?.users
      ?.find((user) => String(user.id) === String(data.currentUserId))
      ?.emailSignature?.trim();
    if (!signature) return;
    window.localStorage.setItem(EMAIL_SIGNATURE_CUSTOM_KEY, signature);
    if (!window.localStorage.getItem(EMAIL_SIGNATURE_TEMPLATE_KEY)) {
      window.localStorage.setItem(EMAIL_SIGNATURE_TEMPLATE_KEY, "custom");
    }
  }, [data?.currentUserId, data?.users]);

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
  const canOpenManagerReports = canViewManagerReports(currentUser);
  const showConnectGmail = Boolean(oauthData?.configured && !oauthData?.connected);
  const needsReconnect = Boolean(oauthData?.requiresReconnect);
  const slackMvpReady = Boolean(
    data.integrations.slack?.eventsConfigured ||
      data.integrations.slack?.webhookConfigured ||
      data.tasks.some((task) => task.source === "slack") ||
      data.suggestions.some((suggestion) => suggestion.fromEmail.toLowerCase().startsWith("slack:")),
  );
  const focusChatInput = () => {
    const el = document.getElementById("chat-message") as HTMLTextAreaElement | null;
    el?.focus();
  };
  const openMvpReadiness = () => {
    setMvpReadinessDismissed(false);
    setMvpReadinessManuallyOpen(true);
    if (typeof window !== "undefined") window.localStorage.removeItem("donnit.mvpReadinessDismissed");
    window.setTimeout(() => {
      document.getElementById("panel-mvp-readiness")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 75);
  };
  const dismissMvpReadiness = () => {
    setMvpReadinessDismissed(true);
    setMvpReadinessManuallyOpen(false);
    if (typeof window !== "undefined") window.localStorage.setItem("donnit.mvpReadinessDismissed", "true");
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
      id: "connect-slack",
      title: "Include Slack",
      detail: "Show Slack messages becoming approval-ready task suggestions in the MVP story.",
      done: slackMvpReady,
      actionLabel: slackMvpReady ? "Ready" : "Setup",
      onAction: () => openAppView("admin"),
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
        buildAgenda.mutate({});
      },
    },
    {
      id: "position-profile",
      title: "Confirm role memory",
      detail: "Open Position Profiles and make sure recurring work has a home.",
      done: positionProfiles.some((profile) => profile.persisted || profile.currentIncompleteTasks.length > 0 || profile.recurringTasks.length > 0),
      actionLabel: "Open",
      onAction: () => openAppView("profiles"),
    },
  ];
  const mvpReadinessSteps: OnboardingStep[] = [
    {
      id: "seeded-data",
      title: "Seeded story",
      detail: "Use controlled sample members, tasks, Slack items, approvals, and Position Profiles.",
      done: hasDemoData,
      actionLabel: hasDemoData ? "Seeded" : "Seed",
      onAction: () => seedDemoWorkspace.mutate(),
    },
    {
      id: "task-capture",
      title: "Task capture",
      detail: "Chat, email, document, or Slack input has produced work in the task list.",
      done: data.tasks.length > 0 || data.suggestions.length > 0,
      actionLabel: "Capture",
      onAction: focusChatInput,
    },
    {
      id: "slack-mvp",
      title: "Slack MVP",
      detail: "Slack is configured or represented with Slack-origin approval items.",
      done: slackMvpReady,
      actionLabel: slackMvpReady ? "Ready" : "Setup",
      onAction: () => openAppView("admin"),
    },
    {
      id: "approvals",
      title: "Approval loop",
      detail: "AI suggestions can be reviewed, edited, approved, or dismissed before becoming tasks.",
      done: data.suggestions.some((suggestion) => suggestion.status === "pending" || suggestion.status === "approved" || suggestion.status === "dismissed"),
      actionLabel: "Review",
      onAction: () => setApprovalInboxOpen(true),
    },
    {
      id: "agenda",
      title: "Agenda",
      detail: "Open work can be converted into an approved day plan and exported.",
      done: orderedAgenda.length > 0 || agendaApproved,
      actionLabel: "Build",
      onAction: () => {
        setSupportView("agenda");
        buildAgenda.mutate({});
      },
    },
    {
      id: "continuity",
      title: "Continuity",
      detail: "Position Profiles show current work, recurring responsibilities, and a handoff packet.",
      done: positionProfiles.some((profile) => profile.currentIncompleteTasks.length > 0 || profile.recurringTasks.length > 0 || profile.completedTasks.length > 0),
      actionLabel: "Profiles",
      onAction: () => openAppView("profiles"),
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
  const openDemoGuide = () => {
    setDemoGuideDismissed(false);
    setDemoGuideManuallyOpen(true);
    window.setTimeout(() => {
      document.getElementById("panel-demo-workspace-guide")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };
  const showDemoGuide = demoGuideManuallyOpen || (hasDemoData && !demoGuideDismissed);
  const showMvpReadiness =
    mvpReadinessManuallyOpen ||
    (canOpenManagerReports && !mvpReadinessDismissed && mvpReadinessSteps.some((step) => !step.done));
  const scrollToReporting = () => {
    if (!canOpenManagerReports) {
      toast({
        title: "Manager access required",
        description: "Reporting is available to managers and workspace admins.",
        variant: "destructive",
      });
      return;
    }
    openAppView("reports");
  };
  const openAppView = (view: AppView) => {
    setAppView(view);
    if (view === "agenda") setSupportView("agenda");
    if (view === "team") setSupportView("team");
    if (view === "home") setSupportView("today");
    setManagerReportOpen(false);
    setWorkspaceSettingsOpen(false);
    if (typeof window !== "undefined") {
      window.location.hash = "/app";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };
  const goHome = () => {
    setManualImportOpen(false);
    setDocumentImportOpen(false);
    setAssignTaskOpen(false);
    setManagerReportOpen(false);
    setCalendarExportOpen(false);
    setWorkspaceSettingsOpen(false);
    setApprovalInboxOpen(false);
    setAgendaWorkOpen(false);
    setNotificationTaskId(null);
    openAppView("home");
  };
  const addTaskActions: FunctionAction[] = [
    {
      id: "create-todo",
      label: "Manual task",
      icon: UserPlus,
      primary: true,
      onClick: () => {
        setAssignTaskOpen(true);
      },
      hint: "Open a form to create a task directly",
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
        buildAgenda.mutate({});
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
    {
      id: "slack-mvp",
      label: slackMvpReady ? "Slack ready" : "Setup Slack",
      icon: Inbox,
      primary: !slackMvpReady,
      onClick: () => openAppView("admin"),
      hint: slackMvpReady
        ? "Slack is included in the MVP approval workflow"
        : "Open settings to configure or test Slack ingestion",
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
            id: "seed-demo-workspace",
            label: "Seed demo workspace",
            icon: Sparkles,
            onClick: () => seedDemoWorkspace.mutate(),
            loading: seedDemoWorkspace.isPending,
            hint: "Create sample team, tasks, approvals, reports, and Position Profiles",
          } satisfies FunctionAction,
          ...(hasDemoData
            ? [
                {
                  id: "demo-guide",
                  label: "Open demo guide",
                  icon: Eye,
                  onClick: openDemoGuide,
                  hint: "Show where the seeded demo data lives",
                } satisfies FunctionAction,
              ]
            : []),
          {
            id: "position-profiles",
            label: "Position Profiles",
            icon: BriefcaseBusiness,
            onClick: () => openAppView("profiles"),
            hint: "Open the admin repository of job-title profiles",
          } satisfies FunctionAction,
        ]
      : []),
    {
      id: "workspace-settings",
      label: "Workspace settings",
      icon: Settings,
      onClick: () => openAppView("admin"),
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
    ...(canOpenManagerReports
      ? [
          {
            id: "mvp-readiness",
            label: "MVP readiness",
            icon: ShieldCheck,
            onClick: openMvpReadiness,
            hint: "Show the Thursday demo readiness checklist",
          } satisfies FunctionAction,
        ]
      : []),
    ...(canOpenManagerReports
      ? [
          {
            id: "manager-report",
            label: "Reporting",
            icon: BarChart3,
            onClick: scrollToReporting,
            hint: "Review manager metrics and source mix",
          } satisfies FunctionAction,
        ]
      : []),
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
  const appNavItems: Array<{ id: AppView; label: string; icon: React.ComponentType<{ className?: string }>; count?: number; disabled?: boolean }> = [
    { id: "home", label: "Home", icon: Home },
    { id: "tasks", label: "Tasks", icon: ClipboardList, count: metrics.open },
    { id: "agenda", label: "Agenda", icon: CalendarClock, count: approvedAgenda.length || orderedAgenda.length },
    { id: "inbox", label: "Inbox", icon: Inbox, count: metrics.emailQueue + metrics.needsAcceptance },
    { id: "team", label: "Team", icon: Users, disabled: !canOpenManagerReports },
    { id: "profiles", label: "Position Profiles", icon: BriefcaseBusiness, count: positionProfiles.length, disabled: !canManagePositionProfiles },
    { id: "reports", label: "Reports", icon: BarChart3, disabled: !canOpenManagerReports },
    { id: "admin", label: "Admin", icon: ShieldCheck, disabled: !canOpenManagerReports },
    { id: "settings", label: "Settings", icon: Settings },
  ];
  const appViewTitle: Record<AppView, string> = {
    home: "Home",
    tasks: "Tasks",
    agenda: "Agenda",
    inbox: "Inbox",
    team: "Team",
    profiles: "Position Profiles",
    reports: "Reports",
    admin: "Admin",
    settings: "Settings",
  };

  return (
    <main
      className="min-h-screen bg-background"
      data-testid="page-command-center"
    >
      <div className="flex min-h-screen">
        <AppShellNav
          view={appView}
          onViewChange={openAppView}
          items={appNavItems}
          currentUser={currentUser}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="command-topbar sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
            <div className="flex h-11 items-center justify-between gap-3 px-4 lg:px-6">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="font-medium text-muted-foreground">Donnit</span>
                <span className="text-muted-foreground/60">/</span>
                <h1 className="truncate text-sm font-semibold text-foreground">
                  {appViewTitle[appView]}
                </h1>
                <span className="hidden text-xs text-muted-foreground md:inline">{todayLabel}</span>
              </div>
              <div className="command-search hidden min-w-[260px] max-w-md flex-1 items-center gap-2 rounded-md border border-border bg-muted/35 px-3 py-1.5 text-xs text-muted-foreground lg:flex">
                <Search className="size-3.5" />
                <span className="truncate">Search tasks, profiles, reports...</span>
                <span className="ml-auto rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">Ctrl K</span>
              </div>
              <div className="flex items-center gap-2">
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
                      openAppView("inbox");
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

          {/* Workspace: each major workflow gets its own view. */}
          {appView === "home" && (
            <section className="command-page mx-auto w-full max-w-[1600px] px-4 py-4 lg:px-6">
              <div className="home-hero mb-4">
                <div className="min-w-0">
                  <h2 className="greet text-2xl font-semibold text-foreground">
                    Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}
                    {currentUser?.name ? `, ${currentUser.name.split(" ")[0]}` : ""}.
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Capture the loose work, review what changed, and keep today moving.
                  </p>
                </div>
                <FunctionBar addTaskActions={addTaskActions} primaryActions={dailyActions} />
              </div>
              <div className="status-strip mb-4">
                <Stat label="Open" value={metrics.open} />
                <Stat label="Due today" value={metrics.dueToday} />
                <Stat label="Needs acceptance" value={metrics.needsAcceptance} />
                <Stat label="Approval queue" value={metrics.emailQueue} />
                <Stat label="Completed" value={metrics.completed} />
              </div>
              <div className="grid gap-4 lg:grid-cols-12">
                <div className="order-2 lg:sticky lg:top-[4rem] lg:order-1 lg:col-span-4 lg:h-[calc(100dvh-5.25rem)] lg:self-start xl:col-span-4">
                  <ChatPanel messages={data.messages} />
                </div>
                <div className="order-1 lg:order-2 lg:col-span-8 xl:col-span-8">
                  <TaskList
                    tasks={scopedDisplayTasks}
                    users={data.users}
                    subtasks={data.subtasks ?? []}
                    events={data.events}
                    authenticated={Boolean(data.authenticated)}
                    positionProfiles={positionProfiles}
                    currentUserId={activeTaskListUserId}
                    viewLabel={teamWorkspaceViewActive && selectedTeamViewUser ? `${selectedTeamViewUser.name}'s tasks` : "My Tasks"}
                    onPinTask={(taskId) => setActiveWorkTask(taskId)}
                    readOnly={teamWorkspaceViewActive}
                  />
                </div>
              </div>
            </section>
          )}

          {appView === "tasks" && (
            <section className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-4 lg:px-6">
              {canUseTeamWorkspaceView && (
                <div className="flex flex-col gap-3 rounded-md border border-border bg-card px-3 py-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Task view</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {teamWorkspaceViewActive && selectedTeamViewUser
                        ? `Viewing ${selectedTeamViewUser.name}'s tasks as read-only.`
                        : "Your assigned, delegated, and collaborative work."}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background p-1">
                      <button
                        type="button"
                        onClick={() => setWorkspaceTaskScope("mine")}
                        className={`h-9 rounded-[6px] px-3 text-xs font-medium transition ${
                          !teamWorkspaceViewActive ? "bg-brand-green text-white shadow-sm" : "text-muted-foreground hover:bg-muted"
                        }`}
                        data-testid="button-workspace-view-mine"
                      >
                        My Tasks
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWorkspaceTaskScope("team");
                          openAppView("team");
                        }}
                        className={`h-9 rounded-[6px] px-3 text-xs font-medium transition ${
                          teamWorkspaceViewActive ? "bg-brand-green text-white shadow-sm" : "text-muted-foreground hover:bg-muted"
                        }`}
                        data-testid="button-workspace-view-team"
                      >
                        My Team
                      </button>
                    </div>
                    {workspaceTaskScope === "team" && (
                      <select
                        value={String(selectedTeamViewUser?.id ?? "")}
                        onChange={(event) => {
                          setSelectedTeamViewUserId(event.target.value);
                          setWorkspaceTaskScope("team");
                          openAppView("team");
                        }}
                        className="flex h-10 min-w-[220px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        data-testid="select-workspace-team-member"
                      >
                        {managerTeamMembers.map((user) => (
                          <option key={String(user.id)} value={String(user.id)}>
                            {user.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              )}
              <FunctionBar addTaskActions={addTaskActions} primaryActions={dailyActions} />
              <TaskList
                tasks={scopedDisplayTasks}
                users={data.users}
                subtasks={data.subtasks ?? []}
                events={data.events}
                authenticated={Boolean(data.authenticated)}
                positionProfiles={positionProfiles}
                currentUserId={activeTaskListUserId}
                viewLabel={teamWorkspaceViewActive && selectedTeamViewUser ? `${selectedTeamViewUser.name}'s tasks` : "My Tasks"}
                onPinTask={(taskId) => setActiveWorkTask(taskId)}
                readOnly={teamWorkspaceViewActive}
                inlineDetail
              />
            </section>
          )}

          {appView === "agenda" && (
            <section className="mx-auto w-full max-w-5xl px-4 py-4 lg:px-6">
              <AgendaPanel
                agenda={orderedAgenda}
                excludedTaskIds={agendaExcludedTaskIds}
                approved={agendaApproved}
                preferences={agendaPreferences}
                schedule={agendaSchedule}
                onBuild={() => buildAgenda.mutate({})}
                onToggleTask={(taskId) => {
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
                onMoveTask={(taskId, direction) => {
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
                onPreferencesChange={(preferences) => {
                  const next = normalizeAgendaPreferences(preferences);
                  setAgendaApproved(false);
                  setAgendaPreferences(next);
                  persistAgendaState(agendaExcludedTaskIds, false, null, next, agendaTaskOrder);
                }}
                onScheduleChange={(schedule) => {
                  const next = normalizeAgendaSchedule(schedule);
                  setAgendaSchedule(next);
                  persistAgendaState(
                    agendaExcludedTaskIds,
                    agendaApproved,
                    data?.workspaceState?.agenda.approvedAt ?? null,
                    agendaPreferences,
                    agendaTaskOrder,
                    next,
                  );
                }}
                onApprove={() => {
                  setAgendaApproved(true);
                  persistAgendaState(agendaExcludedTaskIds, true, new Date().toISOString(), agendaPreferences, agendaTaskOrder);
                  toast({ title: "Agenda approved", description: "Approved agenda blocks are ready for calendar export." });
                }}
                onOpenWork={() => setAgendaWorkOpen(true)}
                onExport={() => setCalendarExportOpen(true)}
                isBuilding={buildAgenda.isPending}
              />
            </section>
          )}

          {appView === "inbox" && (
            <section className="mx-auto w-full max-w-6xl px-4 py-4 lg:px-6">
              <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
                <AcceptancePanel tasks={data.tasks} suggestions={data.suggestions} onOpenInbox={() => setApprovalInboxOpen(true)} />
                <div className="rounded-md border border-border bg-card p-4">
                  <p className="text-sm font-medium text-foreground">Capture sources</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Review imported work, scan Gmail, or manually add source material when Donnit needs context.
                  </p>
                  <div className="mt-4 grid gap-2">
                    <Button type="button" onClick={() => scan.mutate()} disabled={scan.isPending} data-testid="button-inbox-scan-email">
                      {scan.isPending ? <Loader2 className="size-4 animate-spin" /> : <MailPlus className="size-4" />}
                      Scan Gmail
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setManualImportOpen(true)} data-testid="button-inbox-manual-import">
                      <Inbox className="size-4" />
                      Manual import
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setDocumentImportOpen(true)} data-testid="button-inbox-document-import">
                      <FileText className="size-4" />
                      Upload document
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {appView === "team" && (
            <section className="mx-auto w-full max-w-6xl px-4 py-4 lg:px-6">
              {canOpenManagerReports ? (
                <TeamViewPanel
                  tasks={displayTasks}
                  suggestions={data.suggestions}
                  events={data.events}
                  users={data.users}
                  subtasks={data.subtasks ?? []}
                  authenticated={Boolean(data.authenticated)}
                  currentUserId={data.currentUserId}
                />
              ) : (
                <RestrictedView title="Team is for managers" detail="Managers and admins can review team status, overdue work, and update requests here." />
              )}
            </section>
          )}

          {appView === "profiles" && (
            <section className="mx-auto w-full max-w-6xl px-4 py-4 lg:px-6">
              {canManagePositionProfiles ? (
                <PositionProfilesPanel
                  profiles={positionProfiles}
                  users={data.users}
                  currentUserId={data.currentUserId}
                  authenticated={Boolean(data.authenticated)}
                  subtasks={data.subtasks ?? []}
                  events={data.events}
                />
              ) : (
                <RestrictedView title="Position Profiles are admin-only" detail="Admins can assign, transfer, and inspect role memory from this workspace area." />
              )}
            </section>
          )}

          {appView === "reports" && (
            <section className="mx-auto w-full max-w-[1400px] px-4 py-4 lg:px-6">
              {canOpenManagerReports ? (
                <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
                  <ReportingPanel
                    tasks={displayTasks}
                    suggestions={data.suggestions}
                    agenda={orderedAgenda}
                    positionProfiles={positionProfiles}
                    currentUserId={data.currentUserId}
                  />
                  <ActivityLogPanel
                    events={data.events}
                    tasks={displayTasks}
                    users={data.users}
                    subtasks={data.subtasks ?? []}
                    authenticated={Boolean(data.authenticated)}
                    compact
                  />
                </div>
              ) : (
                <RestrictedView title="Reports are for managers" detail="Manager and admin roles can see completion, source mix, and continuity signals." />
              )}
            </section>
          )}

          {appView === "admin" && (
            <section className="mx-auto w-full max-w-[1400px] space-y-4 px-4 py-4 lg:px-6">
              {canOpenManagerReports ? (
                <>
                  {showMvpReadiness && (
                    <MvpReadinessPanel steps={mvpReadinessSteps} onDismiss={dismissMvpReadiness} />
                  )}
                  {showOnboarding && (
                    <OnboardingChecklist steps={onboardingSteps} onDismiss={() => dismissOnboarding(true)} />
                  )}
                  {showDemoGuide && (
                    <DemoWorkspaceGuide
                      users={data.users}
                      tasks={data.tasks}
                      suggestions={data.suggestions}
                      positionProfiles={positionProfiles}
                      onOpenTeam={() => openAppView("team")}
                      onOpenApprovals={() => {
                        openAppView("inbox");
                        setApprovalInboxOpen(true);
                      }}
                      onOpenReports={() => openAppView("reports")}
                      onOpenPositionProfiles={() => openAppView("profiles")}
                      onDismiss={() => {
                        setDemoGuideDismissed(true);
                        setDemoGuideManuallyOpen(false);
                      }}
                    />
                  )}
                  <div className="grid gap-4 xl:grid-cols-[1fr_.9fr]">
                    {Boolean(data.authenticated) && <TaskTemplatesPanel templates={data.taskTemplates ?? []} authenticated={Boolean(data.authenticated)} />}
                    <WorkspaceMembersPanel
                      users={data.users}
                      positionProfiles={positionProfiles}
                      currentUser={currentUser}
                      currentUserId={data.currentUserId}
                    />
                  </div>
                  <div className="rounded-md border border-border bg-card p-4">
                    <p className="text-sm font-medium text-foreground">Integrations and workspace controls</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Gmail, Slack, SMS, signatures, calendar export, and automation preferences live in workspace settings.
                    </p>
                    <Button className="mt-4" type="button" onClick={() => setWorkspaceSettingsOpen(true)} data-testid="button-admin-open-settings">
                      <Settings className="size-4" />
                      Open workspace settings
                    </Button>
                  </div>
                </>
              ) : (
                <RestrictedView title="Admin is locked" detail="Only managers and admins can manage workspace setup, members, and operating controls." />
              )}
            </section>
          )}

          {appView === "settings" && (
            <section className="mx-auto w-full max-w-3xl px-4 py-4 lg:px-6">
              <div className="rounded-md border border-border bg-card p-5">
                <p className="text-sm font-medium text-foreground">Settings</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Personal signature, connected tools, and workspace preferences are grouped here while deeper admin controls live in Admin.
                </p>
                <Button className="mt-4" type="button" onClick={() => setWorkspaceSettingsOpen(true)} data-testid="button-settings-open-workspace">
                  <Settings className="size-4" />
                  Open settings
                </Button>
              </div>
            </section>
          )}

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
        events={data.events}
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
        taskTemplates={data.taskTemplates ?? []}
        positionProfiles={positionProfiles}
      />
      <Dialog open={managerReportOpen && canOpenManagerReports} onOpenChange={setManagerReportOpen}>
        <DialogContent className={`${dialogShellClass} sm:max-w-4xl`}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle>Manager reporting</DialogTitle>
            <DialogDescription>
              Completion, source mix, and continuity signals for managers and admins.
            </DialogDescription>
          </DialogHeader>
          <div className={dialogBodyClass}>
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <ReportingPanel
                tasks={displayTasks}
                suggestions={data.suggestions}
                agenda={orderedAgenda}
                positionProfiles={positionProfiles}
                currentUserId={data.currentUserId}
              />
              <ActivityLogPanel
                events={data.events}
                tasks={displayTasks}
                users={data.users}
                subtasks={data.subtasks ?? []}
                authenticated={Boolean(data.authenticated)}
                compact
              />
            </div>
          </div>
          <DialogFooter className={dialogFooterClass}>
            <Button variant="outline" onClick={() => setManagerReportOpen(false)} data-testid="button-manager-report-close">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <WorkspaceSettingsDialog
        open={workspaceSettingsOpen}
        onOpenChange={setWorkspaceSettingsOpen}
        currentUser={currentUser}
        authenticated={Boolean(data.authenticated)}
        users={data.users}
        positionProfiles={positionProfiles}
        subtasks={data.subtasks ?? []}
        events={data.events}
        taskTemplates={data.taskTemplates ?? []}
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
        events={data.events}
        authenticated={Boolean(data.authenticated)}
        positionProfiles={positionProfiles}
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
        </div>
      </div>
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

function RestrictedView({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/25 p-6 text-center" data-testid="panel-restricted-view">
      <ShieldCheck className="mx-auto size-7 text-muted-foreground" />
      <h2 className="mt-3 text-sm font-semibold text-foreground">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{detail}</p>
    </div>
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
