import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import crypto from "node:crypto";
import {
  chatRequestSchema,
  externalTaskSuggestionSchema,
  noteRequestSchema,
  taskCreateRequestSchema,
  taskTemplateRequestSchema,
  taskUpdateRequestSchema,
} from "@shared/schema";
import type { InsertTask, Task, User } from "@shared/schema";
import {
  buildGmailAuthUrl,
  buildManualEmailCandidate,
  exchangeGmailAuthCode,
  GMAIL_OAUTH_SCOPE,
  GMAIL_SEND_OAUTH_SCOPE,
  GmailTokenExchangeError,
  getGmailOAuthConfig,
  getIntegrationStatus,
  hasGmailSendScope,
  hasGoogleCalendarScope,
  refreshGmailAccessToken,
  scanGmailForTaskCandidates,
  sendGmailThreadReply,
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
import {
  DonnitStore,
  type DonnitEmailSuggestion,
  type DonnitPositionProfile,
  type DonnitTask,
  type DonnitTaskSubtask,
  type DonnitTaskTemplate,
  type DonnitUserWorkspaceState,
} from "./donnit-store";
import { DONNIT_SCHEMA, DONNIT_TABLES, isSupabaseConfigured } from "./supabase";
import { draftSuggestionReplyWithAgent } from "./intelligence/skills/reply-drafter";
import { executeDonnitComposioReadTool, isComposioConfigured, listDonnitComposioTools } from "./intelligence/composio-client";

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

function sendTaskSubtaskError(res: Response, action: "create" | "update" | "delete", error: unknown) {
  const described = describeSupabaseError(error);
  const reason = classifySupabaseError(described, { schema: DONNIT_SCHEMA, table: "task_subtasks" });
  const status =
    reason === "missing_table" || reason === "invalid_column" || reason === "schema_not_exposed"
      ? 409
      : reason === "rls_denied" || reason === "permission_denied_grants_missing"
        ? 403
        : 500;
  const message =
    reason === "missing_table"
      ? "Subtasks are not available yet. Apply Supabase migration 0010_document_source_and_future_task_primitives.sql, then redeploy."
      : reason === "schema_not_exposed"
        ? "Subtasks table is not exposed through Supabase. Add the donnit schema to Supabase API exposed schemas."
        : reason === "invalid_column"
          ? "Subtasks schema is stale. Re-apply migration 0010 and the latest workspace state migration."
          : reason === "rls_denied"
            ? "Supabase blocked this subtask write. Apply migration 20260507154714_user_workspace_state.sql so task owners, delegates, and collaborators can manage subtasks."
            : reason === "permission_denied_grants_missing"
              ? "Supabase table grants are missing for subtasks. Re-apply migration 0010 and confirm authenticated/service_role grants exist."
              : described.message ?? `Could not ${action} subtask.`;
  console.error(`[donnit] task_subtask ${action} failed`, {
    reason,
    code: described.code,
    message: described.message,
    details: described.details,
    hint: described.hint,
  });
  res.status(status).json({
    ok: false,
    reason: `task_subtasks_${reason}`,
    message,
    code: described.code,
    details: described.details,
    hint: described.hint,
  });
}

function sendTaskTemplateError(res: Response, action: "create" | "update" | "delete", error: unknown) {
  const described = describeSupabaseError(error);
  const reason = classifySupabaseError(described, { schema: DONNIT_SCHEMA, table: "task_templates" });
  const status =
    reason === "missing_table" || reason === "invalid_column" || reason === "schema_not_exposed"
      ? 409
      : reason === "rls_denied" || reason === "permission_denied_grants_missing"
        ? 403
        : 500;
  const message =
    reason === "missing_table"
      ? "Task templates need a database update. Apply Supabase migration 20260510214107_task_template_member_access.sql, then try again."
      : reason === "schema_not_exposed"
        ? "Task templates are not exposed through Supabase. Add the donnit schema to Supabase API exposed schemas."
        : reason === "rls_denied"
          ? "Supabase blocked this template write. Apply migration 20260510214107_task_template_member_access.sql so all workspace members can create templates."
          : reason === "permission_denied_grants_missing"
            ? "Supabase table grants are missing for task templates. Re-apply the task templates migration."
            : described.message ?? `Could not ${action} task template.`;
  console.error(`[donnit] task_template ${action} failed`, {
    reason,
    code: described.code,
    message: described.message,
    details: described.details,
    hint: described.hint,
  });
  res.status(status).json({
    ok: false,
    reason: `task_templates_${reason}`,
    message,
    code: described.code,
    details: described.details,
    hint: described.hint,
  });
}

const urgencyRank: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const DEFAULT_DONNIT_TIME_ZONE = process.env.DONNIT_TIME_ZONE || "America/New_York";

function todayIso(timeZone = DEFAULT_DONNIT_TIME_ZONE) {
  return getZonedParts(new Date(), timeZone).date;
}

function addDays(days: number, timeZone = DEFAULT_DONNIT_TIME_ZONE) {
  return addDaysIso(todayIso(timeZone), days);
}

function nextWeekdayIso(targetDay: number, preferNextWeek = false) {
  const localToday = todayIso();
  const today = new Date(`${localToday}T00:00:00.000Z`).getUTCDay();
  let delta = targetDay - today;
  if (delta < 0 || (delta === 0 && preferNextWeek)) delta += 7;
  return addDaysIso(localToday, delta);
}

const weekdayIndexes: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const ordinalNumbers: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
};

function nthWeekdayOfMonthIso(year: number, month: number, weekday: number, ordinal: string) {
  if (ordinal === "last") {
    const lastDay = new Date(Date.UTC(year, month, 0));
    const delta = (lastDay.getUTCDay() - weekday + 7) % 7;
    return toIsoDate(year, month, lastDay.getUTCDate() - delta);
  }
  const occurrence = ordinalNumbers[ordinal];
  if (!occurrence) return null;
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const delta = (weekday - firstDay.getUTCDay() + 7) % 7;
  return toIsoDate(year, month, 1 + delta + (occurrence - 1) * 7);
}

function parseMonthlyOrdinalWeekdayDueDate(message: string) {
  const text = message.toLowerCase();
  const ordinalWeekday = text.match(
    /\b(first|second|third|fourth|last)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:of\s+)?(?:every|each|the)?\s*month\b/i,
  );
  if (!ordinalWeekday) return null;
  const weekday = weekdayIndexes[ordinalWeekday[2]];
  const [yearText, monthText] = todayIso().split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const thisMonth = nthWeekdayOfMonthIso(year, month, weekday, ordinalWeekday[1]);
  if (thisMonth && thisMonth >= todayIso()) return thisMonth;
  const nextMonthDate = new Date(Date.UTC(year, month, 1));
  return nthWeekdayOfMonthIso(nextMonthDate.getUTCFullYear(), nextMonthDate.getUTCMonth() + 1, weekday, ordinalWeekday[1]);
}

function endOfMonthIso(monthOffset = 0) {
  const [yearText, monthText] = todayIso().split("-");
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) + monthOffset, 0));
  return date.toISOString().slice(0, 10);
}

function endOfQuarterIso(quarterOffset = 0) {
  const [yearText, monthText] = todayIso().split("-");
  const month = Number(monthText);
  const quarterEndMonth = Math.ceil(month / 3) * 3 + quarterOffset * 3;
  const date = new Date(Date.UTC(Number(yearText), quarterEndMonth, 0));
  return date.toISOString().slice(0, 10);
}

function endOfYearIso(yearOffset = 0) {
  const [yearText] = todayIso().split("-");
  return toIsoDate(Number(yearText) + yearOffset, 12, 31);
}

const monthIndexes: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const monthNamePattern =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const donnitLanguageLexicon = {
  taskCreationPhrases: [
    "add", "create", "make", "log", "capture", "track", "put", "remind me", "remember to",
    "I need to", "we need to", "need to", "have to", "should", "must", "please handle",
    "can you", "could you", "make sure", "don't forget", "follow up", "circle back",
    "close the loop", "take care of", "look into", "check on", "get done", "knock out",
  ],
  assignmentPhrases: [
    "assign", "delegate", "reassign", "route to", "hand off", "handoff", "transfer",
    "give this to", "put this on", "put this on their plate", "have {person} do",
    "get {person} to", "ask {person} to", "send this to {person} to handle",
  ],
  selfOwnedContactPhrases: [
    "call {person}", "email {person}", "message {person}", "text {person}", "slack {person}",
    "ping {person}", "follow up with {person}", "check in with {person}", "meet with {person}",
    "sync with {person}", "ask {person} about", "send {person} a note",
  ],
  urgencyPhrases: {
    critical: ["critical", "emergency", "blocker", "fire drill", "P0", "sev1", "immediately", "drop everything"],
    high: ["urgent", "asap", "high priority", "important", "P1", "time sensitive", "by EOD", "before close"],
    normal: ["normal", "standard", "regular priority", "not urgent", "no rush", "when you can"],
    low: ["low priority", "whenever", "someday", "backlog", "nice to have", "P3"],
  },
  timeAndDatePhrases: {
    today: ["today", "EOD", "COB", "close of business", "end of day", "EOB"],
    week: ["EOW", "end of week", "next week", "this week"],
    monthQuarterYear: ["EOM", "EOQ", "EOY", "month end", "quarter end", "year end"],
    relative: ["tomorrow", "next Monday", "this Friday", "morning", "afternoon", "evening", "noon", "midnight"],
  },
  recurrencePhrases: [
    "daily", "weekly", "monthly", "quarterly", "annually", "annual", "every day", "every week",
    "every month", "every quarter", "each quarter", "first Monday", "last Friday",
  ],
  privacyPhrases: {
    confidential: ["confidential", "sensitive", "privileged", "restricted", "private work"],
    personal: ["personal", "private", "non-work", "non work"],
  },
  businessAcronyms: {
    EOD: "end of day",
    EOB: "end of business day",
    COB: "close of business",
    EOW: "end of week",
    EOM: "end of month",
    EOQ: "end of quarter",
    EOY: "end of year",
    OOO: "out of office",
    PTO: "paid time off",
    RIF: "reduction in force",
    SOW: "statement of work",
    MSA: "master services agreement",
    NDA: "non-disclosure agreement",
    QBR: "quarterly business review",
    OKR: "objectives and key results",
    KPI: "key performance indicator",
    SLA: "service level agreement",
    RFP: "request for proposal",
    ROI: "return on investment",
    ARR: "annual recurring revenue",
    MRR: "monthly recurring revenue",
    CRM: "customer relationship management",
    ATS: "applicant tracking system",
  },
};

const donnitTaskExtractionPolicy = [
  "Extract one actionable Donnit task for a professional workplace continuity tool.",
  "Return only schema fields. Use null dueDate when no date is clear.",
  "Write a clean action title, not copied source text. Titles must not start with assignment boilerplate like 'Assign Jordan'.",
  "Ask-don't-guess policy: when the source is ambiguous, context-only, or missing a clear action, set shouldCreateTask=false or confidence=low so Donnit can ask a clarifying question.",
  "Ownership rule: only set assigneeHint when the user clearly assigns ownership using language like assign, delegate, reassign, route to, hand off, put on someone's plate, have/get/ask someone to do the work. If the user says call Maya, email Maya, ping Maya, meet with Maya, ask Maya about something, or follow up with Maya, Maya is the object/contact, not the task owner.",
  "If the text clearly assigns someone, put that person in assigneeHint and make the title the work itself.",
  "If multiple assignees could match a first name, keep the assigneeHint exactly as written and use medium confidence so the application can ask which teammate.",
  "If the user marks the task confidential, sensitive, privileged, or restricted, set visibility=confidential. If they mark it personal or private/non-work, set visibility=personal. Otherwise set visibility=work.",
  "Separate actual work from context. Pure FYI, shipment updates, newsletters, and status-only messages should set shouldCreateTask=false and taskType=context_only.",
  "Receipts and business purchases can be tasks when reconciliation or expense review is implied; write them like 'Reconcile ChatGPT expense ($55.00)'.",
  "Descriptions should explain the next step in one or two plain sentences.",
  "Extract structured timing. Use dueTime for a clear time like noon, 3pm, or 14:30. For meetings, calls, appointments, interviews, travel, or other fixed-time events, also set startTime and endTime. Use null time fields when the user only gives a date. Use isAllDay=true only when the user explicitly says all day.",
  "Use the exact time estimate if the user provides one. 1.5 hours is 90 minutes.",
  "Interpret common workplace shorthand and abbreviations. EOW means end of week, EOD/COB means today by end of day, EOM means end of month, EOQ means end of quarter, EOY means end of year, OOO means out of office, PTO means paid time off, RIF means reduction in force.",
  "Business phrases like close the loop, circle back, take care of, look into, check on, put on someone's plate, fire drill, blocker, QBR, OKR, KPI, SLA, RFP, SOW, MSA, NDA, ARR, MRR, CRM, and ATS should be interpreted as normal workplace language, not copied blindly into awkward task titles.",
  "When the user says 'not urgent' or 'no rush', set urgency=normal and do not include that phrase in the title.",
  "Use critical urgency only for past due, blocker, emergency, or explicit critical work.",
  "sourceExcerpt should be a short source quote or summary that explains why the task was suggested.",
  "For email input, set replyNeeded=true only when the sender appears to expect a response; replyIntent should explain the response goal in plain language. Receipts, newsletters, automated notices, and FYI messages usually do not need replies.",
];

