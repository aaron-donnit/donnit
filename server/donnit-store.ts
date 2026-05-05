import type { SupabaseClient } from "@supabase/supabase-js";
import { DONNIT_TABLES } from "./supabase";

// Production-grade store backed by the `donnit` schema in Supabase. This
// module is the only place that issues SELECT/INSERT/UPDATE against Donnit's
// production tables — every query goes through the per-request client built
// in server/auth-supabase.ts so that RLS policies see the caller's uid.

// Supabase-js / PostgREST returns errors as plain objects shaped like
// `{ message, code, details, hint }`, not Error instances. Throwing them
// directly produces "[object Object]" when callers do `String(error)` or
// `error.message`. This helper wraps the raw payload in a real Error whose
// `.message` is the PostgREST message, with `code`/`details`/`hint` preserved
// as own properties so upstream serializers can surface them.
function wrapSupabaseError(prefix: string, raw: unknown): Error {
  if (raw instanceof Error) return raw;
  const r = (raw ?? {}) as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
  const message = typeof r.message === "string" && r.message.length > 0
    ? r.message
    : (typeof r.code === "string" ? `Supabase error ${r.code}` : "Unknown Supabase error");
  const err = new Error(`${prefix}: ${message}`) as Error & { code?: string; details?: string; hint?: string };
  if (typeof r.code === "string") err.code = r.code;
  if (typeof r.details === "string") err.details = r.details;
  if (typeof r.hint === "string") err.hint = r.hint;
  return err;
}

export type DonnitProfile = {
  id: string;
  full_name: string;
  email: string;
  default_org_id: string | null;
  persona: string;
  created_at: string;
};

export type DonnitMember = {
  org_id: string;
  user_id: string;
  role: "owner" | "manager" | "member" | "viewer";
  manager_id: string | null;
  can_assign: boolean;
};

export type DonnitTask = {
  id: string;
  org_id: string;
  title: string;
  description: string;
  status: "open" | "pending_acceptance" | "accepted" | "denied" | "completed";
  urgency: "low" | "normal" | "high" | "critical";
  due_date: string | null;
  estimated_minutes: number;
  assigned_to: string;
  assigned_by: string;
  delegated_to: string | null;
  collaborator_ids: string[];
  source: "chat" | "manual" | "email" | "slack" | "sms" | "automation" | "annual";
  recurrence: "none" | "annual";
  reminder_days_before: number;
  accepted_at: string | null;
  denied_at: string | null;
  completed_at: string | null;
  completion_notes: string;
  created_at: string;
};

export type DonnitTaskEvent = {
  id: string;
  org_id: string;
  task_id: string;
  actor_id: string;
  type: string;
  note: string;
  created_at: string;
};

export type DonnitChatMessage = {
  id: string;
  org_id: string;
  user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  task_id: string | null;
  created_at: string;
};

export type DonnitEmailSuggestion = {
  id: string;
  org_id: string;
  gmail_message_id: string | null;
  from_email: string;
  subject: string;
  preview: string;
  body: string;
  received_at: string | null;
  action_items: string[];
  suggested_title: string;
  suggested_due_date: string | null;
  urgency: "low" | "normal" | "high" | "critical";
  status: "pending" | "approved" | "dismissed";
  assigned_to: string | null;
  created_at: string;
};

export type DonnitGmailAccount = {
  user_id: string;
  org_id: string;
  email: string;
  access_token: string;
  refresh_token: string | null;
  scope: string;
  token_type: string;
  expires_at: string;
  connected_at: string;
  last_scanned_at: string | null;
  status: "connected" | "revoked" | "error";
};

export class DonnitStore {
  constructor(private readonly client: SupabaseClient, public readonly userId: string) {}

  async bootstrapWorkspace(input: { fullName?: string; email?: string; orgName?: string }) {
    const { data, error } = await this.client.rpc("bootstrap_workspace", {
      p_full_name: input.fullName ?? "",
      p_email: input.email ?? "",
      p_org_name: input.orgName ?? "",
    });
    if (error) throw wrapSupabaseError("bootstrap_workspace RPC failed", error);
    const row = Array.isArray(data) ? data[0] : data;
    return row as { user_id: string; org_id: string; is_new: boolean };
  }

