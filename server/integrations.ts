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

export async function scanGmailForTaskCandidates() {
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

  try {
    const { stdout } = await execFileAsync("external-tool", ["call", payload], {
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    const raw = JSON.parse(stdout);
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
      .map((email) => ({
        gmailMessageId: email.email_id ?? null,
        fromEmail: email.from_ ?? "Unknown sender",
        subject: email.subject ?? "No subject",
        preview: email.snippet ?? "",
        suggestedTitle: inferTitle(email),
        suggestedDueDate: inferDueDate(email),
        urgency: inferUrgency(email),
        assignedToId: 1,
        receivedAt: email.date ?? null,
      }));
    return { ok: true, candidates };
  } catch (error) {
    return {
      ok: false,
      reason: "gmail_not_connected_or_tool_unavailable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
