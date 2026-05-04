import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import {
  chatRequestSchema,
  noteRequestSchema,
  taskCreateRequestSchema,
} from "@shared/schema";
import type { InsertTask, Task, User } from "@shared/schema";
import {
  buildGmailAuthUrl,
  buildManualEmailCandidate,
  exchangeGmailAuthCode,
  GmailTokenExchangeError,
  getGmailOAuthConfig,
  getIntegrationStatus,
  refreshGmailAccessToken,
  scanGmailForTaskCandidates,
  signGmailOAuthState,
  verifyGmailOAuthState,
} from "./integrations";
import { z } from "zod";
import { storage } from "./storage";
import {
  attachSupabaseAuth,
  createSupabaseAdminClient,
  requireDonnitAuth,
} from "./auth-supabase";
import { DonnitStore, type DonnitTask } from "./donnit-store";
import { DONNIT_SCHEMA, isSupabaseConfigured } from "./supabase";

const DEMO_USER_ID = 1;

// ---------------------------------------------------------------------
// Supabase diagnostic helpers (used by /api/health/db and the Gmail
// OAuth upsert path). Shared so both code paths emit the same typed
// reasons and the same operator-facing fields.
// ---------------------------------------------------------------------

// Parse the Supabase project ref (e.g. "bchwrbqaacdijavtugdt") from
// SUPABASE_URL. Returns null if the env var is missing or doesn't look
// like a Supabase URL. The ref itself is part of the public REST URL
// every browser request hits — it is NOT a secret.
function parseSupabaseRef(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const m = u.host.match(/^([a-z0-9]+)\.supabase\.(co|in)$/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Pull the documented PostgREST/Postgres fields off any Supabase error
// shape (Error, plain object, or unknown). Truncates each field so a
// pathological message can't blow up the JSON response. Never includes
// stack traces, tokens, or auth code.
function describeSupabaseError(err: unknown): {
  name: string | null;
  message: string | null;
  code: string | null;
  details: string | null;
  hint: string | null;
  status: number | null;
} {
  if (err && typeof err === "object") {
    const a = err as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      details?: unknown;
      hint?: unknown;
      status?: unknown;
      statusCode?: unknown;
    };
    const cap = (v: unknown, n: number): string | null =>
      typeof v === "string" && v.length > 0 ? v.slice(0, n) : null;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    return {
      name: cap(a.name, 80),
      message: cap(a.message, 300),
      code: cap(a.code, 40),
      details: cap(a.details, 300),
      hint: cap(a.hint, 200),
      status: num(a.status) ?? num(a.statusCode),
    };
  }
  if (typeof err === "string") {
    return { name: null, message: err.slice(0, 300), code: null, details: null, hint: null, status: null };
  }
  return { name: null, message: null, code: null, details: null, hint: null, status: null };
}

// Returns true when describeSupabaseError yielded no signal — every
// recognized PostgREST/Postgres field is null. supabase-js occasionally
// hands us a non-null `error` object whose shape we can't read (e.g. an
// empty `{}` from a stale client wrapper, or a frozen sentinel). Such a
// value is indistinguishable from "no error" for diagnostic purposes:
// REST already returned 200 at the root, the schema-pinned client
// completed the round trip, and nothing actionable can be extracted.
// Treating it as accessible avoids the false-negative that surfaced when
// the table is empty (count: null) and supabase-js returned a hollow
// error object alongside.
function isEmptySupabaseError(err: ReturnType<typeof describeSupabaseError>): boolean {
  return (
    err.name === null &&
    err.message === null &&
    err.code === null &&
    err.details === null &&
    err.hint === null &&
    err.status === null
  );
}

// Translate a Supabase/PostgREST/network error into one of a small set
// of operator-actionable reason codes. Order matters: cheaper-to-fix
// reasons come first so a single error never gets bucketed as "unknown"
// when something more specific applies.
type DbProbeReason =
  | "ok"
  | "missing_service_role"
  | "invalid_service_role_or_url"
  | "wrong_project_or_key"
  | "schema_not_exposed"
  | "missing_table"
  | "permission_denied_grants_missing"
  | "rls_denied"
  | "fk_missing_profile_or_org"
  | "missing_required_column"
  | "invalid_column"
  | "network_unreachable"
  | "postgrest_error"
  | "gmail_persist_error"
  | "unknown_with_message";

function classifySupabaseError(
  err: ReturnType<typeof describeSupabaseError>,
  context: { schema: string; table: string },
): DbProbeReason {
  const code = (err.code ?? "").toUpperCase();
  const lowered = `${err.message ?? ""} ${err.details ?? ""} ${err.hint ?? ""}`.toLowerCase();
  const name = (err.name ?? "").toLowerCase();
  const status = err.status;

  // 1. Network / DNS / TLS — supabase-js wraps these as plain TypeError.
  //    No code, no status, message is "fetch failed" or similar.
  if (
    !code &&
    !status &&
    (name === "typeerror" ||
      lowered.includes("fetch failed") ||
      lowered.includes("getaddrinfo") ||
      lowered.includes("enotfound") ||
      lowered.includes("econnrefused") ||
      lowered.includes("network") ||
      lowered.includes("timeout") ||
      lowered.includes("certificate"))
  ) {
    return "network_unreachable";
  }

  // 2. Auth / wrong key. PostgREST 401/403 with codes PGRST301/PGRST302
  //    or "JWT", "Invalid API key", "No API key found".
  if (
    status === 401 ||
    code === "PGRST301" ||
    code === "PGRST302" ||
    lowered.includes("invalid api key") ||
    lowered.includes("no api key") ||
    lowered.includes("jwt expired") ||
    lowered.includes("jwt malformed") ||
    lowered.includes("invalid jwt") ||
    lowered.includes("invalid signature")
  ) {
    return "invalid_service_role_or_url";
  }

  // 3. Schema not exposed via PostgREST settings (db-schemas / db-extra-search-path).
  if (code === "PGRST106" || (lowered.includes("schema") && lowered.includes("not") && lowered.includes("expose"))) {
    return "schema_not_exposed";
  }

  // 4. Table missing in the schema cache (PostgREST PGRST205) or in
  //    Postgres (42P01). The PGRST205 message names the qualified
  //    identifier — match on it so a cached/stale schema is still tagged
  //    correctly.
  const qualified = `${context.schema}.${context.table}`.toLowerCase();
  if (
    code === "PGRST205" ||
    code === "42P01" ||
    lowered.includes("could not find the table") ||
    lowered.includes(`relation "${qualified}"`) ||
    lowered.includes(`relation "${context.table}"`)
  ) {
    return "missing_table";
  }

  // 5. Privilege / RLS errors. Two distinct cases that look similar in
  //    Postgres but mean different things to the operator:
  //
  //    a) `42501 permission denied for table <x>` (or "permission denied
  //       for schema") with NO row-level / RLS phrasing: the service-role
  //       (or current) role lacks GRANT SELECT/INSERT/UPDATE/DELETE on
  //       that object. Bypassing RLS does not bypass missing GRANTs —
  //       Postgres still requires table privileges. Common cause: a
  //       custom schema (donnit) created without `grant ... on tables to
  //       service_role`. We surface this as
  //       `permission_denied_grants_missing` so the toast can guide the
  //       operator to apply the grants migration instead of incorrectly
  //       blaming the service-role key.
  //
  //    b) `42501` whose message mentions row-level security / "violates"
  //       / "policy": RLS actually denied the write. With a valid
  //       service-role key (which bypasses RLS on Supabase by default)
  //       this should not appear, so when it does the deployed key may
  //       not be the project's service_role (it is being treated as
  //       anon). We surface this as `rls_denied`.
  //
  //    The previous classifier collapsed both into `rls_denied`, which
  //    showed users "SUPABASE_SERVICE_ROLE_KEY appears to be anon" even
  //    when /api/health/db said the key was valid and the real fault was
  //    a missing GRANT.
  const looksLikeRowLevelDenial =
    lowered.includes("row-level security") ||
    lowered.includes("row level security") ||
    lowered.includes("rls policy") ||
    lowered.includes("violates row") ||
    lowered.includes("policy for relation");
  if (code === "42501" || lowered.includes("permission denied for")) {
    return looksLikeRowLevelDenial ? "rls_denied" : "permission_denied_grants_missing";
  }
  if (looksLikeRowLevelDenial) {
    return "rls_denied";
  }

  if (code === "23503") return "fk_missing_profile_or_org";
  if (code === "23502") return "missing_required_column";
  if (code === "PGRST204" || code === "42703") return "invalid_column";

  // 6. Anything else with a real code/status from PostgREST.
  if (code || status) return "postgrest_error";

  // 7. We have a message but nothing else — better than the previous
  //    "unknown" because the message itself ships in the response.
  if (err.message) return "unknown_with_message";

  return "postgrest_error";
}

// Bare-fetch probe of the PostgREST root. supabase-js swallows
// non-PostgREST responses (e.g. 401 Cloudflare HTML when the project is
// paused) into a generic message; hitting REST directly with the
// service-role key as `apikey`/`Authorization` lets us read the real
// HTTP status. Never logs the key value.
async function probePostgrestRoot(
  url: string,
  serviceRole: string,
): Promise<{ status: number | null; bodySnippet: string | null; error: string | null }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/`, {
      method: "GET",
      headers: { apikey: serviceRole, authorization: `Bearer ${serviceRole}` },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    let snippet: string | null = null;
    try {
      const text = await res.text();
      snippet = text.slice(0, 200);
    } catch {
      snippet = null;
    }
    return { status: res.status, bodySnippet: snippet, error: null };
  } catch (err) {
    return {
      status: null,
      bodySnippet: null,
      error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    };
  }
}

// Supabase RPC errors (and most PostgREST errors) come back as plain objects
// with `{ message, code, details, hint }` rather than Error instances. Passing
// such an object through `String(error)` yields the literal string
// "[object Object]", which is what surfaced in production for the
// bootstrap_workspace 42702 ambiguous-column failure. This helper extracts a
// human-readable message and a structured payload that is safe to log/return:
// it intentionally only surfaces fields PostgREST already exposes
// (message/code/details/hint) and never includes secrets or full stack traces.
function serializeSupabaseError(error: unknown): { message: string; code?: string; details?: string; hint?: string } {
  if (error instanceof Error) {
    const anyErr = error as Error & { code?: unknown; details?: unknown; hint?: unknown };
    return {
      message: error.message || error.name || "Unknown error",
      code: typeof anyErr.code === "string" ? anyErr.code : undefined,
      details: typeof anyErr.details === "string" ? anyErr.details : undefined,
      hint: typeof anyErr.hint === "string" ? anyErr.hint : undefined,
    };
  }
  if (error && typeof error === "object") {
    const anyErr = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const message = typeof anyErr.message === "string" && anyErr.message.length > 0
      ? anyErr.message
      : (typeof anyErr.code === "string" ? `Supabase error ${anyErr.code}` : "Unknown Supabase error");
    return {
      message,
      code: typeof anyErr.code === "string" ? anyErr.code : undefined,
      details: typeof anyErr.details === "string" ? anyErr.details : undefined,
      hint: typeof anyErr.hint === "string" ? anyErr.hint : undefined,
    };
  }
  if (typeof error === "string" && error.length > 0) return { message: error };
  return { message: "Unknown error" };
}

const urgencyRank: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseDueDate(message: string) {
  const text = message.toLowerCase();
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];
  const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashMatch) {
    const year = slashMatch[3]
      ? Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3])
      : new Date().getFullYear();
    return `${year}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
  }
  if (text.includes("today")) return todayIso();
  if (text.includes("tomorrow")) return addDays(1);
  if (text.includes("next week")) return addDays(7);
  if (text.includes("this week") || text.includes("friday")) return addDays(3);
  return null;
}