  async getProfile(): Promise<DonnitProfile | null> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.profiles)
      .select("*")
      .eq("id", this.userId)
      .maybeSingle();
    if (error) throw error;
    return (data as DonnitProfile | null) ?? null;
  }

  async getDefaultOrgId(): Promise<string | null> {
    const profile = await this.getProfile();
    return profile?.default_org_id ?? null;
  }

  async listOrgMembers(orgId: string): Promise<Array<DonnitMember & { profile: DonnitProfile | null }>> {
    const { data: members, error } = await this.client
      .from(DONNIT_TABLES.organizationMembers)
      .select("*")
      .eq("org_id", orgId);
    if (error) throw error;
    const userIds = Array.from(new Set((members ?? []).map((m: any) => m.user_id))) as string[];
    if (userIds.length === 0) return [];
    const { data: profiles, error: profilesErr } = await this.client
      .from(DONNIT_TABLES.profiles)
      .select("*")
      .in("id", userIds);
    if (profilesErr) throw profilesErr;
    const byId = new Map<string, DonnitProfile>();
    for (const p of (profiles ?? []) as DonnitProfile[]) byId.set(p.id, p);
    return (members ?? []).map((m: any) => ({ ...(m as DonnitMember), profile: byId.get(m.user_id) ?? null }));
  }

  async listTasks(orgId: string): Promise<DonnitTask[]> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.tasks)
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as DonnitTask[];
  }

  async createTask(
    orgId: string,
    input: Omit<
      DonnitTask,
      | "id"
      | "org_id"
      | "created_at"
      | "accepted_at"
      | "denied_at"
      | "completed_at"
      | "completion_notes"
      | "delegated_to"
      | "collaborator_ids"
    > &
      Partial<Pick<DonnitTask, "delegated_to" | "collaborator_ids">>,
  ): Promise<DonnitTask> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.tasks)
      .insert({ ...input, org_id: orgId })
      .select("*")
      .single();
    if (error) throw error;
    const created = data as DonnitTask;
    await this.addEvent(orgId, {
      task_id: created.id,
      actor_id: created.assigned_by,
      type: "created",
      note: `Task created from ${created.source}.`,
    });
    return created;
  }

  async updateTask(taskId: string, patch: Partial<DonnitTask>): Promise<DonnitTask | null> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.tasks)
      .update(patch)
      .eq("id", taskId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return (data as DonnitTask | null) ?? null;
  }

  async getTask(taskId: string): Promise<DonnitTask | null> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.tasks)
      .select("*")
      .eq("id", taskId)
      .maybeSingle();
    if (error) throw error;
    return (data as DonnitTask | null) ?? null;
  }

  async addEvent(orgId: string, input: Omit<DonnitTaskEvent, "id" | "org_id" | "created_at">): Promise<DonnitTaskEvent> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.taskEvents)
      .insert({ ...input, org_id: orgId })
      .select("*")
      .single();
    if (error) throw error;
    return data as DonnitTaskEvent;
  }

  async listEvents(orgId: string): Promise<DonnitTaskEvent[]> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.taskEvents)
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as DonnitTaskEvent[];
  }

  async listChatMessages(orgId: string): Promise<DonnitChatMessage[]> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.chatMessages)
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as DonnitChatMessage[];
  }

  async createChatMessage(orgId: string, input: Omit<DonnitChatMessage, "id" | "org_id" | "user_id" | "created_at">): Promise<DonnitChatMessage> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.chatMessages)
      .insert({ ...input, org_id: orgId, user_id: this.userId })
      .select("*")
      .single();
    if (error) throw error;
    return data as DonnitChatMessage;
  }

  async listEmailSuggestions(orgId: string): Promise<DonnitEmailSuggestion[]> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.emailSuggestions)
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as DonnitEmailSuggestion[];
  }

  async createEmailSuggestion(orgId: string, input: Omit<DonnitEmailSuggestion, "id" | "org_id" | "status" | "created_at">): Promise<DonnitEmailSuggestion> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.emailSuggestions)
      .insert({ ...input, org_id: orgId, status: "pending" })
      .select("*")
      .single();
    if (error) throw error;
    return data as DonnitEmailSuggestion;
  }

  async updateEmailSuggestion(id: string, patch: Partial<DonnitEmailSuggestion>): Promise<DonnitEmailSuggestion | null> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.emailSuggestions)
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return (data as DonnitEmailSuggestion | null) ?? null;
  }

  async getEmailSuggestion(id: string): Promise<DonnitEmailSuggestion | null> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.emailSuggestions)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as DonnitEmailSuggestion | null) ?? null;
  }

  // ---- gmail_accounts (first-party OAuth) -------------------------------

  async getGmailAccount(): Promise<DonnitGmailAccount | null> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.gmailAccounts)
      .select("*")
      .eq("user_id", this.userId)
      .maybeSingle();
    if (error) throw wrapSupabaseError("get gmail_account failed", error);
    return (data as DonnitGmailAccount | null) ?? null;
  }

  async upsertGmailAccount(
    input: Omit<DonnitGmailAccount, "user_id" | "connected_at" | "last_scanned_at" | "status">,
  ): Promise<DonnitGmailAccount> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.gmailAccounts)
      .upsert(
        { ...input, user_id: this.userId, status: "connected" },
        { onConflict: "user_id" },
      )
      .select("*")
      .single();
    if (error) throw wrapSupabaseError("upsert gmail_account failed", error);
    return data as DonnitGmailAccount;
  }

  async patchGmailAccount(patch: Partial<DonnitGmailAccount>): Promise<DonnitGmailAccount | null> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.gmailAccounts)
      .update(patch)
      .eq("user_id", this.userId)
      .select("*")
      .maybeSingle();
    if (error) throw wrapSupabaseError("patch gmail_account failed", error);
    return (data as DonnitGmailAccount | null) ?? null;
  }

  async deleteGmailAccount(): Promise<void> {
    const { error } = await this.client
      .from(DONNIT_TABLES.gmailAccounts)
      .delete()
      .eq("user_id", this.userId);
    if (error) throw wrapSupabaseError("delete gmail_account failed", error);
  }
}
