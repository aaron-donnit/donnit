import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DONNIT_SCHEMA } from "./supabase";

const execFileAsync = promisify(execFile);

export const APPROVED_CHANNEL_ORDER = ["in_app", "email", "push", "sms"] as const;
export const APPROVED_REMINDER_ORDER = ["due_date", "urgency", "assignment_acceptance", "annual_advance"] as const;

// Hosted preview servers (Perplexity Computer) sometimes cannot reach the
// `external-tool` runtime credential, so unread-Gmail scans fail with a
// bare UNAUTHORIZED. The product MUST scan unread Gmail itself — manual
// paste is never the primary behavior. To make production Gmail scanning
// possible without depending on the hosted preview's runtime token, we also
// expose a first-party Gmail OAuth path the operator can configure with
// their own Google Cloud credentials. See docs/GMAIL_OAUTH.md.
export const GMAIL_OAUTH_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_CALENDAR_OAUTH_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_OAUTH_SCOPES = [GMAIL_OAUTH_SCOPE, GOOGLE_CALENDAR_OAUTH_SCOPE] as const;

export function hasGoogleCalendarScope(scope: string | null | undefined) {
  return Boolean(scope?.split(/\s+/).includes(GOOGLE_CALENDAR_OAUTH_SCOPE));
}

export function getIntegrationStatus() {
  const oauth = getGmailOAuthConfig();
  return {
    auth: {
      provider: "supabase",
      status: process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY ? "configured" : "scaffolded",
      projectId: process.env.SUPABASE_PROJECT_ID ?? "bchwrbqaacdijavtugdt",
      schema: DONNIT_SCHEMA,
    },
    email: {
      provider: "gmail",
      sourceId: process.env.GMAIL_CONNECTOR_SOURCE_ID ?? "gcal",
      status: process.env.GMAIL_CONNECTED === "true" ? "connected" : "connected_or_requires_runtime_auth",
      mode: "approval_before_task_creation",
      oauth: {
        configured: oauth.configured,
        clientIdPresent: Boolean(process.env.GOOGLE_CLIENT_ID),
        redirectUriPresent: Boolean(process.env.GOOGLE_REDIRECT_URI),
      },
    },
    slack: {
      provider: "slack",
      status: process.env.SLACK_BOT_TOKEN ? "configured" : "scaffolded",
      mode: "approval_before_task_creation",
    },
    sms: {
      provider: "sms",
      status: process.env.DONNIT_SMS_WEBHOOK_TOKEN || process.env.TWILIO_AUTH_TOKEN ? "configured" : "scaffolded",
      mode: "approval_before_task_creation",
    },
    reminders: {
      channelOrder: process.env.REMINDER_CHANNEL_ORDER?.split(",") ?? [...APPROVED_CHANNEL_ORDER],
      reminderOrder: [...APPROVED_REMINDER_ORDER],
    },
    app: {
      delivery: "pwa_first",
      native: "after_pwa_validation",
    },
  };
}

// ---------------------------------------------------------------------------
// Gmail OAuth (first-party) — production scaffolding
// ---------------------------------------------------------------------------

export type GmailOAuthConfig = {
  configured: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getGmailOAuthConfig(): GmailOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "";
  return {
    configured: Boolean(clientId && clientSecret && redirectUri),
    clientId,
    clientSecret,
    redirectUri,
  };
}

// ---------------------------------------------------------------------------
// Signed OAuth state tokens.
//
// Vercel runs each /api invocation in a separate (potentially cold) Lambda,
// so an in-process Map of state -> { userId, orgId } cannot survive the
// browser round-trip through accounts.google.com. We instead encode the
// userId/orgId/issuedAt into the `state` query param itself and HMAC-sign
// it with a server-only secret. The callback verifies the signature and
// extracts the same userId/orgId without any shared store.
//
// Format: base64url(JSON({u,o,iat,n})) "." base64url(HMAC-SHA256(payload))
//   - u: donnit user id (uuid)
//   - o: donnit org id (uuid)
//   - iat: issued-at (epoch ms)
//   - n: random nonce (replay protection per session; we still also enforce
//        a 10-minute TTL via iat)
//
// The secret is GMAIL_OAUTH_STATE_SECRET when set, else SUPABASE_SERVICE_ROLE_KEY,
// else SUPABASE_ANON_KEY, else a random per-process key (which won't survive
// cold starts — the operator is expected to set GMAIL_OAUTH_STATE_SECRET in
// production).
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let processFallbackSecret: string | null = null;

