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

function normalizeSupabaseTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function isTimestampSyntaxError(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown; details?: unknown };
  const haystack = `${String(raw?.message ?? "")} ${String(raw?.details ?? "")}`.toLowerCase();
  return (
    raw?.code === "22007" ||
    (haystack.includes("invalid input syntax") && haystack.includes("timestamp with time zone"))
  );
}

function isMissingRelationError(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = String(raw?.code ?? "").toUpperCase();
  const haystack = `${String(raw?.message ?? "")} ${String(raw?.details ?? "")}`.toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    haystack.includes("could not find the table") ||
    (haystack.includes("relation") && haystack.includes("does not exist"))
  );
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
  role: "owner" | "admin" | "manager" | "member" | "viewer";
  manager_id: string | null;
  can_assign: boolean;
  status: "active" | "inactive";
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
  source: "chat" | "manual" | "email" | "slack" | "sms" | "document" | "automation" | "annual";
  recurrence: "none" | "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  reminder_days_before: number;
  position_profile_id: string | null;
  visibility: "work" | "personal" | "confidential";
  visible_from: string | null;
  accepted_at: string | null;
  denied_at: string | null;
  completed_at: string | null;
  completion_notes: string;
  created_at: string;
};

export type DonnitTaskSubtask = {
  id: string;
  task_id: string;
  org_id: string;
  title: string;
  status: "open" | "completed";
  position: number;
  completed_at: string | null;
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

export type DonnitPositionProfile = {
  id: string;
  org_id: string;
  title: string;
  status: "active" | "vacant" | "covered";
  current_owner_id: string | null;
  direct_manager_id: string | null;
  temporary_owner_id: string | null;
  delegate_user_id: string | null;
  delegate_until: string | null;
  auto_update_rules: Record<string, unknown>;
  institutional_memory: Record<string, unknown>;
  risk_score: number;
  risk_summary: string;
  created_at: string;
  updated_at: string;
};

export type DonnitPositionProfileAssignment = {
  id: string;
  org_id: string;
  position_profile_id: string | null;
  from_user_id: string | null;
  to_user_id: string | null;
  actor_id: string | null;
  mode: "transfer" | "temporary_cover" | "delegate";
  starts_at: string;
  ends_at: string | null;
  notes: string;
  created_at: string;
};

export type DonnitUserWorkspaceState = {
  id: string;
  org_id: string;
  user_id: string;
  state_key: "reviewed_notifications" | "agenda_state" | "onboarding_state";
  value: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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
      | "position_profile_id"
      | "visibility"
      | "visible_from"
    > &
      Partial<Pick<DonnitTask, "delegated_to" | "collaborator_ids" | "position_profile_id" | "visibility" | "visible_from">>,
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

  async listTaskSubtasks(orgId: string): Promise<DonnitTaskSubtask[]> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.taskSubtasks)
      .select("*")
      .eq("org_id", orgId)
      .order("task_id", { ascending: true })
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw wrapSupabaseError("list task_subtasks failed", error);
    }
    return (data ?? []) as DonnitTaskSubtask[];
  }

  async createTaskSubtask(
    orgId: string,
    input: Pick<DonnitTaskSubtask, "task_id" | "title"> & Partial<Pick<DonnitTaskSubtask, "position">>,
  ): Promise<DonnitTaskSubtask> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.taskSubtasks)
      .insert({
        org_id: orgId,
        task_id: input.task_id,
        title: input.title,
        position: input.position ?? 0,
      })
      .select("*")
      .single();
    if (error) throw wrapSupabaseError("create task_subtask failed", error);
    return data as DonnitTaskSubtask;
  }

  async updateTaskSubtask(
    orgId: string,
    taskId: string,
    subtaskId: string,
    patch: Partial<Pick<DonnitTaskSubtask, "title" | "status" | "position" | "completed_at">>,
  ): Promise<DonnitTaskSubtask | null> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.taskSubtasks)
      .update(patch)
      .eq("org_id", orgId)
      .eq("task_id", taskId)
      .eq("id", subtaskId)
      .select("*")
      .maybeSingle();
    if (error) throw wrapSupabaseError("update task_subtask failed", error);
    return (data as DonnitTaskSubtask | null) ?? null;
  }

  async deleteTaskSubtask(orgId: string, taskId: string, subtaskId: string): Promise<void> {
    const { error } = await this.client
      .from(DONNIT_TABLES.taskSubtasks)
      .delete()
      .eq("org_id", orgId)
      .eq("task_id", taskId)
      .eq("id", subtaskId);
    if (error) throw wrapSupabaseError("delete task_subtask failed", error);
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
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return [...((data ?? []) as DonnitChatMessage[])].reverse();
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
    const payload = {
      ...input,
      received_at: normalizeSupabaseTimestamp(input.received_at),
      org_id: orgId,
      status: "pending",
    };
    const { data, error } = await this.client
      .from(DONNIT_TABLES.emailSuggestions)
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      if (isTimestampSyntaxError(error) && payload.received_at !== null) {
        const { data: retryData, error: retryError } = await this.client
          .from(DONNIT_TABLES.emailSuggestions)
          .insert({ ...payload, received_at: null })
          .select("*")
          .single();
        if (!retryError) return retryData as DonnitEmailSuggestion;
      }
      throw error;
    }
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

  // ---- user_workspace_state (durable per-user UI/workflow state) -------

  async getWorkspaceState(
    orgId: string,
    stateKey: DonnitUserWorkspaceState["state_key"],
  ): Promise<DonnitUserWorkspaceState | null> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.userWorkspaceState)
      .select("*")
      .eq("org_id", orgId)
      .eq("user_id", this.userId)
      .eq("state_key", stateKey)
      .maybeSingle();
    if (error) {
      if (isMissingRelationError(error)) return null;
      throw wrapSupabaseError("get user_workspace_state failed", error);
    }
    return (data as DonnitUserWorkspaceState | null) ?? null;
  }

  async upsertWorkspaceState(
    orgId: string,
    stateKey: DonnitUserWorkspaceState["state_key"],
    value: Record<string, unknown>,
  ): Promise<DonnitUserWorkspaceState> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.userWorkspaceState)
      .upsert(
        {
          org_id: orgId,
          user_id: this.userId,
          state_key: stateKey,
          value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "org_id,user_id,state_key" },
      )
      .select("*")
      .single();
    if (error) throw wrapSupabaseError("upsert user_workspace_state failed", error);
    return data as DonnitUserWorkspaceState;
  }

  // ---- position_profiles (admin continuity repository) ------------------

  async listPositionProfiles(orgId: string): Promise<DonnitPositionProfile[]> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.positionProfiles)
      .select("*")
      .eq("org_id", orgId)
      .order("title", { ascending: true });
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw wrapSupabaseError("list position_profiles failed", error);
    }
    return (data ?? []) as DonnitPositionProfile[];
  }

  async createPositionProfile(
    orgId: string,
    input: Pick<DonnitPositionProfile, "title" | "status"> &
      Partial<
        Pick<
          DonnitPositionProfile,
          | "current_owner_id"
          | "direct_manager_id"
          | "temporary_owner_id"
          | "delegate_user_id"
          | "delegate_until"
          | "auto_update_rules"
          | "institutional_memory"
          | "risk_score"
          | "risk_summary"
        >
      >,
  ): Promise<DonnitPositionProfile> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.positionProfiles)
      .insert({ ...input, org_id: orgId })
      .select("*")
      .single();
    if (error) throw wrapSupabaseError("create position_profile failed", error);
    return data as DonnitPositionProfile;
  }

  async updatePositionProfile(
    orgId: string,
    id: string,
    patch: Partial<
      Pick<
        DonnitPositionProfile,
        | "title"
        | "status"
        | "current_owner_id"
        | "direct_manager_id"
        | "temporary_owner_id"
        | "delegate_user_id"
        | "delegate_until"
        | "auto_update_rules"
        | "institutional_memory"
        | "risk_score"
        | "risk_summary"
      >
    >,
  ): Promise<DonnitPositionProfile | null> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.positionProfiles)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw wrapSupabaseError("update position_profile failed", error);
    return (data as DonnitPositionProfile | null) ?? null;
  }

  async deletePositionProfile(orgId: string, id: string): Promise<void> {
    const { error } = await this.client
      .from(DONNIT_TABLES.positionProfiles)
      .delete()
      .eq("org_id", orgId)
      .eq("id", id);
    if (error) throw wrapSupabaseError("delete position_profile failed", error);
  }

  async createPositionProfileAssignment(
    orgId: string,
    input: Omit<DonnitPositionProfileAssignment, "id" | "org_id" | "starts_at" | "created_at"> &
      Partial<Pick<DonnitPositionProfileAssignment, "starts_at">>,
  ): Promise<DonnitPositionProfileAssignment | null> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.positionProfileAssignments)
      .insert({ ...input, org_id: orgId })
      .select("*")
      .single();
    if (error) {
      if (isMissingRelationError(error)) return null;
      throw wrapSupabaseError("create position_profile_assignment failed", error);
    }
    return data as DonnitPositionProfileAssignment;
  }
}