function parseUrgency(message: string): "low" | "normal" | "high" | "critical" {
  const text = message.toLowerCase();
  if (/(critical|emergency|blocker|immediately)/.test(text)) return "critical";
  if (/(urgent|asap|high priority|important)/.test(text)) return "high";
  if (/(low priority|whenever|someday)/.test(text)) return "low";
  return "normal";
}

function parseEstimate(message: string) {
  const minutes = message.match(/(\d+)\s*(?:min|mins|minutes)/i);
  if (minutes) return Number(minutes[1]);
  const hours = message.match(/(\d+)\s*(?:hr|hrs|hour|hours)/i);
  if (hours) return Number(hours[1]) * 60;
  return 30;
}

function findAssignee(message: string, users: User[]) {
  const text = message.toLowerCase();
  const explicit = users.find((user) => text.includes(`@${user.name.toLowerCase()}`) || text.includes(user.email.toLowerCase()));
  if (explicit) return explicit;
  const named = users.find((user) => user.id !== DEMO_USER_ID && text.includes(user.name.toLowerCase()));
  return named ?? users.find((user) => user.id === DEMO_USER_ID) ?? users[0];
}

function titleFromMessage(message: string) {
  const cleaned = message
    .replace(/\b(today|tomorrow|next week|this week|urgent|asap|critical|high priority|low priority)\b/gi, "")
    .replace(/\bby\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/gi, "")
    .replace(/\b\d+\s*(?:min|mins|minutes|hr|hrs|hour|hours)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(add|create|remind me to|please|task to)\s+/i, "")
    .slice(0, 150);
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : cleaned;
}

function parseAnnualReminderDays(message: string) {
  const text = message.toLowerCase();
  const days = text.match(/(\d+)\s*days?\s*before/);
  if (days) return Number(days[1]);
  return text.includes("birthday") || text.includes("anniversary") || text.includes("annual") ? 15 : 0;
}

function parseChatTask(message: string, users: User[]): InsertTask {
  const assignee = findAssignee(message, users);
  const reminderDaysBefore = parseAnnualReminderDays(message);
  const recurrence = reminderDaysBefore > 0 || /annual|birthday|anniversary/i.test(message) ? "annual" : "none";
  const assignedToId = assignee?.id ?? DEMO_USER_ID;
  const assignedById = DEMO_USER_ID;
  const title = titleFromMessage(message) || "Untitled task";

  return {
    title,
    description: message,
    status: assignedToId === assignedById ? "open" : "pending_acceptance",
    urgency: parseUrgency(message),
    dueDate: parseDueDate(message),
    estimatedMinutes: parseEstimate(message),
    assignedToId,
    assignedById,
    source: "chat",
    recurrence,
    reminderDaysBefore,
  };
}

function sortTasks(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    const aDone = a.status === "completed" ? 1 : 0;
    const bDone = b.status === "completed" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aDue = a.dueDate ?? "9999-12-31";
    const bDue = b.dueDate ?? "9999-12-31";
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    return (urgencyRank[a.urgency] ?? 2) - (urgencyRank[b.urgency] ?? 2);
  });
}

type AgendaItem = {
  taskId: string | number;
  order: number;
  title: string;
  estimatedMinutes: number;
  dueDate: string | null;
  urgency: string;
};

function buildAgenda(tasks: Task[]): AgendaItem[] {
  const availableMinutes = 6 * 60;
  let remaining = availableMinutes;
  const candidates = sortTasks(tasks).filter((task) => task.status !== "completed" && task.status !== "denied");

  return candidates
    .filter((task) => {
      if (remaining <= 0) return false;
      remaining -= task.estimatedMinutes;
      return true;
    })
    .map((task, index) => ({
      taskId: task.id,
      order: index + 1,
      title: task.title,
      estimatedMinutes: task.estimatedMinutes,
      dueDate: task.dueDate,
      urgency: task.urgency,
    }));
}

// ---------------------------------------------------------------------------
// Supabase-backed bootstrap (authenticated path)
// ---------------------------------------------------------------------------

type SupabaseTaskShape = ReturnType<typeof toClientTask>;

function toClientTask(task: DonnitTask) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    urgency: task.urgency,
    dueDate: task.due_date,
    estimatedMinutes: task.estimated_minutes,
    assignedToId: task.assigned_to,
    assignedById: task.assigned_by,
    source: task.source,
    recurrence: task.recurrence,
    reminderDaysBefore: task.reminder_days_before,
    acceptedAt: task.accepted_at,
    deniedAt: task.denied_at,
    completedAt: task.completed_at,
    completionNotes: task.completion_notes,
    createdAt: task.created_at,
  };
}

function sortClientTasks<T extends { dueDate: string | null; urgency: string; status: string }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const aDone = a.status === "completed" ? 1 : 0;
    const bDone = b.status === "completed" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aDue = a.dueDate ?? "9999-12-31";
    const bDue = b.dueDate ?? "9999-12-31";
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    return (urgencyRank[a.urgency] ?? 2) - (urgencyRank[b.urgency] ?? 2);
  });
}