function getStateSecret(): string {
  const explicit = process.env.GMAIL_OAUTH_STATE_SECRET;
  if (explicit && explicit.length >= 16) return explicit;
  const sr = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (sr && sr.length >= 16) return sr;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (anon && anon.length >= 16) return anon;
  if (!processFallbackSecret) {
    processFallbackSecret = crypto.randomBytes(32).toString("hex");
  }
  return processFallbackSecret;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export type GmailOAuthState = {
  userId: string;
  orgId: string;
  issuedAt: number;
};

export function signGmailOAuthState(input: GmailOAuthState): string {
  const payload = {
    u: input.userId,
    o: input.orgId,
    iat: input.issuedAt,
    n: crypto.randomBytes(8).toString("hex"),
  };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf-8"));
  const sig = crypto
    .createHmac("sha256", getStateSecret())
    .update(payloadB64)
    .digest();
  return `${payloadB64}.${base64UrlEncode(sig)}`;
}

export type StateVerifyResult =
  | { ok: true; state: GmailOAuthState }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyGmailOAuthState(token: string): StateVerifyResult {
  if (!token || typeof token !== "string") return { ok: false, reason: "malformed" };
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  let providedSig: Buffer;
  try {
    providedSig = base64UrlDecode(sigB64);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const expectedSig = crypto.createHmac("sha256", getStateSecret()).update(payloadB64).digest();
  if (
    providedSig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(providedSig, expectedSig)
  ) {
    return { ok: false, reason: "bad_signature" };
  }
  let payload: { u?: unknown; o?: unknown; iat?: unknown };
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf-8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof payload.u !== "string" ||
    typeof payload.o !== "string" ||
    typeof payload.iat !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (Date.now() - payload.iat > STATE_TTL_MS) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, state: { userId: payload.u, orgId: payload.o, issuedAt: payload.iat } };
}

export function buildGmailAuthUrl(state: string): string {
  const cfg = getGmailOAuthConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export type GmailTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // epoch ms
  scope: string;
  tokenType: string;
};

// Typed reasons surfaced to the callback handler / UI. We map Google's
// documented `error` field (invalid_grant, invalid_client, redirect_uri_mismatch,
// unauthorized_client, invalid_request, ...) to a small stable set so the SPA
// toast can be specific without leaking secrets. See:
// https://developers.google.com/identity/protocols/oauth2/web-server#exchange-authorization-code
export type GmailTokenExchangeReason =
  | "redirect_mismatch"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_request"
  | "token_exchange_failed";

export class GmailTokenExchangeError extends Error {
  reason: GmailTokenExchangeReason;
  status: number;
  googleError: string | null;
  googleErrorDescription: string | null;
  constructor(args: {
    reason: GmailTokenExchangeReason;
    status: number;
    googleError: string | null;
    googleErrorDescription: string | null;
  }) {
    super(
      `Google token exchange failed (${args.status}, ${args.googleError ?? "no_error_field"})`,
    );
    this.name = "GmailTokenExchangeError";
    this.reason = args.reason;
    this.status = args.status;
    this.googleError = args.googleError;
    this.googleErrorDescription = args.googleErrorDescription;
  }
}

function classifyGoogleTokenError(
  googleError: string | null,
  errorDescription: string | null,
): GmailTokenExchangeReason {
  // Google's RFC 6749 §5.2 error codes:
  //   invalid_grant — code is bad, expired, already used, or redirect_uri
  //     does not match the one used in the original auth request.
  //   redirect_uri_mismatch — registered URIs do not contain the redirect_uri
  //     we sent (some Google deployments still return this distinct code).
  //   invalid_client — client_id/client_secret rejected (rotated secret,
  //     wrong project, deleted client).
  //   unauthorized_client — client type forbids this grant.
  //   invalid_request — Google's catch-all when the request body is malformed
  //     or a required parameter is missing/invalid. The error_description
  //     usually points at the offending field; if it mentions redirect_uri we
  //     surface it as redirect_mismatch so the operator knows where to look.
  switch (googleError) {
    case "redirect_uri_mismatch":
      return "redirect_mismatch";
    case "invalid_client":
    case "unauthorized_client":
      return "invalid_client";
    case "invalid_grant":
      return "invalid_grant";
    case "invalid_request": {
      const desc = (errorDescription ?? "").toLowerCase();
      if (desc.includes("redirect")) return "redirect_mismatch";
      return "invalid_request";
    }
    default:
      return "token_exchange_failed";
  }
}

// Parse Google's error body without ever logging or rethrowing the raw
// auth code or token contents. Google returns short JSON like:
//   { "error": "invalid_grant", "error_description": "Bad Request" }
// We take only `error` and a clamped `error_description`.
function parseGoogleTokenErrorBody(text: string): {
  error: string | null;
  errorDescription: string | null;
} {
  if (!text) return { error: null, errorDescription: null };
  try {
    const parsed = JSON.parse(text) as { error?: unknown; error_description?: unknown };
    const error = typeof parsed.error === "string" ? parsed.error.slice(0, 80) : null;
    const errorDescription =
      typeof parsed.error_description === "string"
        ? parsed.error_description.slice(0, 200)
        : null;
    return { error, errorDescription };
  } catch {
    return { error: null, errorDescription: null };
  }
}

export async function exchangeGmailAuthCode(code: string): Promise<GmailTokenSet> {
  const cfg = getGmailOAuthConfig();
  if (!cfg.configured) throw new Error("Gmail OAuth is not configured on this server.");
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    // MUST be byte-for-byte identical to the redirect_uri sent in the
    // authorization request (RFC 6749 §4.1.3). We always source it from the
    // same env var (cfg.redirectUri) for both the auth URL and this call.
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const { error, errorDescription } = parseGoogleTokenErrorBody(text);
    throw new GmailTokenExchangeError({
      reason: classifyGoogleTokenError(error, errorDescription),
      status: res.status,
      googleError: error,
      googleErrorDescription: errorDescription,
    });
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: Date.now() + (json.expires_in - 30) * 1000,
    scope: json.scope,
    tokenType: json.token_type,
  };
}

export async function refreshGmailAccessToken(refreshToken: string): Promise<GmailTokenSet> {
  const cfg = getGmailOAuthConfig();
  if (!cfg.configured) throw new Error("Gmail OAuth is not configured on this server.");
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google token refresh failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
    token_type: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: null,
    expiresAt: Date.now() + (json.expires_in - 30) * 1000,
    scope: json.scope ?? "",
    tokenType: json.token_type,
  };
}

