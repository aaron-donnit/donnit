import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const APPROVED_CHANNEL_ORDER = ["in_app", "email", "push", "sms"] as const;
export const APPROVED_REMINDER_ORDER = ["due_date", "urgency", "assignment_acceptance", "annual_advance"] as const;

export function getIntegrationStatus() {
  return {
    auth: {
      provider: "supabase",
      status: process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY ? "configured" : "scaffolded",
      projectId: process.env.SUPABASE_PROJECT_ID ?? "bchwrbqaacdijavtugdt",
    },
    email: {
      provider: "gmail",
      sourceId: process.env.GMAIL_CONNECTOR_SOURCE_ID ?? "gcal",
      status: "requires_user_connection",
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

export async function scanGmailForTaskCandidates(query = "newer_than:7d") {
  const sourceId = process.env.GMAIL_CONNECTOR_SOURCE_ID ?? "gcal";
  const payload = JSON.stringify({
    source_id: sourceId,
    tool_name: "search_email",
    arguments: {
      query,
      max_results: 10,
    },
  });

  try {
    const { stdout } = await execFileAsync("external-tool", ["call", payload], {
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, raw: JSON.parse(stdout) };
  } catch (error) {
    return {
      ok: false,
      reason: "gmail_not_connected_or_tool_unavailable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