function buildClientAgenda(tasks: SupabaseTaskShape[]): AgendaItem[] {
  const availableMinutes = 6 * 60;
  let remaining = availableMinutes;
  const candidates = sortClientTasks(tasks).filter((task) => task.status !== "completed" && task.status !== "denied");
  return candidates
    .filter((task) => {
      if (remaining <= 0) return false;
      remaining -= task.estimatedMinutes;
      return true;
    })
    .map((task, index) => ({
      taskId: task.id,
      order: index + 1,
      title: task.title,
      estimatedMinutes: task.estimatedMinutes,
      dueDate: task.dueDate,
      urgency: task.urgency,
    }));
}

async function buildAuthenticatedBootstrap(req: Request) {
  const auth = req.donnitAuth!;
  const store = new DonnitStore(auth.client, auth.userId);
  const profile = await store.getProfile();
  if (!profile?.default_org_id) {
    return {
      authenticated: true,
      bootstrapped: false,
      currentUserId: auth.userId,
      email: auth.email,
      integrations: getIntegrationStatus(),
    };
  }
  const orgId = profile.default_org_id;
  const [members, tasks, events, messages, suggestions] = await Promise.all([
    store.listOrgMembers(orgId),
    store.listTasks(orgId),
    store.listEvents(orgId),
    store.listChatMessages(orgId),
    store.listEmailSuggestions(orgId),
  ]);
  const users = members.map((m) => ({
    id: m.user_id,
    name: m.profile?.full_name || m.profile?.email || "Member",
    email: m.profile?.email ?? "",
    role: m.role,
    persona: m.profile?.persona ?? "operator",
    managerId: m.manager_id,
    canAssign: m.can_assign,
  }));
  const clientTasks = sortClientTasks(tasks.map(toClientTask));
  return {
    authenticated: true,
    bootstrapped: true,
    currentUserId: auth.userId,
    email: auth.email,
    orgId,
    users,
    tasks: clientTasks,
    events: events.map((event) => ({
      id: event.id,
      taskId: event.task_id,
      actorId: event.actor_id,
      type: event.type,
      note: event.note,
      createdAt: event.created_at,
    })),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      taskId: m.task_id,
      createdAt: m.created_at,
    })),
    suggestions: suggestions.map((s) => ({
      id: s.id,
      fromEmail: s.from_email,
      subject: s.subject,
      preview: s.preview,
      body: s.body ?? "",
      receivedAt: s.received_at,
      actionItems: Array.isArray(s.action_items) ? s.action_items : [],
      suggestedTitle: s.suggested_title,
      suggestedDueDate: s.suggested_due_date,
      urgency: s.urgency,
      status: s.status,
      assignedToId: s.assigned_to,
      createdAt: s.created_at,
    })),
    agenda: buildClientAgenda(clientTasks),
    integrations: getIntegrationStatus(),
  };
}

async function buildDemoBootstrap() {
  const [users, tasks, events, messages, suggestions] = await Promise.all([
    storage.listUsers(),
    storage.listTasks(),
    storage.listEvents(),
    storage.listChatMessages(),
    storage.listEmailSuggestions(),
  ]);
  const demoNames = ["Demo Owner", "Demo Manager", "Demo Member"];
  const demoTaskTitles = [
    "Confirm MVP scope",
    "Review email-scan permission copy",
    "Prepare recurring operations checklist",
  ];
  const demoTaskDescriptions = [
    "Decide the first release boundary and what can wait until integrations.",
    "Make the opt-in prompt clear before Donnit suggests a task from an email.",
    "Document a repeatable weekly task so a replacement employee can ramp faster.",
  ];
  const demoSuggestions = [
    {
      fromEmail: "support@example.invalid",
      subject: "New support request needs assignment",
      preview: "A customer-facing support issue needs owner review before end of week.",
      suggestedTitle: "Assign customer support follow-up",
    },
    {
      fromEmail: "finance@example.invalid",
      subject: "Contract renewal needs approval",
      preview: "Please review the renewal terms and confirm the next step.",
      suggestedTitle: "Review contract renewal terms",
    },
  ];
  const demoTasks = sortTasks(tasks).map((task, index) => ({
    ...task,
    title: demoTaskTitles[index] ?? task.title,
    description: demoTaskDescriptions[index] ?? "Demo task for the public preview workspace.",
  }));

  return {
    authenticated: false,
    bootstrapped: true,
    currentUserId: DEMO_USER_ID,
    users: users.map((user, index) => ({
      ...user,
      name: demoNames[index] ?? `Demo User ${index + 1}`,
      email: `demo-user-${index + 1}@example.invalid`,
    })),
    tasks: demoTasks,
    events: events.map((event) => ({
      ...event,
      note: event.note ? "Demo activity event." : event.note,
    })),
    messages,
    suggestions: suggestions.map((suggestion, index) => {
      const demo = demoSuggestions[index];
      if (!demo) return suggestion;
      return {
        ...suggestion,
        fromEmail: demo.fromEmail,
        subject: demo.subject,
        preview: demo.preview,
        suggestedTitle: demo.suggestedTitle,
      };
    }),
    agenda: buildAgenda(demoTasks),
    integrations: getIntegrationStatus(),
  };
}

