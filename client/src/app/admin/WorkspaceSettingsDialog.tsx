import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarCheck, Check, Inbox, Loader2, MailPlus, Send, Settings, Users, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import type { Bootstrap, Id, PositionProfile, TaskEvent, TaskSubtask, TaskTemplate, User } from "@/app/types";
import { dialogShellClass, dialogHeaderClass, dialogBodyClass, dialogFooterClass, EMAIL_SIGNATURE_CUSTOM_KEY, EMAIL_SIGNATURE_TEMPLATE_KEY } from "@/app/constants";
import { invalidateWorkspace } from "@/app/lib/hooks";
import { apiErrorMessage } from "@/app/lib/tasks";
import { isActiveUser } from "@/app/lib/permissions";
import { formatReceivedAt, readCustomEmailSignature } from "@/app/lib/suggestions";
import ConnectedToolRow from "@/app/admin/ConnectedToolRow";
import TaskTemplatesPanel from "@/app/admin/TaskTemplatesPanel";
import WorkspaceMembersPanel from "@/app/admin/WorkspaceMembersPanel";
import OrgChartPanel from "@/app/admin/OrgChartPanel";

export type GmailOAuthStatus = {
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

type ComposioToolsStatus = {
  ok: boolean;
  configured: boolean;
  entityId: string;
  tools: unknown[];
};

export function useGmailOAuthStatus(authenticated: boolean) {
  return useQuery<GmailOAuthStatus>({
    queryKey: ["/api/integrations/gmail/oauth/status"],
    enabled: authenticated,
  });
}

export function useSlackIntegrationStatus(authenticated: boolean) {
  return useQuery<SlackIntegrationStatus>({
    queryKey: ["/api/integrations/slack/status"],
    enabled: authenticated,
  });
}

export function useSmsIntegrationStatus(authenticated: boolean) {
  return useQuery<SmsIntegrationStatus>({
    queryKey: ["/api/integrations/sms/status"],
    enabled: authenticated,
  });
}

function useComposioToolsStatus(authenticated: boolean) {
  return useQuery<ComposioToolsStatus>({
    queryKey: ["/api/integrations/composio/tools?toolkits=gmail,slack,googlecalendar&limit=12"],
    enabled: authenticated,
  });
}

export default function WorkspaceSettingsDialog({
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
  onOpenApprovalInbox,
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
  onOpenApprovalInbox: () => void;
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
  const composioStatus = useComposioToolsStatus(authenticated);
  const composioToolCount = Array.isArray(composioStatus.data?.tools) ? composioStatus.data.tools.length : 0;
  const [composioSource, setComposioSource] = useState<"email" | "slack">("email");
  const [composioToolSlug, setComposioToolSlug] = useState("GMAIL_SEARCH_EMAILS");
  const [composioArguments, setComposioArguments] = useState('{\n  "query": "is:unread newer_than:7d"\n}');
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
  const importComposio = useMutation({
    mutationFn: async () => {
      let parsedArguments: Record<string, unknown>;
      try {
        parsedArguments = JSON.parse(composioArguments || "{}") as Record<string, unknown>;
      } catch {
        throw new Error("Composio arguments must be valid JSON.");
      }
      const res = await apiRequest("POST", "/api/integrations/composio/import", {
        source: composioSource,
        toolSlug: composioToolSlug.trim(),
        arguments: parsedArguments,
        maxItems: 5,
      });
      return (await res.json()) as { ok: boolean; queued: number; readItems: number };
    },
    onSuccess: async (result) => {
      await invalidateWorkspace();
      toast({
        title: result.queued > 0 ? "Composio import queued" : "Composio import reviewed",
        description:
          result.queued > 0
            ? `${result.queued} suggestion${result.queued === 1 ? "" : "s"} added to the Approval inbox.`
            : `Read ${result.readItems} item${result.readItems === 1 ? "" : "s"}, but Donnit did not find an actionable task.`,
      });
      if (result.queued > 0) onOpenApprovalInbox();
    },
    onError: (error: unknown) => {
      toast({
        title: "Composio import failed",
        description: apiErrorMessage(error, "Check the tool slug, arguments, and connected account in Composio."),
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
                icon={Workflow}
                name="Composio"
                status={composioStatus.data?.configured ? "ready" : "setup"}
                detail={
                  composioStatus.data?.configured
                    ? `${composioToolCount} external tool actions visible for this workspace user. Entity: ${composioStatus.data.entityId}.`
                    : "Add COMPOSIO_API_KEY in Vercel to let Donnit route external tool actions through Composio."
                }
                actionLabel={composioStatus.isFetching ? "Checking" : "Check tools"}
                action={() => composioStatus.refetch()}
                loading={composioStatus.isFetching}
              />
              <div className="rounded-md border border-dashed border-border bg-muted/25 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Import from Composio</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Run a safe read tool and queue actionable results for approval.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => importComposio.mutate()}
                    disabled={!composioStatus.data?.configured || !composioToolSlug.trim() || importComposio.isPending}
                    data-testid="button-composio-import"
                  >
                    {importComposio.isPending ? <Loader2 className="size-4 animate-spin" /> : <Workflow className="size-4" />}
                    Queue suggestions
                  </Button>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-[120px_1fr]">
                  <div className="grid gap-1.5">
                    <Label htmlFor="composio-source" className="ui-label">Source</Label>
                    <select
                      id="composio-source"
                      value={composioSource}
                      onChange={(event) => {
                        const next = event.target.value as "email" | "slack";
                        setComposioSource(next);
                        setComposioToolSlug(next === "email" ? "GMAIL_SEARCH_EMAILS" : "SLACK_SEARCH_MESSAGES");
                        setComposioArguments(next === "email" ? '{\n  "query": "is:unread newer_than:7d"\n}' : '{\n  "query": "after:yesterday"\n}');
                      }}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      data-testid="select-composio-source"
                    >
                      <option value="email">Email</option>
                      <option value="slack">Slack</option>
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="composio-tool-slug" className="ui-label">Tool slug</Label>
                    <Input
                      id="composio-tool-slug"
                      value={composioToolSlug}
                      onChange={(event) => setComposioToolSlug(event.target.value)}
                      placeholder="GMAIL_SEARCH_EMAILS"
                      className="h-9 font-mono text-xs"
                      data-testid="input-composio-tool-slug"
                    />
                  </div>
                </div>
                <div className="mt-2 grid gap-1.5">
                  <Label htmlFor="composio-arguments" className="ui-label">Arguments</Label>
                  <Textarea
                    id="composio-arguments"
                    value={composioArguments}
                    onChange={(event) => setComposioArguments(event.target.value)}
                    className="min-h-[92px] font-mono text-xs"
                    data-testid="input-composio-arguments"
                  />
                </div>
              </div>
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

          <OrgChartPanel users={users} currentUser={currentUser} />

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
