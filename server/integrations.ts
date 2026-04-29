import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DONNIT_SCHEMA } from "./supabase";

const execFileAsync = promisify(execFile);

export const APPROVED_CHANNEL_ORDER = ["in_app", "email", "push", "sms"] as const;
export const APPROVED_REMINDER_ORDER = ["due_date", "urgency", "assignment_acceptance", "annual_advance"] as const;

export function getIntegrationStatus() {
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

// Parse the JSON envelope that the external-tool CLI prints to stderr on
// failure. The CLI emits e.g. {"error": "...", "status": 401} or, for
// connector auth issues, {"error": "auth_required", "auth_url": "..."}.
// Inner `error` strings are sometimes themselves JSON like
// {"detail":{"error_code":"UNAUTHORIZED"}}, so we try to peel one layer.
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
  // Find the first JSON object in the text
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
        // inner wasn't JSON; treat error string as a plain message
        if (!out.message) out.message = o.error;
      }
    }
  }
  return out;
}

export type GmailScanResult =
  | { ok: true; candidates: ReturnType<typeof toCandidate>[] }
  | {
      ok: false;
      reason:
        | "gmail_auth_required"
        | "gmail_runtime_unavailable"
        | "gmail_not_connected_or_tool_unavailable";
      message: string;
    };

// When the Gmail connector is configured at the platform layer but the
// running app server cannot reach the external-tool runtime (e.g. the
// hosted preview process does not have a usable programmatic credential),
// the CLI fails with UNAUTHORIZED before ever reaching Gmail. We treat
// that case as a runtime-token problem, not a connector reauthorize one,
// so the user is not told to reconnect Gmail.
const RUNTIME_UNAVAILABLE_MESSAGE =
  "Email scan is connected in Computer, but this preview server cannot access the Gmail runtime token. Try again after redeploy or use Manual email import for now.";

function toCandidate(email: GmailEmail) {
  return {
    gmailMessageId: email.email_id ?? null,
    fromEmail: email.from_ ?? "Unknown sender",
    subject: email.subject ?? "No subject",
    preview: email.snippet ?? "",
    suggestedTitle: inferTitle(email),
    suggestedDueDate: inferDueDate(email),
    urgency: inferUrgency(email),
    assignedToId: 1,
    receivedAt: email.date ?? null,
  };
}

// Build a task candidate from a manually pasted email subject/body. Used by
// the UI fallback when the hosted preview cannot reach the external-tool
// runtime. The synthetic source id keeps these rows trivially distinguishable
// from real Gmail-derived suggestions and namespaces them so dedupe still
// works when a user later re-runs the live scan.
export function buildManualEmailCandidate(input: {
  subject: string;
  body: string;
  fromEmail?: string;
}) {
  const subject = input.subject.trim().slice(0, 240) || "Pasted email";
  const body = input.body.trim().slice(0, 4000);
  const from = (input.fromEmail ?? "manual import").trim().slice(0, 240) || "manual import";
  const synthetic = `manual:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // Strip the body to a short preview — never persist full pasted content
  // beyond what the existing preview field is sized for.
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

export async function scanGmailForTaskCandidates(): Promise<GmailScanResult> {
  const sourceId = process.env.GMAIL_CONNECTOR_SOURCE_ID ?? "gcal";
  const payload = JSON.stringify({
    source_id: sourceId,
    tool_name: "search_email",
    arguments: {
      queries: [
        "subject:ticket after:2026-04-22T00:00:00-04:00",
        "urgent after:2026-04-22T00:00:00-04:00",
        "\"please review\" after:2026-04-22T00:00:00-04:00",
        "\"action required\" after:2026-04-22T00:00:00-04:00",
      ],
    },
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
    // A real connector-side reauthorize is signalled by `error: auth_required`
    // (often with an `auth_url`). A bare UNAUTHORIZED from the CLI without an
    // auth_url means this app process cannot reach the external-tool runtime
    // token at all — telling the user to reconnect Gmail in that case is a
    // lie. Treat it as a runtime-token problem instead.
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
      message:
        "Gmail scan returned an unexpected response. Try again in a moment.",
    };
  }

  // Some connectors return an authenticated:false envelope on success path
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
      const text = `${email.subject ?? ""} ${email.snippet ?? ""} ${email.body ?? ""}`.toLowerCase();
      return /(ticket|urgent|asap|please review|action required|deadline|reset|login|contract|renewal)/.test(text);
    })
    .slice(0, 5)
    .map(toCandidate);
  return { ok: true, candidates };
}