// ---------------------------------------------------------------------------
// Email content shape — used by both the connector and OAuth scan paths.
// ---------------------------------------------------------------------------

type GmailEmail = {
  email_id?: string;
  from_?: string;
  subject?: string;
  snippet?: string;
  body?: string;
  date?: string;
};

function inferUrgency(email: GmailEmail) {
  const text = `${email.subject ?? ""} ${email.snippet ?? ""} ${email.body ?? ""}`.toLowerCase();
  if (/(urgent|asap|emergency|blocked|critical|deadline|overdue)/.test(text)) return "high";
  return "normal";
}

function titleCaseWords(value: string) {
  const cleaned = value
    .replace(/["'<>]/g, " ")
    .replace(/\b(no-?reply|noreply|support|help|billing|receipts?|notifications?|team|mail)\b/gi, " ")
    .replace(/[_+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .slice(0, 5)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferSenderName(from: string | undefined) {
  const raw = (from ?? "").trim();
  if (!raw) return "";
  const display = raw.match(/^"?([^"<]+?)"?\s*</)?.[1]?.trim();
  if (display) return titleCaseWords(display);
  const domain = raw.match(/@([^>\s]+)/)?.[1] ?? raw;
  const root = domain.replace(/^mail\./i, "").split(".")[0] ?? "";
  return titleCaseWords(root);
}

function extractMoney(text: string) {
  const match =
    text.match(/\b(?:USD|US\$)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\b/i) ??
    text.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\b/);
  return match ? `$${match[1]}` : null;
}

function inferMerchant(email: GmailEmail, text: string) {
  const subject = email.subject ?? "";
  const explicit =
    subject.match(/\b(?:receipt|invoice|payment|order|purchase)\s+(?:from|for)\s+([^|-]{2,60})/i)?.[1] ??
    text.match(/\bmerchant\s*[:#-]\s*([^\n|]{2,60})/i)?.[1] ??
    text.match(/\b(?:paid to|seller|vendor)\s*[:#-]?\s*([^\n|]{2,60})/i)?.[1];
  const named = explicit ? titleCaseWords(explicit) : "";
  if (named) return named;
  const sender = inferSenderName(email.from_);
  if (/openai|chatgpt/i.test(`${subject} ${email.from_ ?? ""} ${text}`)) return "ChatGPT";
  return sender || "this vendor";
}

function clampSentence(value: string, max = 180) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 3).trim() + "...";
}

function dedupeStrings(values: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = clampSentence(value, 220);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

type EmailIntent =
  | "expense_reconciliation"
  | "invoice_payment"
  | "approval"
  | "contract"
  | "meeting"
  | "support"
  | "reply"
  | "document_review"
  | "follow_up"
  | "account_access"
  | "shipping"
  | "general_task";

type EmailInterpretation = {
  intent: EmailIntent;
  confidence: "high" | "medium" | "low";
  shouldSuggest: boolean;
  suggestedTitle: string;
  rationale: string;
  actionItems: string[];
  estimatedMinutes: number;
};

function interpretEmail(email: GmailEmail, sanitizedBody: string, baseActionItems: string[]): EmailInterpretation {
  const subject = (email.subject ?? "").replace(/^(re|fw|fwd):\s*/i, "").trim();
  const text = `${subject}\n${email.snippet ?? ""}\n${sanitizedBody}`.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const amount = extractMoney(text);
  const merchant = inferMerchant(email, text);

  const isReceipt = /\b(receipt|purchase|paid|payment received|transaction|charge|order confirmation|your order|subscription renewed|renewal receipt)\b/i.test(text);
  if (isReceipt && (amount || /\b(receipt|charge|transaction|purchase)\b/i.test(text))) {
    const suggestedTitle = `Reconcile ${merchant} expense${amount ? ` (${amount})` : ""}`;
    return {
      intent: "expense_reconciliation",
      confidence: "high",
      shouldSuggest: true,
      suggestedTitle,
      rationale: `You received a receipt for ${merchant}${amount ? ` at ${amount}` : ""}. Donnit can add a task to reconcile this expense.`,
      actionItems: dedupeStrings([
        `Confirm whether to reconcile the ${merchant} expense${amount ? ` for ${amount}` : ""}.`,
        ...baseActionItems,
      ]).slice(0, 4),
      estimatedMinutes: 15,
    };
  }

  if (/\b(invoice|bill|balance due|amount due|payment due|past due)\b/i.test(text)) {
    const suggestedTitle = `Review ${merchant} invoice${amount ? ` (${amount})` : ""}`;
    return {
      intent: "invoice_payment",
      confidence: "high",
      shouldSuggest: true,
      suggestedTitle,
      rationale: `${merchant} sent an invoice or payment notice${amount ? ` for ${amount}` : ""}. Donnit can add a task to review or pay it.`,
      actionItems: dedupeStrings([
        `Review the ${merchant} invoice${amount ? ` for ${amount}` : ""}.`,
        ...baseActionItems,
      ]).slice(0, 4),
      estimatedMinutes: 20,
    };
  }

  if (/\b(approve|approval|sign off|authorize|permission requested)\b/i.test(text)) {
    return {
      intent: "approval",
      confidence: "high",
      shouldSuggest: true,
      suggestedTitle: `Review approval request: ${subject || merchant}`,
      rationale: "This email appears to need approval or sign-off before work can continue.",
      actionItems: dedupeStrings([`Review and approve or decline: ${subject || "the request"}.`, ...baseActionItems]).slice(0, 4),
      estimatedMinutes: 30,
    };
  }

  if (/\b(contract|agreement|proposal|statement of work|sow|terms)\b/i.test(text)) {
    return {
      intent: "contract",
      confidence: "medium",
      shouldSuggest: true,
      suggestedTitle: `Review contract or agreement: ${subject || merchant}`,
      rationale: "This email references a contract, agreement, proposal, or terms that may require review.",
      actionItems: dedupeStrings([`Review the contract details from ${merchant}.`, ...baseActionItems]).slice(0, 4),
      estimatedMinutes: 45,
    };
  }

  if (/\b(reschedule|schedule|calendar invite|meeting|appointment|demo|call)\b/i.test(text)) {
    return {
      intent: "meeting",
      confidence: "medium",
      shouldSuggest: true,
      suggestedTitle: `Follow up on scheduling: ${subject || merchant}`,
      rationale: "This email appears to involve a meeting, call, or scheduling decision.",
      actionItems: dedupeStrings([`Confirm the scheduling next step for ${subject || merchant}.`, ...baseActionItems]).slice(0, 4),
      estimatedMinutes: 15,
    };
  }

  if (/\b(ticket|case|support request|bug|issue|incident)\b/i.test(text)) {
    return {
      intent: "support",
      confidence: "high",
      shouldSuggest: true,
      suggestedTitle: subject || "Review support request",
      rationale: "This email appears to be a support issue or customer request that needs ownership.",
      actionItems: dedupeStrings([`Review and assign the support request.`, ...baseActionItems]).slice(0, 4),
      estimatedMinutes: 30,
    };
  }

  if (/\b(reset|login|password|security alert|verify your account|access request)\b/i.test(text)) {
    return {
      intent: "account_access",
      confidence: "medium",
      shouldSuggest: true,
      suggestedTitle: `Review account access notice: ${subject || merchant}`,
      rationale: "This email appears to involve account access, authentication, or a security notice.",
      actionItems: dedupeStrings([`Review the account access notice from ${merchant}.`, ...baseActionItems]).slice(0, 4),
      estimatedMinutes: 10,
    };
  }

  if (/\b(document|deck|spreadsheet|file|attachment|review comments|redline)\b/i.test(text) && /\b(review|comment|edit|feedback)\b/i.test(text)) {
    return {
      intent: "document_review",
      confidence: "medium",
      shouldSuggest: true,
      suggestedTitle: `Review document feedback: ${subject || merchant}`,
      rationale: "This email appears to request review, feedback, or edits on a document.",
      actionItems: dedupeStrings([`Review the document feedback from ${merchant}.`, ...baseActionItems]).slice(0, 4),
      estimatedMinutes: 45,
    };
  }

  if (/\b(reply|respond|following up|follow up|checking in|circle back)\b/i.test(text)) {
    return {
      intent: "reply",
      confidence: "medium",
      shouldSuggest: true,
      suggestedTitle: `Respond to ${merchant}: ${subject || "follow-up"}`,
      rationale: "This email appears to need a response or follow-up.",
      actionItems: dedupeStrings([`Respond to ${merchant} about ${subject || "the email"}.`, ...baseActionItems]).slice(0, 4),
      estimatedMinutes: 15,
    };
  }

  if (/\b(shipped|delivery|tracking|delivered|package|order is on the way)\b/i.test(text)) {
    return {
      intent: "shipping",
      confidence: "low",
      shouldSuggest: false,
      suggestedTitle: `Track shipment from ${merchant}`,
      rationale: "This looks like a shipping update. Donnit will avoid creating a task unless there is a clear action.",
      actionItems: baseActionItems.slice(0, 3),
      estimatedMinutes: 10,
    };
  }

  const hasActionItems = baseActionItems.length > 0;
  return {
    intent: hasActionItems ? "general_task" : "follow_up",
    confidence: hasActionItems ? "medium" : "low",
    shouldSuggest: hasActionItems,
    suggestedTitle: inferTitle(email),
    rationale: hasActionItems
      ? "Donnit found language that appears to request action or follow-up."
      : "No clear task was detected in this email.",
    actionItems: baseActionItems.slice(0, 4),
    estimatedMinutes: hasActionItems ? 30 : 10,
  };
}

function inferTitle(email: GmailEmail) {
  const subject = (email.subject ?? "Review email request").replace(/^(re|fw|fwd):\s*/i, "").trim();
  if (/ticket/i.test(subject)) return subject;
  if (/reset|login|password/i.test(subject)) return `Review access request: ${subject}`;
  if (/approve|approval|contract|renewal/i.test(subject)) return `Review approval request: ${subject}`;
  return subject.length > 90 ? subject.slice(0, 87).trim() + "..." : subject;
}

function inferDueDate(email: GmailEmail) {
  const text = `${email.subject ?? ""} ${email.snippet ?? ""} ${email.body ?? ""}`.toLowerCase();
  const date = new Date();
  if (text.includes("today")) return date.toISOString().slice(0, 10);
  if (text.includes("tomorrow")) {
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  }
  if (text.includes("friday") || text.includes("end of week") || text.includes("deadline")) {
    date.setDate(date.getDate() + 3);
    return date.toISOString().slice(0, 10);
  }
  return null;
}

// Sanitize an email body for display/storage: strip control characters,
// collapse whitespace, drop quoted reply chains (lines starting with "On … wrote:"
// or ">"), and clamp to a safe length. We never persist the raw MIME source.
export function sanitizeEmailBody(raw: string): string {
  if (!raw) return "";
  // Strip control chars except newline/tab.
  let text = raw.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
  // Cut at typical "On <date> <name> wrote:" reply boundaries.
  text = text.replace(/\n+On\s+[^\n]{0,80}wrote:[\s\S]*$/i, "");
  // Drop quoted lines (>). Keep first chunk only.
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/^--\s*$/.test(line)) break; // signature delimiter
    kept.push(line);
  }
  text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > 4000) text = text.slice(0, 4000);
  return text;
}

// Heuristic action-item extraction. We deliberately keep this dependency-free
// and conservative — it's a hint for the user, not authoritative parsing.
// Rules: pick lines containing imperative cues ("please review", "can you",
// "needs", "deadline", numbered/bulleted lists) up to 5 items, each ≤ 200 chars.
export function extractActionItems(body: string, subject: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const cues =
    /\b(please|kindly|need(?:s|ed)?|require[ds]?|action required|review|approve|sign|complete|finish|send|reply|respond|deadline|due\b|by\s+(?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d))/i;
  const lines = (subject + "\n" + body).split(/\r?\n|(?<=[.!?])\s+/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length < 6 || line.length > 240) continue;
    if (!cues.test(line)) {
      // Keep numbered or bulleted list items even without a cue word.
      if (!/^(?:[-*•]|\d+[.)])\s+\S/.test(line)) continue;
    }
    const cleaned = line.replace(/^(?:[-*•]|\d+[.)])\s+/, "").slice(0, 200).trim();
    const key = cleaned.toLowerCase();
    if (cleaned.length < 6 || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= 5) break;
  }
  return out;
}

