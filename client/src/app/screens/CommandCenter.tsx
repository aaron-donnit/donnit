import React, { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  CalendarPlus,
  ClipboardList,
  Eye,
  FileText,
  History,
  Home,
  Inbox,
  Loader2,
  MailPlus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Workflow,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { AuthedContext } from "@/components/AuthGate";
import { supabaseConfig } from "@/lib/supabase";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  Id,
  AgendaItem,
  AgendaPreferences,
  AgendaSchedule,
  AppView,
} from "@/app/types";
import type { FunctionAction, MenuActionGroup } from "@/app/chrome/FunctionBar";
import type { SupportRailView } from "@/app/chrome/SupportRail";
import type { OnboardingStep } from "@/app/screens/home/OnboardingChecklist";
import {
  DEFAULT_AGENDA_PREFERENCES,
  DEFAULT_AGENDA_SCHEDULE,
  dialogShellClass,
  dialogHeaderClass,
  dialogBodyClass,
  dialogFooterClass,
  EMAIL_SIGNATURE_CUSTOM_KEY,
  EMAIL_SIGNATURE_TEMPLATE_KEY,
} from "@/app/constants";
import { localDateIso, localTimeHHMM } from "@/app/lib/date";
import { isVisibleWorkTask, canAdministerProfiles, canViewManagerReports, teamMembersForUser } from "@/app/lib/permissions";
import { buildPositionProfiles } from "@/app/lib/profiles";
import { normalizeAgendaPreferences, normalizeAgendaSchedule, isTimeAtOrAfter, orderAgendaItems, downloadAgendaCalendar } from "@/app/lib/agenda";
import { buildNotifications } from "@/app/lib/notifications";
import { invalidateWorkspace, useBootstrap } from "@/app/lib/hooks";
import { apiErrorMessage } from "@/app/lib/tasks";
import { useGmailOAuthStatus } from "@/app/admin/WorkspaceSettingsDialog";
import ThemeToggle from "@/app/chrome/ThemeToggle";
import FunctionBar from "@/app/chrome/FunctionBar";
import WorkspaceMenu from "@/app/chrome/WorkspaceMenu";
import AppShellNav from "@/app/chrome/AppShellNav";
import NotificationCenter from "@/app/chrome/NotificationCenter";
import ChatPanel from "@/app/screens/home/ChatPanel";
import OnboardingChecklist from "@/app/screens/home/OnboardingChecklist";
import DemoWorkspaceGuide from "@/app/screens/home/DemoWorkspaceGuide";
import MvpReadinessPanel from "@/app/screens/home/MvpReadinessPanel";
import TaskList from "@/app/tasks/TaskList";
import TaskDetailDialog from "@/app/tasks/TaskDetailDialog";
import FloatingTaskBox from "@/app/tasks/FloatingTaskBox";
import AcceptancePanel from "@/app/tasks/AcceptancePanel";
import AssignTaskDialog from "@/app/tasks/AssignTaskDialog";
import AgendaPanel from "@/app/agenda/AgendaPanel";
import AgendaWorkDialog from "@/app/agenda/AgendaWorkDialog";
import ApprovalInboxDialog from "@/app/inbox/ApprovalInboxDialog";
import ManualEmailImportDialog from "@/app/inbox/ManualEmailImportDialog";
import DocumentImportDialog from "@/app/inbox/DocumentImportDialog";
import ReportingPanel from "@/app/reports/ReportingPanel";
import TeamViewPanel from "@/app/reports/TeamViewPanel";
import PositionProfilesPanel from "@/app/profiles/PositionProfilesPanel";
import ActivityLogPanel from "@/app/activity/ActivityLogPanel";
import CalendarExportDialog from "@/app/admin/CalendarExportDialog";
import TaskTemplatesPanel from "@/app/admin/TaskTemplatesPanel";
import WorkspaceMembersPanel from "@/app/admin/WorkspaceMembersPanel";
import WorkspaceSettingsDialog from "@/app/admin/WorkspaceSettingsDialog";

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
      overdue: tasks.filter((t) => t.dueDate != null && t.dueDate < today && t.status !== "completed").length,
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
                  <h2 className="greet">
                    Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}
                    {currentUser?.name ? `, ${currentUser.name.split(" ")[0]}` : ""}.
                  </h2>
                  <div className="home-meta">
                    <span>{metrics.overdue} overdue</span>
                    <span className="sep">·</span>
                    <span>{metrics.dueToday} due today</span>
                    <span className="sep">·</span>
                    <span>{metrics.needsAcceptance} waiting on team</span>
                    {metrics.emailQueue > 0 && (
                      <>
                        <span className="sep">·</span>
                        <span>{metrics.emailQueue} in inbox</span>
                      </>
                    )}
                  </div>
                </div>
                <FunctionBar addTaskActions={addTaskActions} primaryActions={dailyActions} />
              </div>
              <div className="status-strip mb-4">
                <Stat
                  label="Open"
                  value={metrics.open}
                  delta={metrics.dueToday > 0 ? `${metrics.dueToday} due today` : "Nothing dated today"}
                  tone={metrics.dueToday > 0 ? "down" : "neutral"}
                  accent="info"
                />
                <Stat
                  label="Due today"
                  value={metrics.dueToday}
                  delta={metrics.dueToday > 0 ? "Focus list" : "All clear"}
                  tone={metrics.dueToday > 0 ? "down" : "up"}
                  accent={metrics.dueToday > 0 ? "danger" : "success"}
                />
                <Stat
                  label="Overdue"
                  value={metrics.overdue}
                  delta={metrics.overdue > 0 ? "Past due — act now" : "Nothing overdue"}
                  tone={metrics.overdue > 0 ? "down" : "up"}
                  accent={metrics.overdue > 0 ? "danger" : "success"}
                />
                <Stat
                  label="Needs acceptance"
                  value={metrics.needsAcceptance}
                  delta={metrics.needsAcceptance > 0 ? "Waiting on owner" : "No handoffs pending"}
                  tone={metrics.needsAcceptance > 0 ? "down" : "neutral"}
                  accent="warning"
                />
                <Stat
                  label="Completed"
                  value={metrics.completed}
                  delta={metrics.completed > 0 ? "That's one less thing" : "Get the first done"}
                  tone={metrics.completed > 0 ? "up" : "neutral"}
                  accent="success"
                />
              </div>
              <ChatPanel messages={data.messages} />
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
        onOpenApprovalInbox={() => setApprovalInboxOpen(true)}
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

function Stat({
  label,
  value,
  delta,
  tone = "neutral",
  accent,
}: {
  label: string;
  value: number | string;
  delta?: string;
  tone?: "up" | "down" | "neutral";
  accent?: "success" | "warning" | "danger" | "info";
}) {
  return (
    <div className="status-cell" data-accent={accent} data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <span className="status-cell-label">{label}</span>
      <span className="status-cell-value">{value}</span>
      {delta ? (
        <span
          className={`status-cell-delta ${
            tone === "up" ? "is-up" : tone === "down" ? "is-down" : ""
          }`}
        >
          {delta}
        </span>
      ) : null}
    </div>
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

export default CommandCenter;