// Authenticated chat task parsing — operates on the donnit profile model
// (uuid ids) instead of the demo numeric id model.
function parseChatTaskAuthenticated(
  message: string,
  members: Awaited<ReturnType<DonnitStore["listOrgMembers"]>>,
  selfId: string,
) {
  const text = message.toLowerCase();
  const explicit = members.find((m) => {
    const name = (m.profile?.full_name ?? "").toLowerCase();
    const email = (m.profile?.email ?? "").toLowerCase();
    if (!name && !email) return false;
    return (name && (text.includes(`@${name}`) || text.includes(name))) || (email && text.includes(email));
  });
  const assignee = explicit ?? members.find((m) => m.user_id === selfId) ?? members[0];
  const reminderDaysBefore = parseAnnualReminderDays(message);
  const recurrence = reminderDaysBefore > 0 || /annual|birthday|anniversary/i.test(message) ? "annual" : "none";
  const assignedToId = assignee?.user_id ?? selfId;
  const title = titleFromMessage(message) || "Untitled task";
  return {
    title,
    description: message,
    status: assignedToId === selfId ? "open" : "pending_acceptance",
    urgency: parseUrgency(message),
    dueDate: parseDueDate(message),
    estimatedMinutes: parseEstimate(message),
    assignedToId,
    assignedById: selfId,
    source: "chat" as const,
    recurrence: recurrence as "none" | "annual",
    reminderDaysBefore,
  };
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.use("/api", attachSupabaseAuth);
  const detailedHealthAllowed = (req: Request) => {
    if (process.env.NODE_ENV !== "production") return true;
    const expected = process.env.DONNIT_HEALTH_TOKEN;
    return Boolean(expected && req.get("x-donnit-health-token") === expected);
  };
  const sendHealthNotFound = (res: Response) => {
    res.status(404).json({ ok: false, message: "Not Found" });
  };

  // ------------------------------------------------------------------
  // Health probe — no auth required, no secrets exposed.
  // Reports BOOLEAN presence of each required env var so an operator can
  // verify a Vercel deploy without `vercel env pull`. Used by the OAuth
  // troubleshooting flow: if /api/integrations/gmail/oauth/callback ever
  // 302s to /?gmail=server_misconfigured, hit /api/health to see which
  // env is missing.
  // ------------------------------------------------------------------
  app.get("/api/health", (req: Request, res: Response) => {
    try {
      if (!detailedHealthAllowed(req)) {
        res.json({ ok: true, status: "available" });
        return;
      }
      res.json({
        ok: true,
        time: new Date().toISOString(),
        node: process.version,
        env: {
          supabaseUrl: Boolean(process.env.SUPABASE_URL),
          supabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY),
          supabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
          googleClientId: Boolean(process.env.GOOGLE_CLIENT_ID),
          googleClientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
          googleRedirectUri: Boolean(process.env.GOOGLE_REDIRECT_URI),
          gmailOauthStateSecret: Boolean(process.env.GMAIL_OAUTH_STATE_SECRET),
        },
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        message: err instanceof Error ? err.message.slice(0, 200) : "health failed",
      });
    }
  });

  // Diagnostic DB probe — answers whether the deployed service-role client
  // can reach donnit.gmail_accounts. Returns BOOLEANS + sanitized PostgREST
  // error fields + a typed reason from the DbProbeReason union above.
  //
  // NEVER includes: the service-role key itself, any token, any row data, a
  // stack trace, or the auth code. The Supabase project ref IS included —
  // it appears in every browser request to *.supabase.co and is not a
  // secret; including it lets an operator confirm at a glance whether the
  // deployed SUPABASE_URL points at the project they expected.
  //
  // Probe layout (each step short-circuits on the first definitive answer):
  //   1. service-role env var present?
  //   2. PostgREST root reachable with that key (catches paused project,
  //      wrong URL, wrong/anon key, network outages — none of which
  //      supabase-js surfaces with a useful code).
  //   3. service-role client can HEAD-select donnit.gmail_accounts.
  //   4. (always, when 3 fails) HEAD-select donnit.profiles for comparison
  //      so the operator can tell "schema works, this table is missing"
  //      apart from "schema not exposed at all".
  app.get("/api/health/db", async (req: Request, res: Response) => {
    if (!detailedHealthAllowed(req)) {
      sendHealthNotFound(res);
      return;
    }
    const supabaseUrl = process.env.SUPABASE_URL ?? "";
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const projectRef = parseSupabaseRef(supabaseUrl);
    const baseResponse = {
      schema: DONNIT_SCHEMA,
      projectRef,
      supabaseUrlPresent: Boolean(supabaseUrl),
      serviceRoleKeyPresent: Boolean(serviceRole),
    };

    try {
      if (!serviceRole || !supabaseUrl) {
        res.status(200).json({
          ok: false,
          reason: "missing_service_role",
          ...baseResponse,
        });
        return;
      }

      // Step 1: bare-fetch the REST root. This catches the failure modes
      // supabase-js hides behind generic "TypeError: fetch failed".
      const rootProbe = await probePostgrestRoot(supabaseUrl, serviceRole);
      if (rootProbe.error) {
        res.status(200).json({
          ok: false,
          reason: "network_unreachable",
          ...baseResponse,
          rest: { status: null, error: rootProbe.error },
        });
        return;
      }
      // PostgREST root returns 200 (with a tiny JSON listing) for a valid
      // key, and 401/403 with HTML/JSON for invalid/missing/wrong-project
      // keys. Anything 5xx means the project itself is unhealthy.
      if (rootProbe.status === 401 || rootProbe.status === 403) {
        res.status(200).json({
          ok: false,
          reason: "invalid_service_role_or_url",
          ...baseResponse,
          rest: {
            status: rootProbe.status,
            bodySnippet: rootProbe.bodySnippet,
          },
        });
        return;
      }
      if (rootProbe.status !== null && rootProbe.status >= 500) {
        res.status(200).json({
          ok: false,
          reason: "postgrest_error",
          ...baseResponse,
          rest: {
            status: rootProbe.status,
            bodySnippet: rootProbe.bodySnippet,
          },
        });
        return;
      }

      const admin = createSupabaseAdminClient();
      if (!admin) {
        res.status(200).json({
          ok: false,
          reason: "missing_service_role",
          ...baseResponse,
        });
        return;
      }

      // Step 2: HEAD-select gmail_accounts with the schema-pinned client.
      // A successful HEAD probe returns `error: null` (and `count` may be
      // null when supabase-js can't read the Content-Range header — this
      // is normal for an empty table, NOT a failure). Some supabase-js
      // versions return a hollow `{}` error object on success; treat any
      // error whose extracted fields are all null as "no real error" so
      // an empty table doesn't read as inaccessible.
      const gmailProbe = await admin
        .from("gmail_accounts")
        .select("user_id", { count: "exact", head: true })
        .limit(1);
      const gmailErrRaw = gmailProbe.error;
      const gmailErr = gmailErrRaw
        ? describeSupabaseError(gmailErrRaw)
        : { name: null, message: null, code: null, details: null, hint: null, status: null };
      const gmailHasRealError = gmailErrRaw !== null && !isEmptySupabaseError(gmailErr);
      if (!gmailHasRealError) {
        res.json({
          ok: true,
          ...baseResponse,
          rest: { status: rootProbe.status },
          gmailAccountsTable: true,
          gmailAccountsRowCount: typeof gmailProbe.count === "number" ? gmailProbe.count : null,
        });
        return;
      }

      const gmailReason = classifySupabaseError(gmailErr, {
        schema: DONNIT_SCHEMA,
        table: "gmail_accounts",
      });

      // Step 3: HEAD-select profiles to disambiguate "schema not exposed"
      // (both probes fail the same way) from "table missing"
      // (profiles works, gmail_accounts does not). Same empty-error
      // tolerance as gmail_accounts above.
      const profilesProbe = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .limit(1);
      const profilesErrRaw = profilesProbe.error;
      const profilesErrDescribed = profilesErrRaw
        ? describeSupabaseError(profilesErrRaw)
        : null;
      const profilesHasRealError =
        profilesErrRaw !== null &&
        profilesErrDescribed !== null &&
        !isEmptySupabaseError(profilesErrDescribed);
      const profilesOk = !profilesHasRealError;
      const profilesErr = profilesHasRealError ? profilesErrDescribed : null;
      const profilesReason: DbProbeReason = profilesErr
        ? classifySupabaseError(profilesErr, { schema: DONNIT_SCHEMA, table: "profiles" })
        : "ok";

      // Refine the reason: if profiles also fails with schema_not_exposed
      // OR missing_table, the schema itself is the problem (or the JS
      // client is wrong). If profiles works but gmail_accounts says
      // missing_table, the table really is missing in this project.
      let reason: DbProbeReason = gmailReason;
      if (
        gmailReason === "missing_table" &&
        (profilesReason === "schema_not_exposed" ||
          profilesReason === "missing_table" ||
          profilesReason === "rls_denied" ||
          profilesReason === "invalid_service_role_or_url")
      ) {
        // Two tables both unreachable: if profiles fails for a different
        // reason than gmail_accounts, surface the more general one
        // because a fix to the broader cause likely fixes both.
        reason =
          profilesReason === "schema_not_exposed"
            ? "schema_not_exposed"
            : profilesReason === "invalid_service_role_or_url"
              ? "wrong_project_or_key"
              : "wrong_project_or_key";
      }

      res.status(200).json({
        ok: false,
        reason,
        ...baseResponse,
        rest: { status: rootProbe.status },
        gmailAccountsTable: false,
        gmailAccountsError: gmailErr,
        profilesTable: profilesOk,
        profilesError: profilesErr,
        profilesReason,
      });
    } catch (err) {
      const described = describeSupabaseError(err);
      res.status(200).json({
        ok: false,
        reason: "unknown_with_message",
        ...baseResponse,
        threw: true,
        error: described,
      });
    }
  });

  // ------------------------------------------------------------------
  // Public + auth utility
  // ------------------------------------------------------------------
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!isSupabaseConfigured()) {
      res.json({ supabase: false, authenticated: false });
      return;
    }
    if (!req.donnitAuth) {
      res.json({ supabase: true, authenticated: false });
      return;
    }
    const store = new DonnitStore(req.donnitAuth.client, req.donnitAuth.userId);
    const profile = await store.getProfile();
    res.json({
      supabase: true,
      authenticated: true,
      userId: req.donnitAuth.userId,
      email: req.donnitAuth.email,
      bootstrapped: Boolean(profile?.default_org_id),
      profile: profile
        ? {
            id: profile.id,
            fullName: profile.full_name,
            email: profile.email,
            defaultOrgId: profile.default_org_id,
            persona: profile.persona,
          }
        : null,
    });
  });

  app.post("/api/auth/bootstrap", requireDonnitAuth, async (req: Request, res: Response) => {
    const auth = req.donnitAuth!;
    const fullName = typeof req.body?.fullName === "string" ? req.body.fullName.slice(0, 200) : "";
    const orgName = typeof req.body?.orgName === "string" ? req.body.orgName.slice(0, 200) : "";
    const store = new DonnitStore(auth.client, auth.userId);
    try {
      const result = await store.bootstrapWorkspace({
        fullName,
        email: auth.email ?? undefined,
        orgName,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      const payload = serializeSupabaseError(error);
      console.error("[donnit] bootstrap_workspace failed", {
        userId: auth.userId,
        ...payload,
      });
      res.status(500).json({ ok: false, ...payload });
    }
  });

  // ------------------------------------------------------------------
  // Bootstrap — branches on auth state
  // ------------------------------------------------------------------
  app.get("/api/bootstrap", async (req: Request, res: Response) => {
    if (req.donnitAuth) {
      try {
        const data = await buildAuthenticatedBootstrap(req);
        res.json(data);
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    res.json(await buildDemoBootstrap());
  });

  // ------------------------------------------------------------------
  // Chat
  // ------------------------------------------------------------------
  app.post("/api/chat", async (req: Request, res: Response) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Message must be between 2 and 800 characters." });
      return;
    }

    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const profile = await store.getProfile();
        if (!profile?.default_org_id) {
          res.status(409).json({ message: "Workspace not bootstrapped." });
          return;
        }
        const orgId = profile.default_org_id;
        const members = await store.listOrgMembers(orgId);
        const taskInput = parseChatTaskAuthenticated(parsed.data.message, members, auth.userId);
        const created = await store.createTask(orgId, {
          title: taskInput.title,
          description: taskInput.description,
          status: taskInput.status as DonnitTask["status"],
          urgency: taskInput.urgency,
          due_date: taskInput.dueDate,
          estimated_minutes: taskInput.estimatedMinutes,
          assigned_to: taskInput.assignedToId,
          assigned_by: taskInput.assignedById,
          source: taskInput.source,
          recurrence: taskInput.recurrence,
          reminder_days_before: taskInput.reminderDaysBefore,
        });
        await store.createChatMessage(orgId, { role: "user", content: parsed.data.message, task_id: created.id });
        const assignee = members.find((m) => m.user_id === created.assigned_to);
        const dueText = created.due_date ? ` Due ${created.due_date}.` : "";
        const assignmentText =
          created.status === "pending_acceptance"
            ? ` I asked ${assignee?.profile?.full_name ?? "the assignee"} to accept or deny it.`
            : " It is on your list now.";
        const assistant = await store.createChatMessage(orgId, {
          role: "assistant",
          content: `Added “${created.title}” as ${created.urgency} urgency.${dueText}${assignmentText}`,
          task_id: created.id,
        });
        res.status(201).json({ task: toClientTask(created), assistant });
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const users = await storage.listUsers();
    const taskInput = parseChatTask(parsed.data.message, users);
    const task = await storage.createTask(taskInput);
    await storage.createChatMessage({ role: "user", content: parsed.data.message, taskId: task.id });
    const assignee = users.find((user) => user.id === task.assignedToId);
    const dueText = task.dueDate ? ` Due ${task.dueDate}.` : "";
    const assignmentText =
      task.status === "pending_acceptance"
        ? ` I asked ${assignee?.name ?? "the assignee"} to accept or deny it.`
        : " It is on your list now.";
    const assistant = await storage.createChatMessage({
      role: "assistant",
      content: `Added “${task.title}” as ${task.urgency} urgency.${dueText}${assignmentText}`,
      taskId: task.id,
    });

    res.status(201).json({ task, assistant });
  });

  // ------------------------------------------------------------------
  // Tasks
  // ------------------------------------------------------------------
  app.post("/api/tasks", async (req: Request, res: Response) => {
    const parsed = taskCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Task details are incomplete." });
      return;
    }
    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const orgId = await store.getDefaultOrgId();
        if (!orgId) {
          res.status(409).json({ message: "Workspace not bootstrapped." });
          return;
        }
        const data = parsed.data;
        const created = await store.createTask(orgId, {
          title: data.title,
          description: data.description ?? "",
          status: data.status as DonnitTask["status"],
          urgency: data.urgency,
          due_date: data.dueDate ?? null,
          estimated_minutes: data.estimatedMinutes ?? 30,
          assigned_to: typeof data.assignedToId === "string" ? data.assignedToId : auth.userId,
          assigned_by: typeof data.assignedById === "string" ? data.assignedById : auth.userId,
          source: data.source,
          recurrence: data.recurrence,
          reminder_days_before: data.reminderDaysBefore ?? 0,
        });
        res.status(201).json(toClientTask(created));
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const task = await storage.createTask(parsed.data);
    res.status(201).json(task);
  });

  async function handleTaskAction(
    req: Request,
    res: Response,
    action: "complete" | "accept" | "deny" | "note",
  ) {
    const note = noteRequestSchema.safeParse(req.body);

    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const taskId = String(req.params.id);
        const existing = await store.getTask(taskId);
        if (!existing) {
          res.status(404).json({ message: "Task not found." });
          return;
        }
        let patch: Partial<DonnitTask> = {};
        let eventType = "";
        let eventNote = "";
        switch (action) {
          case "complete":
            patch = {
              status: "completed",
              completed_at: new Date().toISOString(),
              completion_notes: note.success ? note.data.note : "",
            };
            eventType = "completed";
            eventNote = note.success ? note.data.note : "Completed without notes.";
            break;
          case "accept":
            patch = { status: "accepted", accepted_at: new Date().toISOString() };
            eventType = "accepted";
            eventNote = "Assignment accepted.";
            break;
          case "deny":
            patch = {
              status: "denied",
              denied_at: new Date().toISOString(),
              completion_notes: note.success ? note.data.note : "",
            };
            eventType = "denied";
            eventNote = note.success ? note.data.note : "Assignment denied.";
            break;
          case "note":
            if (!note.success) {
              res.status(400).json({ message: "Note is required." });
              return;
            }
            patch = { completion_notes: note.data.note };
            eventType = "note_added";
            eventNote = note.data.note;
            break;
        }
        const updated = await store.updateTask(taskId, patch);
        if (!updated) {
          res.status(404).json({ message: "Task not found." });
          return;
        }
        await store.addEvent(updated.org_id, {
          task_id: updated.id,
          actor_id: auth.userId,
          type: eventType,
          note: eventNote,
        });
        res.json(toClientTask(updated));
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const id = Number(req.params.id);
    let patch: Partial<Task> = {};
    let eventType = "";
    let eventNote = "";
    switch (action) {
      case "complete":
        patch = {
          status: "completed",
          completedAt: new Date().toISOString(),
          completionNotes: note.success ? note.data.note : "",
        };
        eventType = "completed";
        eventNote = note.success ? note.data.note : "Completed without notes.";
        break;
      case "accept":
        patch = { status: "accepted", acceptedAt: new Date().toISOString() };
        eventType = "accepted";
        eventNote = "Assignment accepted.";
        break;
      case "deny":
        patch = {
          status: "denied",
          deniedAt: new Date().toISOString(),
          completionNotes: note.success ? note.data.note : "",
        };
        eventType = "denied";
        eventNote = note.success ? note.data.note : "Assignment denied.";
        break;
      case "note":
        if (!note.success) {
          res.status(400).json({ message: "Note is required." });
          return;
        }
        patch = { completionNotes: note.data.note };
        eventType = "note_added";
        eventNote = note.data.note;
        break;
    }
    const task = await storage.updateTask(id, patch);
    if (!task) {
      res.status(404).json({ message: "Task not found." });
      return;
    }
    await storage.addEvent({ taskId: id, actorId: DEMO_USER_ID, type: eventType, note: eventNote });
    res.json(task);
  }

  app.post("/api/tasks/:id/complete", (req, res) => handleTaskAction(req, res, "complete"));
  app.post("/api/tasks/:id/notes", (req, res) => handleTaskAction(req, res, "note"));
  app.post("/api/tasks/:id/accept", (req, res) => handleTaskAction(req, res, "accept"));
  app.post("/api/tasks/:id/deny", (req, res) => handleTaskAction(req, res, "deny"));

  // ------------------------------------------------------------------
  // Email suggestions
  // ------------------------------------------------------------------
  app.post("/api/suggestions/:id/approve", async (req: Request, res: Response) => {
    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const suggestion = await store.getEmailSuggestion(String(req.params.id));
        if (!suggestion) {
          res.status(404).json({ message: "Suggestion not found." });
          return;
        }
        const updated = await store.updateEmailSuggestion(suggestion.id, { status: "approved" });
        const assignedTo = suggestion.assigned_to ?? auth.userId;
        const task = await store.createTask(suggestion.org_id, {
          title: suggestion.suggested_title,
          description: `${suggestion.subject}\n\n${suggestion.preview}`,
          status: assignedTo === auth.userId ? "open" : "pending_acceptance",
          urgency: suggestion.urgency,
          due_date: suggestion.suggested_due_date,
          estimated_minutes: suggestion.urgency === "high" ? 45 : 30,
          assigned_to: assignedTo,
          assigned_by: auth.userId,
          source: "email",
          recurrence: "none",
          reminder_days_before: 0,
        });
        await store.addEvent(suggestion.org_id, {
          task_id: task.id,
          actor_id: auth.userId,
          type: "email_approved",
          note: `Approved task suggestion from ${suggestion.from_email}.`,
        });
        res.json({ suggestion: updated, task: toClientTask(task) });
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    const result = await storage.approveEmailSuggestion(Number(req.params.id), DEMO_USER_ID);
    if (!result.suggestion) {
      res.status(404).json({ message: "Suggestion not found." });
      return;
    }
    res.json(result);
  });

  app.post("/api/suggestions/:id/dismiss", async (req: Request, res: Response) => {
    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const updated = await store.updateEmailSuggestion(String(req.params.id), { status: "dismissed" });
        if (!updated) {
          res.status(404).json({ message: "Suggestion not found." });
          return;
        }
        res.json(updated);
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    const suggestion = await storage.dismissEmailSuggestion(Number(req.params.id));
    if (!suggestion) {
      res.status(404).json({ message: "Suggestion not found." });
      return;
    }
    res.json(suggestion);
  });

  // ------------------------------------------------------------------
  // Agenda + integrations
  // ------------------------------------------------------------------
  app.get("/api/agenda", async (req: Request, res: Response) => {
    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const orgId = await store.getDefaultOrgId();
        if (!orgId) {
          res.json([]);
          return;
        }
        const tasks = await store.listTasks(orgId);
        res.json(buildClientAgenda(tasks.map(toClientTask)));
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    const tasks = await storage.listTasks();
    res.json(buildAgenda(tasks));
  });

  app.get("/api/integrations", async (_req: Request, res: Response) => {
    res.json(getIntegrationStatus());
  });

  app.post("/api/integrations/gmail/scan", async (req: Request, res: Response) => {
    // Strategy:
    //   1. When first-party Gmail OAuth env is configured (production), the
    //      authenticated user MUST have a connected Gmail account. If they
    //      don't, return a typed `gmail_oauth_not_connected` so the UI can
    //      prompt "Connect Gmail" instead of the vague connector message.
    //      If their stored token won't refresh, return
    //      `gmail_oauth_token_invalid` so the UI says "Reconnect Gmail".
    //   2. When OAuth env is NOT configured (preview/dev), fall back to the
    //      external-tool connector. If that runtime is unavailable, surface
    //      `gmail_oauth_not_configured` so the operator knows to set the env.
    const oauth = getGmailOAuthConfig();
    let oauthAccessToken: string | null = null;
    let oauthAccountStatus: "missing" | "connected" | "error" = "missing";

    if (oauth.configured) {
      if (!req.donnitAuth) {
        res.status(401).json({
          ok: false,
          reason: "gmail_auth_required",
          message: "Sign in to Donnit before scanning Gmail.",
        });
        return;
      }
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const account = await store.getGmailAccount();
        if (!account) {
          res.status(412).json({
            ok: false,
            reason: "gmail_oauth_not_connected",
            message:
              "Connect your Gmail account so Donnit can scan unread email directly.",
          });
          return;
        }
        if (account.status === "error") {
          oauthAccountStatus = "error";
          res.status(401).json({
            ok: false,
            reason: "gmail_oauth_token_invalid",
            message:
              "Gmail authorization expired. Reconnect Gmail and try again.",
          });
          return;
        }
        oauthAccountStatus = "connected";
        const expiresMs = new Date(account.expires_at).getTime();
        const now = Date.now();
        if (expiresMs - now > 30_000) {
          oauthAccessToken = account.access_token;
        } else if (account.refresh_token) {
          try {
            const refreshed = await refreshGmailAccessToken(account.refresh_token);
            await store.patchGmailAccount({
              access_token: refreshed.accessToken,
              expires_at: new Date(refreshed.expiresAt).toISOString(),
              scope: refreshed.scope || account.scope,
              token_type: refreshed.tokenType || account.token_type,
            });
            oauthAccessToken = refreshed.accessToken;
          } catch (refreshErr) {
            // Never log token bodies — only the safe summary the helper threw.
            console.error(
              "[donnit] gmail oauth refresh failed:",
              refreshErr instanceof Error ? refreshErr.message : "unknown",
            );
            await store.patchGmailAccount({ status: "error" });
            res.status(401).json({
              ok: false,
              reason: "gmail_oauth_token_invalid",
              message: "Gmail authorization expired. Reconnect Gmail and try again.",
            });
            return;
          }
        } else {
          // Token expired and we have no refresh_token — force reconnect.
          await store.patchGmailAccount({ status: "error" });
          res.status(401).json({
            ok: false,
            reason: "gmail_oauth_token_invalid",
            message: "Gmail authorization expired. Reconnect Gmail and try again.",
          });
          return;
        }
      } catch (lookupErr) {
        console.error(
          "[donnit] gmail account lookup failed:",
          lookupErr instanceof Error ? lookupErr.message : "unknown",
        );
        res.status(500).json({
          ok: false,
          reason: "gmail_not_connected_or_tool_unavailable",
          message: "Could not load your Gmail connection. Try again shortly.",
        });
        return;
      }
    }

    const result = await scanGmailForTaskCandidates({ oauthAccessToken });
    if (!result.ok) {
      // If OAuth path failed mid-scan because the token/scope is invalid,
      // mark the account as needing reconnect so the next status fetch
      // reflects reality and the UI shows "Reconnect Gmail".
      if (
        oauthAccountStatus === "connected" &&
        (result.reason === "gmail_oauth_token_invalid" ||
          result.reason === "gmail_reconnect_required" ||
          result.reason === "gmail_scope_missing") &&
        req.donnitAuth
      ) {
        try {
          const store = new DonnitStore(req.donnitAuth.client, req.donnitAuth.userId);
          await store.patchGmailAccount({ status: "error" });
        } catch {
          // best-effort
        }
      }
      // When the connector path returns runtime_unavailable but OAuth env is
      // missing, rebrand as `gmail_oauth_not_configured` so the message tells
      // the operator (not the user) what to fix.
      let reason: string = result.reason;
      let message = result.message;
      if (!oauth.configured && result.reason === "gmail_runtime_unavailable") {
        reason = "gmail_oauth_not_configured";
        message =
          "Google OAuth env is not configured on this server. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI, then redeploy.";
      }
      const status =
        reason === "gmail_auth_required" ||
        reason === "gmail_oauth_token_invalid" ||
        reason === "gmail_reconnect_required"
          ? 401
          : reason === "gmail_runtime_unavailable" ||
              reason === "gmail_oauth_not_configured" ||
              reason === "gmail_api_unavailable"
            ? 503
            : reason === "gmail_oauth_not_connected"
              ? 412
              : reason === "gmail_api_not_enabled" || reason === "gmail_api_forbidden"
                ? 403
                : reason === "gmail_scope_missing"
                  ? 403
                  : reason === "gmail_rate_limited"
                    ? 429
                    : reason === "gmail_api_bad_request"
                      ? 400
                      : 424;
      // Pass through Google's sanitized envelope summary so the UI/log can
      // show the operator exactly what Google said.
      const payload: Record<string, unknown> = { ok: false, reason, message };
      if ("googleStatus" in result && result.googleStatus !== undefined) {
        payload.googleStatus = result.googleStatus;
      }
      if ("googleError" in result && result.googleError) {
        payload.googleError = result.googleError;
      }
      res.status(status).json(payload);
      return;
    }
    const candidates = result.candidates;

    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const orgId = await store.getDefaultOrgId();
        if (!orgId) {
          res.status(409).json({ message: "Workspace not bootstrapped." });
          return;
        }
        // Mark scan completion on the OAuth account (best-effort).
        if (oauthAccessToken) {
          try {
            await store.patchGmailAccount({ last_scanned_at: new Date().toISOString() });
          } catch {
            // ignore
          }
        }
        const existing = await store.listEmailSuggestions(orgId);
        const existingKeys = new Set(
          existing.map((item) => item.gmail_message_id ?? `${item.from_email}|${item.subject}`),
        );
        const created = [];
        for (const candidate of candidates) {
          const key = candidate.gmailMessageId ?? `${candidate.fromEmail}|${candidate.subject}`;
          if (existingKeys.has(key)) continue;
          existingKeys.add(key);
          const suggestion = await store.createEmailSuggestion(orgId, {
            gmail_message_id: candidate.gmailMessageId ?? null,
            from_email: candidate.fromEmail,
            subject: candidate.subject,
            preview: candidate.preview,
            body: candidate.body,
            received_at: candidate.receivedAt,
            action_items: candidate.actionItems,
            suggested_title: candidate.suggestedTitle,
            suggested_due_date: candidate.suggestedDueDate,
            urgency: candidate.urgency as "low" | "normal" | "high" | "critical",
            assigned_to: auth.userId,
          });
          created.push(suggestion);
        }
        res.json({
          ok: true,
          source: result.source,
          scannedCandidates: candidates.length,
          createdSuggestions: created.length,
          suggestions: created,
        });
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const created = [];
    const existing = await storage.listEmailSuggestions();
    const existingKeys = new Set(existing.map((item) => `${item.fromEmail}|${item.subject}`));
    for (const candidate of candidates) {
      const key = `${candidate.fromEmail}|${candidate.subject}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      const suggestion = await storage.createEmailSuggestion({
        fromEmail: candidate.fromEmail,
        subject: candidate.subject,
        preview: candidate.preview,
        suggestedTitle: candidate.suggestedTitle,
        suggestedDueDate: candidate.suggestedDueDate,
        urgency: candidate.urgency,
        assignedToId: candidate.assignedToId,
      });
      created.push(suggestion);
    }
    res.json({
      ok: true,
      source: result.source,
      scannedCandidates: candidates.length,
      createdSuggestions: created.length,
      suggestions: created,
    });
  });

  // ------------------------------------------------------------------
  // Gmail OAuth (first-party) — production scaffolding
  // ------------------------------------------------------------------
  // The hosted Perplexity preview cannot always reach the platform
  // connector's runtime token. To make automated unread Gmail scanning the
  // primary product behavior in production, Donnit also supports first-party
  // Google OAuth: the operator configures GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI
  // and each user connects their Gmail once. Tokens are server-only.
  //
  // Endpoints:
  //   GET  /api/integrations/gmail/oauth/status     — is OAuth configured? is the user connected?
  //   POST /api/integrations/gmail/oauth/connect    — returns Google consent URL (signed state)
  //   GET  /api/integrations/gmail/oauth/callback   — Google redirects here with ?code&state
  //   POST /api/integrations/gmail/oauth/disconnect — revoke locally (clears token row)
  //
  // Vercel runs each function invocation in a separate (cold-startable)
  // Lambda, so an in-memory state map cannot survive the round-trip through
  // accounts.google.com. We instead encode {userId, orgId, iat} into the
  // OAuth `state` parameter itself and HMAC-sign it (see
  // signGmailOAuthState/verifyGmailOAuthState). The callback verifies the
  // signature, extracts the donnit userId, and writes the token row using a
  // service-role Supabase client (Google's redirect carries no user JWT).

  app.get("/api/integrations/gmail/oauth/status", async (req: Request, res: Response) => {
    const cfg = getGmailOAuthConfig();
    if (!req.donnitAuth) {
      res.json({
        configured: cfg.configured,
        connected: false,
        authenticated: false,
        requiresReconnect: false,
      });
      return;
    }
    try {
      const store = new DonnitStore(req.donnitAuth.client, req.donnitAuth.userId);
      const account = await store.getGmailAccount();
      const connected = Boolean(account && account.status === "connected");
      const requiresReconnect = Boolean(account && account.status === "error");
      res.json({
        configured: cfg.configured,
        authenticated: true,
        connected,
        requiresReconnect,
        email: account?.email ?? null,
        lastScannedAt: account?.last_scanned_at ?? null,
        status: account?.status ?? null,
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/integrations/gmail/oauth/connect", requireDonnitAuth, async (req: Request, res: Response) => {
    const cfg = getGmailOAuthConfig();
    if (!cfg.configured) {
      res.status(412).json({
        ok: false,
        reason: "oauth_not_configured",
        message:
          "Gmail OAuth is not configured on this server. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI, then redeploy.",
      });
      return;
    }
    const auth = req.donnitAuth!;
    try {
      const store = new DonnitStore(auth.client, auth.userId);
      const orgId = await store.getDefaultOrgId();
      if (!orgId) {
        res.status(409).json({ message: "Workspace not bootstrapped." });
        return;
      }
      const state = signGmailOAuthState({
        userId: auth.userId,
        orgId,
        issuedAt: Date.now(),
      });
      const url = buildGmailAuthUrl(state);
      res.json({ ok: true, url });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET callback. Two important constraints:
  //   1. Google redirects the BROWSER here as a top-level navigation, so no
  //      Authorization header is sent. We cannot rely on req.donnitAuth.
  //   2. The donnit user must be inferred entirely from the signed state.
  //   3. We must NEVER let an exception escape — Vercel surfaces those as
  //      FUNCTION_INVOCATION_FAILED 500 to the user. Every error path
  //      redirects to "/?gmail=<reason>" so the SPA can show a real toast.
  app.get("/api/integrations/gmail/oauth/callback", async (req: Request, res: Response) => {
    const safeRedirect = (
      reason: string,
      detail?: { googleError?: string | null; googleErrorDescription?: string | null },
    ) => {
      // Always redirect to "/" with a typed gmail param so the SPA can show
      // a toast and refresh oauth status without further server hops.
      // Optional `gmail_error` / `gmail_error_description` carry Google's
      // own short error code / description so the toast can show exactly
      // what Google said. These fields come from Google's documented OAuth
      // error response and never contain the auth code or any token.
      const params = new URLSearchParams({ gmail: reason });
      if (detail?.googleError) {
        params.set("gmail_error", String(detail.googleError).slice(0, 80));
      }
      if (detail?.googleErrorDescription) {
        params.set(
          "gmail_error_description",
          String(detail.googleErrorDescription).slice(0, 200),
        );
      }
      const redirectUrl = `/?${params.toString()}`;
      try {
        res.status(302).setHeader("Location", redirectUrl).end();
      } catch {
        // If even setHeader throws (response already started), fall back to
        // a plain HTML body so Vercel still gets a 200 instead of a crash.
        try {
          res.type("html").send(`<p><a href="${redirectUrl}">Return to Donnit</a></p>`);
        } catch {
          // last-resort: no-op
        }
      }
    };

    try {
      const code = typeof req.query.code === "string" ? req.query.code : null;
      const stateParam = typeof req.query.state === "string" ? req.query.state : null;
      const errorParam = typeof req.query.error === "string" ? req.query.error : null;

      if (errorParam) {
        // User denied or Google rejected. Don't log the raw param body.
        return safeRedirect("denied");
      }
      if (!code || !stateParam) {
        return safeRedirect("missing_params");
      }

      const verified = verifyGmailOAuthState(stateParam);
      if (!verified.ok) {
        return safeRedirect(
          verified.reason === "expired"
            ? "expired"
            : verified.reason === "bad_signature"
              ? "bad_state"
              : "bad_state",
        );
      }

      const cfg = getGmailOAuthConfig();
      if (!cfg.configured) {
        return safeRedirect("not_configured");
      }

      const admin = createSupabaseAdminClient();
      if (!admin) {
        // SUPABASE_SERVICE_ROLE_KEY missing. Operator-fixable; tell the user
        // to contact admin via the SPA toast.
        return safeRedirect("server_misconfigured");
      }

      let tokens;
      try {
        tokens = await exchangeGmailAuthCode(code);
      } catch (err) {
        // Token-exchange errors must NEVER include the auth code, client
        // secret, access token, or refresh token. We log only Google's
        // documented `error` / `error_description` fields plus the HTTP
        // status, and the redirect_uri value (which is the public callback
        // URL — not a secret) so an operator can confirm at a glance whether
        // the deployed redirect_uri matches what is registered on the OAuth
        // client. The typed reason flows to the SPA toast so the user (or
        // admin) sees a specific message instead of a generic one.
        if (err instanceof GmailTokenExchangeError) {
          console.error(
            "[donnit] gmail token exchange failed:",
            JSON.stringify({
              status: err.status,
              googleError: err.googleError,
              googleErrorDescription: err.googleErrorDescription,
              reason: err.reason,
              // The redirect_uri we sent to Google. Logged so operators can
              // diff this against the Authorized redirect URIs in the Google
              // OAuth client configuration. Public URL, never a secret.
              redirectUri: cfg.redirectUri,
            }),
          );
          return safeRedirect(err.reason, {
            googleError: err.googleError,
            googleErrorDescription: err.googleErrorDescription,
          });
        }
        console.error(
          "[donnit] gmail token exchange failed (unexpected):",
          err instanceof Error ? err.message.slice(0, 200) : "unknown",
        );
        return safeRedirect("token_exchange_failed");
      }

      // Best-effort: resolve the connected Gmail address. If Gmail's profile
      // call fails, fall back to a generic placeholder; we never log the token.
      let email = "";
      try {
        const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
          headers: { authorization: `Bearer ${tokens.accessToken}` },
        });
        if (profileRes.ok) {
          const profile = (await profileRes.json()) as { emailAddress?: string };
          if (profile.emailAddress) email = profile.emailAddress;
        }
      } catch {
        // ignore
      }
      if (!email) email = "your gmail";

      // Upsert via service role. RLS policy requires user_id = auth.uid(),
      // which the service-role key bypasses. We still scope writes to the
      // userId/orgId from the verified state — never to data sourced from
      // the request.
      //
      // Preflight: a HEAD-select against gmail_accounts with the same
      // admin client we are about to upsert with. If the HEAD probe
      // succeeds but the upsert fails, the failure is NOT a missing
      // service-role key / anon-key swap (the SELECT proved the key has
      // privileges and the schema is reachable). That lets us emit a
      // precise reason like `fk_missing_profile_or_org` or
      // `gmail_persist_error` instead of telling the user
      // "SUPABASE_SERVICE_ROLE_KEY appears to be anon" — which is what
      // the previous classifier did for any 42501 / "permission denied".
      let preflightOk = false;
      try {
        const preflight = await admin
          .from("gmail_accounts")
          .select("user_id", { count: "exact", head: true })
          .limit(1);
        const preflightErrRaw = preflight.error;
        const preflightErr = preflightErrRaw
          ? describeSupabaseError(preflightErrRaw)
          : null;
        preflightOk =
          preflightErrRaw === null ||
          (preflightErr !== null && isEmptySupabaseError(preflightErr));
      } catch {
        preflightOk = false;
      }

      try {
        const { error: upsertError } = await admin
          .from("gmail_accounts")
          .upsert(
            {
              user_id: verified.state.userId,
              org_id: verified.state.orgId,
              email,
              access_token: tokens.accessToken,
              refresh_token: tokens.refreshToken,
              scope: tokens.scope,
              token_type: tokens.tokenType,
              expires_at: new Date(tokens.expiresAt).toISOString(),
              status: "connected",
            },
            { onConflict: "user_id" },
          );
        if (upsertError) {
          // Reuse the same diagnostic helpers /api/health/db uses so a
          // toast reason matches what the operator sees on the probe.
          // Never log tokens, auth code, or the service-role value.
          const described = describeSupabaseError(upsertError);
          // Hollow error object (every recognized field null) means
          // supabase-js handed us a non-null `{}` without a real failure.
          // Treat it as success so a working upsert doesn't redirect to a
          // false-negative error toast. Real PostgREST errors always
          // carry at least a code, status, or message.
          if (isEmptySupabaseError(described)) {
            return safeRedirect("connected");
          }
          let reason: DbProbeReason = classifySupabaseError(described, {
            schema: DONNIT_SCHEMA,
            table: "gmail_accounts",
          });
          // Foreign-key violation (donnit.gmail_accounts.user_id ->
          // donnit.profiles.id). Common when a Supabase auth user signs
          // in but the workspace bootstrap that creates donnit.profiles
          // has not yet run. Surface a precise reason rather than a
          // generic postgrest_error so the toast can tell the user to
          // re-sign-in / bootstrap.
          if ((described.code ?? "").toUpperCase() === "23503") {
            reason = "fk_missing_profile_or_org";
          }
          // Preflight succeeded (HEAD-select worked with this same
          // admin client), so the failure cannot be a missing/anon
          // service-role key. Override misleading reasons that would
          // trigger the "service-role appears to be anon" toast.
          if (
            preflightOk &&
            (reason === "rls_denied" ||
              reason === "invalid_service_role_or_url" ||
              reason === "wrong_project_or_key" ||
              reason === "missing_service_role")
          ) {
            reason =
              (described.code ?? "").toUpperCase() === "42501"
                ? "permission_denied_grants_missing"
                : "gmail_persist_error";
          }
          console.error(
            "[donnit] gmail upsert failed:",
            JSON.stringify({
              reason,
              preflightOk,
              schema: DONNIT_SCHEMA,
              projectRef: parseSupabaseRef(process.env.SUPABASE_URL),
              code: described.code,
              status: described.status,
              message: described.message,
              details: described.details,
              hint: described.hint,
            }).slice(0, 500),
          );
          // The toast reason set the SPA already understands stays a
          // strict subset of DbProbeReason so older clients keep working.
          return safeRedirect(reason, {
            googleError: described.code ?? null,
            googleErrorDescription:
              (described.message || described.details || null)?.slice(0, 200) ?? null,
          });
        }
      } catch (err) {
        console.error(
          "[donnit] gmail upsert threw:",
          err instanceof Error ? err.message.slice(0, 200) : "unknown",
        );
        return safeRedirect("persist_failed");
      }

      return safeRedirect("connected");
    } catch (err) {
      // Defensive top-level catch so Vercel never sees an unhandled rejection.
      // A FUNCTION_INVOCATION_FAILED 500 from this route is what triggered the
      // user's bug report; the catch above each await keeps that from surfacing,
      // and this final guard handles anything synchronous we missed.
      console.error(
        "[donnit] gmail callback unexpected:",
        err instanceof Error ? err.message.slice(0, 200) : "unknown",
      );
      return safeRedirect("unexpected");
    }
  });

  app.post("/api/integrations/gmail/oauth/disconnect", requireDonnitAuth, async (req: Request, res: Response) => {
    const auth = req.donnitAuth!;
    try {
      const store = new DonnitStore(auth.client, auth.userId);
      await store.deleteGmailAccount();
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  // Manual email import — used as a fallback when the hosted preview cannot
  // talk to the external-tool runtime. Persists exactly one email_suggestion
  // row from a pasted subject/body so product testing can continue end-to-end.
  const manualEmailSchema = z.object({
    subject: z.string().trim().min(1).max(240),
    body: z.string().trim().min(1).max(4000),
    fromEmail: z.string().trim().max(240).optional(),
  });

  app.post("/api/integrations/email/manual", async (req: Request, res: Response) => {
    const parsed = manualEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Provide a subject (1–240 chars) and body (1–4000 chars)." });
      return;
    }
    const candidate = buildManualEmailCandidate(parsed.data);
    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const orgId = await store.getDefaultOrgId();
        if (!orgId) {
          res.status(409).json({ message: "Workspace not bootstrapped." });
          return;
        }
        const suggestion = await store.createEmailSuggestion(orgId, {
          gmail_message_id: candidate.gmailMessageId ?? null,
          from_email: candidate.fromEmail,
          subject: candidate.subject,
          preview: candidate.preview,
          body: candidate.body,
          received_at: candidate.receivedAt,
          action_items: candidate.actionItems,
          suggested_title: candidate.suggestedTitle,
          suggested_due_date: candidate.suggestedDueDate,
          urgency: candidate.urgency as "low" | "normal" | "high" | "critical",
          assigned_to: auth.userId,
        });
        res.status(201).json({ ok: true, suggestion });
        return;
      } catch (error) {
        const payload = serializeSupabaseError(error);
        console.error("[donnit] manual email import failed", { userId: req.donnitAuth?.userId, ...payload });
        res.status(500).json({ ok: false, ...payload });
        return;
      }
    }
    const suggestion = await storage.createEmailSuggestion({
      fromEmail: candidate.fromEmail,
      subject: candidate.subject,
      preview: candidate.preview,
      suggestedTitle: candidate.suggestedTitle,
      suggestedDueDate: candidate.suggestedDueDate,
      urgency: candidate.urgency,
      assignedToId: candidate.assignedToId,
    });
    res.status(201).json({ ok: true, suggestion });
  });

  return httpServer;
}