function extractEmails(raw: unknown): GmailEmail[] {
  if (!raw || typeof raw !== "object") return [];
  const container = raw as { email_results?: { emails?: GmailEmail[] }; emails?: GmailEmail[] };
  return container.email_results?.emails ?? container.emails ?? [];
}

type ToolFailure = {
  status?: number;
  errorCode?: string;
  message?: string;
  authUrl?: string;
};

function parseToolFailure(error: unknown): ToolFailure {
  const out: ToolFailure = {};
  if (!error || typeof error !== "object") return out;
  const err = error as { stderr?: unknown; message?: unknown };
  const text = typeof err.stderr === "string" && err.stderr.trim().length > 0
    ? err.stderr
    : typeof err.message === "string"
      ? err.message
      : "";
  if (!text) return out;
  const start = text.indexOf("{");
  if (start === -1) return out;
  const slice = text.slice(start).trim();
  let outer: unknown;
  try {
    outer = JSON.parse(slice);
  } catch {
    return out;
  }
  if (!outer || typeof outer !== "object") return out;
  const o = outer as { error?: unknown; status?: unknown; auth_url?: unknown };
  if (typeof o.status === "number") out.status = o.status;
  if (typeof o.auth_url === "string") out.authUrl = o.auth_url;
  if (typeof o.error === "string") {
    if (o.error === "auth_required") {
      out.errorCode = "auth_required";
    } else {
      try {
        const inner = JSON.parse(o.error);
        if (inner && typeof inner === "object") {
          const detail = (inner as { detail?: unknown }).detail;
          if (detail && typeof detail === "object") {
            const code = (detail as { error_code?: unknown }).error_code;
            const msg = (detail as { message?: unknown }).message;
            if (typeof code === "string") out.errorCode = code;
            if (typeof msg === "string") out.message = msg;
          }
        }
      } catch {
        if (!out.message) out.message = o.error;
      }
    }
  }
  return out;
}

