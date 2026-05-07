import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import crypto from "node:crypto";
import {
  chatRequestSchema,
  externalTaskSuggestionSchema,
  noteRequestSchema,
  taskCreateRequestSchema,
  taskUpdateRequestSchema,
} from "@shared/schema";
import type { InsertTask, Task, User } from "@shared/schema";
import {
  buildGmailAuthUrl,
  buildManualEmailCandidate,
  exchangeGmailAuthCode,
  GmailTokenExchangeError,
  getGmailOAuthConfig,
  getIntegrationStatus,
  hasGoogleCalendarScope,
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
import {
  DonnitStore,
  type DonnitEmailSuggestion,
  type DonnitPositionProfile,
  type DonnitTask,
  type DonnitTaskSubtask,
  type DonnitUserWorkspaceState,
} from "./donnit-store";
import { DONNIT_SCHEMA, DONNIT_TABLES, isSupabaseConfigured } from "./supabase";

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

function nextWeekdayIso(targetDay: number, preferNextWeek = false) {
  const now = new Date();
  const today = now.getDay();
  let delta = targetDay - today;
  if (delta < 0 || (delta === 0 && preferNextWeek)) delta += 7;
  return addDays(delta);
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
  if (text.includes("today")) return todayIso();
  if (text.includes("tomorrow")) return addDays(1);
  if (text.includes("next week")) return addDays(7);
  const weekdayMatch = text.match(/\b(?:(next|this)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (weekdayMatch) {
    const dayIndex: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    return nextWeekdayIso(dayIndex[weekdayMatch[2]], weekdayMatch[1] === "next");
  }
  if (text.includes("this week")) return addDays(3);
  return null;
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
  if (/(critical|emergency|blocker|immediately)/.test(text)) return "critical";
  if (/(urgent|asap|high priority|important)/.test(text)) return "high";
  if (/(low priority|whenever|someday)/.test(text)) return "low";
  return "normal";
}

function parseEstimate(message: string) {
  const minutes = message.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:min|mins|minutes)\b/i);
  if (minutes) return Math.max(5, Math.round(Number(minutes[1])));
  const hours = message.match(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours)\b/i);
  if (hours) return Math.max(15, Math.round(Number(hours[1]) * 60));
  if (/\bquick|small|simple|brief\b/i.test(message)) return 15;
  if (/\breview|audit|analyze|draft|prepare|proposal|contract\b/i.test(message)) return 45;
  if (/\bplan|strategy|report|presentation|deck|onboarding\b/i.test(message)) return 60;
  return 30;
}