function toIsoDate(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function parseNaturalDate(text: string) {
  const monthFirst = text.match(
    new RegExp(`\\b(?:due\\s+(?:on\\s+)?|by\\s+|before\\s+|on\\s+)?(${monthNamePattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d{2}|\\d{2}))?\\b`, "i"),
  );
  if (monthFirst) {
    const month = monthIndexes[monthFirst[1].toLowerCase().replace(".", "")];
    const day = Number(monthFirst[2]);
    const year = monthFirst[3]
      ? Number(monthFirst[3].length === 2 ? `20${monthFirst[3]}` : monthFirst[3])
      : new Date().getFullYear();
    return toIsoDate(year, month, day);
  }

  const dayFirst = text.match(
    new RegExp(`\\b(?:due\\s+(?:on\\s+)?|by\\s+|before\\s+|on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNamePattern})\\.?(?:,?\\s*(20\\d{2}|\\d{2}))?\\b`, "i"),
  );
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = monthIndexes[dayFirst[2].toLowerCase().replace(".", "")];
    const year = dayFirst[3]
      ? Number(dayFirst[3].length === 2 ? `20${dayFirst[3]}` : dayFirst[3])
      : new Date().getFullYear();
    return toIsoDate(year, month, day);
  }

  return null;
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
    return toIsoDate(year, Number(slashMatch[1]), Number(slashMatch[2]));
  }
  const natural = parseNaturalDate(text);
  if (natural) return natural;
  const monthlyOrdinal = parseMonthlyOrdinalWeekdayDueDate(message);
  if (monthlyOrdinal) return monthlyOrdinal;
  if (/\b(?:eod|eob|cob|close of business|end of business|end of day)\b/.test(text)) return todayIso();
  if (/\b(?:next\s+eow|next\s+end of week|end of next week)\b/.test(text)) return nextWeekdayIso(5, true);
  if (/\b(?:eow|end of week)\b/.test(text)) return nextWeekdayIso(5);
  if (/\b(?:next\s+eom|next\s+end of month|end of next month)\b/.test(text)) return endOfMonthIso(1);
  if (/\b(?:eom|end of month)\b/.test(text)) return endOfMonthIso();
  if (/\b(?:next\s+eoq|next\s+end of quarter|end of next quarter)\b/.test(text)) return endOfQuarterIso(1);
  if (/\b(?:eoq|end of quarter)\b/.test(text)) return endOfQuarterIso();
  if (/\b(?:next\s+eoy|next\s+end of year|end of next year)\b/.test(text)) return endOfYearIso(1);
  if (/\b(?:eoy|end of year)\b/.test(text)) return endOfYearIso();
  if (text.includes("today")) return todayIso();
  if (text.includes("tomorrow")) return addDays(1);
  if (text.includes("next week")) return addDays(7);
  const weekdayMatch = text.match(/\b(?:(next|this)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (weekdayMatch) {
    return nextWeekdayIso(weekdayIndexes[weekdayMatch[2]], weekdayMatch[1] === "next");
  }
  if (text.includes("this week")) return addDays(3);
  return null;
}

function normalizeTimeOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addMinutesToTime(value: string, minutes: number) {
  const normalized = normalizeTimeOnly(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(":").map(Number);
  const total = Math.min(Math.max(hour * 60 + minute + Math.max(minutes, 5), 0), 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function clockTimeFromMatch(hourRaw: string, minuteRaw: string | undefined, meridiemRaw: string | undefined) {
  let hour = Number(hourRaw);
  const minute = minuteRaw ? Number(minuteRaw) : 0;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const meridiem = meridiemRaw?.toLowerCase().replace(/\./g, "");
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
  if (hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTaskTime(message: string, estimatedMinutes = 30) {
  const text = message.toLowerCase();
  const isAllDay = /\b(all day|all-day)\b/.test(text);
  if (isAllDay) {
    return { dueTime: null, startTime: null, endTime: null, isAllDay: true };
  }

  const range = text.match(
    /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i,
  );
  if (range) {
    const endTime = clockTimeFromMatch(range[4], range[5], range[6]);
    const startMeridiem = range[3] ?? range[6];
    const startTime = clockTimeFromMatch(range[1], range[2], startMeridiem);
    if (startTime && endTime) return { dueTime: startTime, startTime, endTime, isAllDay: false };
  }

  const namedTime = text.match(/\b(?:at|@|by|before|around)?\s*(noon|midnight)\b/i);
  const explicit = text.match(/\b(?:at|@|by|before|around)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  const inferred =
    !namedTime && !explicit
      ? text.match(/\b(morning|afternoon|evening)\b/i)
      : null;
  const dueTime = namedTime
    ? namedTime[1].toLowerCase() === "noon"
      ? "12:00"
      : "00:00"
    : explicit
      ? clockTimeFromMatch(explicit[1], explicit[2], explicit[3])
      : inferred
        ? inferred[1].toLowerCase() === "morning"
          ? "09:00"
          : inferred[1].toLowerCase() === "afternoon"
            ? "13:00"
            : "17:00"
        : null;
  const isFixedEvent =
    Boolean(dueTime) &&
    /\b(meeting|meet|appointment|interview|demo|event|call|train|flight|travel|drive|go to|attend)\b/.test(text) &&
    !/\b(by|before|deadline|due)\b/.test(text);
  return {
    dueTime,
    startTime: isFixedEvent && dueTime ? dueTime : null,
    endTime: isFixedEvent && dueTime ? addMinutesToTime(dueTime, estimatedMinutes) : null,
    isAllDay: false,
  };
}

function isPastDue(dueDate: string | null) {
  return Boolean(dueDate && dueDate < todayIso());
}

function dueDateAssistantText(dueDate: string | null) {
  if (!dueDate) return "";
  return isPastDue(dueDate) ? ` Due ${dueDate} (past due).` : ` Due ${dueDate}.`;
}

function parseUrgency(message: string): "low" | "normal" | "high" | "critical" {
  const text = message.toLowerCase();
  if (/\b(?:not urgent|not high priority|no rush|not a rush|when you can|regular priority|standard priority)\b/.test(text)) return "normal";
  if (/\b(?:critical|emergency|blocker|fire drill|drop everything|immediately|sev\s*1|p0)\b/.test(text)) return "critical";
  if (/\b(?:urgent|asap|high priority|important|time sensitive|before close|p1|eod|cob|eob)\b/.test(text)) return "high";
  if (/\b(?:low priority|whenever|someday|backlog|nice to have|p3)\b/.test(text)) return "low";
  return "normal";
}

function parseExplicitUrgency(message: string): "low" | "normal" | "high" | "critical" | null {
  const text = message.toLowerCase();
  if (/\b(?:not urgent|not high priority|no rush|not a rush|when you can|regular priority|standard priority)\b/.test(text)) return "normal";
  if (/\b(?:critical|emergency|blocker|fire drill|drop everything|immediately|sev\s*1|p0)\b/.test(text)) return "critical";
  if (/\b(?:urgent|asap|high priority|high urgency|highly urgent|\bhigh\b|important|time sensitive|p1)\b/.test(text)) return "high";
  if (/\b(?:low priority|whenever|someday|backlog|nice to have|p3)\b/.test(text)) return "low";
  if (/\b(normal|medium|standard|regular priority|p2)\b/.test(text)) return "normal";
  return null;
}

function parseEstimate(message: string) {
  const minutes = message.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:min|mins|minutes)\b/i);
  if (minutes) return Math.max(5, Math.round(Number(minutes[1])));
  const hours = message.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours)\b/i);
  if (hours) return Math.max(15, Math.round(Number(hours[1]) * 60));
  if (/\bquick|small|simple|brief|ping|reply|respond|check in|sync\b/i.test(message)) return 15;
  if (/\breview|audit|analyze|draft|prepare|proposal|contract|sow|msa|nda|invoice|reconcile\b/i.test(message)) return 45;
  if (/\bplan|strategy|roadmap|report|presentation|deck|onboarding|qbr|okr|budget|forecast\b/i.test(message)) return 60;
  return 30;
}

function parseTaskVisibility(message: string): "work" | "personal" | "confidential" {
  const text = message.toLowerCase();
  if (/\b(confidential|sensitive|privileged|private work|restricted|need to know|attorney client)\b/.test(text)) return "confidential";
  if (/\b(personal|private|non-work|non work)\b/.test(text)) return "personal";
  return "work";
}

function assigneeAliases(name?: string | null, email?: string | null) {
  const aliases = new Set<string>();
  const normalizedName = (name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedEmail = (email ?? "").toLowerCase().trim();
  if (normalizedName) {
    aliases.add(normalizedName);
    for (const part of normalizedName.split(" ")) {
      if (part.length > 1) aliases.add(part);
    }
  }
  if (normalizedEmail) {
    aliases.add(normalizedEmail);
    const [prefix] = normalizedEmail.split("@");
    if (prefix && prefix.length > 1) aliases.add(prefix);
  }
  return Array.from(aliases).filter(Boolean);
}

function textMentionsAssignee(text: string, name?: string | null, email?: string | null) {
  const normalized = text.toLowerCase();
  const tokens = new Set(normalized.match(/[a-z0-9._%+-]+/g) ?? []);
  return assigneeAliases(name, email).some((alias) => {
    if (alias.includes("@")) return normalized.includes(alias);
    return tokens.has(alias) || normalized.includes(`@${alias}`);
  });
}

function assigneeMentionScore(text: string, name?: string | null, email?: string | null) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const tokens = new Set(normalized.match(/[a-z0-9._%+-]+/g) ?? []);
  const normalizedName = (name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedEmail = (email ?? "").toLowerCase().trim();
  let score = 0;
  if (normalizedEmail && (normalized.includes(normalizedEmail) || tokens.has(normalizedEmail))) score += 8;
  if (normalizedName && normalized.includes(normalizedName)) score += 6;
  const nameParts = normalizedName.split(" ").filter((part) => part.length > 1);
  if (nameParts[0] && tokens.has(nameParts[0])) score += 1;
  if (nameParts.length > 1 && tokens.has(nameParts[nameParts.length - 1])) score += 3;
  return score;
}

function findBestMentionedCandidates<T>(
  message: string,
  candidates: T[],
  getName: (candidate: T) => string | null | undefined,
  getEmail: (candidate: T) => string | null | undefined,
) {
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: assigneeMentionScore(message, getName(candidate), getEmail(candidate)),
    }))
    .filter((item) => item.score > 0);
  const topScore = Math.max(0, ...scored.map((item) => item.score));
  return scored.filter((item) => item.score === topScore).map((item) => item.candidate);
}

function findAssignee(message: string, users: User[]) {
  if (!hasExplicitAssignmentIntent(message)) return users.find((user) => user.id === DEMO_USER_ID) ?? users[0];
  const explicitCandidates = findBestMentionedCandidates(message, users, (user) => user.name, (user) => user.email);
  const explicit = explicitCandidates.length === 1 ? explicitCandidates[0] : null;
  if (explicit) return explicit;
  const named = users.find((user) => user.id !== DEMO_USER_ID && textMentionsAssignee(message.toLowerCase(), user.name, user.email));
  return named ?? users.find((user) => user.id === DEMO_USER_ID) ?? users[0];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripAssigneePhrases(message: string, assigneeLabels: string[]) {
  let cleaned = message;
  for (const label of assigneeLabels) {
    const safe = escapeRegExp(label.trim());
    if (!safe) continue;
    cleaned = cleaned
      .replace(new RegExp(`\\bassign(?: this)?(?: a)?(?: task)?\\s+to\\s+${safe}\\b`, "gi"), "")
      .replace(new RegExp(`\\bassign\\s+${safe}\\b`, "gi"), "")
      .replace(new RegExp(`\\bdelegate(?: this)?(?: a)?(?: task)?\\s+to\\s+${safe}\\b`, "gi"), "")
      .replace(new RegExp(`\\bdelegate\\s+${safe}\\b`, "gi"), "")
      .replace(new RegExp(`\\breassign(?: this)?(?: a)?(?: task)?\\s+to\\s+${safe}\\b`, "gi"), "")
      .replace(new RegExp(`\\breassign\\s+${safe}\\b`, "gi"), "")
      .replace(new RegExp(`\\b(?:route|transfer|hand\\s*off|handoff)(?: this)?(?: task)?\\s+to\\s+${safe}\\b`, "gi"), "")
      .replace(new RegExp(`\\b(?:give|send)(?: this)?(?: task)?\\s+to\\s+${safe}\\b`, "gi"), "")
      .replace(new RegExp(`\\bput\\s+(?:this|it)?\\s*(?:on\\s+)?${safe}(?:'s)?\\s+plate\\b`, "gi"), "")
      .replace(new RegExp(`\\b(?:have|get|ask)\\s+${safe}\\s+to\\b`, "gi"), "")
      .replace(new RegExp(`\\bfor\\s+${safe}\\b`, "gi"), "")
      .replace(new RegExp(`@${safe}\\b`, "gi"), "");
  }
  return cleaned;
}

function stripLeadingUnknownAssignee(message: string) {
  const words = message.trim().split(/\s+/);
  if (words.length < 4) return message;
  const command = words[0]?.toLowerCase();
  if (!["assign", "delegate", "reassign"].includes(command)) return message;
  if (words[1]?.toLowerCase() === "to") return message;

  const actionHints = new Set([
    "urgent",
    "critical",
    "quick",
    "review",
    "audit",
    "analyze",
    "draft",
    "prepare",
    "follow",
    "call",
    "email",
    "reconcile",
    "schedule",
    "update",
    "complete",
    "send",
    "confirm",
  ]);
  const second = words[1] ?? "";
  const third = words[2]?.toLowerCase() ?? "";
  const looksLikeName =
    /^[A-Z][A-Za-z'’-]{1,40}$/.test(second) ||
    (!actionHints.has(second.toLowerCase()) && actionHints.has(third));

  return looksLikeName ? words.slice(2).join(" ") : message;
}

function titleFromMessage(message: string, assigneeLabels: string[] = []) {
  const naturalDate = new RegExp(
    `\\b(?:due\\s+(?:on\\s+)?|by\\s+|before\\s+|on\\s+)?(?:${monthNamePattern})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*(?:20\\d{2}|\\d{2}))?\\b`,
    "gi",
  );
  const naturalDateDayFirst = new RegExp(
    `\\b(?:due\\s+(?:on\\s+)?|by\\s+|before\\s+|on\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${monthNamePattern})\\.?(?:,?\\s*(?:20\\d{2}|\\d{2}))?\\b`,
    "gi",
  );
  const cleaned = message
    .replace(/\b(?:confidential|sensitive|privileged|restricted|personal|private|non-work|non work)\b/gi, "")
    .replace(/\bfor me (?:thats|that's|that is)\b/gi, "")
    .replace(/^(?:for me|me)\b[,\s:]*/gi, "")
    .replace(/\bfor me to\s+/gi, "")
    .replace(/\bfor me\b/gi, "")
    .replace(/\b(?:has|have|had)\s+(?:a\s+)?(?:recurring|reoccurring|reoccuring|reouccring)\s+(?:task|todo|to-do|responsibility)\s+(?:to\s+)?/gi, "")
    .replace(/\b(?:a\s+)?(?:recurring|reoccurring|reoccuring|reouccring)\s+(?:task|todo|to-do|responsibility)\s+(?:to\s+)?/gi, "")
    .replace(/\b(?:please\s+)?(?:add|create|make|log|capture|track)\s+(?:a\s+)?(?:task|todo|to-do|reminder)?\s*(?:to\s+)?/gi, "")
    .replace(/\b(?:remind me|reminder)\s+to\s+/gi, "")
    .replace(/\b(?:remember|don't forget)\s+to\s+/gi, "")
    .replace(/\b(?:i need|we need|need|needs|need to|have to|should|must)\s+/gi, "")
    .replace(/\b(?:please\s+)?(?:handle|take care of|look into|check on|close the loop on|circle back on|knock out)\s+/gi, "")
    .replace(/\b(?:this\s+is\s+)?(?:not urgent|not high priority|no rush|not a rush)\b/gi, "")
    .replace(/\b(?:due|by|before|on)\s+(?:20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/gi, "")
    .replace(/\b(?:due|by|before|on)\s+(?:eod|eob|cob|close of business|end of business|end of day|eow|end of week|end of next week|eom|end of month|end of next month|eoq|end of quarter|end of next quarter|eoy|end of year|end of next year)\b/gi, "")
    .replace(naturalDate, "")
    .replace(naturalDateDayFirst, "")
    .replace(/\b(?:due|by|before|on)\s+(?:today|tomorrow|next week|this week)\b/gi, "")
    .replace(/\b(?:at|@|by|before|around)\s+(?:noon|midnight)\b/gi, "")
    .replace(/\b(?:at|@|by|before|around)\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi, "")
    .replace(/\b(?:the\s+)?(?:first|second|third|fourth|last)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:of\s+)?(?:every|each|the)?\s*month\b/gi, "")
    .replace(/\b(?:every|each)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
    .replace(/\b(?:every|each)\s+(?:month|quarter|year)\b/gi, "")
    .replace(/\b(?:due|by|before|on)?\s*(?:(?:next|this)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
    .replace(/\b(today|tomorrow|next week|this week|eod|eob|cob|close of business|end of business|end of day|eow|end of week|end of next week|eom|end of month|end of next month|eoq|end of quarter|end of next quarter|eoy|end of year|end of next year|urgent|asap|critical|high priority|low priority|time sensitive|fire drill)\b/gi, "")
    .replace(/\bby\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/gi, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:min|mins|minutes|hr|hrs|hour|hours)\b/gi, "")
    .replace(/\b\d+\s*days?\s*before\b/gi, "")
    .replace(/\b(?:normal|medium|high|low)\s+(?:urgency|priority)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(add|create|make|log|please|task to|todo to|to-do to)\s+/i, "")
    .slice(0, 150);
  const withoutAssignee = stripLeadingUnknownAssignee(stripAssigneePhrases(cleaned, assigneeLabels))
    .replace(/\s+/g, " ")
    .replace(/^(?:please\s+)?(?:assign|delegate|reassign)\s+(?:this\s+)?(?:task\s+)?(?:to\s+)?/i, "")
    .replace(/\b(?:,?\s*this\s+is\s+not|,?\s*not)\s*$/i, "")
    .replace(/^to\s+/i, "")
    .replace(/^[,.:;-\s]+|[,.:;-\s]+$/g, "")
    .trim();
  return withoutAssignee
    ? withoutAssignee.charAt(0).toUpperCase() + withoutAssignee.slice(1)
    : withoutAssignee;
}

function parseAnnualReminderDays(message: string) {
  const text = message.toLowerCase();
  const days = text.match(/(\d+)\s*days?\s*before/);
  if (days) return Number(days[1]);
  return text.includes("birthday") || text.includes("anniversary") || text.includes("annual") ? 15 : 0;
}

function parseTaskRecurrence(message: string): DonnitTask["recurrence"] {
  const text = message.toLowerCase();
  if (/\b(?:every day|each day|daily|weekday|weekdays)\b/.test(text)) return "daily";
  if (/\b(?:every year|each year|yearly|annually|annual|birthday|anniversary)\b/.test(text)) return "annual";
  if (/\b(?:every quarter|each quarter|quarterly|quarter end|eoq|qbr|q[1-4])\b/.test(text)) return "quarterly";
  if (/\b(?:every month|each month|monthly|month end|eom|(?:first|second|third|fourth|last)\s+\w+\s+(?:of\s+)?(?:every|each|the)?\s*month)\b/.test(text)) {
    return "monthly";
  }
  if (/\b(?:every week|each week|weekly|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)\b/.test(text)) {
    return "weekly";
  }
  return "none";
}

function recurrenceDetailsFromMessage(message: string, recurrence: DonnitTask["recurrence"], dueDate: string | null) {
  if (recurrence === "none") return "";
  const text = message.toLowerCase();
  const weekday = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/i)?.[1];
  const ordinalWeekday = text.match(/\b(first|second|third|fourth|last)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (ordinalWeekday && recurrence === "monthly") return `${titleCase(ordinalWeekday[1])} ${titleCase(ordinalWeekday[2])} of every month`;
  if (ordinalWeekday) return `${titleCase(ordinalWeekday[1])} ${titleCase(ordinalWeekday[2])}`;
  if (weekday && recurrence === "weekly") return `Every ${titleCase(weekday)}`;
  if (/\b(?:weekday|weekdays)\b/i.test(message)) return "Every weekday";
  if (/\b(?:month end|eom)\b/i.test(message)) return "End of each month";
  if (/\b(?:quarter end|eoq)\b/i.test(message)) return "End of each quarter";
  if (dueDate) {
    const parsed = new Date(`${dueDate}T12:00:00Z`);
    if (Number.isFinite(parsed.getTime())) {
      const weekdayName = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(parsed);
      const monthDay = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(parsed);
      if (recurrence === "weekly") return `Every ${weekdayName}`;
      if (recurrence === "monthly") return `Monthly around the ${parsed.getUTCDate()}${daySuffix(parsed.getUTCDate())}`;
      if (recurrence === "quarterly") return `Quarterly around ${monthDay}`;
      if (recurrence === "annual") return `Every year on ${monthDay}`;
    }
  }
  return titleCase(recurrence);
}

function descriptionWithServerRepeatDetails(description: string, repeatDetails: string) {
  const cleaned = description.trim();
  const repeat = repeatDetails.trim();
  if (!repeat || /Repeat details:/i.test(cleaned)) return cleaned;
  return `${cleaned}${cleaned ? "\n\n" : ""}Repeat details: ${repeat}`;
}

function daySuffix(day: number) {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseChatTask(message: string, users: User[]): InsertTask {
  const assignee = findAssignee(message, users);
  const reminderDaysBefore = parseAnnualReminderDays(message);
  const recurrence = parseTaskRecurrence(message);
  const assignedToId = assignee?.id ?? DEMO_USER_ID;
  const assignedById = DEMO_USER_ID;
  const title = titleFromMessage(message, assigneeAliases(assignee?.name, assignee?.email)) || "Untitled task";
  const dueDate = parseDueDate(message);
  const urgency = isPastDue(dueDate) ? "critical" : parseUrgency(message);
  const estimatedMinutes = parseEstimate(message);
  const timing = parseTaskTime(message, estimatedMinutes);

  return {
    title,
    description: descriptionWithServerRepeatDetails(message, recurrenceDetailsFromMessage(message, recurrence, dueDate)),
    status: assignedToId === assignedById ? "open" : "pending_acceptance",
    urgency,
    dueDate,
    dueTime: timing.dueTime,
    startTime: timing.startTime,
    endTime: timing.endTime,
    isAllDay: timing.isAllDay,
    estimatedMinutes,
    assignedToId,
    assignedById,
    source: "chat",
    recurrence,
    reminderDaysBefore,
    visibility: parseTaskVisibility(message),
  };
}

function sortTasks<T extends { status: string; dueDate: string | null; urgency: string }>(tasks: T[]): T[] {
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
  startAt: string | null;
  endAt: string | null;
  timeZone: string;
  scheduleStatus: "scheduled" | "unscheduled";
};

type CalendarBusyBlock = {
  date: string;
  startMinute: number;
  endMinute: number;
};

const DEFAULT_CALENDAR_TIME_ZONE = DEFAULT_DONNIT_TIME_ZONE;
const SCHEDULE_HORIZON_DAYS = 14;

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

type AgendaSchedule = {
  autoBuildEnabled: boolean;
  buildTime: string;
  lastAutoBuildDate: string | null;
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

const DEFAULT_AGENDA_SCHEDULE: AgendaSchedule = {
  autoBuildEnabled: false,
  buildTime: "07:30",
  lastAutoBuildDate: null,
};

function parseClockMinute(value: unknown, fallback: string) {
  const raw = typeof value === "string" ? value : fallback;
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return parseClockMinute(fallback, "09:00");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return parseClockMinute(fallback, "09:00");
  }
  return hour * 60 + minute;
}

function formatClockMinute(minute: number) {
  const clamped = Math.min(Math.max(Math.round(minute), 0), 23 * 60 + 59);
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

function cleanAgendaPreference(value: unknown, fallback: AgendaPreference): AgendaPreference {
  return value === "deep_work" || value === "communications" || value === "mixed" ? value : fallback;
}

function cleanAgendaPreferences(value: unknown): AgendaPreferences {
  const input = (value ?? {}) as Record<string, unknown>;
  const workdayStartMinute = parseClockMinute(input.workdayStart, DEFAULT_AGENDA_PREFERENCES.workdayStart);
  const fallbackEndMinute = parseClockMinute(DEFAULT_AGENDA_PREFERENCES.workdayEnd, DEFAULT_AGENDA_PREFERENCES.workdayEnd);
  const rawEndMinute = parseClockMinute(input.workdayEnd, DEFAULT_AGENDA_PREFERENCES.workdayEnd);
  const workdayEndMinute = rawEndMinute > workdayStartMinute + 60 ? rawEndMinute : fallbackEndMinute;
  return {
    workdayStart: formatClockMinute(workdayStartMinute),
    workdayEnd: formatClockMinute(workdayEndMinute),
    lunchStart: formatClockMinute(parseClockMinute(input.lunchStart, DEFAULT_AGENDA_PREFERENCES.lunchStart)),
    lunchMinutes: clampNumber(input.lunchMinutes, DEFAULT_AGENDA_PREFERENCES.lunchMinutes, 0, 120),
    meetingBufferMinutes: clampNumber(input.meetingBufferMinutes, DEFAULT_AGENDA_PREFERENCES.meetingBufferMinutes, 0, 45),
    minimumBlockMinutes: clampNumber(input.minimumBlockMinutes, DEFAULT_AGENDA_PREFERENCES.minimumBlockMinutes, 5, 60),
    focusBlockMinutes: clampNumber(input.focusBlockMinutes, DEFAULT_AGENDA_PREFERENCES.focusBlockMinutes, 30, 180),
    morningPreference: cleanAgendaPreference(input.morningPreference, DEFAULT_AGENDA_PREFERENCES.morningPreference),
    afternoonPreference: cleanAgendaPreference(input.afternoonPreference, DEFAULT_AGENDA_PREFERENCES.afternoonPreference),
  };
}

function cleanAgendaSchedule(value: unknown): AgendaSchedule {
  const input = (value ?? {}) as Record<string, unknown>;
  const buildTime = typeof input.buildTime === "string" && /^\d{1,2}:\d{2}$/.test(input.buildTime)
    ? input.buildTime
    : DEFAULT_AGENDA_SCHEDULE.buildTime;
  return {
    autoBuildEnabled: input.autoBuildEnabled === true,
    buildTime,
    lastAutoBuildDate: typeof input.lastAutoBuildDate === "string" ? input.lastAutoBuildDate : null,
  };
}

function inferAgendaMode(task: { title: string; estimatedMinutes: number }, preferences: AgendaPreferences): AgendaPreference {
  const title = task.title.toLowerCase();
  if (/(email|reply|follow[- ]?up|call|slack|message|inbox|check in|respond)/i.test(title)) {
    return "communications";
  }
  if (task.estimatedMinutes >= preferences.focusBlockMinutes || /(draft|review|plan|roadmap|report|contract|analysis|build|prepare)/i.test(title)) {
    return "deep_work";
  }
  return "mixed";
}

function scoreAgendaSlot(
  task: { title: string; estimatedMinutes: number; urgency: string },
  slot: { startMinute: number; endMinute: number },
  preferences: AgendaPreferences,
) {
  const mode = inferAgendaMode(task, preferences);
  const half = slot.startMinute < 12 * 60 ? "morning" : "afternoon";
  const preferred = half === "morning" ? preferences.morningPreference : preferences.afternoonPreference;
  let score = 0;
  if (preferred === mode) score += 30;
  if (preferred === "mixed") score += 10;
  if ((urgencyRank[task.urgency] ?? 2) <= 1) score += Math.max(0, 18 - Math.floor((slot.startMinute - 8 * 60) / 30));
  score += Math.max(0, 8 - Math.floor((slot.endMinute - slot.startMinute - task.estimatedMinutes) / 30));
  return score;
}

function addOneDayIso(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setDate(parsed.getDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function addDaysIso(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function addMonthsIso(date: string, months: number) {
  const [yearText, monthText, dayText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return date;
  const firstOfTarget = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = firstOfTarget.getUTCFullYear();
  const targetMonth = firstOfTarget.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

function formatDateTimeLocal(date: string, minute: number) {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
}

function timeToMinute(value: string | null | undefined) {
  const normalized = normalizeTimeOnly(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(":").map(Number);
  return hour * 60 + minute;
}

function getZonedParts(value: Date | string, timeZone: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minute: hour * 60 + minute,
  };
}

function calendarEventIdFromInput(input: string) {
  return `donnit${crypto.createHash("sha1").update(input).digest("hex").slice(0, 24)}`;
}

function calendarEventIdForAgendaItem(item: AgendaItem) {
  return calendarEventIdFromInput(String(item.taskId));
}

function hasOAuthScope(scope: string | null | undefined, target: string) {
  return Boolean(scope?.split(/\s+/).includes(target));
}

function legacyCalendarEventIdForAgendaItem(item: AgendaItem) {
  return calendarEventIdFromInput(`${item.taskId}:${item.dueDate ?? "today"}`);
}

function cloneBusyByDate(busyByDate: Map<string, CalendarBusyBlock[]>) {
  return new Map(
    Array.from(busyByDate.entries()).map(([date, blocks]) => [
      date,
      blocks.map((block: CalendarBusyBlock) => ({ ...block })),
    ]),
  );
}

function getFreeSlotsForDate(date: string, busyByDate: Map<string, CalendarBusyBlock[]>, preferences = DEFAULT_AGENDA_PREFERENCES) {
  const workdayStartMinute = parseClockMinute(preferences.workdayStart, DEFAULT_AGENDA_PREFERENCES.workdayStart);
  const workdayEndMinute = parseClockMinute(preferences.workdayEnd, DEFAULT_AGENDA_PREFERENCES.workdayEnd);
  const buffer = preferences.meetingBufferMinutes;
  const lunchStartMinute = parseClockMinute(preferences.lunchStart, DEFAULT_AGENDA_PREFERENCES.lunchStart);
  const syntheticBusy: CalendarBusyBlock[] = preferences.lunchMinutes > 0
    ? [{ date, startMinute: lunchStartMinute, endMinute: lunchStartMinute + preferences.lunchMinutes }]
    : [];
  const busy = [...(busyByDate.get(date) ?? []), ...syntheticBusy]
    .map((block) => ({
      startMinute: Math.max(workdayStartMinute, block.startMinute - buffer),
      endMinute: Math.min(workdayEndMinute, block.endMinute + buffer),
    }))
    .filter((block) => block.endMinute > workdayStartMinute && block.startMinute < workdayEndMinute)
    .sort((a, b) => a.startMinute - b.startMinute);
  const slots: Array<{ startMinute: number; endMinute: number }> = [];
  let cursor = workdayStartMinute;
  for (const block of busy) {
    if (block.startMinute > cursor) {
      slots.push({ startMinute: cursor, endMinute: block.startMinute });
    }
    cursor = Math.max(cursor, block.endMinute);
  }
  if (cursor < workdayEndMinute) {
    slots.push({ startMinute: cursor, endMinute: workdayEndMinute });
  }
  return slots;
}

function scheduleTasks<T extends {
  id: string | number;
  title: string;
  estimatedMinutes: number;
  dueDate: string | null;
  dueTime?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  isAllDay?: boolean;
  urgency: string;
  status: string;
}>(
  tasks: T[],
  busyByDate: Map<string, CalendarBusyBlock[]> = new Map(),
  options: { timeZone?: string; today?: string; preferences?: AgendaPreferences; presorted?: boolean } = {},
): AgendaItem[] {
  const timeZone = options.timeZone ?? DEFAULT_CALENDAR_TIME_ZONE;
  const preferences = cleanAgendaPreferences(options.preferences ?? DEFAULT_AGENDA_PREFERENCES);
  const today = options.today ?? getZonedParts(new Date(), timeZone).date;
  const mutableBusy = cloneBusyByDate(busyByDate);
  const candidates = (options.presorted ? [...tasks] : sortTasks(tasks)).filter(
    (task) => task.status !== "completed" && task.status !== "denied",
  );
  const workdayStartMinute = parseClockMinute(preferences.workdayStart, DEFAULT_AGENDA_PREFERENCES.workdayStart);
  const workdayEndMinute = parseClockMinute(preferences.workdayEnd, DEFAULT_AGENDA_PREFERENCES.workdayEnd);
  const workdayMinutes = Math.max(workdayEndMinute - workdayStartMinute, 60);
  const agendaByTaskId = new Map<string, AgendaItem>();

  candidates.forEach((task, index) => {
    if (!task.dueDate || task.isAllDay) return;
    const fixedStart = timeToMinute(task.startTime ?? task.dueTime ?? null);
    if (fixedStart === null) return;
    const fixedEnd = timeToMinute(task.endTime) ?? fixedStart + Math.min(Math.max(task.estimatedMinutes, 5), workdayMinutes);
    const endMinute = Math.min(Math.max(fixedEnd, fixedStart + 5), 23 * 60 + 59);
    mutableBusy.set(task.dueDate, [
      ...(mutableBusy.get(task.dueDate) ?? []),
      { date: task.dueDate, startMinute: fixedStart, endMinute },
    ]);
    agendaByTaskId.set(String(task.id), {
      taskId: task.id,
      order: index + 1,
      title: task.title,
      estimatedMinutes: Math.max(endMinute - fixedStart, 5),
      dueDate: task.dueDate,
      urgency: task.urgency,
      startAt: formatDateTimeLocal(task.dueDate, fixedStart),
      endAt: formatDateTimeLocal(task.dueDate, endMinute),
      timeZone,
      scheduleStatus: "scheduled" as const,
    });
  });

  return candidates.map((task, index) => {
    const fixed = agendaByTaskId.get(String(task.id));
    if (fixed) return fixed;
    const estimate = Math.min(Math.max(task.estimatedMinutes, preferences.minimumBlockMinutes, 5), workdayMinutes);
    const firstDate = task.dueDate && task.dueDate >= today ? task.dueDate : today;
    for (let offset = 0; offset < SCHEDULE_HORIZON_DAYS; offset += 1) {
      const date = addDaysIso(firstDate, offset);
      const slot = getFreeSlotsForDate(date, mutableBusy, preferences)
        .filter((free) => free.endMinute - free.startMinute >= estimate)
        .sort((a, b) => scoreAgendaSlot({ ...task, estimatedMinutes: estimate }, b, preferences) - scoreAgendaSlot({ ...task, estimatedMinutes: estimate }, a, preferences))[0];
      if (!slot) continue;
      const startMinute = slot.startMinute;
      const endMinute = startMinute + estimate;
      const scheduledBlock = { date, startMinute, endMinute };
      mutableBusy.set(date, [...(mutableBusy.get(date) ?? []), scheduledBlock]);
      return {
        taskId: task.id,
        order: index + 1,
        title: task.title,
        estimatedMinutes: estimate,
        dueDate: task.dueDate,
        urgency: task.urgency,
        startAt: formatDateTimeLocal(date, startMinute),
        endAt: formatDateTimeLocal(date, endMinute),
        timeZone,
        scheduleStatus: "scheduled" as const,
      };
    }
    return {
      taskId: task.id,
      order: index + 1,
      title: task.title,
      estimatedMinutes: estimate,
      dueDate: task.dueDate,
      urgency: task.urgency,
      startAt: null,
      endAt: null,
      timeZone,
      scheduleStatus: "unscheduled" as const,
    };
  });
}

function buildAgenda<T extends {
  id: string | number;
  title: string;
  estimatedMinutes: number;
  dueDate: string | null;
  dueTime?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  isAllDay?: boolean;
  urgency: string;
  status: string;
}>(tasks: T[], busyByDate: Map<string, CalendarBusyBlock[]> = new Map(), timeZone = DEFAULT_CALENDAR_TIME_ZONE, preferences = DEFAULT_AGENDA_PREFERENCES): AgendaItem[] {
  return scheduleTasks(tasks, busyByDate, { timeZone, preferences });
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
    dueTime: normalizeTimeOnly(task.due_time),
    startTime: normalizeTimeOnly(task.start_time),
    endTime: normalizeTimeOnly(task.end_time),
    isAllDay: task.is_all_day ?? false,
    estimatedMinutes: task.estimated_minutes,
    assignedToId: task.assigned_to,
    assignedById: task.assigned_by,
    delegatedToId: task.delegated_to,
    collaboratorIds: task.collaborator_ids ?? [],
    source: task.source,
    recurrence: task.recurrence,
    reminderDaysBefore: task.reminder_days_before,
    positionProfileId: (task as { position_profile_id?: string | null }).position_profile_id ?? null,
    visibility: (task as { visibility?: string }).visibility ?? "work",
    visibleFrom: (task as { visible_from?: string | null }).visible_from ?? null,
    acceptedAt: task.accepted_at,
    deniedAt: task.denied_at,
    completedAt: task.completed_at,
    completionNotes: task.completion_notes,
    createdAt: task.created_at,
  };
}

function toClientTaskSubtask(subtask: DonnitTaskSubtask) {
  return {
    id: subtask.id,
    taskId: subtask.task_id,
    title: subtask.title,
    done: subtask.status === "completed",
    position: subtask.position,
    completedAt: subtask.completed_at,
    createdAt: subtask.created_at,
  };
}

function toClientTaskTemplate(template: DonnitTaskTemplate) {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    triggerPhrases: Array.isArray(template.trigger_phrases) ? template.trigger_phrases : [],
    defaultUrgency: template.default_urgency,
    defaultEstimatedMinutes: template.default_estimated_minutes,
    defaultRecurrence: template.default_recurrence,
    createdBy: template.created_by,
    createdAt: template.created_at,
    updatedAt: template.updated_at,
    subtasks: (template.subtasks ?? []).map((subtask) => ({
      id: subtask.id,
      templateId: subtask.template_id,
      title: subtask.title,
      position: subtask.position,
      createdAt: subtask.created_at,
    })),
  };
}

function toClientEmailSuggestion(s: DonnitEmailSuggestion) {
  return {
    id: s.id,
    gmailMessageId: s.gmail_message_id,
    gmailThreadId: s.gmail_thread_id ?? null,
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
    replySuggested: Boolean(s.reply_suggested),
    replyDraft: s.reply_draft ?? null,
    replyStatus: s.reply_status ?? "none",
    replySentAt: s.reply_sent_at ?? null,
    replyProviderMessageId: s.reply_provider_message_id ?? null,
    createdAt: s.created_at,
  };
}

function toClientPositionProfile(profile: DonnitPositionProfile) {
  return {
    id: profile.id,
    title: profile.title,
    status: profile.status,
    currentOwnerId: profile.current_owner_id,
    directManagerId: profile.direct_manager_id,
    temporaryOwnerId: profile.temporary_owner_id,
    delegateUserId: profile.delegate_user_id,
    delegateUntil: profile.delegate_until,
    autoUpdateRules: profile.auto_update_rules ?? {},
    institutionalMemory: profile.institutional_memory ?? {},
    riskScore: profile.risk_score,
    riskSummary: profile.risk_summary,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

type ClientTaskShape = ReturnType<typeof toClientTask>;

function cleanStringArray(value: unknown, maxItems = 300) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item))
    .filter((item) => item.length > 0 && item.length <= 240)
    .slice(-maxItems);
}

function applyAgendaTaskOrder<T extends { id: string | number }>(tasks: T[], taskOrder: string[]) {
  if (taskOrder.length === 0) return tasks;
  const indexById = new Map(taskOrder.map((id, index) => [id, index]));
  return [...tasks].sort((a, b) => {
    const aIndex = indexById.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = indexById.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return 0;
  });
}

function toClientWorkspaceState(input: {
  reviewed?: DonnitUserWorkspaceState | null;
  agenda?: DonnitUserWorkspaceState | null;
  onboarding?: DonnitUserWorkspaceState | null;
}) {
  const reviewedValue = (input.reviewed?.value ?? {}) as Record<string, unknown>;
  const agendaValue = (input.agenda?.value ?? {}) as Record<string, unknown>;
  const onboardingValue = (input.onboarding?.value ?? {}) as Record<string, unknown>;
  return {
    reviewedNotificationIds: cleanStringArray(reviewedValue.ids, 200),
    agenda: {
      excludedTaskIds: cleanStringArray(agendaValue.excludedTaskIds, 500),
      approved: agendaValue.approved === true,
      approvedAt: typeof agendaValue.approvedAt === "string" ? agendaValue.approvedAt : null,
      preferences: cleanAgendaPreferences(agendaValue.preferences),
      taskOrder: cleanStringArray(agendaValue.taskOrder, 500),
      schedule: cleanAgendaSchedule(agendaValue.schedule),
    },
    onboarding: {
      dismissed: onboardingValue.dismissed === true,
      dismissedAt: typeof onboardingValue.dismissedAt === "string" ? onboardingValue.dismissedAt : null,
    },
  };
}

function hasTaskRelationshipColumns(task: DonnitTask) {
  return Object.prototype.hasOwnProperty.call(task, "delegated_to")
    && Object.prototype.hasOwnProperty.call(task, "collaborator_ids");
}

function canManageTaskSubtasks(
  task: DonnitTask,
  actorId: string,
  member: { role?: string | null } | null | undefined,
) {
  const collaboratorIds = Array.isArray(task.collaborator_ids) ? task.collaborator_ids : [];
  return (
    task.assigned_to === actorId ||
    task.assigned_by === actorId ||
    task.delegated_to === actorId ||
    collaboratorIds.includes(actorId) ||
    ["owner", "admin", "manager"].includes(String(member?.role ?? ""))
  );
}

function createSubtaskWriteStore(auth: NonNullable<Request["donnitAuth"]>) {
  const admin = createSupabaseAdminClient();
  return new DonnitStore(admin ?? auth.client, auth.userId);
}

function isWorkspaceAdmin(member: { role?: string | null } | null | undefined) {
  return ["owner", "admin"].includes(String(member?.role ?? ""));
}

function isWorkspaceMember(member: { role?: string | null; status?: string | null } | null | undefined) {
  return Boolean(member?.role) && String(member?.status ?? "active") !== "inactive";
}

function isTaskSensitive(task: Pick<DonnitTask, "visibility"> | { visibility?: string | null }) {
  return ["personal", "confidential"].includes(String(task.visibility ?? "work"));
}

function canViewSensitiveTask(
  task: Pick<DonnitTask, "assigned_to" | "assigned_by" | "delegated_to" | "collaborator_ids" | "visibility">,
  actorId: string,
  actor: { role?: string | null } | null | undefined,
) {
  if (!isTaskSensitive(task)) return true;
  if (isWorkspaceAdmin(actor)) return true;
  return (
    task.assigned_to === actorId ||
    task.assigned_by === actorId ||
    task.delegated_to === actorId ||
    (task.collaborator_ids ?? []).includes(actorId)
  );
}

function isMemberAdminSchemaError(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const haystack = `${String(raw?.message ?? "")} ${String(raw?.details ?? "")} ${String(raw?.hint ?? "")}`.toLowerCase();
  return (
    raw?.code === "23514" ||
    haystack.includes("status") ||
    haystack.includes("role") ||
    haystack.includes("organization_members")
  );
}

function buildAuthRedirectUrl(req: Request) {
  const configured = process.env.DONNIT_AUTH_REDIRECT_URL || process.env.PUBLIC_APP_URL || process.env.VITE_APP_URL;
  if (configured) return configured;
  const proto = String(req.header("x-forwarded-proto") ?? req.protocol ?? "https").split(",")[0].trim() || "https";
  const host = req.header("x-forwarded-host") ?? req.header("host");
  return host ? `${proto}://${host}/#/app` : "https://donnit-1.vercel.app/#/app";
}

async function requireWorkspaceAdminContext(auth: NonNullable<Request["donnitAuth"]>) {
  const userStore = new DonnitStore(auth.client, auth.userId);
  const orgId = await userStore.getDefaultOrgId();
  if (!orgId) return { ok: false as const, status: 409, message: "Workspace not bootstrapped." };
  const members = await userStore.listOrgMembers(orgId);
  const actor = members.find((member) => member.user_id === auth.userId);
  if (!isWorkspaceAdmin(actor)) {
    return { ok: false as const, status: 403, message: "Only workspace admins can manage members." };
  }
  return { ok: true as const, orgId, members, actor };
}

async function requireWorkspaceMemberContext(auth: NonNullable<Request["donnitAuth"]>) {
  const userStore = new DonnitStore(auth.client, auth.userId);
  const orgId = await userStore.getDefaultOrgId();
  if (!orgId) return { ok: false as const, status: 409, message: "Workspace not bootstrapped." };
  const members = await userStore.listOrgMembers(orgId);
  const actor = members.find((member) => member.user_id === auth.userId);
  if (!isWorkspaceMember(actor)) {
    return { ok: false as const, status: 403, message: "Only active workspace members can manage task templates." };
  }
  return { ok: true as const, orgId, members, actor };
}

function memberDisplayName(member: { profile?: { full_name?: string | null; email?: string | null } | null }) {
  return member.profile?.full_name || member.profile?.email || "Member";
}

function firstNameForTaskReference(displayName: string) {
  const trimmed = displayName.trim();
  if (!trimmed || trimmed === "Member") return "the requester";
  const emailPrefix = trimmed.includes("@") ? trimmed.split("@")[0] : trimmed;
  const first = emailPrefix.split(/[.\s_-]+/).filter(Boolean)[0] ?? emailPrefix;
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "the requester";
}

function rewriteRequesterReferencesInTitle(title: string, requesterName: string, shouldRewrite: boolean) {
  if (!shouldRewrite) return title;
  const possessive = requesterName === "the requester" ? "the requester's" : `${requesterName}'s`;
  const rewritten = title
    .replace(/\bme\b/gi, requesterName)
    .replace(/\bmy\b/gi, possessive)
    .replace(/\bmine\b/gi, possessive)
    .replace(/\s+/g, " ")
    .trim();
  return rewritten ? rewritten.charAt(0).toUpperCase() + rewritten.slice(1) : title;
}

function visibleFromForRecurringTask(input: {
  recurrence?: string | null;
  due_date?: string | null;
  reminder_days_before?: number | null;
}) {
  if (!input.due_date || !input.recurrence || input.recurrence === "none") return null;
  const days = Math.max(0, Number(input.reminder_days_before ?? 0) || 0);
  const date = new Date(`${input.due_date}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

type PositionContinuityMode = "transfer" | "delegate";

type PositionContinuityTaskSummary = {
  id: string;
  title: string;
  dueDate: string | null;
  urgency: DonnitTask["urgency"];
  recurrence: DonnitTask["recurrence"];
  visibleFrom: string | null;
  visibility: DonnitTask["visibility"];
  action: "transfer_owner" | "delegate_coverage" | "exclude_personal" | "review_unbound";
  contextHidden: boolean;
};

function isContinuityActiveTask(task: DonnitTask) {
  return task.status !== "completed" && task.status !== "denied";
}

function taskMatchesContinuityProfile(task: DonnitTask, input: { profileId: string | null; fromUserId: string; includeUnboundOwnerTasks?: boolean }) {
  const taskProfileId = (task as { position_profile_id?: string | null }).position_profile_id ?? null;
  if (input.profileId) {
    return taskProfileId === input.profileId || (input.includeUnboundOwnerTasks === true && !taskProfileId && task.assigned_to === input.fromUserId);
  }
  return task.assigned_to === input.fromUserId;
}

function toContinuityTaskSummary(
  task: DonnitTask,
  action: PositionContinuityTaskSummary["action"],
): PositionContinuityTaskSummary {
  return {
    id: task.id,
    title: task.title,
    dueDate: task.due_date,
    urgency: task.urgency,
    recurrence: task.recurrence,
    visibleFrom: visibleFromForRecurringTask(task) ?? task.visible_from,
    visibility: task.visibility,
    action,
    contextHidden: Boolean(task.description || task.completion_notes),
  };
}

function buildPositionContinuityPlan(input: {
  tasks: DonnitTask[];
  profileId: string | null;
  profileTitle: string;
  fromUserId: string;
  toUserId: string;
  mode: PositionContinuityMode;
  delegateUntil?: string | null;
  includeUnboundOwnerTasks?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const matchingTasks = input.tasks.filter((task) => taskMatchesContinuityProfile(task, input));
  const activeMatching = matchingTasks.filter(isContinuityActiveTask);
  const personalExcluded = activeMatching.filter((task) => task.visibility === "personal");
  const tasksToMove = activeMatching.filter((task) => task.visibility !== "personal");
  const historicalTasks = matchingTasks.filter((task) => task.status === "completed" && task.visibility !== "personal");
  const unboundOwnerTasks = input.profileId && input.includeUnboundOwnerTasks !== true
    ? input.tasks.filter(
        (task) =>
          isContinuityActiveTask(task) &&
          task.assigned_to === input.fromUserId &&
          !((task as { position_profile_id?: string | null }).position_profile_id ?? null) &&
          task.visibility !== "personal",
      )
    : [];
  const recurringTasks = tasksToMove.filter((task) => task.recurrence !== "none");
  const futureRecurringTasks = recurringTasks.filter((task) => {
    const visibleFrom = visibleFromForRecurringTask(task) ?? task.visible_from;
    return Boolean(visibleFrom && visibleFrom > today);
  });
  const confidentialTasks = tasksToMove.filter((task) => task.visibility === "confidential");
  const contextHiddenTasks = tasksToMove.filter((task) => task.description || task.completion_notes);
  const warnings = [
    personalExcluded.length > 0
      ? `${personalExcluded.length} personal task${personalExcluded.length === 1 ? " is" : "s are"} excluded from the transition.`
      : "",
    confidentialTasks.length > 0
      ? `${confidentialTasks.length} confidential task${confidentialTasks.length === 1 ? " is" : "s are"} included with restricted context.`
      : "",
    unboundOwnerTasks.length > 0
      ? `${unboundOwnerTasks.length} active task${unboundOwnerTasks.length === 1 ? "" : "s"} owned by the outgoing user are not tied to this Position Profile and need review.`
      : "",
    futureRecurringTasks.length > 0
      ? `${futureRecurringTasks.length} recurring task${futureRecurringTasks.length === 1 ? "" : "s"} will stay hidden until the show-early window.`
      : "",
  ].filter(Boolean);

  return {
    tasksToMove,
    historicalTasks,
    preview: {
      profileId: input.profileId,
      profileTitle: input.profileTitle,
      mode: input.mode,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      delegateUntil: input.delegateUntil ?? null,
      summary: {
        activeTasks: tasksToMove.length,
        recurringTasks: recurringTasks.length,
        futureRecurringTasks: futureRecurringTasks.length,
        confidentialTasks: confidentialTasks.length,
        personalTasksExcluded: personalExcluded.length,
        historicalTasks: historicalTasks.length,
        contextHiddenTasks: contextHiddenTasks.length,
        unboundTasksNeedingReview: unboundOwnerTasks.length,
      },
      includedTasks: tasksToMove.slice(0, 12).map((task) =>
        toContinuityTaskSummary(task, input.mode === "transfer" ? "transfer_owner" : "delegate_coverage"),
      ),
      excludedTasks: personalExcluded.slice(0, 8).map((task) => toContinuityTaskSummary(task, "exclude_personal")),
      reviewTasks: unboundOwnerTasks.slice(0, 8).map((task) => toContinuityTaskSummary(task, "review_unbound")),
      warnings,
    },
  };
}

function relationshipEventNote(input: {
  assignedToId: string | number;
  delegatedToId: string | number | null;
  collaboratorIds: Array<string | number>;
}) {
  return JSON.stringify({
    assignedToId: String(input.assignedToId),
    delegatedToId: input.delegatedToId === null ? null : String(input.delegatedToId),
    collaboratorIds: input.collaboratorIds.map(String),
  });
}

function applyRelationshipEvents<T extends {
  id: string | number;
  assignedToId: string | number;
  delegatedToId?: string | number | null;
  collaboratorIds?: Array<string | number>;
}>(tasks: T[], events: Array<{ task_id?: string | number; taskId?: string | number; type: string; note: string }>): T[] {
  const byTaskId = new Map<string, { delegatedToId: string | null; collaboratorIds: string[] }>();
  for (const event of events) {
    if (event.type !== "relationships_updated") continue;
    const taskId = String(event.task_id ?? event.taskId ?? "");
    if (!taskId || byTaskId.has(taskId)) continue;
    try {
      const parsed = JSON.parse(event.note) as { delegatedToId?: string | null; collaboratorIds?: string[] };
      byTaskId.set(taskId, {
        delegatedToId: parsed.delegatedToId ?? null,
        collaboratorIds: Array.isArray(parsed.collaboratorIds) ? parsed.collaboratorIds : [],
      });
    } catch {
      // Ignore older free-text events.
    }
  }
  return tasks.map((task) => {
    const snapshot = byTaskId.get(String(task.id));
    if (!snapshot) return task;
    return {
      ...task,
      delegatedToId: task.delegatedToId ?? snapshot.delegatedToId,
      collaboratorIds: task.collaboratorIds && task.collaboratorIds.length > 0
        ? task.collaboratorIds
        : snapshot.collaboratorIds,
    };
  });
}

function parseDemoCollaboratorIds(value: unknown): number[] {
  if (Array.isArray(value)) return value.filter((id): id is number => typeof id === "number");
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === "number") : [];
  } catch {
    return [];
  }
}

type ClientDemoTask = Omit<Task, "collaboratorIds"> & { collaboratorIds: number[] };

function toClientDemoTask(task: Task): ClientDemoTask {
  return {
    ...task,
    collaboratorIds: parseDemoCollaboratorIds(task.collaboratorIds),
    positionProfileId: null,
    visibility: "work" as const,
    visibleFrom: null,
  };
}

function parseDemoUserId(value: string | number): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function estimateEmailTaskMinutes(input: {
  title: string;
  preview?: string | null;
  actionItems?: string[] | null;
  urgency?: string | null;
}) {
  const text = `${input.title} ${input.preview ?? ""} ${(input.actionItems ?? []).join(" ")}`.toLowerCase();
  const explicitEstimate = text.match(/\bestimated(?:\s+time)?:\s*(\d{1,4})\s*(?:min|mins|minutes)\b/i);
  if (explicitEstimate) return Math.max(5, Math.min(1440, Number(explicitEstimate[1])));
  if (/reconcile|receipt|expense|charge|transaction/.test(text)) return 15;
  if (/invoice|payment|bill|pay /.test(text)) return 20;
  if (/contract|agreement|proposal|sow|legal/.test(text)) return 45;
  if (/document|feedback|review comments|redline/.test(text)) return 45;
  if (/approve|approval|sign off/.test(text)) return 30;
  if (/meeting|schedule|reschedule|calendar/.test(text)) return 15;
  if (/reply|respond|follow up|following up/.test(text)) return 15;
  if (input.urgency === "high" || input.urgency === "critical") return 45;
  return 30;
}

function normalizeTemplateMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function templateScore(template: DonnitTaskTemplate, input: { title: string; description?: string | null }) {
  const haystack = normalizeTemplateMatchText(`${input.title} ${input.description ?? ""}`);
  const phrases = [
    ...template.trigger_phrases,
    template.name,
  ]
    .map(normalizeTemplateMatchText)
    .filter((phrase) => phrase.length >= 2);
  let score = 0;
  for (const phrase of phrases) {
    if (!haystack.includes(phrase)) continue;
    score = Math.max(score, phrase.length + (template.subtasks?.length ?? 0) * 3);
  }
  return score;
}

function selectTaskTemplate(
  templates: DonnitTaskTemplate[],
  input: { title: string; description?: string | null; templateId?: string | null },
) {
  if (input.templateId) {
    return templates.find((template) => template.id === input.templateId) ?? null;
  }
  const ranked = templates
    .map((template) => ({ template, score: templateScore(template, input) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.template ?? null;
}

async function applyTaskTemplateToTask(
  store: DonnitStore,
  orgId: string,
  task: DonnitTask,
  input: { templateId?: string | null; description?: string | null } = {},
) {
  const templates = await store.listTaskTemplates(orgId);
  if (templates.length === 0) return null;
  const template = selectTaskTemplate(templates, {
    title: task.title,
    description: input.description ?? task.description,
    templateId: input.templateId,
  });
  if (!template || !template.subtasks || template.subtasks.length === 0) return null;
  const createdSubtasks = [];
  for (const subtask of template.subtasks) {
    createdSubtasks.push(
      await store.createTaskSubtask(orgId, {
        task_id: task.id,
        title: subtask.title,
        position: subtask.position,
      }),
    );
  }
  await store.addEvent(orgId, {
    task_id: task.id,
    actor_id: task.assigned_by,
    type: "template_applied",
    note: `Applied task template: ${template.name}.`,
  });
  return { template, subtasks: createdSubtasks };
}

function compactMemoryText(value: string | null | undefined, max = 280) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function repeatDetailsFromDescription(value: string | null | undefined) {
  const match = String(value ?? "").match(/(?:^|\n)\s*Repeat(?: details)?:\s*(.+)\s*$/i);
  return match?.[1]?.trim() ?? "";
}

function uniqueMemoryItems<T>(items: T[], keyFor: (item: T) => string, max = 20) {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const key = keyFor(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
    if (output.length >= max) break;
  }
  return output;
}

async function enrichPositionProfileMemoryFromTask(input: {
  store: DonnitStore;
  orgId: string;
  task: DonnitTask;
  eventType: "created" | "updated" | "completed" | "note_added" | "accepted" | "denied" | "due_date_postponed";
  note?: string;
}) {
  const profileId = (input.task as { position_profile_id?: string | null }).position_profile_id;
  const visibility = (input.task as { visibility?: string }).visibility ?? "work";
  if (!profileId || visibility === "personal") return;

  try {
    const adminClient = createSupabaseAdminClient();
    const writeStore = adminClient ? new DonnitStore(adminClient, input.store.userId) : input.store;
    const profiles = await writeStore.listPositionProfiles(input.orgId);
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return;
    const previous = (profile.institutional_memory ?? {}) as Record<string, unknown>;
    const existingRecent = Array.isArray(previous.recentTaskSignals) ? previous.recentTaskSignals as Array<Record<string, unknown>> : [];
    const existingRecurring = Array.isArray(previous.recurringResponsibilities) ? previous.recurringResponsibilities as Array<Record<string, unknown>> : [];
    const existingHowTo = Array.isArray(previous.howToNotes) ? previous.howToNotes as Array<Record<string, unknown>> : [];
    const existingSources = typeof previous.sourceMix === "object" && previous.sourceMix !== null ? previous.sourceMix as Record<string, number> : {};
    const existingStats = typeof previous.stats === "object" && previous.stats !== null ? previous.stats as Record<string, number> : {};
    const capturedAt = new Date().toISOString();
    const taskSignal = {
      taskId: input.task.id,
      title: input.task.title,
      status: input.task.status,
      urgency: input.task.urgency,
      dueDate: input.task.due_date,
      dueTime: input.task.due_time ?? input.task.start_time ?? null,
      source: input.task.source,
      recurrence: input.task.recurrence,
      visibility,
      eventType: input.eventType,
      capturedAt,
    };
    const recurringSignal =
      input.task.recurrence !== "none" || input.task.reminder_days_before > 0
        ? {
            taskId: input.task.id,
            title: input.task.title,
            cadence: input.task.recurrence,
            repeatDetails: repeatDetailsFromDescription(input.task.description),
            dueDate: input.task.due_date,
            showEarlyDays: input.task.reminder_days_before,
            updatedAt: capturedAt,
          }
        : null;
    const noteText = compactMemoryText(input.note || input.task.completion_notes || input.task.description, 500);
    const howToSignal = noteText
      ? {
          taskId: input.task.id,
          title: input.task.title,
          note: noteText,
          source: input.eventType,
          capturedAt,
        }
      : null;
    const recentTaskSignals = uniqueMemoryItems([taskSignal, ...existingRecent], (item) => `${item.taskId}:${item.eventType}`, 30);
    const recurringResponsibilities = uniqueMemoryItems(
      recurringSignal ? [recurringSignal, ...existingRecurring] : existingRecurring,
      (item) => String(item.taskId || item.title),
      25,
    );
    const howToNotes = uniqueMemoryItems(
      howToSignal ? [howToSignal, ...existingHowTo] : existingHowTo,
      (item) => `${item.taskId}:${item.note}`,
      25,
    );
    const stats = {
      ...existingStats,
      taskSignals: (existingStats.taskSignals ?? 0) + 1,
      completedTasks: (existingStats.completedTasks ?? 0) + (input.eventType === "completed" ? 1 : 0),
      recurringTasks: recurringResponsibilities.length,
    };
    const nextMemory = {
      ...previous,
      stats,
      sourceMix: {
        ...existingSources,
        [input.task.source]: (existingSources[input.task.source] ?? 0) + 1,
      },
      recentTaskSignals,
      recurringResponsibilities,
      howToNotes,
      lastAutoUpdatedAt: capturedAt,
    };
    const riskScore = Math.min(100, Math.max(profile.risk_score ?? 0, recurringResponsibilities.length * 8 + howToNotes.length * 3));
    await writeStore.updatePositionProfile(input.orgId, profile.id, {
      institutional_memory: nextMemory,
      risk_score: riskScore,
      risk_summary: `${profile.title} memory updated from ${input.eventType.replace(/_/g, " ")}: ${input.task.title}.`,
    });
  } catch (error) {
    console.error("[donnit] position profile memory enrichment failed", error instanceof Error ? error.message : String(error));
  }
}

function nextMonthlyOrdinalWeekdayFromTask(task: DonnitTask) {
  const repeatDetails = repeatDetailsFromDescription(task.description);
  const ordinalWeekday = repeatDetails.match(/\b(first|second|third|fourth|last)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (!task.due_date || !ordinalWeekday) return null;
  const nextMonth = new Date(`${addMonthsIso(task.due_date, 1)}T00:00:00.000Z`);
  return nthWeekdayOfMonthIso(
    nextMonth.getUTCFullYear(),
    nextMonth.getUTCMonth() + 1,
    weekdayIndexes[ordinalWeekday[2].toLowerCase()],
    ordinalWeekday[1].toLowerCase(),
  );
}

function nextRecurringDueDate(task: DonnitTask) {
  if (!task.due_date || task.recurrence === "none") return null;
  switch (task.recurrence) {
    case "daily":
      return addDaysIso(task.due_date, 1);
    case "weekly":
      return addDaysIso(task.due_date, 7);
    case "monthly":
      return nextMonthlyOrdinalWeekdayFromTask(task) ?? addMonthsIso(task.due_date, 1);
    case "quarterly":
      return addMonthsIso(task.due_date, 3);
    case "annual":
      return addMonthsIso(task.due_date, 12);
    default:
      return null;
  }
}

async function createNextRecurringOccurrenceFromTask(input: {
  store: DonnitStore;
  orgId: string;
  task: DonnitTask;
  actorId: string;
}) {
  const nextDueDate = nextRecurringDueDate(input.task);
  if (!nextDueDate) return null;
  try {
    const existing = await input.store.listTasks(input.orgId);
    const duplicate = existing.find((task) =>
      task.id !== input.task.id &&
      task.title === input.task.title &&
      task.due_date === nextDueDate &&
      task.recurrence === input.task.recurrence &&
      task.status !== "completed" &&
      ((task as { position_profile_id?: string | null }).position_profile_id ?? null) ===
        ((input.task as { position_profile_id?: string | null }).position_profile_id ?? null),
    );
    if (duplicate) return duplicate;
    const repeatDetails = repeatDetailsFromDescription(input.task.description);
    const nextTask = await input.store.createTask(input.orgId, {
      title: input.task.title,
      description: descriptionWithServerRepeatDetails("", repeatDetails),
      status: "open",
      urgency: input.task.urgency,
      due_date: nextDueDate,
      due_time: input.task.due_time,
      start_time: input.task.start_time,
      end_time: input.task.end_time,
      is_all_day: input.task.is_all_day,
      estimated_minutes: input.task.estimated_minutes,
      assigned_to: input.task.assigned_to,
      assigned_by: input.task.assigned_by,
      delegated_to: input.task.delegated_to,
      collaborator_ids: input.task.collaborator_ids,
      source: "automation",
      recurrence: input.task.recurrence,
      reminder_days_before: input.task.reminder_days_before,
      position_profile_id: input.task.position_profile_id,
      visibility: input.task.visibility,
      visible_from: visibleFromForRecurringTask({
        recurrence: input.task.recurrence,
        due_date: nextDueDate,
        reminder_days_before: input.task.reminder_days_before,
      }),
    });
    try {
      const subtasks = await input.store.listTaskSubtasks(input.orgId);
      const sourceSubtasks = subtasks
        .filter((subtask) => subtask.task_id === input.task.id)
        .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
      for (const subtask of sourceSubtasks) {
        await input.store.createTaskSubtask(input.orgId, {
          task_id: nextTask.id,
          title: subtask.title,
          position: subtask.position,
        });
      }
    } catch (error) {
      console.error("[donnit] recurring subtask copy failed", error instanceof Error ? error.message : String(error));
    }
    await input.store.addEvent(input.orgId, {
      task_id: input.task.id,
      actor_id: input.actorId,
      type: "recurring_next_created",
      note: `Next ${input.task.recurrence} occurrence created for ${nextDueDate}.`,
    });
    await input.store.addEvent(input.orgId, {
      task_id: nextTask.id,
      actor_id: input.actorId,
      type: "recurring_occurrence_created",
      note: `Created from recurring task ${input.task.id}. Historical notes remain on the completed task and Position Profile.`,
    });
    await enrichPositionProfileMemoryFromTask({
      store: input.store,
      orgId: input.orgId,
      task: nextTask,
      eventType: "created",
      note: `Next ${input.task.recurrence} occurrence created for ${nextDueDate}.`,
    });
    return nextTask;
  } catch (error) {
    console.error("[donnit] recurring occurrence creation failed", error instanceof Error ? error.message : String(error));
    return null;
  }
}

function buildEmailTaskDescription(input: {
  subject: string;
  fromEmail: string;
  preview: string;
  actionItems?: string[] | null;
  body?: string | null;
}) {
  const lines = [
    `Donnit interpretation: ${input.preview}`,
    `Source email: ${input.subject}`,
    `From: ${input.fromEmail}`,
  ];
  const actionItems = (input.actionItems ?? []).filter(Boolean);
  if (actionItems.length > 0) {
    lines.push("", "Suggested next steps:");
    for (const item of actionItems.slice(0, 4)) lines.push(`- ${item}`);
  }
  const excerpt = (input.body ?? "").trim();
  if (excerpt) {
    lines.push("", "Email excerpt:", excerpt.slice(0, 700));
  }
  return lines.join("\n");
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

function buildClientAgenda(
  tasks: SupabaseTaskShape[],
  busyByDate: Map<string, CalendarBusyBlock[]> = new Map(),
  timeZone = DEFAULT_CALENDAR_TIME_ZONE,
  preferences = DEFAULT_AGENDA_PREFERENCES,
  taskOrder: string[] = [],
): AgendaItem[] {
  const ordered = applyAgendaTaskOrder(sortClientTasks(tasks), taskOrder);
  return scheduleTasks(ordered, busyByDate, { timeZone, preferences, presorted: true });
}

type GoogleCalendarContext = {
  accessToken: string;
  timeZone: string;
  busyByDate: Map<string, CalendarBusyBlock[]>;
};

async function resolveGoogleCalendarAccess(store: DonnitStore): Promise<
  | { ok: true; accessToken: string; account: Awaited<ReturnType<DonnitStore["getGmailAccount"]>> }
  | { ok: false; status: number; reason: string; message: string }
> {
  const account = await store.getGmailAccount();
  if (!account || account.status !== "connected") {
    return {
      ok: false,
      status: 412,
      reason: "google_oauth_not_connected",
      message: "Connect your Google account before exporting to Google Calendar.",
    };
  }
  if (!hasGoogleCalendarScope(account.scope)) {
    return {
      ok: false,
      status: 412,
      reason: "calendar_scope_missing",
      message: "Reconnect Google so Donnit can read availability and add agenda blocks to Google Calendar.",
    };
  }

  let accessToken = account.access_token;
  const expiresMs = new Date(account.expires_at).getTime();
  if (!Number.isFinite(expiresMs) || expiresMs - Date.now() < 60_000) {
    if (!account.refresh_token) {
      await store.patchGmailAccount({ status: "error" });
      return {
        ok: false,
        status: 401,
        reason: "google_oauth_token_invalid",
        message: "Google authorization expired. Reconnect Google and try again.",
      };
    }
    const refreshed = await refreshGmailAccessToken(account.refresh_token);
    await store.patchGmailAccount({
      access_token: refreshed.accessToken,
      expires_at: new Date(refreshed.expiresAt).toISOString(),
      scope: refreshed.scope || account.scope,
      token_type: refreshed.tokenType || account.token_type,
    });
    accessToken = refreshed.accessToken;
  }

  return { ok: true, accessToken, account };
}

async function resolveGmailSendAccess(store: DonnitStore): Promise<
  | { ok: true; accessToken: string; account: NonNullable<Awaited<ReturnType<DonnitStore["getGmailAccount"]>>> }
  | { ok: false; status: number; reason: string; message: string }
> {
  const account = await store.getGmailAccount();
  if (!account || account.status !== "connected") {
    return {
      ok: false,
      status: 412,
      reason: "google_oauth_not_connected",
      message: "Connect Gmail before Donnit can send a reply through the original email thread.",
    };
  }
  if (!hasGmailSendScope(account.scope)) {
    return {
      ok: false,
      status: 412,
      reason: "gmail_send_scope_missing",
      message: "Reconnect Gmail so Donnit can send approved replies. This adds Gmail send permission.",
    };
  }

  let accessToken = account.access_token;
  const expiresMs = new Date(account.expires_at).getTime();
  if (!Number.isFinite(expiresMs) || expiresMs - Date.now() < 60_000) {
    if (!account.refresh_token) {
      await store.patchGmailAccount({ status: "error" });
      return {
        ok: false,
        status: 401,
        reason: "google_oauth_token_invalid",
        message: "Google authorization expired. Reconnect Gmail and try again.",
      };
    }
    const refreshed = await refreshGmailAccessToken(account.refresh_token);
    await store.patchGmailAccount({
      access_token: refreshed.accessToken,
      expires_at: new Date(refreshed.expiresAt).toISOString(),
      scope: refreshed.scope || account.scope,
      token_type: refreshed.tokenType || account.token_type,
    });
    accessToken = refreshed.accessToken;
  }

  return { ok: true, accessToken, account };
}

function addBusyBlock(busyByDate: Map<string, CalendarBusyBlock[]>, block: CalendarBusyBlock) {
  if (block.endMinute <= block.startMinute) return;
  busyByDate.set(block.date, [...(busyByDate.get(block.date) ?? []), block]);
}

function expandAllDayBusyBlocks(
  busyByDate: Map<string, CalendarBusyBlock[]>,
  startDate: string,
  exclusiveEndDate: string,
) {
  for (let date = startDate; date < exclusiveEndDate; date = addDaysIso(date, 1)) {
    addBusyBlock(busyByDate, { date, startMinute: 0, endMinute: 24 * 60 });
  }
}

function addTimedBusyBlocks(
  busyByDate: Map<string, CalendarBusyBlock[]>,
  startAt: string,
  endAt: string,
  timeZone: string,
) {
  const start = getZonedParts(startAt, timeZone);
  const end = getZonedParts(endAt, timeZone);
  if (start.date === end.date) {
    addBusyBlock(busyByDate, { date: start.date, startMinute: start.minute, endMinute: end.minute });
    return;
  }
  addBusyBlock(busyByDate, { date: start.date, startMinute: start.minute, endMinute: 24 * 60 });
  for (let date = addDaysIso(start.date, 1); date < end.date; date = addDaysIso(date, 1)) {
    addBusyBlock(busyByDate, { date, startMinute: 0, endMinute: 24 * 60 });
  }
  addBusyBlock(busyByDate, { date: end.date, startMinute: 0, endMinute: end.minute });
}

async function fetchGoogleCalendarContext(accessToken: string): Promise<GoogleCalendarContext> {
  let timeZone = DEFAULT_CALENDAR_TIME_ZONE;
  try {
    const calendarRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (calendarRes.ok) {
      const calendar = (await calendarRes.json()) as { timeZone?: string };
      if (calendar.timeZone) timeZone = calendar.timeZone;
    }
  } catch {
    // Keep the default timezone and continue with event fetch.
  }

  const today = getZonedParts(new Date(), timeZone).date;
  const timeMin = new Date(`${today}T00:00:00.000Z`).toISOString();
  const timeMax = new Date(`${addDaysIso(today, SCHEDULE_HORIZON_DAYS + 1)}T00:00:00.000Z`).toISOString();
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    timeZone,
    maxResults: "250",
  });
  const eventsRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!eventsRes.ok) {
    throw new Error(`Google Calendar events fetch failed (${eventsRes.status})`);
  }

  const payload = (await eventsRes.json()) as {
    items?: Array<{
      status?: string;
      summary?: string;
      start?: { date?: string; dateTime?: string };
      end?: { date?: string; dateTime?: string };
      extendedProperties?: { private?: Record<string, string | undefined> };
    }>;
  };
  const busyByDate = new Map<string, CalendarBusyBlock[]>();
  for (const event of payload.items ?? []) {
    if (event.status === "cancelled") continue;
    if (event.extendedProperties?.private?.donnitSource === "agenda") continue;
    if (event.summary?.startsWith("Donnit:")) continue;
    if (event.start?.date && event.end?.date) {
      expandAllDayBusyBlocks(busyByDate, event.start.date, event.end.date);
      continue;
    }
    if (event.start?.dateTime && event.end?.dateTime) {
      addTimedBusyBlocks(busyByDate, event.start.dateTime, event.end.dateTime, timeZone);
    }
  }

  return { accessToken, timeZone, busyByDate };
}

async function tryBuildGoogleCalendarContext(store: DonnitStore): Promise<GoogleCalendarContext | null> {
  try {
    const access = await resolveGoogleCalendarAccess(store);
    if (!access.ok) return null;
    return await fetchGoogleCalendarContext(access.accessToken);
  } catch (error) {
    console.error(
      "[donnit] calendar availability fetch failed:",
      error instanceof Error ? error.message.slice(0, 200) : "unknown",
    );
    return null;
  }
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
  const [
    members,
    tasks,
    events,
    messages,
    suggestions,
    positionProfiles,
    subtasks,
    taskTemplates,
    reviewedState,
    agendaState,
    onboardingState,
  ] = await Promise.all([
    store.listOrgMembers(orgId),
    store.listTasks(orgId),
    store.listEvents(orgId),
    store.listChatMessages(orgId),
    store.listEmailSuggestions(orgId),
    store.listPositionProfiles(orgId),
    store.listTaskSubtasks(orgId),
    store.listTaskTemplates(orgId),
    store.getWorkspaceState(orgId, "reviewed_notifications"),
    store.getWorkspaceState(orgId, "agenda_state"),
    store.getWorkspaceState(orgId, "onboarding_state"),
  ]);
  const users = members.map((m) => ({
    id: m.user_id,
    name: m.profile?.full_name || m.profile?.email || "Member",
    email: m.profile?.email ?? "",
    role: m.role,
    persona: m.profile?.persona ?? "operator",
    emailSignature: m.profile?.email_signature ?? "",
    managerId: m.manager_id,
    canAssign: m.can_assign,
    status: (m as { status?: string }).status ?? "active",
  }));
  const actor = members.find((member) => member.user_id === auth.userId);
  const visibleTasks = tasks.filter((task) => canViewSensitiveTask(task, auth.userId, actor));
  const visibleTaskIds = new Set(visibleTasks.map((task) => task.id));
  const visibleEvents = events.filter((event) => !event.task_id || visibleTaskIds.has(event.task_id));
  const clientTasks = sortClientTasks(applyRelationshipEvents(visibleTasks.map(toClientTask), visibleEvents));
  const calendarContext = await tryBuildGoogleCalendarContext(store);
  const workspaceState = toClientWorkspaceState({ reviewed: reviewedState, agenda: agendaState, onboarding: onboardingState });
  return {
    authenticated: true,
    bootstrapped: true,
    currentUserId: auth.userId,
    email: auth.email,
    orgId,
    users,
    tasks: clientTasks,
    events: visibleEvents.map((event) => ({
      id: event.id,
      taskId: event.task_id,
      actorId: event.actor_id,
      type: event.type,
      note: event.note,
      createdAt: event.created_at,
    })),
    messages: messages.filter((m) => m.role !== "system").map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      taskId: m.task_id,
      createdAt: m.created_at,
    })),
    suggestions: suggestions.map(toClientEmailSuggestion),
    positionProfiles: positionProfiles.map(toClientPositionProfile),
    subtasks: subtasks.map(toClientTaskSubtask),
    taskTemplates: taskTemplates.map(toClientTaskTemplate),
    workspaceState,
    agenda: buildClientAgenda(
      clientTasks,
      calendarContext?.busyByDate,
      calendarContext?.timeZone ?? DEFAULT_CALENDAR_TIME_ZONE,
      workspaceState.agenda.preferences,
      workspaceState.agenda.taskOrder,
    ),
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
  const demoTasks = sortTasks(applyRelationshipEvents(tasks.map(toClientDemoTask), events)).map((task, index) => ({
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
      status: "active",
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
    positionProfiles: [],
    subtasks: [],
    workspaceState: toClientWorkspaceState({}),
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
  const explicitCandidates = hasExplicitAssignmentIntent(message) ? findMentionedMemberCandidates(message, members) : [];
  const explicit = explicitCandidates.length === 1 ? explicitCandidates[0] : null;
  const assignee = explicit ?? members.find((m) => m.user_id === selfId) ?? members[0];
  const reminderDaysBefore = parseAnnualReminderDays(message);
  const recurrence = parseTaskRecurrence(message);
  const assignedToId = assignee?.user_id ?? selfId;
  const title =
    titleFromMessage(message, assigneeAliases(assignee?.profile?.full_name, assignee?.profile?.email)) || "Untitled task";
  const dueDate = parseDueDate(message);
  const urgency = isPastDue(dueDate) ? "critical" : parseUrgency(message);
  const estimatedMinutes = parseEstimate(message);
  const timing = parseTaskTime(message, estimatedMinutes);
  return {
    title,
    description: descriptionWithServerRepeatDetails(message, recurrenceDetailsFromMessage(message, recurrence, dueDate)),
    status: assignedToId === selfId ? "open" : "pending_acceptance",
    urgency,
    dueDate,
    dueTime: timing.dueTime,
    startTime: timing.startTime,
    endTime: timing.endTime,
    isAllDay: timing.isAllDay,
    estimatedMinutes,
    assignedToId,
    assignedById: selfId,
    source: "chat" as const,
    recurrence: recurrence as DonnitTask["recurrence"],
    reminderDaysBefore,
    visibility: parseTaskVisibility(message),
  };
}

type PendingChatMissingField = "title" | "assignee" | "dueDate" | "urgency" | "positionProfile";

function pendingChatMissing(task: Pick<PendingChatTask, "dueDate" | "missing">) {
  const missing = new Set(task.missing);
  if (!task.dueDate) missing.add("dueDate");
  return Array.from(missing);
}

function normalizeTaskTitleForIntent(value: string) {
  return value
    .toLowerCase()
    .replace(/["'.,:;!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericAssignmentTitle(title: string) {
  const normalized = normalizeTaskTitleForIntent(title)
    .replace(/^(?:assign|delegate|reassign|add|create|make|log)\s+/, "")
    .replace(/^(?:a|an|the)\s+/, "")
    .trim();
  return (
    !normalized ||
    /^(?:untitled task|task|todo|to do|to-do|work|item|something|thing|it|this)$/.test(normalized) ||
    /^(?:task|todo|to do|to-do|work|item)\s+(?:to|for)\s+[a-z][a-z'-]*$/.test(normalized)
  );
}

function hasExplicitAssignmentIntent(message: string) {
  return (
    /\b(?:assign|delegate|reassign|route|transfer|handoff|hand\s*off)\b/i.test(message) ||
    /\b(?:give|send)\s+(?:this|it|the task|that)?\s*(?:to\s+)?[a-z][a-z' -]{1,80}\s+(?:to\s+)?(?:handle|own|complete|review|finish|do)\b/i.test(message) ||
    /\bput\s+(?:this|it|the task)?\s*(?:on\s+)?[a-z][a-z' -]{1,80}(?:'s)?\s+plate\b/i.test(message) ||
    /\b(?:have|get|ask)\s+[a-z][a-z' -]{1,80}\s+to\s+(?:handle|own|complete|review|finish|do|send|prepare|draft|update|call|email|follow)\b/i.test(message)
  );
}

function findMentionedMember(
  message: string,
  members: Awaited<ReturnType<DonnitStore["listOrgMembers"]>>,
) {
  const candidates = findMentionedMemberCandidates(message, members);
  return candidates.length === 1 ? candidates[0] : null;
}

function findMentionedMemberCandidates(
  message: string,
  members: Awaited<ReturnType<DonnitStore["listOrgMembers"]>>,
) {
  return findBestMentionedCandidates(
    message,
    members,
    (member) => member.profile?.full_name,
    (member) => member.profile?.email,
  );
}

function normalizedProfileSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function profileCandidatesForAssignee(profiles: DonnitPositionProfile[], assignedToId: string) {
  return profiles.filter(
    (profile) =>
      profile.current_owner_id === assignedToId ||
      profile.temporary_owner_id === assignedToId ||
      profile.delegate_user_id === assignedToId,
  );
}

function profileMatchesText(profile: DonnitPositionProfile, message: string) {
  const haystack = normalizedProfileSearchText(message);
  const title = normalizedProfileSearchText(profile.title);
  if (!haystack || !title) return false;
  if (haystack.includes(title)) return true;
  const words = title.split(" ").filter((word) => word.length >= 3);
  const acronym = words.map((word) => word[0]).join("");
  if (acronym.length >= 2 && haystack.split(" ").includes(acronym)) return true;
  return words.length >= 2 && words.every((word) => haystack.includes(word));
}

function resolveChatPositionProfile(input: {
  profiles: DonnitPositionProfile[];
  assignedToId: string;
  message: string;
  visibility: "work" | "personal" | "confidential";
}) {
  if (input.visibility === "personal") {
    return { positionProfileId: null as string | null, needsChoice: false, candidates: [] as DonnitPositionProfile[] };
  }
  const candidates = profileCandidatesForAssignee(input.profiles, input.assignedToId);
  if (candidates.length === 0) {
    return { positionProfileId: null as string | null, needsChoice: false, candidates };
  }
  const explicit = candidates.find((profile) => profileMatchesText(profile, input.message));
  if (explicit) {
    return { positionProfileId: explicit.id, needsChoice: false, candidates };
  }
  if (candidates.length === 1) {
    return { positionProfileId: candidates[0].id, needsChoice: false, candidates };
  }
  return { positionProfileId: null as string | null, needsChoice: true, candidates };
}

function formatProfileChoices(profiles: DonnitPositionProfile[]) {
  return profiles.map((profile) => profile.title).slice(0, 5).join(", ");
}

function missingChatQuestion(
  task: PendingChatTask,
  members: Awaited<ReturnType<DonnitStore["listOrgMembers"]>>,
  profiles: DonnitPositionProfile[] = [],
) {
  const assignee = members.find((member) => member.user_id === task.assignedToId);
  const assigneeName = memberDisplayName(assignee ?? {});
  const visibilityText = task.visibility === "confidential"
    ? " as confidential"
    : task.visibility === "personal"
      ? " as personal"
      : "";
  const intro = `I can assign ${assigneeName} to ${lowercaseFirst(task.title)}${visibilityText}.`;
  const missing = pendingChatMissing(task);
  const needsTitle = missing.includes("title");
  if (missing.includes("assignee") && needsTitle) {
    return "Who should own this task, and what should they do?";
  }
  if (missing.includes("assignee")) {
    const memberNames = members.map(memberDisplayName).filter(Boolean).slice(0, 6).join(", ");
    return `Who should own "${task.title}"?${memberNames ? ` I can assign it to: ${memberNames}.` : ""}`;
  }
  if (needsTitle && missing.includes("dueDate") && missing.includes("urgency")) {
    return `What should ${assigneeName} do, when is it due, and how urgent is it?`;
  }
  if (needsTitle && missing.includes("dueDate")) {
    return `What should ${assigneeName} do, and when is it due?`;
  }
  if (needsTitle && missing.includes("urgency")) {
    return `What should ${assigneeName} do, and how urgent is it?`;
  }
  if (needsTitle) return `What should ${assigneeName} do?`;
  const profileCandidates = missing.includes("positionProfile")
    ? profileCandidatesForAssignee(profiles, task.assignedToId)
    : [];
  const profileQuestion = profileCandidates.length > 0
    ? ` Which Position Profile should this belong to: ${formatProfileChoices(profileCandidates)}?`
    : "";
  if (missing.includes("positionProfile") && missing.includes("dueDate") && missing.includes("urgency")) {
    return `${intro}${profileQuestion} Also, when is it due, and how urgent is it?`;
  }
  if (missing.includes("positionProfile") && missing.includes("dueDate")) {
    return `${intro}${profileQuestion} Also, when is it due?`;
  }
  if (missing.includes("positionProfile") && missing.includes("urgency")) {
    return `${intro}${profileQuestion} Also, how urgent is it?`;
  }
  if (missing.includes("positionProfile")) {
    return `${intro}${profileQuestion || " Which Position Profile should this belong to?"}`;
  }
  if (missing.includes("dueDate") && missing.includes("urgency")) {
    return `${intro} When is this due, and how urgent is it?`;
  }
  if (missing.includes("dueDate")) return `${intro} When is this due?`;
  return `${intro} How urgent is this task?`;
}

function lowercaseFirst(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function taskActionForSentence(title: string) {
  return lowercaseFirst(
    title
      .replace(/^to\s+/i, "")
      .replace(/\b(?:this\s+is\s+)?(?:not urgent|not high priority|no rush|not a rush)\b/gi, "")
      .replace(/\s+/g, " ")
      .replace(/^[,.:;-\s]+|[,.:;-\s]+$/g, "")
      .trim(),
  );
}

function formatChatDueDate(value: string | null) {
  if (!value) return "no due date";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
}

function formatChatTime(value: string | null | undefined) {
  const normalized = normalizeTimeOnly(value);
  if (!normalized) return "";
  const [hour, minute] = normalized.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function chatTaskOutcome(task: DonnitTask, members: Awaited<ReturnType<DonnitStore["listOrgMembers"]>>) {
  const assignee = members.find((member) => member.user_id === task.assigned_to);
  const assigneeName = memberDisplayName(assignee ?? {});
  const action = taskActionForSentence(task.title);
  const timeText = formatChatTime(task.due_time ?? task.start_time);
  const dueText = task.due_date ? ` by ${formatChatDueDate(task.due_date)}${timeText ? ` at ${timeText}` : ""}` : "";
  const repeatDetails = repeatDetailsFromDescription(task.description);
  const recurrenceText = task.recurrence !== "none"
    ? ` It repeats ${repeatDetails || task.recurrence}.`
    : "";
  const urgencyText =
    task.urgency === "critical"
      ? " It is marked critical."
      : task.urgency === "high"
        ? " It is marked high priority."
        : "";
  const visibilitySentence =
    task.visibility === "confidential"
      ? " This task was marked as confidential."
      : task.visibility === "personal"
        ? " This task was marked as personal."
        : "";
  return `I assigned ${assigneeName} to ${action}${dueText}.${recurrenceText}${urgencyText}${visibilitySentence}`;
}

function buildPendingFromTaskInput(input: {
  title: string;
  description: string;
  status: string;
  urgency: "low" | "normal" | "high" | "critical";
  dueDate: string | null;
  dueTime?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  isAllDay?: boolean;
  estimatedMinutes: number;
  assignedToId: string;
  assignedById: string;
  source: "chat";
  recurrence: DonnitTask["recurrence"];
  reminderDaysBefore: number;
  visibility: "work" | "personal" | "confidential";
  positionProfileId?: string | null;
}, missing: PendingChatMissingField[]): PendingChatTask {
  return {
    title: input.title,
    description: input.description,
    status: input.status as PendingChatTask["status"],
    urgency: input.urgency,
    dueDate: input.dueDate,
    dueTime: input.dueTime ?? null,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    isAllDay: input.isAllDay ?? false,
    estimatedMinutes: input.estimatedMinutes,
    assignedToId: input.assignedToId,
    assignedById: input.assignedById,
    source: "chat",
    recurrence: input.recurrence,
    reminderDaysBefore: input.reminderDaysBefore,
    visibility: input.visibility,
    positionProfileId: input.visibility === "personal" ? null : input.positionProfileId ?? null,
    missing,
    createdAt: new Date().toISOString(),
  };
}

async function getPendingChatTask(store: DonnitStore, orgId: string) {
  const key = `${orgId}:${store.userId}`;
  const fromMessages = await getPendingChatTaskFromMessages(store, orgId);
  if (fromMessages === false) return null;
  if (fromMessages) {
    if (pendingChatTaskExpired(fromMessages)) return null;
    pendingChatTaskMemory.set(key, fromMessages);
    return fromMessages;
  }
  try {
    const state = await store.getWorkspaceState(orgId, "onboarding_state");
    const value = (state?.value ?? {}) as Record<string, unknown>;
    const parsed = pendingChatTaskSchema.safeParse(value.pendingChatTask);
    if (parsed.success) {
      if (pendingChatTaskExpired(parsed.data)) return null;
      pendingChatTaskMemory.set(key, parsed.data);
      return parsed.data;
    }
  } catch (error) {
    console.error("[donnit] pending chat task read failed", error instanceof Error ? error.message : String(error));
  }
  const cached = pendingChatTaskMemory.get(key) ?? null;
  return cached && !pendingChatTaskExpired(cached) ? cached : null;
}

async function setPendingChatTask(store: DonnitStore, orgId: string, task: PendingChatTask) {
  const key = `${orgId}:${store.userId}`;
  pendingChatTaskMemory.set(key, task);
  try {
    await store.createChatMessage(orgId, {
      role: "system",
      content: `${pendingChatTaskMarker}${JSON.stringify(task)}`,
      task_id: null,
    });
  } catch (error) {
    console.error("[donnit] pending chat task system write failed", error instanceof Error ? error.message : String(error));
  }
  try {
    const state = await store.getWorkspaceState(orgId, "onboarding_state");
    await store.upsertWorkspaceState(orgId, "onboarding_state", {
      ...((state?.value ?? {}) as Record<string, unknown>),
      pendingChatTask: task,
    });
  } catch (error) {
    console.error("[donnit] pending chat task write failed", error instanceof Error ? error.message : String(error));
  }
}

async function clearPendingChatTask(store: DonnitStore, orgId: string) {
  const key = `${orgId}:${store.userId}`;
  pendingChatTaskMemory.delete(key);
  try {
    await store.createChatMessage(orgId, {
      role: "system",
      content: `${pendingChatTaskClearedMarker}:${new Date().toISOString()}`,
      task_id: null,
    });
  } catch (error) {
    console.error("[donnit] pending chat task system clear failed", error instanceof Error ? error.message : String(error));
  }
  try {
    const state = await store.getWorkspaceState(orgId, "onboarding_state");
    const rest = { ...((state?.value ?? {}) as Record<string, unknown>) };
    delete rest.pendingChatTask;
    await store.upsertWorkspaceState(orgId, "onboarding_state", {
      ...rest,
      pendingChatTaskClearedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[donnit] pending chat task clear failed", error instanceof Error ? error.message : String(error));
  }
}

function mergePendingChatTask(
  task: PendingChatTask,
  message: string,
  profiles: DonnitPositionProfile[] = [],
  members: Awaited<ReturnType<DonnitStore["listOrgMembers"]>> = [],
): PendingChatTask {
  const replyTitle = task.missing.includes("title") ? titleFromMessage(message) : task.title;
  const title = replyTitle && !isGenericAssignmentTitle(replyTitle) ? replyTitle : task.title;
  const mentionedAssignee = task.missing.includes("assignee") ? findMentionedMember(message, members) : null;
  const assignedToId = mentionedAssignee?.user_id ?? task.assignedToId;
  const dueDate = parseDueDate(message) ?? task.dueDate;
  const explicitUrgency = parseExplicitUrgency(message);
  const urgency = dueDate && isPastDue(dueDate) ? "critical" : (explicitUrgency ?? task.urgency);
  const estimatedMinutes = /\d/.test(message) ? parseEstimate(message) : task.estimatedMinutes;
  const timing = parseTaskTime(message, estimatedMinutes);
  const profileResolution = resolveChatPositionProfile({
    profiles,
    assignedToId,
    message,
    visibility: task.visibility,
  });
  const positionProfileId = task.positionProfileId ?? profileResolution.positionProfileId;
  const missing = task.missing.filter((item) => {
    if (item === "title") return isGenericAssignmentTitle(title);
    if (item === "assignee") return !mentionedAssignee;
    if (item === "dueDate") return !dueDate;
    if (item === "urgency") return explicitUrgency === null && !(dueDate && isPastDue(dueDate));
    if (item === "positionProfile") return !positionProfileId;
    return false;
  });
  return {
    ...task,
    title,
    description: task.missing.includes("title") ? `${task.description}\n\nClarification: ${message}` : task.description,
    dueDate,
    urgency,
    estimatedMinutes,
    assignedToId,
    status: assignedToId === task.assignedById ? "open" : "pending_acceptance",
    dueTime: timing.dueTime ?? task.dueTime ?? null,
    startTime: timing.startTime ?? task.startTime ?? null,
    endTime: timing.endTime ?? task.endTime ?? null,
    isAllDay: timing.isAllDay || task.isAllDay || false,
    positionProfileId,
    missing,
  };
}

function pendingChatTaskExpired(task: PendingChatTask) {
  if (!task.createdAt) return false;
  const createdAt = new Date(task.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt > 30 * 60 * 1000;
}

function looksLikeNewTaskIntent(message: string) {
  return hasStandaloneTaskIntent(message);
}

function hasStandaloneTaskIntent(message: string) {
  const text = message.toLowerCase().trim();
  if (
    /\b(assign|delegate|reassign|route|transfer|handoff|hand\s*off|add|create|make|log|capture|track|remind me|reminder|remember to|schedule|ask)\b/i.test(message)
  ) {
    return true;
  }
  if (/\b(?:i|we)\s+(?:need|have|want|plan|should|must)\s+to\b/.test(text)) return true;
  if (/^(?:need|have|want|plan|should|must)\s+to\b/.test(text)) return true;
  if (/\b(?:make sure|don't forget|take care of|look into|check on|close the loop|circle back|knock out)\b/.test(text)) return true;
  if (/\b(?:meeting|meet|appointment|call|interview|event)\b/.test(text) && Boolean(parseDueDate(message))) return true;
  if (/\b(?:take|catch|ride|travel|go|drive|walk)\b.+\b(?:meeting|appointment|call|event)\b/.test(text)) {
    return true;
  }
  return /\b(review|send|call|email|prepare|draft|complete|follow up|follow-up|reconcile|update|confirm|analyze|audit|submit|finish|meet|approve|approve|file|pay|renew|schedule|reschedule|book)\b/i.test(message);
}

async function getPendingChatTaskFromMessages(store: DonnitStore, orgId: string) {
  try {
    const messages = await store.listChatMessages(orgId);
    for (const message of [...messages].reverse()) {
      if (message.role !== "system") continue;
      if (message.content.startsWith(pendingChatTaskClearedMarker)) return false;
      if (!message.content.startsWith(pendingChatTaskMarker)) continue;
      const raw = message.content.slice(pendingChatTaskMarker.length).trim();
      const parsed = pendingChatTaskSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    }
  } catch (error) {
    console.error("[donnit] pending chat task message read failed", error instanceof Error ? error.message : String(error));
  }
  return undefined;
}

function looksLikeClarificationReply(message: string) {
  const text = message.toLowerCase().trim();
  const hasDueOrUrgency = Boolean(parseDueDate(message) || parseExplicitUrgency(message));
  if (!hasDueOrUrgency) return false;
  if (hasStandaloneTaskIntent(message)) return false;
  return (
    /^(it|it'?s|this|that|due|by|on|urgent|high|medium|normal|low|critical)\b/.test(text) ||
    !/\b(assign|create|add|make|review|send|call|email|prepare|draft|complete|follow|reconcile|schedule|update|confirm|analyze|audit)\b/.test(text)
  );
}

type SuggestionSource = "email" | "slack" | "sms" | "document";

const documentSuggestRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().max(160).optional(),
  dataBase64: z.string().min(16).max(12_000_000),
});

const taskSubtaskCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  position: z.number().int().min(0).max(1000).optional(),
});

const taskSubtaskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  done: z.boolean().optional(),
  position: z.number().int().min(0).max(1000).optional(),
});

const pendingChatTaskSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().max(1600).default(""),
  status: z.enum(["open", "pending_acceptance", "accepted", "denied", "completed"]),
  urgency: z.enum(["low", "normal", "high", "critical"]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  isAllDay: z.boolean().optional(),
  estimatedMinutes: z.number().int().min(5).max(1440),
  assignedToId: z.string().min(1),
  assignedById: z.string().min(1),
  source: z.literal("chat"),
  recurrence: z.enum(["none", "daily", "weekly", "monthly", "quarterly", "annual"]),
  reminderDaysBefore: z.number().int().min(0).max(365),
  visibility: z.enum(["work", "personal", "confidential"]),
  positionProfileId: z.string().nullable().optional(),
  missing: z.array(z.enum(["title", "assignee", "dueDate", "urgency", "positionProfile"])).default([]),
  createdAt: z.string().datetime().optional(),
});

type PendingChatTask = z.infer<typeof pendingChatTaskSchema>;
const pendingChatTaskMemory = new Map<string, PendingChatTask>();
const pendingChatTaskMarker = "DONNIT_PENDING_CHAT_TASK:";
const pendingChatTaskClearedMarker = "DONNIT_PENDING_CHAT_TASK_CLEARED";

const workspaceStateSchema = z.discriminatedUnion("key", [
  z.object({
    key: z.literal("reviewed_notifications"),
    value: z.object({
      ids: z.array(z.string().trim().min(1).max(240)).max(200),
    }),
  }),
  z.object({
    key: z.literal("agenda_state"),
    value: z.object({
      excludedTaskIds: z.array(z.union([z.string(), z.number()])).max(500).transform((items) => items.map(String)),
      approved: z.boolean(),
      approvedAt: z.string().datetime().nullable().optional(),
      preferences: z
        .object({
          workdayStart: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
          workdayEnd: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
          lunchStart: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
          lunchMinutes: z.number().int().min(0).max(120).optional(),
          meetingBufferMinutes: z.number().int().min(0).max(45).optional(),
          minimumBlockMinutes: z.number().int().min(5).max(60).optional(),
          focusBlockMinutes: z.number().int().min(30).max(180).optional(),
          morningPreference: z.enum(["deep_work", "communications", "mixed"]).optional(),
          afternoonPreference: z.enum(["deep_work", "communications", "mixed"]).optional(),
        })
        .optional()
        .transform((value) => cleanAgendaPreferences(value)),
      taskOrder: z.array(z.union([z.string(), z.number()])).max(500).optional().transform((items) => (items ?? []).map(String)),
      schedule: z
        .object({
          autoBuildEnabled: z.boolean().optional(),
          buildTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
          lastAutoBuildDate: z.string().nullable().optional(),
        })
        .optional()
        .transform((value) => cleanAgendaSchedule(value)),
    }),
  }),
  z.object({
    key: z.literal("onboarding_state"),
    value: z.object({
      dismissed: z.boolean(),
      dismissedAt: z.string().datetime().nullable().optional(),
    }),
  }),
]);

const profileSignatureSchema = z.object({
  emailSignature: z.string().max(1000).default("").transform((value) => value.trim()),
});

const memberRoleSchema = z.enum(["owner", "admin", "manager", "member", "viewer"]);
const memberStatusSchema = z.enum(["active", "inactive"]);
const memberCreateSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(240).transform((value) => value.toLowerCase()),
  role: memberRoleSchema.default("member"),
  persona: z.string().trim().min(1).max(80).default("operator"),
  managerId: z.string().uuid().nullable().optional(),
  canAssign: z.boolean().default(false),
  positionProfileId: z.string().uuid().nullable().optional(),
});
const memberUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  role: memberRoleSchema.optional(),
  persona: z.string().trim().min(1).max(80).optional(),
  managerId: z.string().uuid().nullable().optional(),
  canAssign: z.boolean().optional(),
  status: memberStatusSchema.optional(),
});

const positionProfileAssignSchema = z.object({
  profileId: z.string().trim().min(1).optional(),
  fromUserId: z.union([z.string().min(1), z.number()]),
  toUserId: z.union([z.string().min(1), z.number()]),
  mode: z.enum(["transfer", "delegate"]),
  delegateUntil: z.string().trim().max(20).nullable().optional(),
  profileTitle: z.string().trim().max(160).optional(),
  includeUnboundOwnerTasks: z.boolean().optional(),
});

const positionProfileCreateSchema = z.object({
  title: z.string().trim().min(2).max(160),
  ownerId: z.string().trim().min(1).nullable().optional(),
  managerId: z.string().trim().min(1).nullable().optional(),
  status: z.enum(["active", "vacant", "covered"]).optional(),
});

const positionProfileUpdateSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  status: z.enum(["active", "vacant", "covered"]).optional(),
  currentOwnerId: z.string().trim().min(1).nullable().optional(),
  directManagerId: z.string().trim().min(1).nullable().optional(),
  temporaryOwnerId: z.string().trim().min(1).nullable().optional(),
  delegateUserId: z.string().trim().min(1).nullable().optional(),
  delegateUntil: z.string().trim().max(20).nullable().optional(),
  riskSummary: z.string().trim().max(500).optional(),
  institutionalMemory: z.record(z.unknown()).optional(),
});

type DemoTaskSeed = {
  title: string;
  description: string;
  urgency: "low" | "normal" | "high" | "critical";
  dueOffset: number;
  estimatedMinutes: number;
  source: DonnitTask["source"];
  status?: DonnitTask["status"];
  recurrence?: DonnitTask["recurrence"];
  completedOffset?: number;
  subtasks?: string[];
};

type DemoTeamMemberSeed = {
  key: string;
  name: string;
  persona: string;
  role: "manager" | "member";
  canAssign: boolean;
  positionTitle: string;
  positionRisk: number;
  positionSummary: string;
  tasks: DemoTaskSeed[];
};

const demoTeamMembers: DemoTeamMemberSeed[] = [
  {
    key: "maya",
    name: "Maya Chen",
    persona: "operations",
    role: "manager" as const,
    canAssign: true,
    positionTitle: "Operations Manager",
    positionRisk: 42,
    positionSummary: "Owns weekly coverage planning, vendor coordination, and operational handoff routines.",
    tasks: [
      {
        title: "Confirm Friday client coverage plan",
        description: "Review open client work and confirm who owns the Friday coverage notes before the end of day.",
        urgency: "high" as const,
        dueOffset: 0,
        estimatedMinutes: 45,
        source: "chat" as const,
        subtasks: ["Review open client items", "Confirm backup owner", "Post coverage summary"],
      },
      {
        title: "Review unread vendor renewal request",
        description: "Vendor renewal came through email and needs a quick decision before the contract rolls over.",
        urgency: "normal" as const,
        dueOffset: 2,
        estimatedMinutes: 30,
        source: "email" as const,
        subtasks: ["Open vendor renewal email", "Confirm renewal amount", "Send decision to finance"],
      },
      {
        title: "Send weekly operations handoff",
        description: "Recurring Friday handoff that summarizes open blockers, owner changes, and weekend coverage.",
        urgency: "normal" as const,
        dueOffset: 5,
        estimatedMinutes: 40,
        source: "annual" as const,
        recurrence: "annual" as const,
      },
    ],
  },
  {
    key: "jordan",
    name: "Jordan Lee",
    persona: "client-success",
    role: "member" as const,
    canAssign: false,
    positionTitle: "Client Success Specialist",
    positionRisk: 68,
    positionSummary: "High-risk customer continuity role with overdue renewal work and recurring account knowledge.",
    tasks: [
      {
        title: "Follow up on ACME renewal blockers",
        description: "Slack thread flagged renewal blockers. Summarize next steps and update the manager before the account review.",
        urgency: "critical" as const,
        dueOffset: -1,
        estimatedMinutes: 60,
        source: "slack" as const,
        subtasks: ["Summarize renewal blockers", "Tag finance owner", "Update ACME account notes"],
      },
      {
        title: "Prepare onboarding notes for replacement coverage",
        description: "Add how-to context for recurring account handoff steps so another person can cover the role if needed.",
        urgency: "normal" as const,
        dueOffset: 4,
        estimatedMinutes: 50,
        source: "document" as const,
        subtasks: ["List recurring customer meetings", "Add contract renewal steps", "Attach account links"],
      },
      {
        title: "Complete QBR follow-up summary",
        description: "Summarized last quarter's customer follow-ups and attached the open action list for the account team.",
        urgency: "low" as const,
        dueOffset: -3,
        estimatedMinutes: 35,
        source: "manual" as const,
        status: "completed" as const,
        completedOffset: -2,
      },
    ],
  },
  {
    key: "nina",
    name: "Nina Patel",
    persona: "finance",
    role: "member" as const,
    canAssign: false,
    positionTitle: "Finance Coordinator",
    positionRisk: 35,
    positionSummary: "Maintains expense reconciliation, payroll access follow-up, and monthly close support.",
    tasks: [
      {
        title: "Reconcile ChatGPT expense receipt",
        description: "Receipt was captured from Gmail. Confirm the amount, category, and whether it should be attached to May expenses.",
        urgency: "normal" as const,
        dueOffset: 1,
        estimatedMinutes: 15,
        source: "email" as const,
        subtasks: ["Confirm receipt amount", "Select expense category", "Attach receipt to monthly report"],
      },
      {
        title: "Review payroll access request from Gmail",
        description: "Payroll access request came through email. Confirm whether the employee still needs help and document the resolution.",
        urgency: "high" as const,
        dueOffset: 0,
        estimatedMinutes: 20,
        source: "email" as const,
        subtasks: ["Reply to employee", "Confirm access status", "Note payroll resolution"],
      },
    ],
  },
];

const demoApprovalSuggestions = [
  {
    key: "slack-coverage",
    fromEmail: "slack:#people-ops",
    subject: "Slack: #people-ops",
    preview: "Can someone cover Taylor's onboarding checklist while Jordan is out?",
    body: "Maya: Can someone cover Taylor's onboarding checklist while Jordan is out? Need laptop, payroll, benefits, and first-week meetings confirmed before Friday.",
    actionItems: [
      "Assign onboarding checklist coverage",
      "Confirm laptop, payroll, benefits, and first-week meetings",
      "Source excerpt: Taylor onboarding coverage request in #people-ops",
    ],
    suggestedTitle: "Cover Taylor onboarding checklist",
    suggestedDueOffset: 2,
    urgency: "high" as const,
  },
  {
    key: "board-packet",
    fromEmail: "chief-of-staff@example.com",
    subject: "Board packet updates due this week",
    preview: "Please pull the latest operating metrics into the board packet by Thursday.",
    body: "Please pull the latest operating metrics into the board packet by Thursday and flag anything missing from Finance.",
    actionItems: ["Pull operating metrics", "Flag missing Finance inputs"],
    suggestedTitle: "Update board packet operating metrics",
    suggestedDueOffset: 3,
    urgency: "high" as const,
  },
  {
    key: "vendor-security",
    fromEmail: "security@example.com",
    subject: "Vendor security questionnaire",
    preview: "Can someone complete the vendor security questionnaire before procurement review?",
    body: "Can someone complete the vendor security questionnaire before procurement review next week? The account is waiting on this before signature.",
    actionItems: ["Complete vendor security questionnaire", "Send answers to procurement"],
    suggestedTitle: "Complete vendor security questionnaire",
    suggestedDueOffset: 5,
    urgency: "normal" as const,
  },
];

type IngestTarget = {
  orgId: string;
  assignedTo: string;
};

type ExternalTaskSuggestionInput = z.infer<typeof externalTaskSuggestionSchema>;

type AiTaskExtraction = {
  shouldCreateTask: boolean;
  taskType:
    | "assignment"
    | "follow_up"
    | "approval"
    | "expense"
    | "invoice"
    | "meeting"
    | "document_review"
    | "support"
    | "access"
    | "recurring"
    | "context_only";
  title: string;
  description: string;
  urgency: "low" | "normal" | "high" | "critical";
  dueDate: string | null;
  dueTime: string | null;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  estimatedMinutes: number;
  assigneeHint: string | null;
  visibility: "work" | "personal" | "confidential";
  recurrence: "none" | "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  reminderDaysBefore: number;
  replyNeeded: boolean;
  replyIntent: string | null;
  confidence: "low" | "medium" | "high";
  rationale: string;
  sourceExcerpt: string;
};

const aiTaskExtractionSchema = z.object({
  shouldCreateTask: z.boolean(),
  taskType: z.enum([
    "assignment",
    "follow_up",
    "approval",
    "expense",
    "invoice",
    "meeting",
    "document_review",
    "support",
    "access",
    "recurring",
    "context_only",
  ]),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1200).default(""),
  urgency: z.enum(["low", "normal", "high", "critical"]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  isAllDay: z.boolean(),
  estimatedMinutes: z.number().int().min(5).max(1440),
  assigneeHint: z.string().trim().max(160).nullable(),
  visibility: z.enum(["work", "personal", "confidential"]),
  recurrence: z.enum(["none", "daily", "weekly", "monthly", "quarterly", "annual"]),
  reminderDaysBefore: z.number().int().min(0).max(365),
  replyNeeded: z.boolean(),
  replyIntent: z.string().trim().max(300).nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  rationale: z.string().trim().max(400),
  sourceExcerpt: z.string().trim().max(300),
});

const suggestionPatchSchema = z.object({
  suggestedTitle: z.string().trim().min(2).max(160).optional(),
  suggestedDueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  urgency: z.enum(["low", "normal", "high", "critical"]).optional(),
  preview: z.string().trim().min(2).max(600).optional(),
  actionItems: z.array(z.string().trim().min(1).max(260)).max(8).optional(),
  assignedToId: z.union([z.string().min(1), z.number()]).nullable().optional(),
});

const suggestionReplySchema = z.object({
  message: z.string().trim().min(2).max(4000),
  completeTask: z.boolean().optional(),
});

const suggestionDraftReplySchema = z.object({
  instruction: z.string().trim().max(600).optional(),
});

const composioToolsQuerySchema = z.object({
  toolkits: z.string().trim().max(300).optional(),
  tools: z.string().trim().max(600).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const composioReadToolSchema = z.object({
  toolSlug: z.string().trim().min(2).max(120),
  arguments: z.record(z.unknown()).default({}),
  connectedAccountId: z.string().trim().min(1).max(160).optional(),
  version: z.string().trim().min(1).max(80).optional(),
});

const composioImportSchema = composioReadToolSchema.extend({
  source: z.enum(["email", "slack"]).default("email"),
  maxItems: z.number().int().min(1).max(10).default(5),
});

const salesLeadSchema = z.object({
  intent: z.enum(["signup", "demo"]).default("signup"),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(240),
  phone: z.string().trim().min(7).max(40),
  companyName: z.string().trim().max(160).optional(),
  message: z.string().trim().min(2).max(1200),
});

function extractOutputText(response: any): string | null {
  if (typeof response?.output_text === "string") return response.output_text;
  const output = Array.isArray(response?.output) ? response.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string") return part.text;
    }
  }
  return null;
}

function compactTaskText(value: string, max = 220) {
  const cleaned = value
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 3).trim()}...`;
}

function normalizeAiTitle(title: string, fallback: string, assigneeLabels: string[] = []) {
  const cleaned =
    titleFromMessage(title, assigneeLabels) ||
    titleFromMessage(fallback, assigneeLabels) ||
    fallback.trim();
  return compactTaskText(
    cleaned
      .replace(/^(?:please\s+)?(?:assign|delegate|reassign)\s+/i, "")
      .replace(/^to\s+/i, "")
      .replace(/\b(?:this\s+is\s+)?(?:not urgent|not high priority|no rush|not a rush)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim(),
    160,
  );
}

function normalizeAiDescription(description: string, fallback: string) {
  const cleaned = compactTaskText(description || fallback, 900);
  if (!cleaned) return compactTaskText(fallback, 900);
  return cleaned;
}

async function extractTaskWithAi(input: {
  source: SuggestionSource | "chat";
  text: string;
  memberLabels?: string[];
  from?: string;
  subject?: string;
  channel?: string;
  fallbackTitle?: string;
}): Promise<AiTaskExtraction | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const sourceInstructions: Record<SuggestionSource | "chat", string> = {
    chat: "Manager chat input may contain assignment commands, due dates, urgency, time estimates, and workplace shorthand.",
    email:
      "Email input may be a receipt, invoice, scheduling request, approval request, access notice, customer request, or FYI. Create a task only from the actionable next step implied by the email.",
    slack:
      "Slack input may be informal. Convert the actual request into a clean task title instead of copying the message.",
    sms:
      "SMS input may be short or fragmented. Infer the intended task conservatively and keep it clear.",
    document:
      "Document input may contain bullet points, meeting notes, policies, or project plans. Extract the clearest actionable item.",
  };
  const workplaceAbbreviations = {
    EOD: "end of day, due today",
    EOB: "end of business day, due today",
    COB: "close of business, due today",
    EOW: "end of week, due Friday of the current week unless the user says next EOW",
    EOM: "end of month",
    EOQ: "end of quarter",
    EOY: "end of year",
    OOO: "out of office",
    PTO: "paid time off",
    RIF: "reduction in force",
    SOW: "statement of work",
    MSA: "master services agreement",
    NDA: "non-disclosure agreement",
    QBR: "quarterly business review",
    OKR: "objectives and key results",
    KPI: "key performance indicator",
    SLA: "service level agreement",
    RFP: "request for proposal",
  };
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.DONNIT_AI_MODEL ?? "gpt-5-mini",
        input: [
          {
            role: "system",
            content: donnitTaskExtractionPolicy.join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              source: input.source,
              guidance: sourceInstructions[input.source],
              text: input.text,
              from: input.from ?? null,
              subject: input.subject ?? null,
              channel: input.channel ?? null,
              fallbackTitle: input.fallbackTitle ?? null,
              availableAssignees: input.memberLabels ?? [],
              today: todayIso(),
              currentYear: new Date().getFullYear(),
              workplaceAbbreviations,
              interpretationLexicon: donnitLanguageLexicon,
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "donnit_task_extraction",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                shouldCreateTask: { type: "boolean" },
                taskType: {
                  type: "string",
                  enum: [
                    "assignment",
                    "follow_up",
                    "approval",
                    "expense",
                    "invoice",
                    "meeting",
                    "document_review",
                    "support",
                    "access",
                    "recurring",
                    "context_only",
                  ],
                },
                title: { type: "string" },
                description: { type: "string" },
                urgency: { type: "string", enum: ["low", "normal", "high", "critical"] },
                dueDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
                dueTime: { anyOf: [{ type: "string", pattern: "^\\d{2}:\\d{2}$" }, { type: "null" }] },
                startTime: { anyOf: [{ type: "string", pattern: "^\\d{2}:\\d{2}$" }, { type: "null" }] },
                endTime: { anyOf: [{ type: "string", pattern: "^\\d{2}:\\d{2}$" }, { type: "null" }] },
                isAllDay: { type: "boolean" },
                estimatedMinutes: { type: "integer" },
                assigneeHint: { anyOf: [{ type: "string" }, { type: "null" }] },
                visibility: { type: "string", enum: ["work", "personal", "confidential"] },
                recurrence: { type: "string", enum: ["none", "daily", "weekly", "monthly", "quarterly", "annual"] },
                reminderDaysBefore: { type: "integer" },
                replyNeeded: { type: "boolean" },
                replyIntent: { anyOf: [{ type: "string" }, { type: "null" }] },
                confidence: { type: "string", enum: ["low", "medium", "high"] },
                rationale: { type: "string" },
                sourceExcerpt: { type: "string" },
              },
              required: [
                "shouldCreateTask",
                "taskType",
                "title",
                "description",
                "urgency",
                "dueDate",
                "dueTime",
                "startTime",
                "endTime",
                "isAllDay",
                "estimatedMinutes",
                "assigneeHint",
                "visibility",
                "recurrence",
                "reminderDaysBefore",
                "replyNeeded",
                "replyIntent",
                "confidence",
                "rationale",
                "sourceExcerpt",
              ],
            },
          },
        },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = extractOutputText(json);
    if (!text) return null;
    const parsed = aiTaskExtractionSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function extractChatTaskWithAi(message: string, memberLabels: string[]): Promise<AiTaskExtraction | null> {
  return extractTaskWithAi({ source: "chat", text: message, memberLabels });
}

function matchAiAssignee<T extends { name?: string; email?: string; id?: string | number }>(
  hint: string | null,
  candidates: T[],
): T | null {
  if (!hint) return null;
  const lowered = hint.toLowerCase();
  const hintTokens = new Set(lowered.match(/[a-z0-9._%+-]+/g) ?? []);
  return (
    candidates.find((candidate) => {
      return assigneeAliases(candidate.name, candidate.email).some((alias) => {
        if (alias.includes("@")) return lowered.includes(alias) || hintTokens.has(alias);
        return lowered === alias || lowered.includes(alias) || hintTokens.has(alias);
      });
    }) ?? null
  );
}

function sourceFromSuggestion(input: { fromEmail: string; subject: string }): SuggestionSource {
  const marker = `${input.fromEmail} ${input.subject}`.toLowerCase();
  if (marker.includes("slack:") || marker.includes("slack")) return "slack";
  if (marker.includes("sms:") || marker.includes("text message") || marker.includes("sms")) return "sms";
  if (marker.includes("document:") || marker.includes("document upload")) return "document";
  return "email";
}

function normalizeReplySubject(subject: string) {
  const trimmed = subject.trim() || "Donnit task follow-up";
  return trimmed.toLowerCase().startsWith("re:") ? trimmed : `Re: ${trimmed}`;
}

function extractEmailAddress(value: string) {
  const bracket = value.match(/<([^>\s]+@[^>\s]+)>/);
  if (bracket) return bracket[1];
  const plain = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return plain?.[0] ?? null;
}

function replyScenario(suggestion: Pick<DonnitEmailSuggestion, "subject" | "suggested_title" | "preview"> & { body?: string | null }) {
  const text = `${suggestion.subject} ${suggestion.suggested_title} ${suggestion.preview} ${suggestion.body ?? ""}`.toLowerCase();
  if (/\b(schedule|reschedule|meeting|meet|calendar|availability|available|call|demo|appointment|time to connect)\b/.test(text)) {
    return "scheduling";
  }
  if (/\b(approve|approval|sign off|authorize|permission)\b/.test(text)) return "approval";
  if (/\b(contract|agreement|proposal|sow|msa|terms|redline)\b/.test(text)) return "document_review";
  if (/\b(invoice|receipt|payment|paid|charge|expense|renewal)\b/.test(text)) return "finance";
  if (/\b(ticket|case|support|bug|issue|incident|customer)\b/.test(text)) return "support";
  if (/\b(question|can you|could you|please|need|request)\b/.test(text)) return "request";
  return "general";
}

function concreteSchedulingPhrase(sourceText: string) {
  const text = sourceText.replace(/\s+/g, " ").trim();
  const date =
    text.match(/\b(?:today|tomorrow|tonight)\b/i)?.[0] ??
    text.match(/\b(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)?.[0] ??
    text.match(new RegExp(`\\b(?:${monthNamePattern})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "i"))?.[0] ??
    null;
  const time =
    text.match(/\b(?:noon|midnight)\b/i)?.[0] ??
    text.match(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i)?.[0] ??
    null;
  if (date && time) return `${date} at ${time}`.replace(/\s+/g, " ");
  if (time) return time;
  return null;
}

function fallbackReplyDraft(
  suggestion: Pick<DonnitEmailSuggestion, "from_email" | "subject" | "suggested_title" | "preview"> & { body?: string | null },
) {
  const senderName =
    suggestion.from_email.match(/^"?([^"<@]+)"?\s*</)?.[1]?.trim() ??
    suggestion.from_email.split("@")[0]?.replace(/[._-]+/g, " ") ??
    "";
  const greeting = senderName ? `Hi ${senderName.split(/\s+/)[0]},` : "Hi,";
  const scenario = replyScenario(suggestion);
  const sourceText = `${suggestion.subject} ${suggestion.suggested_title} ${suggestion.preview} ${suggestion.body ?? ""}`;
  const proposedTime = concreteSchedulingPhrase(sourceText);
  const hasConcreteMeetingTime =
    scenario === "scheduling" &&
    Boolean(proposedTime) &&
    /\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{1,2}\/\d{1,2})\b/i.test(sourceText);
  const bodyByScenario: Record<string, string> = {
    scheduling:
      hasConcreteMeetingTime
        ? `Thanks for sending this over. I have ${proposedTime} noted and will send the calendar invite shortly.`
        : "Thanks for reaching out. I am happy to schedule time. Please send a few times that work for you, or share a calendar link and I will find a slot.",
    approval:
      "Thanks for sending this over. I will review the approval request and follow up with a decision or any questions.",
    document_review:
      "Thanks for sharing this. I will review the document and follow up with comments or next steps.",
    finance:
      "Thanks for sending this. I will review it for reconciliation or payment handling and follow up if anything else is needed.",
    support:
      "Thanks for flagging this. I will review the issue and follow up with the next step.",
    request:
      "Thanks for the note. I will review the request and follow up with the next step.",
    general:
      "Thanks for sending this. I will review it and follow up shortly.",
  };
  return [greeting, "", bodyByScenario[scenario] ?? bodyByScenario.general, "", "Best,"].join("\n");
}

async function completeRelatedTaskFromSuggestion(store: DonnitStore, suggestion: DonnitEmailSuggestion, actorId: string) {
  const source = sourceFromSuggestion({
    fromEmail: suggestion.from_email,
    subject: suggestion.subject,
  });
  const normalizedTitle = suggestion.suggested_title.trim().toLowerCase();
  const preferredAssignee = suggestion.assigned_to ?? actorId;
  const candidates = (await store.listTasks(suggestion.org_id))
    .filter((task) => task.source === source)
    .filter((task) => task.title.trim().toLowerCase() === normalizedTitle)
    .filter((task) => task.status !== "completed" && task.status !== "denied");
  const task = candidates.find((item) => item.assigned_to === preferredAssignee) ?? candidates[0] ?? null;
  if (!task) return null;
  const updated = await store.updateTask(task.id, {
    status: "completed",
    completed_at: new Date().toISOString(),
    completion_notes: "Completed after sending the source reply from Donnit.",
  });
  await store.addEvent(suggestion.org_id, {
    task_id: task.id,
    actor_id: actorId,
    type: "completed",
    note: "Marked done after sending the source reply from Donnit.",
  }).catch(() => null);
  return updated;
}

function draftLooksCopiedOrWeak(draft: string, suggestion: DonnitEmailSuggestion) {
  const normalizedDraft = draft.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedSource = `${suggestion.subject} ${suggestion.body}`.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalizedDraft.length < 40) return true;
  if (normalizedDraft.includes("donnit interpretation") || normalizedDraft.includes("source excerpt")) return true;
  const sourceSlice = normalizedSource.slice(0, 180);
  return sourceSlice.length > 80 && normalizedDraft.includes(sourceSlice);
}

function parseSlackChannelFromSuggestion(suggestion: Pick<DonnitEmailSuggestion, "subject" | "from_email">) {
  const subjectChannel = suggestion.subject.match(/^slack:\s*(.+)$/i)?.[1]?.trim();
  if (subjectChannel) return subjectChannel;
  const fromChannel = suggestion.from_email.match(/^slack:\s*(C[A-Z0-9]+|G[A-Z0-9]+|D[A-Z0-9]+)/i)?.[1]?.trim();
  return fromChannel || null;
}

function parseSmsPhoneFromSuggestion(suggestion: Pick<DonnitEmailSuggestion, "from_email">) {
  const raw = suggestion.from_email.replace(/^sms:/i, "").trim();
  const phone = raw.match(/\+?[0-9][0-9\s().-]{7,}[0-9]/)?.[0]?.replace(/[^\d+]/g, "");
  if (!phone) return null;
  return phone.startsWith("+") ? phone : `+${phone}`;
}

async function sendSlackReply(input: { channel: string; message: string }) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, reason: "missing_slack_bot_token" };
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      channel: input.channel,
      text: input.message,
    }),
  });
  if (!response.ok) return { ok: false, reason: `slack_http_${response.status}` };
  const payload = (await response.json()) as { ok?: boolean; error?: string; ts?: string };
  return payload.ok
    ? { ok: true, providerMessageId: payload.ts ?? null }
    : { ok: false, reason: payload.error ?? "slack_send_failed" };
}

async function sendSmsReply(input: { to: string; message: string }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) return { ok: false, reason: "missing_twilio_config" };
  const body = new URLSearchParams({
    To: input.to,
    From: from,
    Body: input.message,
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) return { ok: false, reason: `twilio_http_${response.status}` };
  const payload = (await response.json()) as { sid?: string; error_message?: string };
  return payload.sid
    ? { ok: true, providerMessageId: payload.sid }
    : { ok: false, reason: payload.error_message ?? "twilio_send_failed" };
}

function salesLeadText(input: z.infer<typeof salesLeadSchema>) {
  return [
    `Intent: ${input.intent === "demo" ? "Book a demo" : "Sign up"}`,
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Phone: ${input.phone}`,
    `Company: ${input.companyName?.trim() || "Not provided"}`,
    "",
    "Message:",
    input.message,
  ].join("\n");
}

function salesLeadMailto(input: z.infer<typeof salesLeadSchema>) {
  const to = process.env.DONNIT_SALES_TO_EMAIL || "sales@donnit.ai";
  const subject = input.intent === "demo" ? "Donnit demo request" : "Donnit sign up request";
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(salesLeadText(input))}`;
}

async function sendSalesLead(input: z.infer<typeof salesLeadSchema>) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.DONNIT_SALES_FROM_EMAIL;
  const to = process.env.DONNIT_SALES_TO_EMAIL || "sales@donnit.ai";
  if (!apiKey || !from) return { ok: false, reason: "sales_email_not_configured" };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      reply_to: input.email,
      subject: input.intent === "demo" ? `Donnit demo request from ${input.name}` : `Donnit sign up request from ${input.name}`,
      text: salesLeadText(input),
    }),
  });
  if (!response.ok) return { ok: false, reason: `resend_http_${response.status}` };
  const payload = (await response.json()) as { id?: string };
  return { ok: true, providerMessageId: payload.id ?? null };
}

async function resolveDefaultIngestTarget(): Promise<IngestTarget | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (orgError) throw orgError;
  const orgId = typeof org?.id === "string" ? org.id : null;
  if (!orgId) return null;

  const { data: members, error: memberError } = await admin
    .from("organization_members")
    .select("user_id, role, can_assign, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (memberError) throw memberError;

  const rows = Array.isArray(members) ? members : [];
  const owner =
    rows.find((member: any) => member.role === "owner") ??
    rows.find((member: any) => member.can_assign) ??
    rows[0];
  const assignedTo = typeof owner?.user_id === "string" ? owner.user_id : null;
  return assignedTo ? { orgId, assignedTo } : null;
}

type TaskSuggestionCandidate = {
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  fromEmail: string;
  subject: string;
  preview: string;
  body: string;
  receivedAt: string | null;
  actionItems: string[];
  suggestedTitle: string;
  suggestedDueDate: string | null;
  urgency: string;
  estimatedMinutes?: number;
  shouldCreateTask?: boolean;
  replySuggested?: boolean;
  replyDraft?: string | null;
  replyStatus?: "none" | "suggested" | "drafted" | "sent" | "copy" | "failed";
};

type EnrichedTaskSuggestionCandidate<T extends TaskSuggestionCandidate> = T & {
  shouldCreateTask?: boolean;
  replySuggested?: boolean;
  replyDraft?: string | null;
  replyStatus?: "none" | "suggested" | "drafted" | "sent" | "copy" | "failed";
};

function shouldSuggestSourceReply(candidate: TaskSuggestionCandidate, ai: AiTaskExtraction | null, source: SuggestionSource) {
  if (source !== "email") return source === "slack" || source === "sms";
  if (ai?.replyNeeded) return true;
  const text = `${candidate.subject}\n${candidate.preview}\n${candidate.body}`.toLowerCase();
  if (/\b(no-?reply|do not reply|newsletter|receipt|invoice paid|order confirmation|shipping|tracking)\b/i.test(text)) {
    return false;
  }
  return /\b(can you|could you|please|would you|let me know|thoughts\?|approve|approval|review|respond|reply|follow up|available|schedule|confirm)\b/i.test(text);
}

function applyAiToCandidate<T extends TaskSuggestionCandidate>(
  candidate: T,
  ai: AiTaskExtraction | null,
  source: SuggestionSource,
): EnrichedTaskSuggestionCandidate<T> {
  if (!ai) {
    const replySuggested = shouldSuggestSourceReply(candidate, null, source);
    return { ...candidate, replySuggested, replyStatus: replySuggested ? "suggested" : "none" };
  }
  const title = normalizeAiTitle(ai.title, candidate.suggestedTitle);
  const dueDate = ai.dueDate ?? candidate.suggestedDueDate ?? null;
  const urgency = dueDate && isPastDue(dueDate) ? "critical" : ai.urgency;
  const replySuggested = shouldSuggestSourceReply(candidate, ai, source);
  const actionItems = [
    normalizeAiDescription(ai.description, candidate.preview),
    `Why Donnit suggested this: ${ai.rationale}`,
    `Confidence: ${ai.confidence}`,
    `Estimated time: ${ai.estimatedMinutes} minutes`,
    ai.replyNeeded && ai.replyIntent ? `Suggested response: ${ai.replyIntent}` : "",
    ai.sourceExcerpt ? `Source excerpt: ${compactTaskText(ai.sourceExcerpt, 240)}` : "",
  ].filter(Boolean);
  return {
    ...candidate,
    shouldCreateTask: ai.shouldCreateTask,
    replySuggested,
    replyStatus: replySuggested ? "suggested" : "none",
    preview: ai.rationale || candidate.preview,
    actionItems,
    suggestedTitle: title,
    suggestedDueDate: dueDate,
    urgency,
    estimatedMinutes: ai.estimatedMinutes,
    body:
      candidate.body && candidate.body.trim().length > 0
        ? `${candidate.body}\n\nAI interpretation: ${normalizeAiDescription(ai.description, ai.rationale)}`.slice(0, 4000)
        : `${source.toUpperCase()} interpretation: ${normalizeAiDescription(ai.description, ai.rationale)}`.slice(0, 4000),
  };
}

async function enrichSuggestionCandidateWithAi<T extends TaskSuggestionCandidate>(
  candidate: T,
  source: SuggestionSource,
  context?: { from?: string; channel?: string },
): Promise<EnrichedTaskSuggestionCandidate<T>> {
  const ai = await extractTaskWithAi({
    source,
    text: `${candidate.subject}\n${candidate.preview}\n${candidate.body ?? ""}`.slice(0, 5000),
    from: context?.from ?? candidate.fromEmail,
    subject: candidate.subject,
    channel: context?.channel,
    fallbackTitle: candidate.suggestedTitle,
  });
  return applyAiToCandidate(candidate, ai, source);
}

function buildExternalSuggestionCandidate(input: {
  source: "slack" | "sms";
  text: string;
  from?: string;
  channel?: string;
  subject?: string;
}) {
  const sourceLabel = input.source === "slack" ? "Slack" : "SMS";
  const actor = input.from?.trim() || (input.source === "slack" ? "Slack user" : "SMS user");
  const context = input.channel?.trim();
  const title = titleFromMessage(input.text, [actor]) || `Review ${sourceLabel} request`;
  const urgency = parseUrgency(input.text);
  const dueDate = parseDueDate(input.text);
  const estimate = parseEstimate(input.text);
  const rationale = `${sourceLabel} message from ${actor}${context ? ` in ${context}` : ""} appears actionable.`;
  return {
    fromEmail: `${input.source}:${actor}`,
    subject: input.subject?.trim() || `${sourceLabel}${context ? `: ${context}` : ""}`,
    preview: `${rationale} Suggested task: ${title}.`,
    body: input.text,
    receivedAt: new Date().toISOString(),
    actionItems: [`Confirm and assign: ${title}.`],
    suggestedTitle: title,
    suggestedDueDate: dueDate,
    urgency,
    estimatedMinutes: estimate,
  };
}

function compactJson(value: unknown, max = 4000) {
  const text =
    typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);
  return compactTaskText(text ?? "", max);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function nestedValue(source: Record<string, unknown>, ...paths: string[]) {
  for (const path of paths) {
    const parts = path.split(".");
    let current: unknown = source;
    for (const part of parts) {
      if (!current || typeof current !== "object") {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    if (current != null) return current;
  }
  return undefined;
}

function composioResultItems(result: unknown, maxItems: number): unknown[] {
  const payload = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const candidates = [
    payload.data,
    nestedValue(payload, "data.items"),
    nestedValue(payload, "data.messages"),
    nestedValue(payload, "data.results"),
    nestedValue(payload, "result"),
    nestedValue(payload, "result.items"),
    nestedValue(payload, "result.messages"),
    nestedValue(payload, "items"),
    nestedValue(payload, "messages"),
    nestedValue(payload, "results"),
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate.slice(0, maxItems);
  }
  return [result].filter(Boolean).slice(0, maxItems);
}

function composioSuggestionKey(toolSlug: string, source: "email" | "slack", item: unknown) {
  return `composio:${source}:${crypto
    .createHash("sha1")
    .update(`${toolSlug}:${compactJson(item, 2000)}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function buildComposioSuggestionCandidate(input: {
  toolSlug: string;
  source: "email" | "slack";
  item: unknown;
}): TaskSuggestionCandidate {
  const item = input.item && typeof input.item === "object" ? input.item as Record<string, unknown> : {};
  const from = firstString(
    nestedValue(item, "from.email"),
    nestedValue(item, "sender.email"),
    nestedValue(item, "author.email"),
    item.fromEmail,
    item.from,
    item.sender,
    item.author,
    input.source === "slack" ? "composio:slack" : "composio:gmail",
  );
  const subject = firstString(item.subject, item.title, item.name, item.channel, `${input.source === "slack" ? "Slack" : "Email"} item from Composio`);
  const body = firstString(
    item.body,
    item.text,
    item.message,
    item.content,
    item.snippet,
    item.preview,
    nestedValue(item, "payload.body"),
    nestedValue(item, "data.body"),
    compactJson(input.item),
  );
  const receivedAt = firstString(item.receivedAt, item.received_at, item.date, item.createdAt, item.created_at, item.ts) || new Date().toISOString();
  const sourceText = `${subject}\n${body}`;
  const title = titleFromMessage(sourceText, [from]) || `Review imported ${input.source} item`;
  return {
    gmailMessageId: composioSuggestionKey(input.toolSlug, input.source, input.item),
    gmailThreadId: firstString(item.threadId, item.thread_id, item.gmailThreadId) || null,
    fromEmail: input.source === "slack" ? `slack:${from}` : from,
    subject,
    preview: compactTaskText(sourceText, 600),
    body: compactJson({ tool: input.toolSlug, source: "composio", item: input.item }, 4000),
    receivedAt,
    actionItems: [`Review imported ${input.source} context from Composio.`],
    suggestedTitle: title,
    suggestedDueDate: parseDueDate(sourceText),
    urgency: parseUrgency(sourceText),
    estimatedMinutes: parseEstimate(sourceText),
  };
}

function externalSuggestionKey(source: "slack" | "sms", candidate: TaskSuggestionCandidate) {
  return `${source}:${crypto
    .createHash("sha1")
    .update(`${candidate.subject}:${candidate.fromEmail}:${candidate.body}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function normalizeActorLookup(value: string | undefined | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/^slack:/, "")
    .replace(/[<@>]/g, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

async function resolveAssignedToFromActor(store: DonnitStore, orgId: string, actor: string | undefined, fallback: string) {
  const lookup = normalizeActorLookup(actor);
  if (!lookup) return fallback;
  const members = await store.listOrgMembers(orgId);
  const match = members.find((member) => {
    const email = member.profile?.email?.toLowerCase() ?? "";
    const name = member.profile?.full_name?.toLowerCase() ?? "";
    return (
      (email && (email === lookup || email.startsWith(`${lookup}@`))) ||
      (name && (name === lookup || name.includes(lookup) || lookup.includes(name)))
    );
  });
  return match?.user_id ?? fallback;
}

function verifySlackRequest(req: Request) {
  const expectedToken = process.env.DONNIT_SLACK_WEBHOOK_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const providedToken = req.get("x-donnit-ingest-token");
  if (expectedToken && providedToken === expectedToken) return true;
  if (!signingSecret) return false;
  const timestamp = req.get("x-slack-request-timestamp");
  const signature = req.get("x-slack-signature");
  const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString("utf8") : "";
  if (!timestamp || !signature || !raw) return false;
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 60 * 5) return false;
  const expected = `v0=${crypto
    .createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${raw}`)
    .digest("hex")}`;
  return (
    Buffer.byteLength(signature) === Buffer.byteLength(expected) &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}

function verifySmsRequest(req: Request) {
  const expectedToken = process.env.DONNIT_SMS_WEBHOOK_TOKEN;
  const providedToken = req.get("x-donnit-ingest-token");
  if (expectedToken && providedToken === expectedToken) return true;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.get("x-twilio-signature");
  if (!authToken || !signature) return false;
  const proto = req.get("x-forwarded-proto") ?? req.protocol ?? "https";
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "";
  const fullUrl = `${proto}://${host}${req.originalUrl}`;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const paramString = Object.keys(body)
    .sort()
    .map((key) => `${key}${String(body[key] ?? "")}`)
    .join("");
  const expected = crypto.createHmac("sha1", authToken).update(`${fullUrl}${paramString}`).digest("base64");
  return (
    Buffer.byteLength(signature) === Buffer.byteLength(expected) &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}

function normalizeSmsInboundBody(body: unknown): ExternalTaskSuggestionInput | null {
  if (!body || typeof body !== "object") return null;
  const input = body as Record<string, unknown>;
  const text = typeof input.text === "string" ? input.text : typeof input.Body === "string" ? input.Body : "";
  if (!text.trim()) return null;
  const from = typeof input.from === "string" ? input.from : typeof input.From === "string" ? input.From : undefined;
  const to = typeof input.to === "string" ? input.to : typeof input.To === "string" ? input.To : undefined;
  const sid = typeof input.MessageSid === "string" ? input.MessageSid : typeof input.SmsMessageSid === "string" ? input.SmsMessageSid : undefined;
  return {
    text,
    from,
    channel: to ? `to ${to}` : "sms",
    subject: sid ? `SMS: ${sid}` : "SMS inbound",
    assignedToId: typeof input.assignedToId === "string" || typeof input.assignedToId === "number" ? input.assignedToId : undefined,
  };
}

async function lookupSlackUserLabel(userId: string | undefined | null) {
  if (!userId) return "Slack user";
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) return userId;
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
      headers: { authorization: `Bearer ${botToken}` },
    });
    if (!res.ok) return userId;
    const payload = (await res.json()) as {
      ok?: boolean;
      user?: { real_name?: string; name?: string; profile?: { email?: string; real_name?: string; display_name?: string } };
    };
    if (!payload.ok || !payload.user) return userId;
    return (
      payload.user.profile?.email ||
      payload.user.profile?.display_name ||
      payload.user.profile?.real_name ||
      payload.user.real_name ||
      payload.user.name ||
      userId
    );
  } catch {
    return userId;
  }
}

async function extractUploadedDocumentText(input: {
  fileName: string;
  mimeType?: string;
  dataBase64: string;
}) {
  const buffer = Buffer.from(input.dataBase64, "base64");
  if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) {
    throw new Error("Document must be smaller than 8MB.");
  }
  const name = input.fileName.toLowerCase();
  const mime = (input.mimeType ?? "").toLowerCase();
  if (name.endsWith(".pdf") || mime.includes("pdf")) {
    const mod: any = await import("pdf-parse");
    const pdfParse = mod.default ?? mod;
    const result = await pdfParse(buffer);
    return String(result?.text ?? "");
  }
  if (name.endsWith(".docx") || mime.includes("wordprocessingml")) {
    const mod: any = await import("mammoth");
    const result = await mod.extractRawText({ buffer });
    return String(result?.value ?? "");
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || mime.startsWith("text/")) {
    return buffer.toString("utf8");
  }
  throw new Error("Upload a PDF, Word .docx, or text file.");
}

function buildDocumentSuggestionCandidates(input: {
  fileName: string;
  text: string;
  assignedToId: string | number;
}) {
  const cleaned = input.text.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
  const lines = cleaned
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length >= 8 && line.length <= 280);
  const actionable = lines.filter((line) =>
    /\b(assign|send|review|approve|update|prepare|create|call|follow up|follow-up|schedule|renew|submit|complete|draft|reconcile|confirm|collect|onboard|train|audit)\b/i.test(line),
  );
  const candidates = (actionable.length > 0 ? actionable : lines).slice(0, 10);
  const selected =
    candidates.length > 0
      ? candidates
      : cleaned
          .split(/(?<=[.!?])\s+/)
          .filter((sentence) => sentence.length >= 16)
          .slice(0, 5);

  return selected.map((raw, index) => {
    const title = titleFromMessage(raw) || `Review ${input.fileName}`;
    const dueDate = parseDueDate(raw);
    const urgency = isPastDue(dueDate) ? "critical" : parseUrgency(raw);
    return {
      fromEmail: `document:${input.fileName}`,
      subject: `Document upload: ${input.fileName}`,
      preview: raw.slice(0, 500),
      body: cleaned.slice(0, 4000),
      receivedAt: new Date().toISOString(),
      actionItems: [`Review document item ${index + 1}: ${title}.`],
      suggestedTitle: title,
      suggestedDueDate: dueDate,
      urgency,
      assignedTo: input.assignedToId,
    };
  });
}

function normalizeDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) ? trimmed : null;
  }
  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function normalizeTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export const __chatParserTest = {
  findBestMentionedCandidates,
  fallbackReplyDraft,
  hasExplicitAssignmentIntent,
  nextRecurringDueDate,
  parseDueDate,
  parseEstimate,
  parseTaskTime,
  parseTaskRecurrence,
  repeatDetailsFromDescription,
  rewriteRequesterReferencesInTitle,
  chatTaskOutcome,
  titleFromMessage,
};

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
          openAiApiKey: Boolean(process.env.OPENAI_API_KEY),
          donnitAiModel: process.env.DONNIT_AI_MODEL ?? "gpt-5-mini",
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

  app.patch("/api/profile/signature", requireDonnitAuth, async (req: Request, res: Response) => {
    const parsed = profileSignatureSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Signature payload is invalid." });
      return;
    }
    try {
      const auth = req.donnitAuth!;
      const store = new DonnitStore(auth.client, auth.userId);
      const profile = await store.updateProfileSignature(parsed.data.emailSignature);
      res.json({
        ok: true,
        emailSignature: profile.email_signature ?? "",
        profile: {
          id: profile.id,
          fullName: profile.full_name,
          email: profile.email,
          emailSignature: profile.email_signature ?? "",
        },
      });
    } catch (error) {
      const described = describeSupabaseError(error);
      const reason = classifySupabaseError(described, { schema: DONNIT_SCHEMA, table: "profiles" });
      if (reason === "invalid_column") {
        res.status(409).json({
          ok: false,
          reason: "profile_signature_schema_missing",
          message: "Email signatures are not available yet. Apply Supabase migration 20260511165451_profile_email_signature.sql, then redeploy.",
          code: described.code,
          details: described.details,
          hint: described.hint,
        });
        return;
      }
      const payload = serializeSupabaseError(error);
      console.error("[donnit] profile signature update failed", {
        reason,
        userId: req.donnitAuth?.userId,
        ...payload,
      });
      res.status(reason === "rls_denied" || reason === "permission_denied_grants_missing" ? 403 : 500).json({ ok: false, ...payload });
    }
  });

  app.patch("/api/workspace-state", requireDonnitAuth, async (req: Request, res: Response) => {
    const parsed = workspaceStateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Workspace state payload is invalid." });
      return;
    }
    try {
      const auth = req.donnitAuth!;
      const store = new DonnitStore(auth.client, auth.userId);
      const orgId = await store.getDefaultOrgId();
      if (!orgId) {
        res.status(409).json({ message: "Workspace not bootstrapped." });
        return;
      }
      const stateKey = parsed.data.key as DonnitUserWorkspaceState["state_key"];
      const state = await store.upsertWorkspaceState(orgId, stateKey, parsed.data.value);
      res.json({ ok: true, state });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/admin/seed-demo-team", requireDonnitAuth, async (req: Request, res: Response) => {
    try {
      const auth = req.donnitAuth!;
      const userStore = new DonnitStore(auth.client, auth.userId);
      const orgId = await userStore.getDefaultOrgId();
      if (!orgId) {
        res.status(409).json({ message: "Workspace not bootstrapped." });
        return;
      }
      const members = await userStore.listOrgMembers(orgId);
      const actor = members.find((member) => member.user_id === auth.userId);
      if (!["owner", "admin"].includes(String(actor?.role ?? ""))) {
        res.status(403).json({ message: "Only workspace admins can add demo team members." });
        return;
      }
      const admin = createSupabaseAdminClient();
      if (!admin) {
        res.status(503).json({
          message: "Demo team seeding needs SUPABASE_SERVICE_ROLE_KEY in Vercel.",
        });
        return;
      }
      const store = new DonnitStore(admin, auth.userId);
      const seededUsers: Array<{ id: string; name: string; email: string }> = [];
      let createdTasks = 0;
      let createdSubtasks = 0;
      let completedTasks = 0;
      let createdSuggestions = 0;
      let createdProfiles = 0;
      let skippedProfiles = 0;
      const seedWarnings: string[] = [];
      const existingTasks = await store.listTasks(orgId);
      const allTasks = [...existingTasks];
      const allSubtasks = await store.listTaskSubtasks(orgId);
      const existingSuggestions = await store.listEmailSuggestions(orgId);
      const allPositionProfiles = await store.listPositionProfiles(orgId);
      const dateForOffset = (days: number) => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString().slice(0, 10);
      };
      const timestampForOffset = (days: number) => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString();
      };

      for (const legacyTask of allTasks.filter((task) => task.title === "Respond to payroll access text")) {
        const updated = await store.updateTask(legacyTask.id, {
          title: "Review payroll access request from Gmail",
          description: "Payroll access request came through email. Confirm whether the employee still needs help and document the resolution.",
          source: "email",
        });
        if (updated) Object.assign(legacyTask, updated);
      }

      for (const seed of demoTeamMembers) {
        const email = `demo-${seed.key}-${orgId.slice(0, 8)}@example.invalid`;
        const { data: existingProfile, error: profileLookupError } = await admin
          .from(DONNIT_TABLES.profiles)
          .select("*")
          .eq("email", email)
          .maybeSingle();
        if (profileLookupError) throw profileLookupError;

        let userId = typeof existingProfile?.id === "string" ? existingProfile.id : null;
        if (!userId) {
          const created = await admin.auth.admin.createUser({
            email,
            password: crypto.randomBytes(18).toString("base64url"),
            email_confirm: true,
            user_metadata: {
              full_name: seed.name,
              donnit_demo_team: true,
            },
          });
          if (created.error || !created.data.user?.id) throw created.error ?? new Error("Could not create demo user.");
          userId = created.data.user.id;
        }

        const { error: profileError } = await admin
          .from(DONNIT_TABLES.profiles)
          .upsert(
            {
              id: userId,
              full_name: seed.name,
              email,
              default_org_id: orgId,
              persona: seed.persona,
            },
            { onConflict: "id" },
          );
        if (profileError) throw profileError;

        const { error: memberError } = await admin
          .from(DONNIT_TABLES.organizationMembers)
          .upsert(
            {
              org_id: orgId,
              user_id: userId,
              role: seed.role,
              manager_id: seed.role === "manager" ? null : auth.userId,
              can_assign: seed.canAssign,
            },
            { onConflict: "org_id,user_id" },
          );
        if (memberError) throw memberError;

        seededUsers.push({ id: userId, name: seed.name, email });

        for (const taskSeed of seed.tasks) {
          let task = allTasks.find(
            (task) => task.assigned_to === userId && task.title === taskSeed.title,
          );
          if (!task) {
            task = await store.createTask(orgId, {
              title: taskSeed.title,
              description: taskSeed.description,
              status: taskSeed.status ?? (taskSeed.source === "chat" ? "pending_acceptance" : "open"),
              urgency: taskSeed.urgency,
              due_date: dateForOffset(taskSeed.dueOffset),
              estimated_minutes: taskSeed.estimatedMinutes,
              assigned_to: userId,
              assigned_by: auth.userId,
              source: taskSeed.source,
              recurrence: taskSeed.recurrence ?? "none",
              reminder_days_before: taskSeed.recurrence === "annual" ? 14 : 0,
            });
            allTasks.push(task);
            createdTasks += 1;
          }
          if (taskSeed.status === "completed" && !task.completed_at) {
            const completedAt = timestampForOffset(taskSeed.completedOffset ?? 0);
            const updated = await store.updateTask(task.id, {
              status: "completed",
              completed_at: completedAt,
              completion_notes: "Completed in the demo workspace to show reporting history.",
            });
            if (updated) {
              Object.assign(task, updated);
              await store.addEvent(orgId, {
                task_id: task.id,
                actor_id: auth.userId,
                type: "completed",
                note: "Demo workspace seeded a completed task for reporting.",
              });
              completedTasks += 1;
            }
          }
          const subtaskTitles = taskSeed.subtasks ?? [];
          for (let position = 0; position < subtaskTitles.length; position += 1) {
            const title = subtaskTitles[position];
            const exists = allSubtasks.some(
              (subtask) => subtask.task_id === task!.id && subtask.title === title,
            );
            if (exists) continue;
            const subtask = await store.createTaskSubtask(orgId, {
              task_id: task.id,
              title,
              position,
            });
            allSubtasks.push(subtask);
            createdSubtasks += 1;
          }
        }

        const profileExists = allPositionProfiles.some((profile) => profile.title === seed.positionTitle);
        if (!profileExists) {
          try {
            const profile = await store.createPositionProfile(orgId, {
              title: seed.positionTitle,
              status: "active",
              current_owner_id: userId,
              direct_manager_id: auth.userId,
              risk_score: seed.positionRisk,
              risk_summary: seed.positionSummary,
              auto_update_rules: {
                mode: "demo",
                reviewHighImpactChanges: true,
                preserveInstitutionalKnowledge: true,
              },
              institutional_memory: {
                source: "demo_seed",
                recurringResponsibilities: seed.tasks
                  .filter((task) => task.recurrence !== "none" || task.source === "annual")
                  .map((task) => task.title),
                howTo:
                  seed.key === "jordan"
                    ? ["Renewal blockers are usually collected from Slack, then summarized into the account notes before QBR prep."]
                    : seed.key === "maya"
                      ? ["Friday coverage plans should identify owner, backup, deadline, and unresolved blocker for each client."]
                      : ["Expense receipts should be reconciled against the monthly close folder and tagged by vendor."],
                tools: seed.key === "nina" ? ["Gmail", "Payroll", "Expense system"] : ["Slack", "Gmail", "Calendar"],
              },
            });
            allPositionProfiles.push(profile);
            createdProfiles += 1;
          } catch (error) {
            const reason = classifySupabaseError(describeSupabaseError(error), {
              schema: DONNIT_SCHEMA,
              table: "position_profiles",
            });
            if (reason !== "missing_table" && reason !== "schema_not_exposed") throw error;
            skippedProfiles += 1;
            if (!seedWarnings.includes("position_profiles_unavailable")) {
              seedWarnings.push("position_profiles_unavailable");
            }
          }
        }
      }

      for (const suggestionSeed of demoApprovalSuggestions) {
        const messageId = `demo-${suggestionSeed.key}-${orgId}`;
        const alreadyExists = existingSuggestions.some((suggestion) => suggestion.gmail_message_id === messageId);
        if (alreadyExists) continue;
        await store.createEmailSuggestion(orgId, {
          gmail_message_id: messageId,
          gmail_thread_id: null,
          from_email: suggestionSeed.fromEmail,
          subject: suggestionSeed.subject,
          preview: suggestionSeed.preview,
          body: suggestionSeed.body,
          received_at: timestampForOffset(-1),
          action_items: suggestionSeed.actionItems,
          suggested_title: suggestionSeed.suggestedTitle,
          suggested_due_date: dateForOffset(suggestionSeed.suggestedDueOffset),
          urgency: suggestionSeed.urgency,
          assigned_to: auth.userId,
          reply_suggested: true,
          reply_status: "suggested",
        });
        createdSuggestions += 1;
      }

      res.status(201).json({
        ok: true,
        users: seededUsers.length,
        tasks: createdTasks,
        subtasks: createdSubtasks,
        suggestions: createdSuggestions,
        positionProfiles: createdProfiles,
        skippedPositionProfiles: skippedProfiles,
        completedTasks,
        warnings: seedWarnings,
        message:
          seedWarnings.includes("position_profiles_unavailable")
            ? "Demo workspace seeded, but Position Profiles were skipped because the Position Profiles migration is not applied or exposed."
            : createdTasks + createdSuggestions + createdProfiles + createdSubtasks + completedTasks > 0
              ? "Pilot demo workspace seeded with team members, tasks, approvals, subtasks, reports, and Position Profiles."
            : "Pilot demo workspace was already present.",
      });
    } catch (error) {
      const payload = serializeSupabaseError(error);
      console.error("[donnit] seed demo team failed", { userId: req.donnitAuth?.userId, ...payload });
      res.status(500).json({ ok: false, ...payload });
    }
  });

  app.post("/api/admin/members", requireDonnitAuth, async (req: Request, res: Response) => {
    const parsed = memberCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Member payload is invalid." });
      return;
    }
    try {
      const auth = req.donnitAuth!;
      const context = await requireWorkspaceAdminContext(auth);
      if (!context.ok) {
        res.status(context.status).json({ message: context.message });
        return;
      }
      const admin = createSupabaseAdminClient();
      if (!admin) {
        res.status(503).json({ message: "Member management needs SUPABASE_SERVICE_ROLE_KEY in Vercel." });
        return;
      }
      const input = parsed.data;
      if (input.managerId && !context.members.some((member) => (
        member.user_id === input.managerId &&
        ((member as { status?: string }).status ?? "active") !== "inactive"
      ))) {
        res.status(400).json({ message: "Manager must be an active workspace member." });
        return;
      }
      const store = new DonnitStore(admin, auth.userId);
      const profiles = input.positionProfileId ? await store.listPositionProfiles(context.orgId) : [];
      const assignedProfile = input.positionProfileId
        ? profiles.find((profile) => profile.id === input.positionProfileId)
        : null;
      if (input.positionProfileId && !assignedProfile) {
        res.status(404).json({ message: "Position Profile was not found." });
        return;
      }
      if (assignedProfile?.current_owner_id) {
        const currentOwner = context.members.find((member) => member.user_id === assignedProfile.current_owner_id);
        if (((currentOwner as { status?: string } | undefined)?.status ?? "active") !== "inactive") {
          res.status(409).json({ message: "That Position Profile is already assigned to an active employee." });
          return;
        }
      }

      const { data: existingProfile, error: profileLookupError } = await admin
        .from(DONNIT_TABLES.profiles)
        .select("*")
        .eq("email", input.email)
        .maybeSingle();
      if (profileLookupError) throw profileLookupError;

      let userId = typeof existingProfile?.id === "string" ? existingProfile.id : null;
      if (!userId) {
        const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (listed.error) throw listed.error;
        const existingAuthUser = listed.data.users.find(
          (user) => String(user.email ?? "").toLowerCase() === input.email,
        );
        if (existingAuthUser?.id) {
          userId = existingAuthUser.id;
        } else {
          const created = await admin.auth.admin.createUser({
            email: input.email,
            password: crypto.randomBytes(18).toString("base64url"),
            email_confirm: true,
            user_metadata: { full_name: input.fullName },
          });
          if (created.error || !created.data.user?.id) throw created.error ?? new Error("Could not create workspace member.");
          userId = created.data.user.id;
        }
      }

      const { error: profileError } = await admin
        .from(DONNIT_TABLES.profiles)
        .upsert(
          {
            id: userId,
            full_name: input.fullName,
            email: input.email,
            default_org_id: context.orgId,
            persona: input.persona,
          },
          { onConflict: "id" },
        );
      if (profileError) throw profileError;

      const { data: member, error: memberError } = await admin
        .from(DONNIT_TABLES.organizationMembers)
        .upsert(
          {
            org_id: context.orgId,
            user_id: userId,
            role: input.role,
            manager_id: input.managerId ?? null,
            can_assign: input.canAssign,
            status: "active",
          },
          { onConflict: "org_id,user_id" },
        )
        .select("*")
        .single();
      if (memberError) {
        if (isMemberAdminSchemaError(memberError)) {
          res.status(409).json({
            message: "Member management schema is not applied yet. Apply the latest Supabase migration and redeploy.",
          });
          return;
        }
        throw memberError;
      }

      if (assignedProfile) {
        await store.updatePositionProfile(context.orgId, assignedProfile.id, {
          status: "active",
          current_owner_id: userId,
          direct_manager_id: input.managerId ?? null,
          temporary_owner_id: null,
          delegate_user_id: null,
          delegate_until: null,
          risk_summary: `Assigned to ${input.fullName} during member creation.`,
        });
      }

      res.status(201).json({ ok: true, member });
    } catch (error) {
      const payload = serializeSupabaseError(error);
      console.error("[donnit] add member failed", { userId: req.donnitAuth?.userId, ...payload });
      res.status(500).json({ ok: false, ...payload });
    }
  });

  app.patch("/api/admin/members/:userId", requireDonnitAuth, async (req: Request, res: Response) => {
    const parsed = memberUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Member update payload is invalid." });
      return;
    }
    try {
      const auth = req.donnitAuth!;
      const targetUserId = String(req.params.userId ?? "");
      const context = await requireWorkspaceAdminContext(auth);
      if (!context.ok) {
        res.status(context.status).json({ message: context.message });
        return;
      }
      const target = context.members.find((member) => member.user_id === targetUserId);
      if (!target) {
        res.status(404).json({ message: "Member not found in this workspace." });
        return;
      }
      const input = parsed.data;
      if (input.managerId && !context.members.some((member) => (
        member.user_id === input.managerId &&
        ((member as { status?: string }).status ?? "active") !== "inactive"
      ))) {
        res.status(400).json({ message: "Manager must be an active workspace member." });
        return;
      }
      if (input.managerId === targetUserId) {
        res.status(400).json({ message: "A member cannot report to themselves." });
        return;
      }
      const targetIsAdmin = isWorkspaceAdmin(target);
      const nextRole = input.role ?? target.role;
      const nextStatus = input.status ?? ((target as { status?: string }).status ?? "active");
      const wouldRemoveAdminAccess = targetIsAdmin && (!["owner", "admin"].includes(nextRole) || nextStatus === "inactive");
      const hasOtherActiveAdmin = context.members.some((member) => (
        member.user_id !== targetUserId &&
        isWorkspaceAdmin(member) &&
        ((member as { status?: string }).status ?? "active") !== "inactive"
      ));
      if (wouldRemoveAdminAccess && !hasOtherActiveAdmin) {
        res.status(409).json({ message: "At least one active owner or admin must remain in the workspace." });
        return;
      }
      if (targetUserId === auth.userId && nextStatus === "inactive") {
        res.status(409).json({ message: "You cannot deactivate your own admin access." });
        return;
      }

      const admin = createSupabaseAdminClient();
      if (!admin) {
        res.status(503).json({ message: "Member management needs SUPABASE_SERVICE_ROLE_KEY in Vercel." });
        return;
      }

      if (input.fullName || input.persona) {
        const { error: profileError } = await admin
          .from(DONNIT_TABLES.profiles)
          .update({
            ...(input.fullName ? { full_name: input.fullName } : {}),
            ...(input.persona ? { persona: input.persona } : {}),
          })
          .eq("id", targetUserId);
        if (profileError) throw profileError;
      }

      const memberUpdate = {
        ...(input.role ? { role: input.role } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "managerId") ? { manager_id: input.managerId ?? null } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "canAssign") ? { can_assign: input.canAssign ?? false } : {}),
        ...(input.status ? { status: input.status } : {}),
      };
      const { data: member, error: memberError } = await admin
        .from(DONNIT_TABLES.organizationMembers)
        .update(memberUpdate)
        .eq("org_id", context.orgId)
        .eq("user_id", targetUserId)
        .select("*")
        .single();
      if (memberError) {
        if (isMemberAdminSchemaError(memberError)) {
          res.status(409).json({
            message: "Member management schema is not applied yet. Apply the latest Supabase migration and redeploy.",
          });
          return;
        }
        throw memberError;
      }

      res.json({ ok: true, member });
    } catch (error) {
      const payload = serializeSupabaseError(error);
      console.error("[donnit] update member failed", { userId: req.donnitAuth?.userId, ...payload });
      res.status(500).json({ ok: false, ...payload });
    }
  });

  app.post("/api/admin/members/:userId/invite", requireDonnitAuth, async (req: Request, res: Response) => {
    try {
      const auth = req.donnitAuth!;
      const targetUserId = String(req.params.userId ?? "");
      const context = await requireWorkspaceAdminContext(auth);
      if (!context.ok) {
        res.status(context.status).json({ message: context.message });
        return;
      }
      const target = context.members.find((member) => member.user_id === targetUserId);
      if (!target?.profile?.email) {
        res.status(404).json({ message: "Member email was not found." });
        return;
      }
      const admin = createSupabaseAdminClient();
      if (!admin) {
        res.status(503).json({ message: "Invite links need SUPABASE_SERVICE_ROLE_KEY in Vercel." });
        return;
      }
      const { data, error } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: target.profile.email,
        options: {
          data: { full_name: memberDisplayName(target), donnit_org_id: context.orgId },
          redirectTo: buildAuthRedirectUrl(req),
        },
      });
      if (error || !data.properties?.action_link) throw error ?? new Error("Could not generate invite link.");
      res.json({
        ok: true,
        type: "invite",
        email: target.profile.email,
        actionLink: data.properties.action_link,
        message: `Invite link generated for ${memberDisplayName(target)}.`,
      });
    } catch (error) {
      const payload = serializeSupabaseError(error);
      console.error("[donnit] member invite failed", { userId: req.donnitAuth?.userId, ...payload });
      res.status(500).json({ ok: false, ...payload });
    }
  });

  app.post("/api/admin/members/:userId/reset-access", requireDonnitAuth, async (req: Request, res: Response) => {
    try {
      const auth = req.donnitAuth!;
      const targetUserId = String(req.params.userId ?? "");
      const context = await requireWorkspaceAdminContext(auth);
      if (!context.ok) {
        res.status(context.status).json({ message: context.message });
        return;
      }
      const target = context.members.find((member) => member.user_id === targetUserId);
      if (!target?.profile?.email) {
        res.status(404).json({ message: "Member email was not found." });
        return;
      }
      const admin = createSupabaseAdminClient();
      if (!admin) {
        res.status(503).json({ message: "Reset links need SUPABASE_SERVICE_ROLE_KEY in Vercel." });
        return;
      }
      const { data, error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: target.profile.email,
        options: { redirectTo: buildAuthRedirectUrl(req) },
      });
      if (error || !data.properties?.action_link) throw error ?? new Error("Could not generate reset link.");
      res.json({
        ok: true,
        type: "reset",
        email: target.profile.email,
        actionLink: data.properties.action_link,
        message: `Reset link generated for ${memberDisplayName(target)}.`,
      });
    } catch (error) {
      const payload = serializeSupabaseError(error);
      console.error("[donnit] member reset failed", { userId: req.donnitAuth?.userId, ...payload });
      res.status(500).json({ ok: false, ...payload });
    }
  });

  app.post("/api/admin/members/:userId/remove-access", requireDonnitAuth, async (req: Request, res: Response) => {
    try {
      const auth = req.donnitAuth!;
      const targetUserId = String(req.params.userId ?? "");
      const context = await requireWorkspaceAdminContext(auth);
      if (!context.ok) {
        res.status(context.status).json({ message: context.message });
        return;
      }
      const target = context.members.find((member) => member.user_id === targetUserId);
      if (!target) {
        res.status(404).json({ message: "Member not found in this workspace." });
        return;
      }
      if (targetUserId === auth.userId) {
        res.status(409).json({ message: "You cannot remove your own access." });
        return;
      }
      const hasOtherActiveAdmin = context.members.some((member) => (
        member.user_id !== targetUserId &&
        isWorkspaceAdmin(member) &&
        ((member as { status?: string }).status ?? "active") !== "inactive"
      ));
      if (isWorkspaceAdmin(target) && !hasOtherActiveAdmin) {
        res.status(409).json({ message: "At least one active owner or admin must remain in the workspace." });
        return;
      }
      const admin = createSupabaseAdminClient();
      if (!admin) {
        res.status(503).json({ message: "Removing access needs SUPABASE_SERVICE_ROLE_KEY in Vercel." });
        return;
      }
      const { data: member, error } = await admin
        .from(DONNIT_TABLES.organizationMembers)
        .update({ status: "inactive", can_assign: false })
        .eq("org_id", context.orgId)
        .eq("user_id", targetUserId)
        .select("*")
        .single();
      if (error) throw error;
      res.json({
        ok: true,
        member,
        message: `${memberDisplayName(target)} can no longer access this Donnit workspace.`,
      });
    } catch (error) {
      const payload = serializeSupabaseError(error);
      console.error("[donnit] member remove access failed", { userId: req.donnitAuth?.userId, ...payload });
      res.status(500).json({ ok: false, ...payload });
    }
  });

  app.get("/api/integrations/composio/tools", requireDonnitAuth, async (req: Request, res: Response) => {
    const parsed = composioToolsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: "Composio tool filters are invalid." });
      return;
    }
    try {
      const auth = req.donnitAuth!;
      const context = await requireWorkspaceMemberContext(auth);
      if (!context.ok) {
        res.status(context.status).json({ message: context.message });
        return;
      }
      const splitList = (value?: string) =>
        value
          ?.split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      const result = await listDonnitComposioTools({
        orgId: context.orgId,
        userId: auth.userId,
        toolkits: splitList(parsed.data.toolkits),
        tools: splitList(parsed.data.tools),
        search: parsed.data.search,
        limit: parsed.data.limit,
      });
      res.json({
        ok: true,
        configured: isComposioConfigured(),
        entityId: result.entityId,
        tools: result.tools,
      });
    } catch (error) {
      res.status(502).json({
        ok: false,
        configured: isComposioConfigured(),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/integrations/composio/read", requireDonnitAuth, async (req: Request, res: Response) => {
    const parsed = composioReadToolSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Composio read tool request is invalid." });
      return;
    }
    try {
      const auth = req.donnitAuth!;
      const context = await requireWorkspaceMemberContext(auth);
      if (!context.ok) {
        res.status(context.status).json({ message: context.message });
        return;
      }
      const result = await executeDonnitComposioReadTool({
        orgId: context.orgId,
        userId: auth.userId,
        toolSlug: parsed.data.toolSlug,
        arguments: parsed.data.arguments,
        connectedAccountId: parsed.data.connectedAccountId,
        version: parsed.data.version,
      });
      res.json({ ok: true, configured: isComposioConfigured(), result });
    } catch (error) {
      res.status(502).json({
        ok: false,
        configured: isComposioConfigured(),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/integrations/composio/import", requireDonnitAuth, async (req: Request, res: Response) => {
    const parsed = composioImportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Composio import request is invalid." });
      return;
    }
    try {
      const auth = req.donnitAuth!;
      const context = await requireWorkspaceMemberContext(auth);
      if (!context.ok) {
        res.status(context.status).json({ message: context.message });
        return;
      }
      const store = new DonnitStore(auth.client, auth.userId);
      const result = await executeDonnitComposioReadTool({
        orgId: context.orgId,
        userId: auth.userId,
        toolSlug: parsed.data.toolSlug,
        arguments: parsed.data.arguments,
        connectedAccountId: parsed.data.connectedAccountId,
        version: parsed.data.version,
      });
      const items = composioResultItems(result, parsed.data.maxItems);
      const source = parsed.data.source;
      const enriched = await Promise.all(
        items.map((item) =>
          enrichSuggestionCandidateWithAi(
            buildComposioSuggestionCandidate({
              toolSlug: parsed.data.toolSlug,
              source,
              item,
            }),
            source,
          ),
        ),
      );
      const candidates = enriched.filter((candidate) => candidate.shouldCreateTask !== false);
      const created: DonnitEmailSuggestion[] = [];
      for (const candidate of candidates) {
        const suggestion = await store.createEmailSuggestion(context.orgId, {
          gmail_message_id: candidate.gmailMessageId ?? composioSuggestionKey(parsed.data.toolSlug, source, candidate.body),
          gmail_thread_id: candidate.gmailThreadId ?? null,
          from_email: candidate.fromEmail,
          subject: candidate.subject,
          preview: candidate.preview,
          body: candidate.body,
          received_at: normalizeTimestamp(candidate.receivedAt),
          action_items: candidate.actionItems,
          suggested_title: candidate.suggestedTitle,
          suggested_due_date: normalizeDateOnly(candidate.suggestedDueDate),
          urgency: candidate.urgency as "low" | "normal" | "high" | "critical",
          assigned_to: auth.userId,
          reply_suggested: Boolean(candidate.replySuggested),
          reply_status: candidate.replyStatus ?? (candidate.replySuggested ? "suggested" : "none"),
        });
        created.push(suggestion);
      }
      res.status(201).json({
        ok: true,
        configured: isComposioConfigured(),
        source,
        readItems: items.length,
        queued: created.length,
        suggestions: created.map(toClientEmailSuggestion),
      });
    } catch (error) {
      res.status(502).json({
        ok: false,
        configured: isComposioConfigured(),
        message: error instanceof Error ? error.message : String(error),
      });
    }
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
        await store.createChatMessage(orgId, { role: "user", content: parsed.data.message, task_id: null });
        const pending = await getPendingChatTask(store, orgId);
        if (pending) {
          if (looksLikeNewTaskIntent(parsed.data.message) && !looksLikeClarificationReply(parsed.data.message)) {
            await clearPendingChatTask(store, orgId);
          } else {
          if (/\b(cancel|never mind|nevermind|discard|stop)\b/i.test(parsed.data.message)) {
            await clearPendingChatTask(store, orgId);
            const assistant = await store.createChatMessage(orgId, {
              role: "assistant",
              content: "No problem. I discarded that pending task.",
              task_id: null,
            });
            res.json({ assistant, pending: false });
            return;
          }

          const positionProfiles = pending.visibility === "personal" ? [] : await store.listPositionProfiles(orgId);
          const merged = mergePendingChatTask(pending, parsed.data.message, positionProfiles, members);
          if (pendingChatMissing(merged).length > 0) {
            await setPendingChatTask(store, orgId, merged);
            const assistant = await store.createChatMessage(orgId, {
              role: "assistant",
              content: missingChatQuestion(merged, members, positionProfiles),
              task_id: null,
            });
            res.json({ assistant, pending: true });
            return;
          }

          const created = await store.createTask(orgId, {
            title: merged.title,
            description: merged.description,
            status: merged.status as DonnitTask["status"],
            urgency: merged.urgency,
            due_date: merged.dueDate,
            ...(merged.dueTime ? { due_time: merged.dueTime } : {}),
            ...(merged.startTime ? { start_time: merged.startTime } : {}),
            ...(merged.endTime ? { end_time: merged.endTime } : {}),
            ...(merged.isAllDay ? { is_all_day: true } : {}),
            estimated_minutes: merged.estimatedMinutes,
            assigned_to: merged.assignedToId,
            assigned_by: merged.assignedById,
            source: merged.source,
            recurrence: merged.recurrence,
            reminder_days_before: merged.reminderDaysBefore,
            position_profile_id: merged.visibility === "personal" ? null : merged.positionProfileId ?? null,
            visibility: merged.visibility,
            visible_from: visibleFromForRecurringTask({
              recurrence: merged.recurrence,
              due_date: merged.dueDate,
              reminder_days_before: merged.reminderDaysBefore,
            }),
          });
          await applyTaskTemplateToTask(store, orgId, created, { description: merged.description });
          await enrichPositionProfileMemoryFromTask({ store, orgId, task: created, eventType: "created", note: merged.description });
          await clearPendingChatTask(store, orgId);
          const assistant = await store.createChatMessage(orgId, {
            role: "assistant",
            content: chatTaskOutcome(created, members),
            task_id: created.id,
          });
          res.status(201).json({ task: toClientTask(created), assistant });
          return;
          }
        }
        if (looksLikeClarificationReply(parsed.data.message)) {
          const assistant = await store.createChatMessage(orgId, {
            role: "assistant",
            content: "I lost the task context for that reply. Please restate the task with the owner, due date, and urgency so I can assign it cleanly.",
            task_id: null,
          });
          res.json({ assistant, pending: false });
          return;
        }
        const ai = await extractChatTaskWithAi(
          parsed.data.message,
          members.map((m) => `${m.profile?.full_name ?? ""} ${m.profile?.email ?? ""}`.trim()).filter(Boolean),
        );
        const fallbackInput = parseChatTaskAuthenticated(parsed.data.message, members, auth.userId);
        const explicitAssignment = hasExplicitAssignmentIntent(parsed.data.message);
        const explicitMentionedMembers = explicitAssignment ? findMentionedMemberCandidates(parsed.data.message, members) : [];
        const ambiguousMentionedAssignee = explicitMentionedMembers.length > 1;
        const explicitMentionedMember = explicitMentionedMembers.length === 1 ? explicitMentionedMembers[0] : null;
        const aiAssignee = ai && explicitAssignment && !ambiguousMentionedAssignee
          ? members.find((member) => {
              const candidate = matchAiAssignee(ai.assigneeHint, [
                {
                  id: member.user_id,
                  name: member.profile?.full_name ?? "",
                  email: member.profile?.email ?? "",
                },
              ]);
              return Boolean(candidate);
            })
          : null;
        const assignedToId = aiAssignee?.user_id ?? explicitMentionedMember?.user_id ?? fallbackInput.assignedToId;
        const resolvedDueDate = fallbackInput.dueDate ?? ai?.dueDate ?? null;
        const resolvedDueTime = normalizeTimeOnly(ai?.dueTime) ?? fallbackInput.dueTime ?? null;
        const resolvedStartTime = normalizeTimeOnly(ai?.startTime) ?? fallbackInput.startTime ?? null;
        const resolvedEndTime =
          normalizeTimeOnly(ai?.endTime) ??
          fallbackInput.endTime ??
          (resolvedStartTime ? addMinutesToTime(resolvedStartTime, ai?.estimatedMinutes ?? fallbackInput.estimatedMinutes ?? 30) : null);
        const resolvedUrgency =
          resolvedDueDate && isPastDue(resolvedDueDate) ? "critical" : (ai?.urgency ?? fallbackInput.urgency);
        const resolvedRecurrence: DonnitTask["recurrence"] =
          (fallbackInput.recurrence && fallbackInput.recurrence !== "none"
            ? fallbackInput.recurrence
            : ai?.recurrence && ai.recurrence !== "none"
              ? ai.recurrence
              : "none") as DonnitTask["recurrence"];
        const resolvedReminderDaysBefore = Math.max(ai?.reminderDaysBefore ?? 0, fallbackInput.reminderDaysBefore ?? 0);
        const resolvedTitle = ai
          ? normalizeAiTitle(ai.title, fallbackInput.title, [
              ...assigneeAliases(aiAssignee?.profile?.full_name, aiAssignee?.profile?.email),
            ])
          : fallbackInput.title;
        const requester = members.find((member) => member.user_id === auth.userId);
        const finalTitle = rewriteRequesterReferencesInTitle(
          resolvedTitle,
          firstNameForTaskReference(memberDisplayName(requester ?? {})),
          String(assignedToId) !== String(auth.userId),
        );
        const repeatDetails = recurrenceDetailsFromMessage(parsed.data.message, resolvedRecurrence, resolvedDueDate);
        const taskInput = ai
          ? {
              title: finalTitle,
              description: descriptionWithServerRepeatDetails(
                `${normalizeAiDescription(ai.description, parsed.data.message)}\n\nDonnit rationale: ${ai.rationale}${explicitAssignment && ai.assigneeHint && !aiAssignee ? `\nPotential assignee mentioned: ${ai.assigneeHint}` : ""}`,
                repeatDetails,
              ),
              status: assignedToId === auth.userId ? "open" : "pending_acceptance",
              urgency: resolvedUrgency,
              dueDate: resolvedDueDate,
              dueTime: resolvedDueTime,
              startTime: resolvedStartTime,
              endTime: resolvedEndTime,
              isAllDay: ai.isAllDay || fallbackInput.isAllDay,
              estimatedMinutes: ai.estimatedMinutes,
              assignedToId,
              assignedById: auth.userId,
              source: "chat" as const,
              recurrence: resolvedRecurrence,
              reminderDaysBefore: resolvedReminderDaysBefore,
              visibility: ai.visibility ?? fallbackInput.visibility,
            }
          : {
              ...fallbackInput,
              title: finalTitle,
              description: descriptionWithServerRepeatDetails(fallbackInput.description ?? parsed.data.message, repeatDetails),
              recurrence: resolvedRecurrence,
              reminderDaysBefore: resolvedReminderDaysBefore,
            };
        const positionProfiles = taskInput.visibility === "personal" ? [] : await store.listPositionProfiles(orgId);
        const profileResolution = resolveChatPositionProfile({
          profiles: positionProfiles,
          assignedToId: String(taskInput.assignedToId),
          message: parsed.data.message,
          visibility: taskInput.visibility ?? "work",
        });
        const missing: PendingChatMissingField[] = [];
        const aiNeedsTaskClarification = Boolean(ai && (ai.shouldCreateTask === false || ai.confidence === "low"));
        if ((explicitAssignment && isGenericAssignmentTitle(taskInput.title)) || aiNeedsTaskClarification) missing.push("title");
        if (explicitAssignment && (ambiguousMentionedAssignee || (!explicitMentionedMember && !aiAssignee))) missing.push("assignee");
        if (!taskInput.dueDate) missing.push("dueDate");
        if (profileResolution.needsChoice) missing.push("positionProfile");
        if (missing.length > 0) {
          const pendingTask = buildPendingFromTaskInput(
            {
              ...taskInput,
              assignedToId: String(taskInput.assignedToId),
              assignedById: String(taskInput.assignedById),
              positionProfileId: profileResolution.positionProfileId,
            },
            missing,
          );
          await setPendingChatTask(store, orgId, pendingTask);
          const assistant = await store.createChatMessage(orgId, {
            role: "assistant",
            content: missingChatQuestion(pendingTask, members, positionProfiles),
            task_id: null,
          });
          res.json({ assistant, pending: true });
          return;
        }
        const created = await store.createTask(orgId, {
          title: taskInput.title,
          description: taskInput.description,
          status: taskInput.status as DonnitTask["status"],
          urgency: taskInput.urgency,
          due_date: taskInput.dueDate,
          ...(taskInput.dueTime ? { due_time: taskInput.dueTime } : {}),
          ...(taskInput.startTime ? { start_time: taskInput.startTime } : {}),
          ...(taskInput.endTime ? { end_time: taskInput.endTime } : {}),
          ...(taskInput.isAllDay ? { is_all_day: true } : {}),
          estimated_minutes: taskInput.estimatedMinutes,
          assigned_to: taskInput.assignedToId,
          assigned_by: taskInput.assignedById,
          source: taskInput.source,
          recurrence: taskInput.recurrence,
          reminder_days_before: taskInput.reminderDaysBefore,
          position_profile_id: taskInput.visibility === "personal" ? null : profileResolution.positionProfileId,
          visibility: taskInput.visibility ?? "work",
          visible_from: visibleFromForRecurringTask({
            recurrence: taskInput.recurrence,
            due_date: taskInput.dueDate,
            reminder_days_before: taskInput.reminderDaysBefore,
          }),
        });
        await applyTaskTemplateToTask(store, orgId, created, { description: taskInput.description });
        await enrichPositionProfileMemoryFromTask({ store, orgId, task: created, eventType: "created", note: taskInput.description });
        const assistant = await store.createChatMessage(orgId, {
          role: "assistant",
          content: chatTaskOutcome(created, members),
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
    const ai = await extractChatTaskWithAi(
      parsed.data.message,
      users.map((user) => `${user.name} ${user.email}`),
    );
    const fallbackInput = parseChatTask(parsed.data.message, users);
    const explicitAssignment = hasExplicitAssignmentIntent(parsed.data.message);
    const explicitMentionedUsers = explicitAssignment
      ? findBestMentionedCandidates(parsed.data.message, users, (user) => user.name, (user) => user.email)
      : [];
    const ambiguousMentionedAssignee = explicitMentionedUsers.length > 1;
    const explicitMentionedUser = explicitMentionedUsers.length === 1 ? explicitMentionedUsers[0] : null;
    const aiAssignee = explicitAssignment && !ambiguousMentionedAssignee ? matchAiAssignee(ai?.assigneeHint ?? null, users) : null;
    const assignedToId = aiAssignee?.id ?? fallbackInput.assignedToId ?? DEMO_USER_ID;
    const resolvedDueDate = fallbackInput.dueDate ?? ai?.dueDate ?? null;
    const resolvedDueTime = normalizeTimeOnly(ai?.dueTime) ?? fallbackInput.dueTime ?? null;
    const resolvedStartTime = normalizeTimeOnly(ai?.startTime) ?? fallbackInput.startTime ?? null;
    const resolvedEndTime =
      normalizeTimeOnly(ai?.endTime) ??
      fallbackInput.endTime ??
      (resolvedStartTime ? addMinutesToTime(resolvedStartTime, ai?.estimatedMinutes ?? fallbackInput.estimatedMinutes ?? 30) : null);
    const resolvedUrgency =
      resolvedDueDate && isPastDue(resolvedDueDate) ? "critical" : (ai?.urgency ?? fallbackInput.urgency);
    const resolvedRecurrence: DonnitTask["recurrence"] =
      (fallbackInput.recurrence && fallbackInput.recurrence !== "none"
        ? fallbackInput.recurrence
        : ai?.recurrence && ai.recurrence !== "none"
          ? ai.recurrence
          : "none") as DonnitTask["recurrence"];
    const resolvedReminderDaysBefore = Math.max(ai?.reminderDaysBefore ?? 0, fallbackInput.reminderDaysBefore ?? 0);
    const resolvedTitle = ai
      ? normalizeAiTitle(ai.title, fallbackInput.title, assigneeAliases(aiAssignee?.name, aiAssignee?.email))
      : fallbackInput.title;
    const requester = users.find((user) => user.id === DEMO_USER_ID);
    const finalTitle = rewriteRequesterReferencesInTitle(
      resolvedTitle,
      firstNameForTaskReference(requester?.name ?? "Demo Owner"),
      String(assignedToId) !== String(DEMO_USER_ID),
    );
    const repeatDetails = recurrenceDetailsFromMessage(parsed.data.message, resolvedRecurrence, resolvedDueDate);
    const taskInput = ai
      ? {
          title: finalTitle,
          description: descriptionWithServerRepeatDetails(
            `${normalizeAiDescription(ai.description, parsed.data.message)}\n\nDonnit rationale: ${ai.rationale}${explicitAssignment && ai.assigneeHint && !aiAssignee ? `\nPotential assignee mentioned: ${ai.assigneeHint}` : ""}`,
            repeatDetails,
          ),
          status: assignedToId === DEMO_USER_ID ? "open" : "pending_acceptance",
          urgency: resolvedUrgency,
          dueDate: resolvedDueDate,
          dueTime: resolvedDueTime,
          startTime: resolvedStartTime,
          endTime: resolvedEndTime,
          isAllDay: ai.isAllDay || fallbackInput.isAllDay,
          estimatedMinutes: ai.estimatedMinutes,
          assignedToId,
          assignedById: DEMO_USER_ID,
          source: "chat" as const,
          recurrence: resolvedRecurrence,
          reminderDaysBefore: resolvedReminderDaysBefore,
          visibility: ai.visibility ?? fallbackInput.visibility,
        }
      : {
          ...fallbackInput,
          title: finalTitle,
          description: descriptionWithServerRepeatDetails(fallbackInput.description ?? parsed.data.message, repeatDetails),
          recurrence: resolvedRecurrence,
          reminderDaysBefore: resolvedReminderDaysBefore,
        };
    if (explicitAssignment && (ambiguousMentionedAssignee || (!explicitMentionedUser && !aiAssignee))) {
      await storage.createChatMessage({ role: "user", content: parsed.data.message, taskId: null });
      const assistant = await storage.createChatMessage({
        role: "assistant",
        content: ambiguousMentionedAssignee
          ? `Which person should own "${taskInput.title}"? I found more than one matching teammate.`
          : `Who should own "${taskInput.title}"? I could not match the person you named to a workspace user.`,
        taskId: null,
      });
      res.json({ assistant, pending: true });
      return;
    }
    if (ai && (ai.shouldCreateTask === false || ai.confidence === "low")) {
      await storage.createChatMessage({ role: "user", content: parsed.data.message, taskId: null });
      const assistant = await storage.createChatMessage({
        role: "assistant",
        content: "I am not fully sure what task to create from that. What should be done, and when is it due?",
        taskId: null,
      });
      res.json({ assistant, pending: true });
      return;
    }
    const task = await storage.createTask(taskInput);
    await storage.createChatMessage({ role: "user", content: parsed.data.message, taskId: task.id });
    const assignee = users.find((user) => user.id === task.assignedToId);
    const dueText = dueDateAssistantText(task.dueDate);
    const assignmentText =
      task.status === "pending_acceptance"
        ? ` I assigned it to ${assignee?.name ?? "the assignee"}.`
        : " It is on your list now.";
    const assistant = await storage.createChatMessage({
      role: "assistant",
      content: `Added “${task.title}” as ${task.urgency} urgency.${dueText}${assignmentText}`,
      taskId: task.id,
    });

    res.status(201).json({ task, assistant });
  });

  // ------------------------------------------------------------------
  // Task templates
  // ------------------------------------------------------------------
  app.post("/api/task-templates", requireDonnitAuth, async (req: Request, res: Response) => {
    const parsed = taskTemplateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Template details are incomplete." });
      return;
    }
    try {
      const auth = req.donnitAuth!;
      const context = await requireWorkspaceMemberContext(auth);
      if (!context.ok) {
        res.status(context.status).json({ message: context.message });
        return;
      }
      const store = new DonnitStore(auth.client, auth.userId);
      const input = parsed.data;
      const template = await store.createTaskTemplate(context.orgId, {
        name: input.name,
        description: input.description,
        trigger_phrases: input.triggerPhrases,
        default_urgency: input.defaultUrgency,
        default_estimated_minutes: input.defaultEstimatedMinutes,
        default_recurrence: input.defaultRecurrence,
        created_by: auth.userId,
        subtasks: input.subtasks.map((title, index) => ({ title, position: index })),
      });
      res.status(201).json(toClientTaskTemplate(template));
    } catch (error) {
      sendTaskTemplateError(res, "create", error);
    }
  });

  app.patch("/api/task-templates/:id", requireDonnitAuth, async (req: Request, res: Response) => {
    const parsed = taskTemplateRequestSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Template update details are incomplete." });
      return;
    }
    try {
      const auth = req.donnitAuth!;
      const context = await requireWorkspaceMemberContext(auth);
      if (!context.ok) {
        res.status(context.status).json({ message: context.message });
        return;
      }
      const input = parsed.data;
      const store = new DonnitStore(auth.client, auth.userId);
      const template = await store.updateTaskTemplate(context.orgId, String(req.params.id), {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.triggerPhrases !== undefined ? { trigger_phrases: input.triggerPhrases } : {}),
        ...(input.defaultUrgency !== undefined ? { default_urgency: input.defaultUrgency } : {}),
        ...(input.defaultEstimatedMinutes !== undefined ? { default_estimated_minutes: input.defaultEstimatedMinutes } : {}),
        ...(input.defaultRecurrence !== undefined ? { default_recurrence: input.defaultRecurrence } : {}),
        ...(input.subtasks !== undefined ? { subtasks: input.subtasks.map((title, index) => ({ title, position: index })) } : {}),
      });
      if (!template) {
        res.status(404).json({ message: "Task template not found." });
        return;
      }
      res.json(toClientTaskTemplate(template));
    } catch (error) {
      sendTaskTemplateError(res, "update", error);
    }
  });

  app.delete("/api/task-templates/:id", requireDonnitAuth, async (req: Request, res: Response) => {
    try {
      const auth = req.donnitAuth!;
      const context = await requireWorkspaceMemberContext(auth);
      if (!context.ok) {
        res.status(context.status).json({ message: context.message });
        return;
      }
      const store = new DonnitStore(auth.client, auth.userId);
      await store.deleteTaskTemplate(context.orgId, String(req.params.id));
      res.status(204).end();
    } catch (error) {
      sendTaskTemplateError(res, "delete", error);
    }
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
        const visibility = data.visibility ?? "work";
        const activeProfile = data.positionProfileId
          ? null
          : visibility === "personal"
            ? null
            : (await store.listPositionProfiles(orgId)).find((profile) => profile.current_owner_id === String(data.assignedToId));
        const created = await store.createTask(orgId, {
          title: data.title,
          description: data.description ?? "",
          status: data.status as DonnitTask["status"],
          urgency: data.urgency,
          due_date: data.dueDate ?? null,
          ...(normalizeTimeOnly(data.dueTime) ? { due_time: normalizeTimeOnly(data.dueTime) } : {}),
          ...(normalizeTimeOnly(data.startTime) ? { start_time: normalizeTimeOnly(data.startTime) } : {}),
          ...(normalizeTimeOnly(data.endTime) ? { end_time: normalizeTimeOnly(data.endTime) } : {}),
          ...(data.isAllDay ? { is_all_day: true } : {}),
          estimated_minutes: data.estimatedMinutes ?? 30,
          assigned_to: typeof data.assignedToId === "string" ? data.assignedToId : auth.userId,
          assigned_by: typeof data.assignedById === "string" ? data.assignedById : auth.userId,
          source: data.source,
          recurrence: data.recurrence,
          reminder_days_before: data.reminderDaysBefore ?? 0,
          position_profile_id: visibility === "personal" ? null : data.positionProfileId ?? activeProfile?.id ?? null,
          visibility,
          visible_from: data.visibleFrom ?? visibleFromForRecurringTask({
            recurrence: data.recurrence,
            due_date: data.dueDate ?? null,
            reminder_days_before: data.reminderDaysBefore ?? 0,
          }),
        });
        await applyTaskTemplateToTask(store, orgId, created, {
          templateId: data.templateId ?? null,
          description: data.description ?? "",
        });
        await enrichPositionProfileMemoryFromTask({ store, orgId, task: created, eventType: "created", note: data.description ?? "" });
        res.status(201).json(toClientTask(created));
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const data = parsed.data;
    if (typeof data.assignedToId !== "number" || typeof data.assignedById !== "number") {
      res.status(400).json({ message: "Demo task assignments require numeric user ids." });
      return;
    }
    const task = await storage.createTask({
      ...data,
      assignedToId: data.assignedToId,
      assignedById: data.assignedById,
    });
    res.status(201).json(toClientDemoTask(task));
  });

  app.patch("/api/tasks/:id", async (req: Request, res: Response) => {
    const parsed = taskUpdateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Task update details are incomplete." });
      return;
    }
    const data = parsed.data;

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
        const patch: Partial<DonnitTask> = {};
        if (data.title !== undefined) patch.title = data.title;
        if (data.description !== undefined) patch.description = data.description;
        if (data.status !== undefined) {
          patch.status = data.status;
          if (data.status === "completed" && !existing.completed_at) {
            patch.completed_at = new Date().toISOString();
          }
        }
        if (data.urgency !== undefined) patch.urgency = data.urgency;
        if (data.dueDate !== undefined) patch.due_date = data.dueDate;
        if (data.dueTime !== undefined) patch.due_time = normalizeTimeOnly(data.dueTime);
        if (data.startTime !== undefined) patch.start_time = normalizeTimeOnly(data.startTime);
        if (data.endTime !== undefined) patch.end_time = normalizeTimeOnly(data.endTime);
        if (data.isAllDay !== undefined) patch.is_all_day = data.isAllDay;
        if (data.estimatedMinutes !== undefined) patch.estimated_minutes = data.estimatedMinutes;
        if (data.assignedToId !== undefined) patch.assigned_to = String(data.assignedToId);
        if (data.recurrence !== undefined) patch.recurrence = data.recurrence;
        if (data.reminderDaysBefore !== undefined) patch.reminder_days_before = data.reminderDaysBefore;
        if (data.visibility !== undefined) {
          patch.visibility = data.visibility;
          if (data.visibility === "personal") {
            patch.position_profile_id = null;
          } else if (data.positionProfileId === undefined && !existing.position_profile_id) {
            const orgId = existing.org_id;
            const activeProfile = (await store.listPositionProfiles(orgId)).find(
              (profile) => profile.current_owner_id === (patch.assigned_to ?? existing.assigned_to),
            );
            if (activeProfile) patch.position_profile_id = activeProfile.id;
          }
        }
        if (data.visibleFrom !== undefined) patch.visible_from = data.visibleFrom;
        if (data.positionProfileId !== undefined) {
          patch.position_profile_id = (patch.visibility ?? existing.visibility) === "personal" ? null : data.positionProfileId;
        }
        if ((data.recurrence !== undefined || data.dueDate !== undefined || data.reminderDaysBefore !== undefined) && data.visibleFrom === undefined) {
          patch.visible_from = visibleFromForRecurringTask({
            recurrence: data.recurrence ?? existing.recurrence,
            due_date: data.dueDate === undefined ? existing.due_date : data.dueDate,
            reminder_days_before: data.reminderDaysBefore ?? existing.reminder_days_before,
          });
        }
        if (
          data.assignedToId !== undefined &&
          data.positionProfileId === undefined &&
          (patch.visibility ?? existing.visibility) !== "personal"
        ) {
          const activeProfile = (await store.listPositionProfiles(existing.org_id)).find(
            (profile) => profile.current_owner_id === patch.assigned_to,
          );
          patch.position_profile_id = activeProfile?.id ?? null;
        }
        const supportsRelationshipColumns = hasTaskRelationshipColumns(existing);
        const nextDelegatedToId = data.delegatedToId === undefined
          ? existing.delegated_to ?? null
          : data.delegatedToId === null
            ? null
            : String(data.delegatedToId);
        const nextCollaboratorIds = data.collaboratorIds === undefined
          ? existing.collaborator_ids ?? []
          : Array.from(
              new Set(data.collaboratorIds.map((id) => String(id)).filter((id) => id !== (patch.assigned_to ?? existing.assigned_to))),
            );
        if (supportsRelationshipColumns && data.delegatedToId !== undefined) {
          patch.delegated_to = nextDelegatedToId;
        }
        if (supportsRelationshipColumns && data.collaboratorIds !== undefined) {
          const collaborators = Array.from(
            new Set(data.collaboratorIds.map((id) => String(id)).filter((id) => id !== (patch.assigned_to ?? existing.assigned_to))),
          );
          patch.collaborator_ids = collaborators;
        }
        if (data.note !== undefined) patch.completion_notes = data.note;

        const updated = await store.updateTask(taskId, patch);
        if (!updated) {
          res.status(404).json({ message: "Task not found." });
          return;
        }
        const relationshipChanged =
          data.assignedToId !== undefined || data.delegatedToId !== undefined || data.collaboratorIds !== undefined;
        const taskCompleted = data.status === "completed";
        const eventType = relationshipChanged ? "relationships_updated" : taskCompleted ? "completed" : "updated";
        const eventNote = relationshipChanged
          ? relationshipEventNote({
              assignedToId: updated.assigned_to,
              delegatedToId: nextDelegatedToId,
              collaboratorIds: nextCollaboratorIds,
            })
          : taskCompleted
            ? data.note || "Task completed."
            : data.note || "Task details updated.";
        await store.addEvent(updated.org_id, {
          task_id: updated.id,
          actor_id: auth.userId,
          type: eventType,
          note: eventNote,
        });
        await enrichPositionProfileMemoryFromTask({
          store,
          orgId: updated.org_id,
          task: updated,
          eventType: taskCompleted ? "completed" : relationshipChanged ? "updated" : "updated",
          note: eventNote,
        });
        if (taskCompleted && existing.status !== "completed") {
          await createNextRecurringOccurrenceFromTask({
            store,
            orgId: updated.org_id,
            task: updated,
            actorId: auth.userId,
          });
        }
        res.json(toClientTask(updated));
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const id = Number(req.params.id);
    const existingTask = (await storage.listTasks()).find((candidate) => candidate.id === id);
    const patch: Partial<Task> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.status !== undefined) {
      patch.status = data.status;
      if (data.status === "completed") patch.completedAt = new Date().toISOString();
    }
    if (data.urgency !== undefined) patch.urgency = data.urgency;
    if (data.dueDate !== undefined) patch.dueDate = data.dueDate;
    if (data.dueTime !== undefined) patch.dueTime = normalizeTimeOnly(data.dueTime);
    if (data.startTime !== undefined) patch.startTime = normalizeTimeOnly(data.startTime);
    if (data.endTime !== undefined) patch.endTime = normalizeTimeOnly(data.endTime);
    if (data.isAllDay !== undefined) patch.isAllDay = data.isAllDay;
    if (data.estimatedMinutes !== undefined) patch.estimatedMinutes = data.estimatedMinutes;
    if (data.assignedToId !== undefined) {
      const assignedToId = parseDemoUserId(data.assignedToId);
      if (assignedToId === null) {
        res.status(400).json({ message: "Demo task assignments require numeric user ids." });
        return;
      }
      patch.assignedToId = assignedToId;
    }
    if (data.delegatedToId !== undefined) {
      const delegatedToId = data.delegatedToId === null ? null : parseDemoUserId(data.delegatedToId);
      if (delegatedToId === null && data.delegatedToId !== null) {
        res.status(400).json({ message: "Demo task delegation requires numeric user ids." });
        return;
      }
      patch.delegatedToId = delegatedToId;
    }
    if (data.collaboratorIds !== undefined) {
      const parsedCollaborators = data.collaboratorIds.map(parseDemoUserId);
      if (parsedCollaborators.some((id) => id === null)) {
        res.status(400).json({ message: "Demo task collaborators require numeric user ids." });
        return;
      }
      const ownerId = patch.assignedToId ?? existingTask?.assignedToId;
      patch.collaboratorIds = JSON.stringify(
        Array.from(new Set(parsedCollaborators.filter((id): id is number => id !== null && id !== ownerId))),
      );
    }
    if (data.note !== undefined) patch.completionNotes = data.note;

    const task = await storage.updateTask(id, patch);
    if (!task) {
      res.status(404).json({ message: "Task not found." });
      return;
    }
    const relationshipChanged =
      data.assignedToId !== undefined || data.delegatedToId !== undefined || data.collaboratorIds !== undefined;
    const taskCompleted = data.status === "completed";
    const eventType = relationshipChanged ? "relationships_updated" : taskCompleted ? "completed" : "updated";
    const eventNote = relationshipChanged
      ? relationshipEventNote({
          assignedToId: task.assignedToId,
          delegatedToId: task.delegatedToId,
          collaboratorIds: parseDemoCollaboratorIds(task.collaboratorIds),
        })
      : taskCompleted
        ? data.note || "Task completed."
        : data.note || "Task details updated.";
    await storage.addEvent({
      taskId: id,
      actorId: DEMO_USER_ID,
      type: eventType,
      note: eventNote,
    });
    res.json(toClientDemoTask(task));
  });

  app.post("/api/tasks/:id/subtasks", requireDonnitAuth, async (req: Request, res: Response) => {
    const parsed = taskSubtaskCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Subtask title is required." });
      return;
    }
    try {
      const auth = req.donnitAuth!;
      const store = new DonnitStore(auth.client, auth.userId);
      const orgId = await store.getDefaultOrgId();
      if (!orgId) {
        res.status(409).json({ message: "Workspace not bootstrapped." });
        return;
      }
      const taskId = String(req.params.id);
      const task = await store.getTask(taskId);
      if (!task || task.org_id !== orgId) {
        res.status(404).json({ message: "Task not found." });
        return;
      }
      const members = await store.listOrgMembers(orgId);
      const actor = members.find((member) => member.user_id === auth.userId);
      if (!canManageTaskSubtasks(task, auth.userId, actor)) {
        res.status(403).json({ message: "Only the task owner, assigner, delegate, collaborators, or managers can add subtasks." });
        return;
      }
      const writeStore = createSubtaskWriteStore(auth);
      const subtask = await writeStore.createTaskSubtask(orgId, {
        task_id: taskId,
        title: parsed.data.title,
        position: parsed.data.position,
      });
      res.status(201).json(toClientTaskSubtask(subtask));
    } catch (error) {
      sendTaskSubtaskError(res, "create", error);
    }
  });

  app.patch("/api/tasks/:taskId/subtasks/:subtaskId", requireDonnitAuth, async (req: Request, res: Response) => {
    const parsed = taskSubtaskUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Subtask update is invalid." });
      return;
    }
    try {
      const auth = req.donnitAuth!;
      const store = new DonnitStore(auth.client, auth.userId);
      const orgId = await store.getDefaultOrgId();
      if (!orgId) {
        res.status(409).json({ message: "Workspace not bootstrapped." });
        return;
      }
      const taskId = String(req.params.taskId);
      const task = await store.getTask(taskId);
      if (!task || task.org_id !== orgId) {
        res.status(404).json({ message: "Task not found." });
        return;
      }
      const members = await store.listOrgMembers(orgId);
      const actor = members.find((member) => member.user_id === auth.userId);
      if (!canManageTaskSubtasks(task, auth.userId, actor)) {
        res.status(403).json({ message: "Only the task owner, assigner, delegate, collaborators, or managers can update subtasks." });
        return;
      }
      const patch: Partial<Pick<DonnitTaskSubtask, "title" | "status" | "position" | "completed_at">> = {};
      if (parsed.data.title !== undefined) patch.title = parsed.data.title;
      if (parsed.data.position !== undefined) patch.position = parsed.data.position;
      if (parsed.data.done !== undefined) {
        patch.status = parsed.data.done ? "completed" : "open";
        patch.completed_at = parsed.data.done ? new Date().toISOString() : null;
      }
      if (Object.keys(patch).length === 0) {
        res.status(400).json({ message: "No subtask changes were provided." });
        return;
      }
      const writeStore = createSubtaskWriteStore(auth);
      const subtask = await writeStore.updateTaskSubtask(orgId, taskId, String(req.params.subtaskId), patch);
      if (!subtask) {
        res.status(404).json({ message: "Subtask not found." });
        return;
      }
      res.json(toClientTaskSubtask(subtask));
    } catch (error) {
      sendTaskSubtaskError(res, "update", error);
    }
  });

  app.delete("/api/tasks/:taskId/subtasks/:subtaskId", requireDonnitAuth, async (req: Request, res: Response) => {
    try {
      const auth = req.donnitAuth!;
      const store = new DonnitStore(auth.client, auth.userId);
      const orgId = await store.getDefaultOrgId();
      if (!orgId) {
        res.status(409).json({ message: "Workspace not bootstrapped." });
        return;
      }
      const taskId = String(req.params.taskId);
      const task = await store.getTask(taskId);
      if (!task || task.org_id !== orgId) {
        res.status(404).json({ message: "Task not found." });
        return;
      }
      const members = await store.listOrgMembers(orgId);
      const actor = members.find((member) => member.user_id === auth.userId);
      if (!canManageTaskSubtasks(task, auth.userId, actor)) {
        res.status(403).json({ message: "Only the task owner, assigner, delegate, collaborators, or managers can delete subtasks." });
        return;
      }
      const writeStore = createSubtaskWriteStore(auth);
      await writeStore.deleteTaskSubtask(orgId, taskId, String(req.params.subtaskId));
      res.json({ ok: true });
    } catch (error) {
      sendTaskSubtaskError(res, "delete", error);
    }
  });

  async function handleTaskAction(
    req: Request,
    res: Response,
    action: "complete" | "accept" | "deny" | "note" | "request_update" | "postpone_day" | "postpone_week",
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
          case "request_update": {
            const requestedNote = note.success
              ? note.data.note
              : "Please add a quick status update on this task.";
            const stamped = `Manager requested update: ${requestedNote}`;
            patch = {
              completion_notes: existing.completion_notes
                ? `${existing.completion_notes}\n\n${stamped}`
                : stamped,
            };
            eventType = "update_requested";
            eventNote = requestedNote;
            break;
          }
          case "postpone_day":
          case "postpone_week": {
            const days = action === "postpone_day" ? 1 : 7;
            const baseDueDate = existing.due_date ?? todayIso();
            const nextDueDate = addDaysIso(baseDueDate, days);
            patch = { due_date: nextDueDate };
            eventType = "due_date_postponed";
            eventNote = `Due date moved from ${existing.due_date ?? "no due date"} to ${nextDueDate} (+${days} day${days === 1 ? "" : "s"}).`;
            break;
          }
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
        const memoryEventType =
          action === "complete"
            ? "completed"
            : action === "note"
              ? "note_added"
              : action === "postpone_day" || action === "postpone_week"
                ? "due_date_postponed"
                : action === "accept"
                  ? "accepted"
                  : action === "deny"
                    ? "denied"
                    : "updated";
        await enrichPositionProfileMemoryFromTask({
          store,
          orgId: updated.org_id,
          task: updated,
          eventType: memoryEventType,
          note: eventNote,
        });
        if (action === "complete" && existing.status !== "completed") {
          await createNextRecurringOccurrenceFromTask({
            store,
            orgId: updated.org_id,
            task: updated,
            actorId: auth.userId,
          });
        }
        res.json(toClientTask(updated));
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const id = Number(req.params.id);
    const existingTask = (await storage.listTasks()).find((task) => task.id === id);
    if (!existingTask) {
      res.status(404).json({ message: "Task not found." });
      return;
    }
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
      case "request_update": {
        const requestedNote = note.success
          ? note.data.note
          : "Please add a quick status update on this task.";
        const stamped = `Manager requested update: ${requestedNote}`;
        patch = {
          completionNotes: existingTask.completionNotes
            ? `${existingTask.completionNotes}\n\n${stamped}`
            : stamped,
        };
        eventType = "update_requested";
        eventNote = requestedNote;
        break;
      }
      case "postpone_day":
      case "postpone_week": {
        const days = action === "postpone_day" ? 1 : 7;
        const baseDueDate = existingTask.dueDate ?? todayIso();
        const nextDueDate = addDaysIso(baseDueDate, days);
        patch = { dueDate: nextDueDate };
        eventType = "due_date_postponed";
        eventNote = `Due date moved from ${existingTask.dueDate ?? "no due date"} to ${nextDueDate} (+${days} day${days === 1 ? "" : "s"}).`;
        break;
      }
    }
    const task = await storage.updateTask(id, patch);
    if (!task) {
      res.status(404).json({ message: "Task not found." });
      return;
    }
    await storage.addEvent({ taskId: id, actorId: DEMO_USER_ID, type: eventType, note: eventNote });
    res.json(toClientDemoTask(task));
  }

  app.post("/api/tasks/:id/complete", (req, res) => handleTaskAction(req, res, "complete"));
  app.post("/api/tasks/:id/notes", (req, res) => handleTaskAction(req, res, "note"));
  app.post("/api/tasks/:id/request-update", (req, res) => handleTaskAction(req, res, "request_update"));
  app.post("/api/tasks/:id/postpone-day", (req, res) => handleTaskAction(req, res, "postpone_day"));
  app.post("/api/tasks/:id/postpone-week", (req, res) => handleTaskAction(req, res, "postpone_week"));
  app.post("/api/tasks/:id/accept", (req, res) => handleTaskAction(req, res, "accept"));
  app.post("/api/tasks/:id/deny", (req, res) => handleTaskAction(req, res, "deny"));

  // ------------------------------------------------------------------
  // Position profiles
  // ------------------------------------------------------------------
  app.post("/api/position-profiles", requireDonnitAuth, async (req: Request, res: Response) => {
    const parsed = positionProfileCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Position profile details are incomplete." });
      return;
    }
    try {
      const auth = req.donnitAuth!;
      const store = new DonnitStore(auth.client, auth.userId);
      const orgId = await store.getDefaultOrgId();
      if (!orgId) {
        res.status(409).json({ message: "Workspace not bootstrapped." });
        return;
      }
      const members = await store.listOrgMembers(orgId);
      const actor = members.find((member) => member.user_id === auth.userId);
      if (!["owner", "admin"].includes(String(actor?.role ?? ""))) {
        res.status(403).json({ message: "Only admins can create position profiles." });
        return;
      }
      const ownerId = parsed.data.ownerId ?? null;
      if (ownerId && !members.some((member) => member.user_id === ownerId)) {
        res.status(404).json({ message: "Profile owner is not a workspace member." });
        return;
      }
      const managerId = parsed.data.managerId ?? null;
      if (managerId && !members.some((member) => member.user_id === managerId)) {
        res.status(404).json({ message: "Direct manager is not a workspace member." });
        return;
      }
      const created = await store.createPositionProfile(orgId, {
        title: parsed.data.title,
        status: parsed.data.status ?? (ownerId ? "active" : "vacant"),
        current_owner_id: ownerId,
        direct_manager_id: managerId,
        risk_summary: "Created by admin. Donnit will enrich this profile from task history.",
      });
      res.status(201).json(toClientPositionProfile(created));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/position-profiles/:id/tasks", requireDonnitAuth, async (req: Request, res: Response) => {
    try {
      const auth = req.donnitAuth!;
      const store = new DonnitStore(auth.client, auth.userId);
      const orgId = await store.getDefaultOrgId();
      if (!orgId) {
        res.status(409).json({ message: "Workspace not bootstrapped." });
        return;
      }
      const [members, profiles, tasks] = await Promise.all([
        store.listOrgMembers(orgId),
        store.listPositionProfiles(orgId),
        store.listTasks(orgId),
      ]);
      const actor = members.find((member) => member.user_id === auth.userId);
      const profile = profiles.find((item) => item.id === String(req.params.id));
      if (!profile) {
        res.status(404).json({ message: "Position Profile not found." });
        return;
      }
      const canView =
        isWorkspaceAdmin(actor) ||
        profile.current_owner_id === auth.userId ||
        profile.temporary_owner_id === auth.userId ||
        profile.delegate_user_id === auth.userId;
      if (!canView) {
        res.status(403).json({ message: "Only admins and assigned profile owners can view this history." });
        return;
      }
      const profileTasks = tasks.filter((task) => (
        ((task as { position_profile_id?: string | null }).position_profile_id === profile.id ||
          (profile.current_owner_id && task.assigned_to === profile.current_owner_id)) &&
        ((task as { visibility?: string }).visibility ?? "work") !== "personal" &&
        canViewSensitiveTask(task, auth.userId, actor)
      ));
      res.json({
        ok: true,
        profile: toClientPositionProfile(profile),
        tasks: profileTasks.map((task) => {
          const visibleTask = toClientTask(task);
          const includeHistory = req.query.history === "1";
          return includeHistory
            ? visibleTask
            : {
                ...visibleTask,
                description: "",
                completionNotes: "",
              };
        }),
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch("/api/position-profiles/:id", requireDonnitAuth, async (req: Request, res: Response) => {
    const parsed = positionProfileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Position profile update details are incomplete." });
      return;
    }
    try {
      const auth = req.donnitAuth!;
      const store = new DonnitStore(auth.client, auth.userId);
      const orgId = await store.getDefaultOrgId();
      if (!orgId) {
        res.status(409).json({ message: "Workspace not bootstrapped." });
        return;
      }
      const members = await store.listOrgMembers(orgId);
      const actor = members.find((member) => member.user_id === auth.userId);
      if (!["owner", "admin"].includes(String(actor?.role ?? ""))) {
        res.status(403).json({ message: "Only admins can update position profiles." });
        return;
      }
      const ensureMember = (id: string | null | undefined, label: string) => {
        if (!id) return null;
        if (!members.some((member) => member.user_id === id)) {
          throw new Error(`${label} is not a workspace member.`);
        }
        return id;
      };
      const patch: Partial<DonnitPositionProfile> = {};
      if (parsed.data.title !== undefined) patch.title = parsed.data.title;
      if (parsed.data.status !== undefined) patch.status = parsed.data.status;
      if (parsed.data.currentOwnerId !== undefined) patch.current_owner_id = ensureMember(parsed.data.currentOwnerId, "Current owner");
      if (parsed.data.directManagerId !== undefined) patch.direct_manager_id = ensureMember(parsed.data.directManagerId, "Direct manager");
      if (parsed.data.temporaryOwnerId !== undefined) patch.temporary_owner_id = ensureMember(parsed.data.temporaryOwnerId, "Temporary owner");
      if (parsed.data.delegateUserId !== undefined) patch.delegate_user_id = ensureMember(parsed.data.delegateUserId, "Delegate");
      if (parsed.data.delegateUntil !== undefined) patch.delegate_until = parsed.data.delegateUntil || null;
      if (parsed.data.riskSummary !== undefined) patch.risk_summary = parsed.data.riskSummary;
      if (parsed.data.institutionalMemory !== undefined) patch.institutional_memory = parsed.data.institutionalMemory;
      if (Object.keys(patch).length === 0) {
        res.status(400).json({ message: "No position profile changes were supplied." });
        return;
      }
      const updated = await store.updatePositionProfile(orgId, String(req.params.id), patch);
      if (!updated) {
        res.status(404).json({ message: "Position profile not found." });
        return;
      }
      res.json(toClientPositionProfile(updated));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete("/api/position-profiles/:id", requireDonnitAuth, async (req: Request, res: Response) => {
    try {
      const auth = req.donnitAuth!;
      const store = new DonnitStore(auth.client, auth.userId);
      const orgId = await store.getDefaultOrgId();
      if (!orgId) {
        res.status(409).json({ message: "Workspace not bootstrapped." });
        return;
      }
      const members = await store.listOrgMembers(orgId);
      const actor = members.find((member) => member.user_id === auth.userId);
      if (!["owner", "admin"].includes(String(actor?.role ?? ""))) {
        res.status(403).json({ message: "Only admins can delete position profiles." });
        return;
      }
      await store.deletePositionProfile(orgId, String(req.params.id));
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/position-profiles/assign/preview", requireDonnitAuth, async (req: Request, res: Response) => {
    const parsed = positionProfileAssignSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Position profile assignment details are incomplete." });
      return;
    }
    try {
      const auth = req.donnitAuth!;
      const store = new DonnitStore(auth.client, auth.userId);
      const orgId = await store.getDefaultOrgId();
      if (!orgId) {
        res.status(409).json({ message: "Workspace not bootstrapped." });
        return;
      }
      const members = await store.listOrgMembers(orgId);
      const actor = members.find((member) => member.user_id === auth.userId);
      if (!["owner", "admin"].includes(String(actor?.role ?? ""))) {
        res.status(403).json({ message: "Only admins can preview position profile assignments." });
        return;
      }
      const fromUserId = String(parsed.data.fromUserId);
      const toUserId = String(parsed.data.toUserId);
      if (!members.some((member) => member.user_id === toUserId)) {
        res.status(404).json({ message: "Target user is not a workspace member." });
        return;
      }
      const tasks = (await store.listTasks(orgId)).filter((task) => canViewSensitiveTask(task, auth.userId, actor));
      const plan = buildPositionContinuityPlan({
        tasks,
        profileId: parsed.data.profileId ?? null,
        profileTitle: parsed.data.profileTitle ?? "Position Profile",
        fromUserId,
        toUserId,
        mode: parsed.data.mode,
        delegateUntil: parsed.data.delegateUntil ?? null,
        includeUnboundOwnerTasks: parsed.data.includeUnboundOwnerTasks === true,
      });
      res.json({ ok: true, preview: plan.preview });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/position-profiles/assign", async (req: Request, res: Response) => {
    const parsed = positionProfileAssignSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Position profile assignment details are incomplete." });
      return;
    }
    const { mode, profileTitle = "Position profile", delegateUntil } = parsed.data;

    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const adminClient = createSupabaseAdminClient();
        const writeStore = new DonnitStore(adminClient ?? auth.client, auth.userId);
        const orgId = await store.getDefaultOrgId();
        if (!orgId) {
          res.status(409).json({ message: "Workspace not bootstrapped." });
          return;
        }
        const members = await store.listOrgMembers(orgId);
        const actor = members.find((member) => member.user_id === auth.userId);
        const canManage = ["owner", "admin"].includes(String(actor?.role ?? ""));
        if (!canManage) {
          res.status(403).json({ message: "Only admins can assign position profiles." });
          return;
        }
        const fromUserId = String(parsed.data.fromUserId);
        const toUserId = String(parsed.data.toUserId);
        const toMember = members.find((member) => member.user_id === toUserId);
        if (!toMember) {
          res.status(404).json({ message: "Target user is not a workspace member." });
          return;
        }
        const tasks = (await store.listTasks(orgId)).filter((task) => canViewSensitiveTask(task, auth.userId, actor));
        const profileId = parsed.data.profileId ?? null;
        const plan = buildPositionContinuityPlan({
          tasks,
          profileId,
          profileTitle,
          fromUserId,
          toUserId,
          mode,
          delegateUntil: delegateUntil ?? null,
          includeUnboundOwnerTasks: parsed.data.includeUnboundOwnerTasks === true,
        });
        if (mode === "delegate" && plan.tasksToMove.some((task) => !hasTaskRelationshipColumns(task))) {
          res.status(409).json({ message: "Apply migration 0008 before delegating position profiles." });
          return;
        }
        let updatedCount = 0;
        for (const task of plan.tasksToMove) {
          const inheritedContext = {
            profileTitle,
            fromUserId,
            toUserId,
            mode,
            delegateUntil: delegateUntil ?? null,
            inheritedDescription: task.description ?? "",
            inheritedCompletionNotes: task.completion_notes ?? "",
            inheritedAt: new Date().toISOString(),
          };
          const patch: Partial<DonnitTask> =
            mode === "transfer"
              ? {
                  assigned_to: toUserId,
                  description: "",
                  completion_notes: "",
                  position_profile_id: profileId,
                  visible_from: visibleFromForRecurringTask(task),
                  ...(hasTaskRelationshipColumns(task) ? { delegated_to: null } : {}),
                }
              : {
                  delegated_to: toUserId,
                  description: "",
                  completion_notes: "",
                  position_profile_id: profileId,
                  visible_from: visibleFromForRecurringTask(task),
                };
          const updated = await writeStore.updateTask(task.id, patch);
          if (!updated) continue;
          updatedCount += 1;
          await writeStore.addEvent(orgId, {
            task_id: task.id,
            actor_id: auth.userId,
            type: mode === "transfer" ? "position_profile_transferred" : "position_profile_delegated",
            note: JSON.stringify(inheritedContext),
          });
        }
        if (profileId) {
          for (const task of plan.historicalTasks) {
            const existingProfileId = (task as { position_profile_id?: string | null }).position_profile_id ?? null;
            if (existingProfileId === profileId) continue;
            const updated = await writeStore.updateTask(task.id, { position_profile_id: profileId });
            if (!updated) continue;
            await writeStore.addEvent(orgId, {
              task_id: task.id,
              actor_id: auth.userId,
              type: "position_profile_history_linked",
              note: JSON.stringify({
                profileTitle,
                fromUserId,
                toUserId,
                mode,
                linkedAt: new Date().toISOString(),
                reason: "Preserve completed task history for future profile holders.",
              }),
            });
          }
        }
        let profile = null;
        if (parsed.data.profileId) {
          const existingProfile = (await store.listPositionProfiles(orgId)).find((item) => item.id === parsed.data.profileId);
          const existingMemory = (existingProfile?.institutional_memory ?? {}) as Record<string, unknown>;
          const previousAssignments = Array.isArray(existingMemory.continuityAssignments)
            ? existingMemory.continuityAssignments as Array<Record<string, unknown>>
            : [];
          const delegateUntilDate = delegateUntil || null;
          const updatedProfile = await writeStore.updatePositionProfile(orgId, parsed.data.profileId, {
            status: mode === "transfer" ? "active" : "covered",
            current_owner_id: mode === "transfer" ? toUserId : fromUserId,
            temporary_owner_id: mode === "transfer" ? null : toUserId,
            delegate_user_id: mode === "transfer" ? null : toUserId,
            delegate_until: mode === "transfer" ? null : delegateUntilDate,
            institutional_memory: {
              ...existingMemory,
              continuityAssignments: [
                {
                  mode,
                  fromUserId,
                  toUserId,
                  assignedAt: new Date().toISOString(),
                  activeTasks: plan.preview.summary.activeTasks,
                  recurringTasks: plan.preview.summary.recurringTasks,
                  historicalTasks: plan.preview.summary.historicalTasks,
                  confidentialTasks: plan.preview.summary.confidentialTasks,
                  personalTasksExcluded: plan.preview.summary.personalTasksExcluded,
                },
                ...previousAssignments,
              ].slice(0, 20),
            },
            risk_summary:
              mode === "transfer"
                ? `Transferred from ${fromUserId} to ${toUserId}. ${updatedCount} active task${updatedCount === 1 ? "" : "s"} moved.`
                : `Coverage delegated to ${toUserId}. ${updatedCount} active task${updatedCount === 1 ? "" : "s"} remain owned by the profile owner.`,
          });
          if (updatedProfile) {
            profile = toClientPositionProfile(updatedProfile);
            await writeStore.createPositionProfileAssignment(orgId, {
              position_profile_id: updatedProfile.id,
              from_user_id: fromUserId,
              to_user_id: toUserId,
              actor_id: auth.userId,
              mode: mode === "transfer" ? "transfer" : "delegate",
              ends_at: delegateUntilDate ? `${delegateUntilDate}T23:59:59.000Z` : null,
              notes: profileTitle,
            });
          }
        }
        res.json({ ok: true, mode, updated: updatedCount, profile, preview: plan.preview });
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const fromUserId = parseDemoUserId(parsed.data.fromUserId);
    const toUserId = parseDemoUserId(parsed.data.toUserId);
    if (fromUserId === null || toUserId === null) {
      res.status(400).json({ message: "Demo position assignment requires numeric user ids." });
      return;
    }
    const demoProfileId = parsed.data.profileId ?? null;
    const tasks = (await storage.listTasks()).filter(
      (task) =>
        task.assignedToId === fromUserId &&
        task.status !== "completed" &&
        task.status !== "denied" &&
        (!demoProfileId || String((task as { positionProfileId?: string | null }).positionProfileId ?? "") === demoProfileId),
    );
    let updatedCount = 0;
    for (const task of tasks) {
      const updated = await storage.updateTask(
        task.id,
        mode === "transfer"
          ? { assignedToId: toUserId, delegatedToId: null, positionProfileId: demoProfileId }
          : { delegatedToId: toUserId, positionProfileId: demoProfileId },
      );
      if (!updated) continue;
      updatedCount += 1;
      await storage.addEvent({
        taskId: task.id,
        actorId: DEMO_USER_ID,
        type: mode === "transfer" ? "position_profile_transferred" : "position_profile_delegated",
        note: JSON.stringify({
          profileTitle,
          fromUserId,
          toUserId,
          mode,
          delegateUntil: delegateUntil ?? null,
        }),
      });
    }
    res.json({ ok: true, mode, updated: updatedCount });
  });

  // ------------------------------------------------------------------
  // Document imports
  // ------------------------------------------------------------------
  app.post("/api/documents/suggest", async (req: Request, res: Response) => {
    const parsed = documentSuggestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Upload a PDF, Word .docx, or text file under 8MB." });
      return;
    }

    try {
      const text = await extractUploadedDocumentText(parsed.data);
      if (text.trim().length < 12) {
        res.status(400).json({ message: "Donnit could not read enough text from that document." });
        return;
      }

      if (req.donnitAuth) {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const orgId = await store.getDefaultOrgId();
        if (!orgId) {
          res.status(409).json({ message: "Workspace not bootstrapped." });
          return;
        }
        const candidates = (
          await Promise.all(
          buildDocumentSuggestionCandidates({
            fileName: parsed.data.fileName,
            text,
            assignedToId: auth.userId,
          }).map((candidate) => enrichSuggestionCandidateWithAi(candidate, "document")),
          )
        ).filter((candidate) => candidate.shouldCreateTask !== false);
        const suggestions = [];
        for (const candidate of candidates) {
          const suggestion = await store.createEmailSuggestion(orgId, {
            gmail_message_id: `document:${crypto
              .createHash("sha1")
              .update(`${parsed.data.fileName}:${candidate.preview}`)
              .digest("hex")
              .slice(0, 24)}`,
            gmail_thread_id: null,
            from_email: candidate.fromEmail,
            subject: candidate.subject,
            preview: candidate.preview,
            body: candidate.body,
            received_at: candidate.receivedAt,
            action_items: candidate.actionItems,
            suggested_title: candidate.suggestedTitle,
            suggested_due_date: candidate.suggestedDueDate,
            urgency: candidate.urgency,
            assigned_to: String(candidate.assignedTo),
            reply_suggested: false,
            reply_status: "none",
          });
          suggestions.push({
            id: suggestion.id,
            fromEmail: suggestion.from_email,
            subject: suggestion.subject,
            preview: suggestion.preview,
            body: suggestion.body,
            receivedAt: suggestion.received_at,
            actionItems: suggestion.action_items,
            suggestedTitle: suggestion.suggested_title,
            suggestedDueDate: suggestion.suggested_due_date,
            urgency: suggestion.urgency,
            status: suggestion.status,
            assignedToId: suggestion.assigned_to,
            createdAt: suggestion.created_at,
          });
        }
        res.status(201).json({ ok: true, created: suggestions.length, suggestions });
        return;
      }

      const candidates = (
        await Promise.all(
        buildDocumentSuggestionCandidates({
          fileName: parsed.data.fileName,
          text,
          assignedToId: DEMO_USER_ID,
        }).map((candidate) => enrichSuggestionCandidateWithAi(candidate, "document")),
        )
      ).filter((candidate) => candidate.shouldCreateTask !== false);
      const suggestions = [];
      for (const candidate of candidates) {
        const suggestion = await storage.createEmailSuggestion({
          fromEmail: candidate.fromEmail,
          subject: candidate.subject,
          preview: candidate.preview,
          suggestedTitle: candidate.suggestedTitle,
          suggestedDueDate: candidate.suggestedDueDate,
          urgency: candidate.urgency,
          assignedToId: DEMO_USER_ID,
        });
        suggestions.push(suggestion);
      }
      res.status(201).json({ ok: true, created: suggestions.length, suggestions });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  // ------------------------------------------------------------------
  // Email suggestions
  // ------------------------------------------------------------------
  app.patch("/api/suggestions/:id", async (req: Request, res: Response) => {
    const parsed = suggestionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Suggestion edits are incomplete." });
      return;
    }
    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const patch: Partial<DonnitEmailSuggestion> = {};
        if (parsed.data.suggestedTitle !== undefined) patch.suggested_title = parsed.data.suggestedTitle;
        if (parsed.data.suggestedDueDate !== undefined) patch.suggested_due_date = parsed.data.suggestedDueDate;
        if (parsed.data.urgency !== undefined) patch.urgency = parsed.data.urgency;
        if (parsed.data.preview !== undefined) patch.preview = parsed.data.preview;
        if (parsed.data.actionItems !== undefined) patch.action_items = parsed.data.actionItems;
        if (parsed.data.assignedToId !== undefined) {
          patch.assigned_to = parsed.data.assignedToId === null ? null : String(parsed.data.assignedToId);
        }
        const updated = await store.updateEmailSuggestion(String(req.params.id), patch);
        if (!updated) {
          res.status(404).json({ message: "Suggestion not found." });
          return;
        }
        res.json(toClientEmailSuggestion(updated));
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: "Suggestion id is invalid." });
      return;
    }
    const patch: Partial<Awaited<ReturnType<typeof storage.listEmailSuggestions>>[number]> = {};
    if (parsed.data.suggestedTitle !== undefined) patch.suggestedTitle = parsed.data.suggestedTitle;
    if (parsed.data.suggestedDueDate !== undefined) patch.suggestedDueDate = parsed.data.suggestedDueDate;
    if (parsed.data.urgency !== undefined) patch.urgency = parsed.data.urgency;
    if (parsed.data.preview !== undefined) patch.preview = parsed.data.preview;
    if (typeof parsed.data.assignedToId === "number") patch.assignedToId = parsed.data.assignedToId;
    const updated = await storage.updateEmailSuggestion(id, patch);
    if (!updated) {
      res.status(404).json({ message: "Suggestion not found." });
      return;
    }
    res.json(updated);
  });

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
        const suggestionSource = sourceFromSuggestion({
          fromEmail: suggestion.from_email,
          subject: suggestion.subject,
        });
        const task = await store.createTask(suggestion.org_id, {
          title: suggestion.suggested_title,
          description: buildEmailTaskDescription({
            subject: suggestion.subject,
            fromEmail: suggestion.from_email,
            preview: suggestion.preview,
            actionItems: suggestion.action_items,
            body: suggestion.body,
          }),
          status: assignedTo === auth.userId ? "open" : "pending_acceptance",
          urgency: suggestion.urgency,
          due_date: suggestion.suggested_due_date,
          estimated_minutes: estimateEmailTaskMinutes({
            title: suggestion.suggested_title,
            preview: suggestion.preview,
            actionItems: suggestion.action_items,
            urgency: suggestion.urgency,
          }),
          assigned_to: assignedTo,
          assigned_by: auth.userId,
          source: suggestionSource,
          recurrence: "none",
          reminder_days_before: 0,
        });
        await applyTaskTemplateToTask(store, suggestion.org_id, task, {
          description: `${suggestion.subject} ${suggestion.preview} ${(suggestion.action_items ?? []).join(" ")} ${suggestion.body ?? ""}`,
        });
        await enrichPositionProfileMemoryFromTask({
          store,
          orgId: suggestion.org_id,
          task,
          eventType: "created",
          note: `${suggestion.subject} ${suggestion.preview}`,
        });
        await store.addEvent(suggestion.org_id, {
          task_id: task.id,
          actor_id: auth.userId,
          type: "email_approved",
          note: `Approved ${suggestionSource} task suggestion from ${suggestion.from_email}.`,
        });
        res.json({ suggestion: updated ? toClientEmailSuggestion(updated) : null, task: toClientTask(task) });
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
        res.json(toClientEmailSuggestion(updated));
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

  app.post("/api/suggestions/:id/draft-reply", async (req: Request, res: Response) => {
    const parsed = suggestionDraftReplySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: "Reply instructions are too long." });
      return;
    }

    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const suggestion = await store.getEmailSuggestion(String(req.params.id));
        if (!suggestion) {
          res.status(404).json({ message: "Suggestion not found." });
          return;
        }
        const source = sourceFromSuggestion({
          fromEmail: suggestion.from_email,
          subject: suggestion.subject,
        });
        if (source === "document") {
          res.status(422).json({ message: "Document suggestions do not support outbound replies." });
          return;
        }
        const fallback = fallbackReplyDraft(suggestion);
        let draft: { message: string; rationale: string; correlationId?: string; estimatedCostUsd?: number };
        if (!process.env.OPENAI_API_KEY) {
          draft = {
            message: fallback,
            rationale: "OpenAI is not configured, so Donnit prepared a simple professional response.",
          };
        } else {
          try {
            draft = await draftSuggestionReplyWithAgent({
              store,
              orgId: suggestion.org_id,
              userId: auth.userId,
              suggestionId: suggestion.id,
              instruction: parsed.data.instruction,
              sourceFromSuggestion,
              replyScenario,
            });
            if (draftLooksCopiedOrWeak(draft.message, suggestion)) {
              draft = {
                ...draft,
                message: fallback,
                rationale: "Donnit replaced a weak AI draft with a safer contextual response.",
              };
            }
          } catch (error) {
            draft = {
              message: fallback,
              rationale: error instanceof Error && error.message.includes("ai_session")
                ? "Apply the intelligence observability Supabase migration, then redeploy before using AI reply drafts."
                : "Donnit used a simple fallback because the AI drafter could not complete.",
            };
          }
        }
        let updated: DonnitEmailSuggestion | null = null;
        try {
          updated = await store.updateEmailSuggestion(suggestion.id, {
            reply_suggested: true,
            reply_draft: draft.message,
            reply_status: "drafted",
          });
        } catch (error) {
          const payload = serializeSupabaseError(error);
          res.status(409).json({
            ok: false,
            reason: "email_reply_schema_missing",
            ...payload,
            message:
              "Apply the email reply workflow Supabase migration, then redeploy before saving AI reply drafts.",
          });
          return;
        }
        res.json({
          ok: true,
          draft: draft.message,
          rationale: draft.rationale,
          correlationId: draft.correlationId ?? null,
          estimatedCostUsd: draft.estimatedCostUsd ?? 0,
          suggestion: updated ? toClientEmailSuggestion(updated) : null,
        });
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const id = Number(req.params.id);
    const suggestions = await storage.listEmailSuggestions();
    const suggestion = suggestions.find((item) => item.id === id);
    if (!suggestion) {
      res.status(404).json({ message: "Suggestion not found." });
      return;
    }
    res.json({
      ok: true,
      draft: fallbackReplyDraft({
        from_email: suggestion.fromEmail,
        subject: suggestion.subject,
        suggested_title: suggestion.suggestedTitle,
        preview: suggestion.preview,
      }),
      rationale: "Demo mode prepared a simple professional response.",
    });
  });

  app.post("/api/suggestions/:id/reply", async (req: Request, res: Response) => {
    const parsed = suggestionReplySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Write a reply before sending." });
      return;
    }

    if (req.donnitAuth) {
      try {
        const auth = req.donnitAuth;
        const store = new DonnitStore(auth.client, auth.userId);
        const suggestion = await store.getEmailSuggestion(String(req.params.id));
        if (!suggestion) {
          res.status(404).json({ message: "Suggestion not found." });
          return;
        }

        const message = parsed.data.message;
        const completeAfterSend = Boolean(parsed.data.completeTask);
        const source = sourceFromSuggestion({
          fromEmail: suggestion.from_email,
          subject: suggestion.subject,
        });

        if (source === "email") {
          const to = extractEmailAddress(suggestion.from_email);
          if (!to) {
            res.status(422).json({ message: "This suggestion does not have a replyable email address." });
            return;
          }
          const subject = normalizeReplySubject(suggestion.subject);
          const access = await resolveGmailSendAccess(store);
          if (access.ok) {
            const sent = await sendGmailThreadReply({
              accessToken: access.accessToken,
              to,
              subject,
              message,
              threadId: suggestion.gmail_thread_id ?? null,
              originalMessageId: suggestion.gmail_message_id ?? null,
            });
            if (sent.ok) {
              const completedTask = completeAfterSend
                ? await completeRelatedTaskFromSuggestion(store, suggestion, auth.userId).catch(() => null)
                : null;
              await store.updateEmailSuggestion(suggestion.id, {
                reply_draft: message,
                reply_status: "sent",
                reply_sent_at: new Date().toISOString(),
                reply_provider_message_id: sent.providerMessageId,
              }).catch(() => null);
              res.json({
                ok: true,
                provider: "email",
                delivery: "sent",
                target: to,
                subject,
                providerMessageId: sent.providerMessageId,
                completedTask: completedTask ? toClientTask(completedTask) : null,
                message: "Email reply sent through Gmail.",
              });
              return;
            }
            await store.updateEmailSuggestion(suggestion.id, {
              reply_draft: message,
              reply_status: "failed",
            }).catch(() => null);
            res.json({
              ok: true,
              provider: "email",
              delivery: "mailto",
              target: to,
              subject,
              href: `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`,
              fallbackReason: sent.reason,
              message: `Gmail could not send directly (${sent.message}). Open the prepared email draft instead.`,
            });
            return;
          }
          await store.updateEmailSuggestion(suggestion.id, {
            reply_draft: message,
            reply_status: "copy",
          }).catch(() => null);
          res.json({
            ok: true,
            provider: "email",
            delivery: "mailto",
            target: to,
            subject,
            href: `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`,
            fallbackReason: access.reason,
            message: access.reason === "gmail_send_scope_missing"
              ? "Reconnect Gmail to let Donnit send replies directly. For now, open the prepared draft."
              : "Connect Gmail to send directly. For now, open the prepared draft.",
          });
          return;
        }

        if (source === "slack") {
          const channel = parseSlackChannelFromSuggestion(suggestion);
          if (channel) {
            const sent = await sendSlackReply({ channel, message });
            if (sent.ok) {
              const completedTask = completeAfterSend
                ? await completeRelatedTaskFromSuggestion(store, suggestion, auth.userId).catch(() => null)
                : null;
              res.json({
                ok: true,
                provider: "slack",
                delivery: "sent",
                target: channel,
                providerMessageId: sent.providerMessageId,
                completedTask: completedTask ? toClientTask(completedTask) : null,
                message: "Slack reply sent.",
              });
              return;
            }
            res.json({
              ok: true,
              provider: "slack",
              delivery: "copy",
              target: channel,
              fallbackReason: sent.reason,
              message: "Slack direct send is not available yet. The reply was prepared to copy.",
              body: parsed.data.message,
            });
            return;
          }
          res.json({
            ok: true,
            provider: "slack",
            delivery: "copy",
            target: suggestion.from_email,
            fallbackReason: "missing_slack_channel",
            message: "Donnit could not identify the Slack channel. The reply was prepared to copy.",
            body: parsed.data.message,
          });
          return;
        }

        if (source === "sms") {
          const phone = parseSmsPhoneFromSuggestion(suggestion);
          if (phone) {
            const sent = await sendSmsReply({ to: phone, message });
            if (sent.ok) {
              const completedTask = completeAfterSend
                ? await completeRelatedTaskFromSuggestion(store, suggestion, auth.userId).catch(() => null)
                : null;
              res.json({
                ok: true,
                provider: "sms",
                delivery: "sent",
                target: phone,
                providerMessageId: sent.providerMessageId,
                completedTask: completedTask ? toClientTask(completedTask) : null,
                message: "SMS reply sent.",
              });
              return;
            }
            res.json({
              ok: true,
              provider: "sms",
              delivery: "copy",
              target: phone,
              fallbackReason: sent.reason,
              message: "SMS direct send is not configured yet. The reply was prepared to copy.",
              body: parsed.data.message,
            });
            return;
          }
          res.json({
            ok: true,
            provider: "sms",
            delivery: "copy",
            target: suggestion.from_email,
            fallbackReason: "missing_sms_phone",
            message: "Donnit could not identify the SMS phone number. The reply was prepared to copy.",
            body: parsed.data.message,
          });
          return;
        }

        res.status(422).json({ message: "Document suggestions do not support outbound replies." });
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: "Suggestion id is invalid." });
      return;
    }
    const suggestions = await storage.listEmailSuggestions();
    const suggestion = suggestions.find((item) => item.id === id);
    if (!suggestion) {
      res.status(404).json({ message: "Suggestion not found." });
      return;
    }
    const source = sourceFromSuggestion({
      fromEmail: suggestion.fromEmail,
      subject: suggestion.subject,
    });
    if (source === "email" && suggestion.fromEmail.includes("@")) {
      const subject = normalizeReplySubject(suggestion.subject);
      res.json({
        ok: true,
        provider: "email",
        delivery: "mailto",
        target: suggestion.fromEmail,
        subject,
        href: `mailto:${encodeURIComponent(suggestion.fromEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(parsed.data.message)}`,
        message: "Open your email draft to finish sending.",
      });
      return;
    }
    res.json({
      ok: true,
      provider: source,
      delivery: "copy",
      target: suggestion.fromEmail,
      message: "The reply was prepared to copy.",
      body: parsed.data.message,
    });
  });

  app.post("/api/sales-leads", async (req: Request, res: Response) => {
    const parsed = salesLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Name, email, phone, and message are required." });
      return;
    }
    try {
      const sent = await sendSalesLead(parsed.data);
      if (sent.ok) {
        res.json({
          ok: true,
          delivery: "sent",
          target: process.env.DONNIT_SALES_TO_EMAIL || "sales@donnit.ai",
          providerMessageId: sent.providerMessageId,
          message: "Thanks. Your request was sent to Donnit sales.",
        });
        return;
      }
      res.json({
        ok: true,
        delivery: "mailto",
        target: process.env.DONNIT_SALES_TO_EMAIL || "sales@donnit.ai",
        fallbackReason: sent.reason,
        href: salesLeadMailto(parsed.data),
        message: "Email sending is not configured yet. Open the prepared email to send your request.",
      });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
    }
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
        const [members, tasks] = await Promise.all([
          store.listOrgMembers(orgId),
          store.listTasks(orgId),
        ]);
        const actor = members.find((member) => member.user_id === auth.userId);
        const visibleTasks = tasks.filter((task) => canViewSensitiveTask(task, auth.userId, actor));
        const agendaState = await store.getWorkspaceState(orgId, "agenda_state");
        const workspaceState = toClientWorkspaceState({ agenda: agendaState });
        const calendarContext = await tryBuildGoogleCalendarContext(store);
        res.json(
          buildClientAgenda(
            visibleTasks.map(toClientTask),
            calendarContext?.busyByDate,
            calendarContext?.timeZone ?? DEFAULT_CALENDAR_TIME_ZONE,
            workspaceState.agenda.preferences,
            workspaceState.agenda.taskOrder,
          ),
        );
        return;
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    const tasks = await storage.listTasks();
    res.json(buildAgenda(tasks));
  });

  app.post("/api/integrations/google/calendar/export", requireDonnitAuth, async (req: Request, res: Response) => {
    const auth = req.donnitAuth!;
    try {
      const store = new DonnitStore(auth.client, auth.userId);
      const access = await resolveGoogleCalendarAccess(store);
      if (!access.ok) {
        res.status(access.status).json({
          ok: false,
          reason: access.reason,
          message: access.message,
        });
        return;
      }

      const orgId = await store.getDefaultOrgId();
      if (!orgId) {
        res.status(409).json({ message: "Workspace not bootstrapped." });
        return;
      }

      const members = await store.listOrgMembers(orgId);
      const actor = members.find((member) => member.user_id === auth.userId);
      const tasks = (await store.listTasks(orgId)).filter((task) => canViewSensitiveTask(task, auth.userId, actor));
      const calendarContext = await fetchGoogleCalendarContext(access.accessToken);
      const excludedTaskIds = Array.isArray(req.body?.excludedTaskIds)
        ? new Set(req.body.excludedTaskIds.map((id: unknown) => String(id)))
        : new Set<string>();
      const preferences = cleanAgendaPreferences(req.body?.preferences);
      const taskOrder = cleanStringArray(req.body?.taskOrder, 500);
      const agenda = buildClientAgenda(
        tasks.map(toClientTask),
        calendarContext.busyByDate,
        calendarContext.timeZone,
        preferences,
        taskOrder,
      ).filter((item) => !excludedTaskIds.has(String(item.taskId)));
      let exported = 0;
      let skipped = 0;
      let updated = 0;

      for (const item of agenda) {
        if (!item.startAt || !item.endAt || item.scheduleStatus !== "scheduled") {
          skipped += 1;
          continue;
        }
        const event = {
          id: calendarEventIdForAgendaItem(item),
          summary: `Donnit: ${item.title}`,
          description: [
            `Estimated time: ${item.estimatedMinutes} minutes`,
            `Urgency: ${item.urgency}`,
            `Donnit task: ${item.taskId}`,
          ].join("\n"),
          start: { dateTime: item.startAt, timeZone: item.timeZone },
          end: { dateTime: item.endAt, timeZone: item.timeZone },
          extendedProperties: {
            private: {
              donnitTaskId: String(item.taskId),
              donnitSource: "agenda",
            },
          },
        };

        const insert = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
          method: "POST",
          headers: {
            authorization: `Bearer ${access.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(event),
        });

        if (insert.ok) {
          exported += 1;
          const legacyId = legacyCalendarEventIdForAgendaItem(item);
          if (legacyId !== event.id) {
            await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${legacyId}`, {
              method: "DELETE",
              headers: { authorization: `Bearer ${access.accessToken}` },
            }).catch(() => undefined);
          }
          continue;
        }

        if (insert.status === 409) {
          const { id: _id, ...patchEvent } = event;
          const patch = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${event.id}`,
            {
              method: "PATCH",
              headers: {
                authorization: `Bearer ${access.accessToken}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(patchEvent),
            },
          );
          if (patch.ok) {
            updated += 1;
            const legacyId = legacyCalendarEventIdForAgendaItem(item);
            if (legacyId !== event.id) {
              await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${legacyId}`, {
                method: "DELETE",
                headers: { authorization: `Bearer ${access.accessToken}` },
              }).catch(() => undefined);
            }
            continue;
          }
        }

        const body = await insert.text().catch(() => "");
        res.status(insert.status === 401 ? 401 : 424).json({
          ok: false,
          reason: insert.status === 401 ? "google_oauth_token_invalid" : "calendar_api_failed",
          message:
            insert.status === 401
              ? "Google authorization expired. Reconnect Google and try again."
              : "Google Calendar rejected the agenda export.",
          detail: body.slice(0, 300),
        });
        return;
      }

      res.json({ ok: true, exported, updated, skipped, total: agenda.length });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : String(error) });
    }
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
    const enrichedCandidates = await Promise.all(
      result.candidates.map((candidate) => enrichSuggestionCandidateWithAi(candidate, "email")),
    );
    const candidates = enrichedCandidates.filter((candidate) => candidate.shouldCreateTask !== false);

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
            gmail_thread_id: candidate.gmailThreadId ?? null,
            from_email: candidate.fromEmail,
            subject: candidate.subject,
            preview: candidate.preview,
            body: candidate.body,
            received_at: normalizeTimestamp(candidate.receivedAt),
            action_items: candidate.actionItems,
            suggested_title: candidate.suggestedTitle,
            suggested_due_date: normalizeDateOnly(candidate.suggestedDueDate),
            urgency: candidate.urgency as "low" | "normal" | "high" | "critical",
            assigned_to: auth.userId,
            reply_suggested: Boolean(candidate.replySuggested),
            reply_status: candidate.replyStatus ?? (candidate.replySuggested ? "suggested" : "none"),
          });
          created.push(suggestion);
        }
        res.json({
          ok: true,
          source: result.source,
          scannedCandidates: enrichedCandidates.length,
          createdSuggestions: created.length,
          suggestions: created,
        });
        return;
      } catch (error) {
        const payload = serializeSupabaseError(error);
        console.error("[donnit] gmail suggestion persist failed", {
          userId: req.donnitAuth?.userId,
          ...payload,
        });
        res.status(500).json({
          ok: false,
          reason: "gmail_suggestion_persist_failed",
          message: payload.message,
          code: payload.code,
          details: payload.details,
          hint: payload.hint,
        });
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
      scannedCandidates: enrichedCandidates.length,
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
      const gmailScopeConnected = Boolean(connected && hasOAuthScope(account?.scope, GMAIL_OAUTH_SCOPE));
      const gmailSendScopeConnected = Boolean(connected && hasOAuthScope(account?.scope, GMAIL_SEND_OAUTH_SCOPE));
      const calendarConnected = Boolean(connected && hasGoogleCalendarScope(account?.scope));
      const requiresReconnect = Boolean(account && account.status === "error");
      const expiresMs = account?.expires_at ? new Date(account.expires_at).getTime() : NaN;
      const tokenExpiresSoon = Boolean(connected && Number.isFinite(expiresMs) && expiresMs - Date.now() < 10 * 60_000);
      const health =
        !cfg.configured
          ? "oauth_not_configured"
          : !account
            ? "not_connected"
            : requiresReconnect || tokenExpiresSoon
              ? "needs_reconnect"
              : !gmailScopeConnected
                ? "gmail_scope_missing"
                : !gmailSendScopeConnected
                  ? "gmail_send_scope_missing"
                : !calendarConnected
                  ? "calendar_scope_missing"
                  : "ready";
      res.json({
        configured: cfg.configured,
        authenticated: true,
        connected,
        gmailScopeConnected,
        gmailSendScopeConnected,
        calendarConnected,
        calendarRequiresReconnect: connected && !calendarConnected,
        requiresReconnect,
        tokenExpiresSoon,
        health,
        email: account?.email ?? null,
        connectedAt: account?.connected_at ?? null,
        expiresAt: account?.expires_at ?? null,
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
  //      redirects to "/?gmail=<reason>#/app" so the SPA can show a real
  //      toast while keeping the user inside the authenticated app route.
  app.get("/api/integrations/gmail/oauth/callback", async (req: Request, res: Response) => {
    const safeRedirect = (
      reason: string,
      detail?: { googleError?: string | null; googleErrorDescription?: string | null },
    ) => {
      // Always redirect to the app route with a typed gmail param so the SPA
      // can show a toast and refresh oauth status without further server hops.
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
      const redirectUrl = `/?${params.toString()}#/app`;
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
    const candidate = await enrichSuggestionCandidateWithAi(buildManualEmailCandidate(parsed.data), "email", {
      from: parsed.data.fromEmail,
    });
    if (candidate.shouldCreateTask === false) {
      res.status(200).json({
        ok: true,
        created: false,
        message: "Donnit did not find a clear task in that email.",
        candidate,
      });
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
        const suggestion = await store.createEmailSuggestion(orgId, {
          gmail_message_id: candidate.gmailMessageId ?? null,
          gmail_thread_id: candidate.gmailThreadId ?? null,
          from_email: candidate.fromEmail,
          subject: candidate.subject,
          preview: candidate.preview,
          body: candidate.body,
          received_at: normalizeTimestamp(candidate.receivedAt),
          action_items: candidate.actionItems,
          suggested_title: candidate.suggestedTitle,
          suggested_due_date: normalizeDateOnly(candidate.suggestedDueDate),
          urgency: candidate.urgency as "low" | "normal" | "high" | "critical",
          assigned_to: auth.userId,
          reply_suggested: Boolean(candidate.replySuggested),
          reply_status: candidate.replyStatus ?? (candidate.replySuggested ? "suggested" : "none"),
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

  async function createExternalSuggestionFromInput(
    req: Request,
    res: Response,
    source: "slack" | "sms",
    input: ExternalTaskSuggestionInput,
  ) {
    const candidate = await enrichSuggestionCandidateWithAi(
      buildExternalSuggestionCandidate({
        source,
        text: input.text,
        from: input.from,
        channel: input.channel,
        subject: input.subject,
      }),
      source,
      {
        from: input.from,
        channel: input.channel,
      },
    );
    if (candidate.shouldCreateTask === false) {
      res.status(200).json({
        ok: true,
        created: false,
        source,
        message: "Donnit did not find a clear task in that message.",
        candidate,
      });
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
        const assignedTo =
          typeof input.assignedToId === "string"
            ? input.assignedToId
            : await resolveAssignedToFromActor(store, orgId, input.from, auth.userId);
        const suggestion = await store.createEmailSuggestion(orgId, {
          gmail_message_id: externalSuggestionKey(source, candidate),
          gmail_thread_id: null,
          from_email: candidate.fromEmail,
          subject: candidate.subject,
          preview: candidate.preview,
          body: candidate.body,
          received_at: normalizeTimestamp(candidate.receivedAt),
          action_items: candidate.actionItems,
          suggested_title: candidate.suggestedTitle,
          suggested_due_date: normalizeDateOnly(candidate.suggestedDueDate),
          urgency: candidate.urgency,
          assigned_to: assignedTo,
          reply_suggested: Boolean(candidate.replySuggested),
          reply_status: candidate.replyStatus ?? (candidate.replySuggested ? "suggested" : "none"),
        });
        res.status(201).json({ ok: true, suggestion });
        return;
      } catch (error) {
        const payload = serializeSupabaseError(error);
        console.error(`[donnit] ${source} suggestion failed`, { userId: req.donnitAuth?.userId, ...payload });
        res.status(500).json({ ok: false, ...payload });
        return;
      }
    }

    if (isSupabaseConfigured()) {
      try {
        const admin = createSupabaseAdminClient();
        if (!admin) {
          res.status(503).json({
            ok: false,
            reason: "missing_service_role",
            message: "Slack/SMS ingest needs SUPABASE_SERVICE_ROLE_KEY to save into the workspace.",
          });
          return;
        }
        const target = await resolveDefaultIngestTarget();
        if (!target) {
          res.status(409).json({
            ok: false,
            reason: "workspace_not_bootstrapped",
            message: "No Donnit workspace is available for external suggestions.",
          });
          return;
        }
        const store = new DonnitStore(admin, target.assignedTo);
        const assignedTo =
          typeof input.assignedToId === "string"
            ? input.assignedToId
            : source === "sms" && process.env.DONNIT_SMS_DEFAULT_ASSIGNEE_ID
              ? process.env.DONNIT_SMS_DEFAULT_ASSIGNEE_ID
            : await resolveAssignedToFromActor(store, target.orgId, input.from, target.assignedTo);
        const suggestion = await store.createEmailSuggestion(target.orgId, {
          gmail_message_id: externalSuggestionKey(source, candidate),
          gmail_thread_id: null,
          from_email: candidate.fromEmail,
          subject: candidate.subject,
          preview: candidate.preview,
          body: candidate.body,
          received_at: normalizeTimestamp(candidate.receivedAt),
          action_items: candidate.actionItems,
          suggested_title: candidate.suggestedTitle,
          suggested_due_date: normalizeDateOnly(candidate.suggestedDueDate),
          urgency: candidate.urgency,
          assigned_to: assignedTo,
          reply_suggested: Boolean(candidate.replySuggested),
          reply_status: candidate.replyStatus ?? (candidate.replySuggested ? "suggested" : "none"),
        });
        res.status(201).json({ ok: true, source, destination: "supabase", suggestion });
        return;
      } catch (error) {
        const payload = serializeSupabaseError(error);
        console.error(`[donnit] ${source} admin suggestion failed`, { ...payload });
        res.status(500).json({ ok: false, reason: "external_suggestion_persist_failed", ...payload });
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
      assignedToId: typeof input.assignedToId === "number" ? input.assignedToId : DEMO_USER_ID,
    });
    res.status(201).json({ ok: true, suggestion });
  }

  async function createExternalSuggestion(req: Request, res: Response, source: "slack" | "sms") {
    const parsed = externalTaskSuggestionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Provide message text between 2 and 4000 characters." });
      return;
    }
    return createExternalSuggestionFromInput(req, res, source, parsed.data);
  }

  app.post("/api/integrations/slack/suggest", async (req: Request, res: Response) => {
    const expected = process.env.DONNIT_SLACK_WEBHOOK_TOKEN;
    if (
      !req.donnitAuth &&
      process.env.NODE_ENV === "production" &&
      (!expected || req.get("x-donnit-ingest-token") !== expected)
    ) {
      res.status(401).json({
        message: "Authenticate or provide the Slack ingest token.",
        reason: expected ? "token_mismatch" : "token_not_configured",
      });
      return;
    }
    return createExternalSuggestion(req, res, "slack");
  });

  app.get("/api/integrations/slack/status", requireDonnitAuth, async (req: Request, res: Response) => {
    try {
      const auth = req.donnitAuth!;
      const store = new DonnitStore(auth.client, auth.userId);
      const orgId = await store.getDefaultOrgId();
      const members = orgId ? await store.listOrgMembers(orgId) : [];
      const mappedByEmail = members.filter((member) => Boolean(member.profile?.email)).length;
      const signingSecretConfigured = Boolean(process.env.SLACK_SIGNING_SECRET);
      const webhookConfigured = Boolean(process.env.DONNIT_SLACK_WEBHOOK_TOKEN);
      const botConfigured = Boolean(process.env.SLACK_BOT_TOKEN);
      const eventsConfigured = signingSecretConfigured || webhookConfigured;
      res.json({
        ok: true,
        provider: "slack",
        health: eventsConfigured ? (botConfigured ? "ready" : "events_without_profile_lookup") : "setup",
        webhookConfigured,
        signingSecretConfigured,
        botConfigured,
        eventsConfigured,
        eventEndpoint: "/api/integrations/slack/events",
        suggestEndpoint: "/api/integrations/slack/suggest",
        unreadDelayMinutes: Number(process.env.DONNIT_SLACK_UNREAD_DELAY_MINUTES ?? "2") || 2,
        userMapping: {
          mode: botConfigured ? "slack_profile_email_then_name" : "message_name_then_default_owner",
          mappedByEmail,
          totalMembers: members.length,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/integrations/slack/events", async (req: Request, res: Response) => {
    if (process.env.NODE_ENV === "production" && !verifySlackRequest(req)) {
      res.status(401).json({ ok: false, reason: "slack_signature_or_token_required" });
      return;
    }
    const body = req.body as Record<string, any>;
    if (body?.type === "url_verification" && typeof body.challenge === "string") {
      res.json({ challenge: body.challenge });
      return;
    }
    if (body?.type !== "event_callback") {
      res.json({ ok: true, ignored: "unsupported_slack_payload" });
      return;
    }
    const event = body.event as Record<string, any> | undefined;
    if (!event || event.type !== "message" || typeof event.text !== "string") {
      res.json({ ok: true, ignored: "unsupported_slack_event" });
      return;
    }
    if (event.subtype || event.bot_id || event.hidden) {
      res.json({ ok: true, ignored: "non_user_message" });
      return;
    }
    const actor = await lookupSlackUserLabel(typeof event.user === "string" ? event.user : null);
    const channel = typeof event.channel === "string" ? event.channel : body.event_context ?? "slack";
    const eventId = typeof body.event_id === "string" ? body.event_id : `${channel}:${event.ts ?? Date.now()}`;
    const text = String(event.text).replace(/<@([A-Z0-9]+)>/g, "@$1").trim();
    const metadata = [
      `Slack event: ${eventId}`,
      event.ts ? `Message timestamp: ${event.ts}` : "",
      event.thread_ts ? `Thread timestamp: ${event.thread_ts}` : "",
    ].filter(Boolean);
    return createExternalSuggestionFromInput(req, res, "slack", {
      text: `${text}\n\n${metadata.join("\n")}`.trim(),
      from: actor,
      channel,
      subject: `Slack: ${channel}`,
    });
  });

  app.post("/api/integrations/sms/inbound", async (req: Request, res: Response) => {
    if (
      !req.donnitAuth &&
      process.env.NODE_ENV === "production" &&
      !verifySmsRequest(req)
    ) {
      res.status(401).json({
        message: "Authenticate, provide the SMS ingest token, or send a verified Twilio webhook.",
        reason: process.env.DONNIT_SMS_WEBHOOK_TOKEN || process.env.TWILIO_AUTH_TOKEN ? "sms_verification_failed" : "token_not_configured",
      });
      return;
    }
    const parsed = externalTaskSuggestionSchema.safeParse(req.body);
    if (parsed.success) return createExternalSuggestionFromInput(req, res, "sms", parsed.data);
    const normalized = normalizeSmsInboundBody(req.body);
    if (!normalized) {
      res.status(400).json({ message: "Provide SMS text in `text` or Twilio `Body`." });
      return;
    }
    return createExternalSuggestionFromInput(req, res, "sms", normalized);
  });

  app.get("/api/integrations/sms/status", requireDonnitAuth, async (req: Request, res: Response) => {
    try {
      const auth = req.donnitAuth!;
      const store = new DonnitStore(auth.client, auth.userId);
      const orgId = await store.getDefaultOrgId();
      const members = orgId ? await store.listOrgMembers(orgId) : [];
      const inboundConfigured = Boolean(process.env.DONNIT_SMS_WEBHOOK_TOKEN || process.env.TWILIO_AUTH_TOKEN);
      const providerConfigured = Boolean(process.env.TWILIO_AUTH_TOKEN || process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_FROM_NUMBER);
      res.json({
        ok: true,
        provider: "sms",
        health: inboundConfigured ? (providerConfigured ? "ready" : "webhook_only") : "setup",
        inboundConfigured,
        webhookConfigured: Boolean(process.env.DONNIT_SMS_WEBHOOK_TOKEN),
        signatureConfigured: Boolean(process.env.TWILIO_AUTH_TOKEN),
        accountConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID),
        fromNumberConfigured: Boolean(process.env.TWILIO_FROM_NUMBER),
        inboundEndpoint: "/api/integrations/sms/inbound",
        routing: {
          mode: process.env.DONNIT_SMS_DEFAULT_ASSIGNEE_ID ? "configured_default_assignee" : "default_workspace_owner",
          defaultAssigneeConfigured: Boolean(process.env.DONNIT_SMS_DEFAULT_ASSIGNEE_ID),
          totalMembers: members.length,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  });

  return httpServer;
}