export type EmailScanCandidate = ReturnType<typeof toCandidate>;

export type GmailScanResult =
  | { ok: true; source: "connector" | "oauth"; candidates: EmailScanCandidate[] }
  | {
      ok: false;
      reason:
        | "gmail_auth_required"
        | "gmail_runtime_unavailable"
        | "gmail_oauth_token_invalid"
        | "gmail_oauth_not_connected"
        | "gmail_oauth_not_configured"
        | "gmail_not_connected_or_tool_unavailable"
        // First-party Gmail API error reasons. These map Google's HTTP+error
        // payload (status, message, reason/domain) to an action the user or
        // operator can take. Sanitized strings only — never tokens or bodies.
        | "gmail_api_not_enabled"
        | "gmail_scope_missing"
        | "gmail_reconnect_required"
        | "gmail_rate_limited"
        | "gmail_api_forbidden"
        | "gmail_api_unavailable"
        | "gmail_api_bad_request"
        | "gmail_api_call_failed";
      message: string;
      googleStatus?: number;
      googleError?: { status?: string; message?: string; reason?: string; domain?: string };
    };

const RUNTIME_UNAVAILABLE_MESSAGE =
  "Email scan is connected, but this server cannot reach the Gmail runtime token. " +
  "If you are running in production, configure first-party Gmail OAuth (GOOGLE_CLIENT_ID, " +
  "GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI) so Donnit can scan unread Gmail directly.";