function findAssignee(message: string, users: User[]) {
  const text = message.toLowerCase();
  const explicit = users.find((user) => text.includes(`@${user.name.toLowerCase()}`) || text.includes(user.email.toLowerCase()));
  if (explicit) return explicit;
  const named = users.find((user) => user.id !== DEMO_USER_ID && text.includes(user.name.toLowerCase()));
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
      .replace(new RegExp(`\\bassign(?: this)?(?: task)?\\s+to\\s+${safe}\\b`, "gi"), "")
      .replace(new RegExp(`\\bassign\\s+${safe}\\b`, "gi"), "")
      .replace(new RegExp(`\\bdelegate(?: this)?(?: task)?\\s+to\\s+${safe}\\b`, "gi"), "")
      .replace(new RegExp(`\\bdelegate\\s+${safe}\\b`, "gi"), "")
      .replace(new RegExp(`\\breassign(?: this)?(?: task)?\\s+to\\s+${safe}\\b`, "gi"), "")
      .replace(new RegExp(`\\breassign\\s+${safe}\\b`, "gi"), "")
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
    .replace(/\bfor me (?:thats|that's|that is)\b/gi, "")
    .replace(/^(?:for me|me)\b[,\s:]*/gi, "")
    .replace(/\bfor me to\s+/gi, "")
    .replace(/\bfor me\b/gi, "")
    .replace(/\b(?:please\s+)?(?:add|create|make|log)\s+(?:a\s+)?(?:task|todo|to-do)\s+(?:to\s+)?/gi, "")
    .replace(/\b(?:remind me|reminder)\s+to\s+/gi, "")
    .replace(/\b(?:i need|need|needs|need to)\s+/gi, "")
    .replace(/\b(?:due|by|before|on)\s+(?:20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/gi, "")
    .replace(naturalDate, "")
    .replace(naturalDateDayFirst, "")
    .replace(/\b(?:due|by|before|on)\s+(?:today|tomorrow|next week|this week)\b/gi, "")
    .replace(/\b(?:due|by|before|on)?\s*(?:(?:next|this)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
    .replace(/\b(today|tomorrow|next week|this week|urgent|asap|critical|high priority|low priority)\b/gi, "")
    .replace(/\bby\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/gi, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:min|mins|minutes|hr|hrs|hour|hours)\b/gi, "")
    .replace(/\b\d+\s*days?\s*before\b/gi, "")
    .replace(/\b(?:normal|medium|high|low)\s+urgency\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(add|create|make|log|please|task to|todo to|to-do to)\s+/i, "")
    .slice(0, 150);
  const withoutAssignee = stripLeadingUnknownAssignee(stripAssigneePhrases(cleaned, assigneeLabels))
    .replace(/\s+/g, " ")
    .replace(/^(?:please\s+)?(?:assign|delegate|reassign)\s+(?:this\s+)?(?:task\s+)?(?:to\s+)?/i, "")
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

function parseChatTask(message: string, users: User[]): InsertTask {
  const assignee = findAssignee(message, users);
  const reminderDaysBefore = parseAnnualReminderDays(message);
  const recurrence = reminderDaysBefore > 0 || /annual|birthday|anniversary/i.test(message) ? "annual" : "none";
  const assignedToId = assignee?.id ?? DEMO_USER_ID;
  const assignedById = DEMO_USER_ID;
  const title = titleFromMessage(message, [assignee?.name ?? "", assignee?.email ?? ""]) || "Untitled task";
  const dueDate = parseDueDate(message);
  const urgency = isPastDue(dueDate) ? "critical" : parseUrgency(message);

  return {
    title,
    description: message,
    status: assignedToId === assignedById ? "open" : "pending_acceptance",
    urgency,
    dueDate,
    estimatedMinutes: parseEstimate(message),
    assignedToId,
    assignedById,
    source: "chat",
    recurrence,
    reminderDaysBefore,
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

const DEFAULT_CALENDAR_TIME_ZONE = "America/New_York";
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

function formatDateTimeLocal(date: string, minute: number) {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
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

  return candidates.map((task, index) => {
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
    estimatedMinutes: task.estimated_minutes,
    assignedToId: task.assigned_to,
    assignedById: task.assigned_by,
    delegatedToId: task.delegated_to,
    collaboratorIds: task.collaborator_ids ?? [],
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
}) {
  const reviewedValue = (input.reviewed?.value ?? {}) as Record<string, unknown>;
  const agendaValue = (input.agenda?.value ?? {}) as Record<string, unknown>;
  return {
    reviewedNotificationIds: cleanStringArray(reviewedValue.ids, 200),
    agenda: {
      excludedTaskIds: cleanStringArray(agendaValue.excludedTaskIds, 500),
      approved: agendaValue.approved === true,
      approvedAt: typeof agendaValue.approvedAt === "string" ? agendaValue.approvedAt : null,
      preferences: cleanAgendaPreferences(agendaValue.preferences),
      taskOrder: cleanStringArray(agendaValue.taskOrder, 500),
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
    reviewedState,
    agendaState,
  ] = await Promise.all([
    store.listOrgMembers(orgId),
    store.listTasks(orgId),
    store.listEvents(orgId),
    store.listChatMessages(orgId),
    store.listEmailSuggestions(orgId),
    store.listPositionProfiles(orgId),
    store.listTaskSubtasks(orgId),
    store.getWorkspaceState(orgId, "reviewed_notifications"),
    store.getWorkspaceState(orgId, "agenda_state"),
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
  const clientTasks = sortClientTasks(applyRelationshipEvents(tasks.map(toClientTask), events));
  const calendarContext = await tryBuildGoogleCalendarContext(store);
  const workspaceState = toClientWorkspaceState({ reviewed: reviewedState, agenda: agendaState });
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
    positionProfiles: positionProfiles.map(toClientPositionProfile),
    subtasks: subtasks.map(toClientTaskSubtask),
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
  const title =
    titleFromMessage(message, [
      assignee?.profile?.full_name ?? "",
      assignee?.profile?.email ?? "",
    ]) || "Untitled task";
  const dueDate = parseDueDate(message);
  const urgency = isPastDue(dueDate) ? "critical" : parseUrgency(message);
  return {
    title,
    description: message,
    status: assignedToId === selfId ? "open" : "pending_acceptance",
    urgency,
    dueDate,
    estimatedMinutes: parseEstimate(message),
    assignedToId,
    assignedById: selfId,
    source: "chat" as const,
    recurrence: recurrence as "none" | "annual",
    reminderDaysBefore,
  };
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
    }),
  }),
]);

const positionProfileAssignSchema = z.object({
  profileId: z.string().trim().min(1).optional(),
  fromUserId: z.union([z.string().min(1), z.number()]),
  toUserId: z.union([z.string().min(1), z.number()]),
  mode: z.enum(["transfer", "delegate"]),
  delegateUntil: z.string().trim().max(20).nullable().optional(),
  profileTitle: z.string().trim().max(160).optional(),
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
});

const demoTeamMembers = [
  {
    key: "maya",
    name: "Maya Chen",
    persona: "operations",
    role: "manager" as const,
    canAssign: true,
    tasks: [
      {
        title: "Confirm Friday client coverage plan",
        description: "Review open client work and confirm who owns the Friday coverage notes before the end of day.",
        urgency: "high" as const,
        dueOffset: 0,
        estimatedMinutes: 45,
        source: "chat" as const,
      },
      {
        title: "Review unread vendor renewal request",
        description: "Vendor renewal came through email and needs a quick decision before the contract rolls over.",
        urgency: "normal" as const,
        dueOffset: 2,
        estimatedMinutes: 30,
        source: "email" as const,
      },
    ],
  },
  {
    key: "jordan",
    name: "Jordan Lee",
    persona: "client-success",
    role: "member" as const,
    canAssign: false,
    tasks: [
      {
        title: "Follow up on ACME renewal blockers",
        description: "Slack thread flagged renewal blockers. Summarize next steps and update the manager before the account review.",
        urgency: "critical" as const,
        dueOffset: -1,
        estimatedMinutes: 60,
        source: "slack" as const,
      },
      {
        title: "Prepare onboarding notes for replacement coverage",
        description: "Add how-to context for recurring account handoff steps so another person can cover the role if needed.",
        urgency: "normal" as const,
        dueOffset: 4,
        estimatedMinutes: 50,
        source: "document" as const,
      },
    ],
  },
  {
    key: "nina",
    name: "Nina Patel",
    persona: "finance",
    role: "member" as const,
    canAssign: false,
    tasks: [
      {
        title: "Reconcile ChatGPT expense receipt",
        description: "Receipt was captured from Gmail. Confirm the amount, category, and whether it should be attached to May expenses.",
        urgency: "normal" as const,
        dueOffset: 1,
        estimatedMinutes: 15,
        source: "email" as const,
      },
      {
        title: "Respond to payroll access text",
        description: "Inbound SMS mentioned payroll access. Confirm whether the employee still needs help and document the resolution.",
        urgency: "high" as const,
        dueOffset: 0,
        estimatedMinutes: 20,
        source: "sms" as const,
      },
    ],
  },
];

type IngestTarget = {
  orgId: string;
  assignedTo: string;
};

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
  estimatedMinutes: number;
  assigneeHint: string | null;
  recurrence: "none" | "annual";
  reminderDaysBefore: number;
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
  estimatedMinutes: z.number().int().min(5).max(1440),
  assigneeHint: z.string().trim().max(160).nullable(),
  recurrence: z.enum(["none", "annual"]),
  reminderDaysBefore: z.number().int().min(0).max(365),
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
  return compactTaskText(cleaned.replace(/^(?:please\s+)?(?:assign|delegate|reassign)\s+/i, ""), 160);
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
    chat: "Manager chat input may contain assignment commands, due dates, urgency, and time estimates.",
    email:
      "Email input may be a receipt, invoice, scheduling request, approval request, access notice, customer request, or FYI. Create a task only from the actionable next step implied by the email.",
    slack:
      "Slack input may be informal. Convert the actual request into a clean task title instead of copying the message.",
    sms:
      "SMS input may be short or fragmented. Infer the intended task conservatively and keep it clear.",
    document:
      "Document input may contain bullet points, meeting notes, policies, or project plans. Extract the clearest actionable item.",
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
        model: process.env.DONNIT_AI_MODEL ?? "gpt-4o-mini",
        input: [
          {
            role: "system",
            content:
              [
                "Extract one actionable Donnit task for a professional workplace continuity tool.",
                "Return only schema fields. Use null dueDate when no date is clear.",
                "Write a clean action title, not copied source text. Titles must not start with assignment boilerplate like 'Assign Jordan'.",
                "If the text says to assign someone, put that person in assigneeHint and make the title the work itself.",
                "Separate actual work from context. Pure FYI, shipment updates, newsletters, and status-only messages should set shouldCreateTask=false and taskType=context_only.",
                "Receipts and business purchases can be tasks when reconciliation or expense review is implied; write them like 'Reconcile ChatGPT expense ($55.00)'.",
                "Descriptions should explain the next step in one or two plain sentences.",
                "Use the exact time estimate if the user provides one. 1.5 hours is 90 minutes.",
                "Use critical urgency only for past due, blocker, emergency, or explicit critical work.",
                "sourceExcerpt should be a short source quote or summary that explains why the task was suggested.",
              ].join(" "),
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
                estimatedMinutes: { type: "integer" },
                assigneeHint: { anyOf: [{ type: "string" }, { type: "null" }] },
                recurrence: { type: "string", enum: ["none", "annual"] },
                reminderDaysBefore: { type: "integer" },
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
                "estimatedMinutes",
                "assigneeHint",
                "recurrence",
                "reminderDaysBefore",
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
  return (
    candidates.find((candidate) => {
      const name = (candidate.name ?? "").toLowerCase();
      const email = (candidate.email ?? "").toLowerCase();
      return Boolean((name && lowered.includes(name)) || (email && lowered.includes(email)));
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
};

function applyAiToCandidate<T extends TaskSuggestionCandidate>(
  candidate: T,
  ai: AiTaskExtraction | null,
  source: SuggestionSource,
): T & { shouldCreateTask?: boolean } {
  if (!ai) return candidate;
  const title = normalizeAiTitle(ai.title, candidate.suggestedTitle);
  const dueDate = ai.dueDate ?? candidate.suggestedDueDate ?? null;
  const urgency = dueDate && isPastDue(dueDate) ? "critical" : ai.urgency;
  const actionItems = [
    normalizeAiDescription(ai.description, candidate.preview),
    `Why Donnit suggested this: ${ai.rationale}`,
    `Confidence: ${ai.confidence}`,
    `Estimated time: ${ai.estimatedMinutes} minutes`,
    ai.sourceExcerpt ? `Source excerpt: ${compactTaskText(ai.sourceExcerpt, 240)}` : "",
  ].filter(Boolean);
  return {
    ...candidate,
    shouldCreateTask: ai.shouldCreateTask,
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
): Promise<T & { shouldCreateTask?: boolean }> {
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
          donnitAiModel: process.env.DONNIT_AI_MODEL ?? "gpt-4o-mini",
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
      const existingTasks = await store.listTasks(orgId);
      const dateForOffset = (days: number) => {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date.toISOString().slice(0, 10);
      };

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
          const alreadyExists = existingTasks.some(
            (task) => task.assigned_to === userId && task.title === taskSeed.title,
          );
          if (alreadyExists) continue;
          await store.createTask(orgId, {
            title: taskSeed.title,
            description: taskSeed.description,
            status: taskSeed.source === "chat" ? "pending_acceptance" : "open",
            urgency: taskSeed.urgency,
            due_date: dateForOffset(taskSeed.dueOffset),
            estimated_minutes: taskSeed.estimatedMinutes,
            assigned_to: userId,
            assigned_by: auth.userId,
            source: taskSeed.source,
            recurrence: "none",
            reminder_days_before: 0,
          });
          createdTasks += 1;
        }
      }

      res.status(201).json({
        ok: true,
        users: seededUsers.length,
        tasks: createdTasks,
        message:
          createdTasks > 0
            ? "Demo team added. Refresh the Team view to test manager reporting."
            : "Demo team was already present.",
      });
    } catch (error) {
      const payload = serializeSupabaseError(error);
      console.error("[donnit] seed demo team failed", { userId: req.donnitAuth?.userId, ...payload });
      res.status(500).json({ ok: false, ...payload });
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
        const ai = await extractChatTaskWithAi(
          parsed.data.message,
          members.map((m) => `${m.profile?.full_name ?? ""} ${m.profile?.email ?? ""}`.trim()).filter(Boolean),
        );
        const fallbackInput = parseChatTaskAuthenticated(parsed.data.message, members, auth.userId);
        const aiAssignee = ai
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
        const assignedToId = aiAssignee?.user_id ?? fallbackInput.assignedToId;
        const resolvedDueDate = ai?.dueDate ?? fallbackInput.dueDate;
        const resolvedUrgency =
          resolvedDueDate && isPastDue(resolvedDueDate) ? "critical" : (ai?.urgency ?? fallbackInput.urgency);
        const resolvedTitle = ai
          ? normalizeAiTitle(ai.title, fallbackInput.title, [
              aiAssignee?.profile?.full_name ?? "",
              aiAssignee?.profile?.email ?? "",
            ])
          : fallbackInput.title;
        const taskInput = ai
          ? {
              title: resolvedTitle,
              description: `${normalizeAiDescription(ai.description, parsed.data.message)}\n\nDonnit rationale: ${ai.rationale}${ai.assigneeHint && !aiAssignee ? `\nPotential assignee mentioned: ${ai.assigneeHint}` : ""}`,
              status: assignedToId === auth.userId ? "open" : "pending_acceptance",
              urgency: resolvedUrgency,
              dueDate: resolvedDueDate,
              estimatedMinutes: ai.estimatedMinutes,
              assignedToId,
              assignedById: auth.userId,
              source: "chat" as const,
              recurrence: ai.recurrence,
              reminderDaysBefore: ai.reminderDaysBefore,
            }
          : fallbackInput;
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
        const dueText = dueDateAssistantText(created.due_date);
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
    const ai = await extractChatTaskWithAi(
      parsed.data.message,
      users.map((user) => `${user.name} ${user.email}`),
    );
    const fallbackInput = parseChatTask(parsed.data.message, users);
    const aiAssignee = matchAiAssignee(ai?.assigneeHint ?? null, users);
    const assignedToId = aiAssignee?.id ?? fallbackInput.assignedToId;
    const resolvedDueDate = ai?.dueDate ?? fallbackInput.dueDate;
    const resolvedUrgency =
      resolvedDueDate && isPastDue(resolvedDueDate) ? "critical" : (ai?.urgency ?? fallbackInput.urgency);
    const resolvedTitle = ai
      ? normalizeAiTitle(ai.title, fallbackInput.title, [aiAssignee?.name ?? "", aiAssignee?.email ?? ""])
      : fallbackInput.title;
    const taskInput = ai
      ? {
          title: resolvedTitle,
          description: `${normalizeAiDescription(ai.description, parsed.data.message)}\n\nDonnit rationale: ${ai.rationale}${ai.assigneeHint && !aiAssignee ? `\nPotential assignee mentioned: ${ai.assigneeHint}` : ""}`,
          status: assignedToId === DEMO_USER_ID ? "open" : "pending_acceptance",
          urgency: resolvedUrgency,
          dueDate: resolvedDueDate,
          estimatedMinutes: ai.estimatedMinutes,
          assignedToId,
          assignedById: DEMO_USER_ID,
          source: "chat" as const,
          recurrence: ai.recurrence,
          reminderDaysBefore: ai.reminderDaysBefore,
        }
      : fallbackInput;
    const task = await storage.createTask(taskInput);
    await storage.createChatMessage({ role: "user", content: parsed.data.message, taskId: task.id });
    const assignee = users.find((user) => user.id === task.assignedToId);
    const dueText = dueDateAssistantText(task.dueDate);
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
        if (data.estimatedMinutes !== undefined) patch.estimated_minutes = data.estimatedMinutes;
        if (data.assignedToId !== undefined) patch.assigned_to = String(data.assignedToId);
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
        await store.addEvent(updated.org_id, {
          task_id: updated.id,
          actor_id: auth.userId,
          type: data.assignedToId !== undefined || data.delegatedToId !== undefined || data.collaboratorIds !== undefined
            ? "relationships_updated"
            : "updated",
          note: data.assignedToId !== undefined || data.delegatedToId !== undefined || data.collaboratorIds !== undefined
            ? relationshipEventNote({
                assignedToId: updated.assigned_to,
                delegatedToId: nextDelegatedToId,
                collaboratorIds: nextCollaboratorIds,
              })
            : data.note || "Task details updated.",
        });
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
    await storage.addEvent({
      taskId: id,
      actorId: DEMO_USER_ID,
      type: data.assignedToId !== undefined || data.delegatedToId !== undefined || data.collaboratorIds !== undefined
        ? "relationships_updated"
        : "updated",
      note: data.assignedToId !== undefined || data.delegatedToId !== undefined || data.collaboratorIds !== undefined
        ? relationshipEventNote({
            assignedToId: task.assignedToId,
            delegatedToId: task.delegatedToId,
            collaboratorIds: parseDemoCollaboratorIds(task.collaboratorIds),
          })
        : data.note || "Task details updated.",
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
    action: "complete" | "accept" | "deny" | "note" | "request_update",
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
        const tasks = await store.listTasks(orgId);
        const active = tasks.filter(
          (task) =>
            task.assigned_to === fromUserId &&
            task.status !== "completed" &&
            task.status !== "denied",
        );
        if (mode === "delegate" && active.some((task) => !hasTaskRelationshipColumns(task))) {
          res.status(409).json({ message: "Apply migration 0008 before delegating position profiles." });
          return;
        }
        let updatedCount = 0;
        for (const task of active) {
          const patch: Partial<DonnitTask> =
            mode === "transfer"
              ? { assigned_to: toUserId, ...(hasTaskRelationshipColumns(task) ? { delegated_to: null } : {}) }
              : { delegated_to: toUserId };
          const updated = await store.updateTask(task.id, patch);
          if (!updated) continue;
          updatedCount += 1;
          await store.addEvent(orgId, {
            task_id: task.id,
            actor_id: auth.userId,
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
        let profile = null;
        if (parsed.data.profileId) {
          const delegateUntilDate = delegateUntil || null;
          const updatedProfile = await store.updatePositionProfile(orgId, parsed.data.profileId, {
            status: mode === "transfer" ? "active" : "covered",
            current_owner_id: mode === "transfer" ? toUserId : fromUserId,
            temporary_owner_id: mode === "transfer" ? null : toUserId,
            delegate_user_id: mode === "transfer" ? null : toUserId,
            delegate_until: mode === "transfer" ? null : delegateUntilDate,
            risk_summary:
              mode === "transfer"
                ? `Transferred from ${fromUserId} to ${toUserId}. ${updatedCount} active task${updatedCount === 1 ? "" : "s"} moved.`
                : `Coverage delegated to ${toUserId}. ${updatedCount} active task${updatedCount === 1 ? "" : "s"} remain owned by the profile owner.`,
          });
          if (updatedProfile) {
            profile = toClientPositionProfile(updatedProfile);
            await store.createPositionProfileAssignment(orgId, {
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
        res.json({ ok: true, mode, updated: updatedCount, profile });
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
    const tasks = (await storage.listTasks()).filter(
      (task) => task.assignedToId === fromUserId && task.status !== "completed" && task.status !== "denied",
    );
    let updatedCount = 0;
    for (const task of tasks) {
      const updated = await storage.updateTask(
        task.id,
        mode === "transfer" ? { assignedToId: toUserId, delegatedToId: null } : { delegatedToId: toUserId },
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
        res.json({
          id: updated.id,
          fromEmail: updated.from_email,
          subject: updated.subject,
          preview: updated.preview,
          body: updated.body ?? "",
          receivedAt: updated.received_at,
          actionItems: Array.isArray(updated.action_items) ? updated.action_items : [],
          suggestedTitle: updated.suggested_title,
          suggestedDueDate: updated.suggested_due_date,
          urgency: updated.urgency,
          status: updated.status,
          assignedToId: updated.assigned_to,
          createdAt: updated.created_at,
        });
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
        await store.addEvent(suggestion.org_id, {
          task_id: task.id,
          actor_id: auth.userId,
          type: "email_approved",
          note: `Approved ${suggestionSource} task suggestion from ${suggestion.from_email}.`,
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
        const agendaState = await store.getWorkspaceState(orgId, "agenda_state");
        const workspaceState = toClientWorkspaceState({ agenda: agendaState });
        const calendarContext = await tryBuildGoogleCalendarContext(store);
        res.json(
          buildClientAgenda(
            tasks.map(toClientTask),
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

      const tasks = await store.listTasks(orgId);
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
      const calendarConnected = Boolean(connected && hasGoogleCalendarScope(account?.scope));
      const requiresReconnect = Boolean(account && account.status === "error");
      res.json({
        configured: cfg.configured,
        authenticated: true,
        connected,
        calendarConnected,
        calendarRequiresReconnect: connected && !calendarConnected,
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

  async function createExternalSuggestion(req: Request, res: Response, source: "slack" | "sms") {
    const parsed = externalTaskSuggestionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Provide message text between 2 and 4000 characters." });
      return;
    }
    const candidate = await enrichSuggestionCandidateWithAi(
      buildExternalSuggestionCandidate({
        source,
        text: parsed.data.text,
        from: parsed.data.from,
        channel: parsed.data.channel,
        subject: parsed.data.subject,
      }),
      source,
      {
        from: parsed.data.from,
        channel: parsed.data.channel,
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
          typeof parsed.data.assignedToId === "string" ? parsed.data.assignedToId : auth.userId;
        const suggestion = await store.createEmailSuggestion(orgId, {
          gmail_message_id: `${source}:${crypto.createHash("sha1").update(candidate.body).digest("hex").slice(0, 20)}`,
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
          typeof parsed.data.assignedToId === "string" ? parsed.data.assignedToId : target.assignedTo;
        const suggestion = await store.createEmailSuggestion(target.orgId, {
          gmail_message_id: `${source}:${crypto.createHash("sha1").update(candidate.body).digest("hex").slice(0, 20)}`,
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
      assignedToId: typeof parsed.data.assignedToId === "number" ? parsed.data.assignedToId : DEMO_USER_ID,
    });
    res.status(201).json({ ok: true, suggestion });
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

  app.post("/api/integrations/sms/inbound", async (req: Request, res: Response) => {
    const expected = process.env.DONNIT_SMS_WEBHOOK_TOKEN;
    if (
      !req.donnitAuth &&
      process.env.NODE_ENV === "production" &&
      (!expected || req.get("x-donnit-ingest-token") !== expected)
    ) {
      res.status(401).json({
        message: "Authenticate or provide the SMS ingest token.",
        reason: expected ? "token_mismatch" : "token_not_configured",
      });
      return;
    }
    return createExternalSuggestion(req, res, "sms");
  });

  return httpServer;
}