function toCandidate(email: GmailEmail) {
  const sanitizedBody = sanitizeEmailBody(email.body ?? email.snippet ?? "");
  const extractedActionItems = extractActionItems(sanitizedBody, email.subject ?? "");
  const interpretation = interpretEmail(email, sanitizedBody, extractedActionItems);
  return {
    gmailMessageId: email.email_id ?? null,
    fromEmail: email.from_ ?? "Unknown sender",
    subject: email.subject ?? "No subject",
    preview: interpretation.rationale.slice(0, 240),
    body: sanitizedBody,
    actionItems: interpretation.actionItems,
    suggestedTitle: interpretation.suggestedTitle,
    suggestedDueDate: inferDueDate(email),
    urgency: inferUrgency(email),
    assignedToId: 1,
    receivedAt: email.date ?? null,
    interpretation,
  };
}

export function buildManualEmailCandidate(input: {
  subject: string;
  body: string;
  fromEmail?: string;
}) {
  const subject = input.subject.trim().slice(0, 240) || "Pasted email";
  const body = sanitizeEmailBody(input.body.trim().slice(0, 4000));
  const from = (input.fromEmail ?? "manual import").trim().slice(0, 240) || "manual import";
  const synthetic = `manual:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const preview = body.slice(0, 240);
  const email: GmailEmail = {
    email_id: synthetic,
    from_: from,
    subject,
    snippet: preview,
    body,
  };
  return toCandidate(email);
}

// ---------------------------------------------------------------------------
// Path 1: external-tool connector scan (Perplexity Computer preview)
// ---------------------------------------------------------------------------

// Build queries that focus on UNREAD inbox emails. The connector accepts an
// array of search queries; we ask for unread inbox first, then narrow on
// action-oriented unread variants. Filtering is done in-process rather than
// trusting the connector to dedupe.
function buildUnreadQueries(): string[] {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const after = sevenDaysAgo.toISOString().slice(0, 10);
  return [
    `in:inbox is:unread after:${after}`,
    `is:unread newer_than:7d`,
    `is:unread (subject:ticket OR subject:urgent OR subject:"action required" OR subject:"please review")`,
    `is:unread (urgent OR "action required" OR "please review" OR deadline)`,
  ];
}

export async function scanGmailViaConnector(): Promise<GmailScanResult> {
  const sourceId = process.env.GMAIL_CONNECTOR_SOURCE_ID ?? "gcal";
  const payload = JSON.stringify({
    source_id: sourceId,
    tool_name: "search_email",
    arguments: { queries: buildUnreadQueries() },
  });

  let stdout: string;
  try {
    const result = await execFileAsync("external-tool", ["call", payload], {
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (error) {
    const failure = parseToolFailure(error);
    if (failure.errorCode === "auth_required" || failure.authUrl) {
      return {
        ok: false,
        reason: "gmail_auth_required",
        message:
          "Gmail authorization needs to be refreshed. Reconnect Gmail or refresh the preview and try again.",
      };
    }
    if (failure.status === 401 || failure.errorCode === "UNAUTHORIZED") {
      return {
        ok: false,
        reason: "gmail_runtime_unavailable",
        message: RUNTIME_UNAVAILABLE_MESSAGE,
      };
    }
    return {
      ok: false,
      reason: "gmail_not_connected_or_tool_unavailable",
      message:
        "Gmail scan is unavailable right now. Confirm the Gmail connector is linked and retry shortly.",
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return {
      ok: false,
      reason: "gmail_not_connected_or_tool_unavailable",
      message: "Gmail scan returned an unexpected response. Try again in a moment.",
    };
  }

  if (raw && typeof raw === "object" && (raw as { authenticated?: unknown }).authenticated === false) {
    return {
      ok: false,
      reason: "gmail_auth_required",
      message:
        "Gmail authorization needs to be refreshed. Reconnect Gmail or refresh the preview and try again.",
    };
  }

  const seen = new Set<string>();
  const candidates = extractEmails(raw)
    .filter((email) => {
      const key = email.email_id ?? `${email.from_}-${email.subject}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10)
    .map(toCandidate)
    .filter((candidate) => candidate.interpretation.shouldSuggest);
  return { ok: true, source: "connector", candidates };
}

// ---------------------------------------------------------------------------
// Path 2: first-party Gmail OAuth scan (production)
// ---------------------------------------------------------------------------

function decodeBase64Url(encoded: string): string {
  if (!encoded) return "";
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  try {
    return Buffer.from(padded + pad, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

type GmailApiHeader = { name?: string; value?: string };
type GmailApiPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailApiHeader[];
  body?: { size?: number; data?: string };
  parts?: GmailApiPart[];
};
type GmailApiMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailApiPart;
};

function pickHeader(headers: GmailApiHeader[] | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const h of headers) {
    if ((h.name ?? "").toLowerCase() === lower) return h.value;
  }
  return undefined;
}

// Walk the MIME tree and prefer text/plain. Fall back to the first text part.
function extractMessageBody(payload: GmailApiPart | undefined): string {
  if (!payload) return "";
  let plain = "";
  let fallback = "";
  const walk = (part: GmailApiPart) => {
    const mime = (part.mimeType ?? "").toLowerCase();
    const data = part.body?.data;
    if (data) {
      const decoded = decodeBase64Url(data);
      if (mime === "text/plain" && !plain) plain = decoded;
      else if (!fallback && (mime.startsWith("text/") || mime === "")) fallback = decoded;
    }
    if (part.parts) {
      for (const child of part.parts) walk(child);
    }
  };
  walk(payload);
  // Strip HTML tags from fallback if used.
  if (!plain && fallback) {
    fallback = fallback.replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  return plain || fallback;
}

// Gmail returns errors as either `{ error: { code, message, status, errors:[{reason,domain,message}] } }`
// (the v1 envelope) or, for some 4xx auth failures, `{ error: "invalid_grant", error_description: "..." }`.
// We extract a sanitized summary so callers can map to a typed reason without
// ever touching the raw body again.
type GmailApiErrorSummary = {
  httpStatus: number;
  status?: string; // e.g. "PERMISSION_DENIED", "UNAUTHENTICATED", "FAILED_PRECONDITION"
  message?: string; // Google's short message, sanitized + truncated
  reason?: string; // first errors[].reason — e.g. "accessNotConfigured", "insufficientPermissions", "rateLimitExceeded"
  domain?: string; // first errors[].domain — e.g. "usageLimits", "global"
};

class GmailApiError extends Error {
  summary: GmailApiErrorSummary;
  constructor(summary: GmailApiErrorSummary) {
    super(`Gmail API ${summary.httpStatus} ${summary.status ?? ""}`.trim());
    this.name = "GmailApiError";
    this.summary = summary;
  }
}

function sanitize(input: unknown, max = 240): string | undefined {
  if (typeof input !== "string") return undefined;
  // Drop control chars / strip HTML-ish junk; trim long messages so we never
  // log/return a full email body or token-laden URL.
  const cleaned = input.replace(/[ -]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function parseGmailErrorBody(httpStatus: number, raw: string): GmailApiErrorSummary {
  const summary: GmailApiErrorSummary = { httpStatus };
  if (!raw) return summary;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    summary.message = sanitize(raw);
    return summary;
  }
  const err = (body as { error?: unknown })?.error;
  if (typeof err === "string") {
    // OAuth-style: { error: "invalid_grant", error_description: "..." }
    summary.status = sanitize(err, 64);
    summary.message = sanitize((body as { error_description?: unknown }).error_description);
    return summary;
  }
  if (err && typeof err === "object") {
    const e = err as {
      code?: number;
      status?: string;
      message?: string;
      errors?: Array<{ reason?: string; domain?: string; message?: string }>;
    };
    summary.status = sanitize(e.status, 64);
    summary.message = sanitize(e.message);
    const first = e.errors?.[0];
    if (first) {
      summary.reason = sanitize(first.reason, 64);
      summary.domain = sanitize(first.domain, 64);
      if (!summary.message) summary.message = sanitize(first.message);
    }
  }
  return summary;
}

async function gmailApiFetch<T>(
  accessToken: string,
  path: string,
  init?: { method?: string; query?: Record<string, string> },
): Promise<T> {
  const url = new URL(`https://gmail.googleapis.com${path}`);
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  if (res.ok) {
    return (await res.json()) as T;
  }
  const text = await res.text().catch(() => "");
  const summary = parseGmailErrorBody(res.status, text);
  throw new GmailApiError(summary);
}

// Map a Google error envelope to one of our typed scan-failure reasons.
// Order matters: we look at errors[].reason first (Google's most specific
// machine-readable signal), then status, then HTTP code.
function classifyGmailApiError(s: GmailApiErrorSummary): {
  reason: Extract<
    (GmailScanResult & { ok: false })["reason"],
    | "gmail_api_not_enabled"
    | "gmail_scope_missing"
    | "gmail_reconnect_required"
    | "gmail_rate_limited"
    | "gmail_api_forbidden"
    | "gmail_api_unavailable"
    | "gmail_api_bad_request"
    | "gmail_api_call_failed"
  >;
  message: string;
} {
  const reason = (s.reason ?? "").toLowerCase();
  const status = (s.status ?? "").toUpperCase();
  const http = s.httpStatus;
  const tail = s.message ? ` (Google: ${s.message})` : "";

  if (
    reason === "accessnotconfigured" ||
    reason === "servicedisabled" ||
    /\bGmail API\b.*\b(not been used|disabled|enable it)\b/i.test(s.message ?? "")
  ) {
    return {
      reason: "gmail_api_not_enabled",
      message:
        "Gmail API is not enabled in the Google Cloud project tied to this OAuth client. Enable it at console.cloud.google.com → APIs & Services → Library → Gmail API → Enable, then redeploy and click Scan email again." +
        tail,
    };
  }
  if (
    reason === "insufficientpermissions" ||
    reason === "insufficientscopes" ||
    reason === "forbidden" && /scope/i.test(s.message ?? "") ||
    /insufficient.*scope/i.test(s.message ?? "")
  ) {
    return {
      reason: "gmail_scope_missing",
      message:
        "Donnit's Gmail authorization is missing the gmail.readonly scope. Disconnect Gmail and reconnect — make sure you accept the 'Read your email' permission on Google's consent screen." +
        tail,
    };
  }
  if (
    http === 401 ||
    status === "UNAUTHENTICATED" ||
    reason === "authError" ||
    reason === "unauthorized"
  ) {
    return {
      reason: "gmail_reconnect_required",
      message: "Gmail authorization was rejected. Reconnect Gmail and try again." + tail,
    };
  }
  if (
    http === 429 ||
    reason === "ratelimitexceeded" ||
    reason === "userratelimitexceeded" ||
    reason === "quotaexceeded" ||
    status === "RESOURCE_EXHAUSTED"
  ) {
    return {
      reason: "gmail_rate_limited",
      message: "Gmail API rate limit hit. Wait a minute and try Scan email again." + tail,
    };
  }
  if (http === 403 || status === "PERMISSION_DENIED") {
    return {
      reason: "gmail_api_forbidden",
      message:
        "Google rejected the Gmail API request as forbidden. Confirm the OAuth client and Gmail API are in the same Google Cloud project, and that the consenting account is allowed to use this app." +
        tail,
    };
  }
  if (http === 503 || http === 502 || http === 504 || status === "UNAVAILABLE") {
    return {
      reason: "gmail_api_unavailable",
      message: "Gmail API is temporarily unavailable. Try again in a moment." + tail,
    };
  }
  if (http === 400 || status === "INVALID_ARGUMENT") {
    return {
      reason: "gmail_api_bad_request",
      message: "Gmail API rejected the request as malformed. This is a Donnit bug — please report it." + tail,
    };
  }
  return {
    reason: "gmail_api_call_failed",
    message: `Gmail API call failed (HTTP ${http}${status ? ` ${status}` : ""}). Try again shortly.${tail}`,
  };
}

type GmailListResponse = {
  messages?: { id: string; threadId: string }[];
  resultSizeEstimate?: number;
};

function gmailApiFailureToScanResult(error: unknown): GmailScanResult & { ok: false } {
  if (error instanceof GmailApiError) {
    const classified = classifyGmailApiError(error.summary);
    // Log a single sanitized line for the operator. Tokens, URLs, and bodies
    // are never included — only the structured Google envelope summary.
    console.error("[donnit] gmail api error:", {
      httpStatus: error.summary.httpStatus,
      googleStatus: error.summary.status,
      googleReason: error.summary.reason,
      googleDomain: error.summary.domain,
      googleMessage: error.summary.message,
      mappedReason: classified.reason,
    });
    return {
      ok: false,
      reason: classified.reason,
      message: classified.message,
      googleStatus: error.summary.httpStatus,
      googleError: {
        status: error.summary.status,
        message: error.summary.message,
        reason: error.summary.reason,
        domain: error.summary.domain,
      },
    };
  }
  console.error(
    "[donnit] gmail api transport error:",
    error instanceof Error ? error.message : "unknown",
  );
  return {
    ok: false,
    reason: "gmail_api_call_failed",
    message: "Gmail API call failed before Google could respond. Check your connection and retry.",
  };
}

export async function scanGmailViaOAuth(accessToken: string): Promise<GmailScanResult> {
  // Target unread inbox mail in the last 30 days. We deliberately ask for
  // `in:inbox` so promotional/spam folders are excluded, and fall back to a
  // narrower urgency-keyword query so we still surface action-oriented mail
  // even when the inbox is quiet.
  const queries = [
    `in:inbox is:unread newer_than:30d`,
    `is:unread (urgent OR "action required" OR "please review" OR deadline) newer_than:30d`,
  ];

  const messageIds = new Set<string>();
  for (const q of queries) {
    try {
      const list = await gmailApiFetch<GmailListResponse>(accessToken, "/gmail/v1/users/me/messages", {
        query: { q, maxResults: "20" },
      });
      for (const m of list.messages ?? []) messageIds.add(m.id);
    } catch (error) {
      return gmailApiFailureToScanResult(error);
    }
    if (messageIds.size >= 25) break;
  }

  if (messageIds.size === 0) {
    return { ok: true, source: "oauth", candidates: [] };
  }

  const candidates: EmailScanCandidate[] = [];
  for (const id of Array.from(messageIds).slice(0, 15)) {
    let msg: GmailApiMessage;
    try {
      msg = await gmailApiFetch<GmailApiMessage>(accessToken, `/gmail/v1/users/me/messages/${id}`, {
        query: { format: "full" },
      });
    } catch (error) {
      // Hard-fail on auth/scope/api-not-enabled errors so the user can act on
      // them; tolerate transient per-message failures (rate limit, 5xx) by
      // skipping the message and continuing.
      if (error instanceof GmailApiError) {
        const classified = classifyGmailApiError(error.summary);
        if (
          classified.reason === "gmail_reconnect_required" ||
          classified.reason === "gmail_scope_missing" ||
          classified.reason === "gmail_api_not_enabled" ||
          classified.reason === "gmail_api_forbidden"
        ) {
          return gmailApiFailureToScanResult(error);
        }
      }
      continue;
    }
    const headers = msg.payload?.headers;
    const subject = pickHeader(headers, "Subject") ?? "(no subject)";
    const from = pickHeader(headers, "From") ?? "Unknown sender";
    const dateHeader = pickHeader(headers, "Date");
    const internalIso = msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : null;
    const body = extractMessageBody(msg.payload);
    const candidate = toCandidate({
        email_id: msg.id,
        from_: from,
        subject,
        snippet: msg.snippet ?? "",
        body,
        date: dateHeader ?? internalIso ?? undefined,
      });
    if (candidate.interpretation.shouldSuggest) {
      candidates.push(candidate);
    }
  }
  return { ok: true, source: "oauth", candidates };
}

// Public entry point. Prefer first-party OAuth when an access token is
// supplied (server has already loaded/refreshed it from gmail_accounts).
// Fall back to the connector path otherwise.
export async function scanGmailForTaskCandidates(opts?: {
  oauthAccessToken?: string | null;
}): Promise<GmailScanResult> {
  if (opts?.oauthAccessToken) {
    return scanGmailViaOAuth(opts.oauthAccessToken);
  }
  return scanGmailViaConnector();
}
