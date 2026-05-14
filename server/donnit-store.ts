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

function isMissingColumnError(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = String(raw?.code ?? "").toUpperCase();
  const haystack = `${String(raw?.message ?? "")} ${String(raw?.details ?? "")}`.toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    haystack.includes("could not find") && haystack.includes("column")
  );
}

export type DonnitProfile = {
  id: string;
  full_name: string;
  email: string;
  default_org_id: string | null;
  persona: string;
  email_signature?: string | null;
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
  due_time: string | null;
  start_time: string | null;
  end_time: string | null;
  is_all_day: boolean;
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

export type DonnitTaskTemplateSubtask = {
  id: string;
  template_id: string;
  org_id: string;
  title: string;
  position: number;
  created_at: string;
};

export type DonnitTaskTemplate = {
  id: string;
  org_id: string;
  name: string;
  description: string;
  trigger_phrases: string[];
  default_urgency: "low" | "normal" | "high" | "critical";
  default_estimated_minutes: number;
  default_recurrence: "none" | "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  created_by: string | null;
  created_at: string;
  updated_at: string;
  subtasks?: DonnitTaskTemplateSubtask[];
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
  gmail_thread_id?: string | null;
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
  reply_suggested?: boolean;
  reply_draft?: string | null;
  reply_status?: "none" | "suggested" | "drafted" | "sent" | "copy" | "failed";
  reply_sent_at?: string | null;
  reply_provider_message_id?: string | null;
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

export type DonnitPositionProfileKnowledgeKind =
  | "how_to"
  | "recurring_responsibility"
  | "stakeholder"
  | "tool"
  | "risk"
  | "critical_date"
  | "decision_rule"
  | "relationship"
  | "process"
  | "preference"
  | "handoff_note";

export type DonnitPositionProfileKnowledge = {
  id: string;
  org_id: string;
  position_profile_id: string;
  source_task_id: string | null;
  kind: DonnitPositionProfileKnowledgeKind;
  title: string;
  body: string;
  confidence: "low" | "medium" | "high";
  last_seen_at: string;
  created_at: string;
  memory_key?: string;
  markdown_body?: string;
  source_kind?: "task" | "task_event" | "email" | "slack" | "sms" | "document" | "manual" | "assistant" | "profile_transfer";
  source_event_id?: string | null;
  source_ref?: string;
  evidence?: Record<string, unknown>;
  status?: "active" | "superseded" | "archived" | "rejected";
  importance?: number;
  confidence_score?: number;
  created_by?: string | null;
  updated_at?: string;
  archived_at?: string | null;
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

export type DonnitAiSession = {
  id: string;
  org_id: string;
  user_id: string | null;
  correlation_id: string;
  skill_id: string;
  feature: string;
  status: "started" | "completed" | "failed" | "cancelled";
  model_policy: Record<string, unknown>;
  metadata: Record<string, unknown>;
  estimated_cost_usd: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type DonnitAiModelCallInput = {
  session_id: string;
  org_id: string;
  user_id: string;
  correlation_id: string;
  skill_id: string;
  provider?: "openai";
  model: string;
  request_payload: Record<string, unknown>;
  response_payload: Record<string, unknown>;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  status: "success" | "failed";
  error_message?: string | null;
};

export type DonnitAiToolCallInput = {
  session_id: string;
  org_id: string;
  user_id: string;
  correlation_id: string;
  tool_name: string;
  side_effect: "read" | "write";
  input_payload: Record<string, unknown>;
  output_payload: Record<string, unknown>;
  latency_ms: number;
  status: "success" | "failed" | "permission_denied";
  error_message?: string | null;
};

export type DonnitAssistantRun = {
  id: string;
  org_id: string;
  user_id: string;
  task_id: string;
  position_profile_id: string | null;
  provider: "openai" | "hermes";
  skill_id: string;
  status: "queued" | "running" | "needs_approval" | "completed" | "failed" | "cancelled";
  instruction: string;
  output: Record<string, unknown>;
  approval_required: boolean;
  approved_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  correlation_id: string;
  estimated_cost_usd: number;
  created_at: string;
  updated_at: string;
};

export type DonnitAssistantRunInput = Pick<
  DonnitAssistantRun,
  "task_id" | "provider" | "skill_id" | "instruction" | "correlation_id"
> & Partial<Pick<DonnitAssistantRun, "position_profile_id" | "status" | "approval_required">>;

export type DonnitAssistantRunEvent = {
  id: string;
  org_id: string;
  assistant_run_id: string;
  task_id: string | null;
  user_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
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

  async updateProfileSignature(emailSignature: string): Promise<DonnitProfile> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.profiles)
      .update({ email_signature: emailSignature })
      .eq("id", this.userId)
      .select("*")
      .single();
    if (error) throw error;
    return data as DonnitProfile;
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
      | "due_time"
      | "start_time"
      | "end_time"
      | "is_all_day"
      | "position_profile_id"
      | "visibility"
      | "visible_from"
    > &
      Partial<Pick<DonnitTask, "delegated_to" | "collaborator_ids" | "due_time" | "start_time" | "end_time" | "is_all_day" | "position_profile_id" | "visibility" | "visible_from">>,
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

  async listTaskTemplates(orgId: string): Promise<DonnitTaskTemplate[]> {
    const { data: templates, error } = await this.client
      .from(DONNIT_TABLES.taskTemplates)
      .select("*")
      .eq("org_id", orgId)
      .order("name", { ascending: true });
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw wrapSupabaseError("list task_templates failed", error);
    }
    const { data: subtasks, error: subtasksError } = await this.client
      .from(DONNIT_TABLES.taskTemplateSubtasks)
      .select("*")
      .eq("org_id", orgId)
      .order("template_id", { ascending: true })
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (subtasksError) {
      if (isMissingRelationError(subtasksError)) {
        return ((templates ?? []) as DonnitTaskTemplate[]).map((template) => ({ ...template, subtasks: [] }));
      }
      throw wrapSupabaseError("list task_template_subtasks failed", subtasksError);
    }
    const byTemplate = new Map<string, DonnitTaskTemplateSubtask[]>();
    for (const subtask of (subtasks ?? []) as DonnitTaskTemplateSubtask[]) {
      const list = byTemplate.get(subtask.template_id) ?? [];
      list.push(subtask);
      byTemplate.set(subtask.template_id, list);
    }
    return ((templates ?? []) as DonnitTaskTemplate[]).map((template) => ({
      ...template,
      trigger_phrases: Array.isArray(template.trigger_phrases) ? template.trigger_phrases : [],
      subtasks: byTemplate.get(template.id) ?? [],
    }));
  }

  async createTaskTemplate(
    orgId: string,
    input: Omit<DonnitTaskTemplate, "id" | "org_id" | "created_at" | "updated_at" | "subtasks"> & {
      subtasks?: Array<Pick<DonnitTaskTemplateSubtask, "title" | "position">>;
    },
  ): Promise<DonnitTaskTemplate> {
    const { subtasks = [], ...templateInput } = input;
    const { data, error } = await this.client
      .from(DONNIT_TABLES.taskTemplates)
      .insert({ ...templateInput, org_id: orgId })
      .select("*")
      .single();
    if (error) throw wrapSupabaseError("create task_template failed", error);
    const template = data as DonnitTaskTemplate;
    if (subtasks.length > 0) {
      const { error: subtasksError } = await this.client
        .from(DONNIT_TABLES.taskTemplateSubtasks)
        .insert(
          subtasks.map((subtask, index) => ({
            org_id: orgId,
            template_id: template.id,
            title: subtask.title,
            position: subtask.position ?? index,
          })),
        );
      if (subtasksError) throw wrapSupabaseError("create task_template_subtasks failed", subtasksError);
    }
    return (await this.listTaskTemplates(orgId)).find((item) => item.id === template.id) ?? template;
  }

  async updateTaskTemplate(
    orgId: string,
    templateId: string,
    patch: Partial<Omit<DonnitTaskTemplate, "id" | "org_id" | "created_at" | "updated_at" | "subtasks">> & {
      subtasks?: Array<Pick<DonnitTaskTemplateSubtask, "title" | "position">>;
    },
  ): Promise<DonnitTaskTemplate | null> {
    const { subtasks, ...templatePatch } = patch;
    const updatePayload = { ...templatePatch, updated_at: new Date().toISOString() };
    const { data, error } = await this.client
      .from(DONNIT_TABLES.taskTemplates)
      .update(updatePayload)
      .eq("org_id", orgId)
      .eq("id", templateId)
      .select("*")
      .maybeSingle();
    if (error) throw wrapSupabaseError("update task_template failed", error);
    if (!data) return null;
    if (subtasks) {
      const { error: deleteError } = await this.client
        .from(DONNIT_TABLES.taskTemplateSubtasks)
        .delete()
        .eq("org_id", orgId)
        .eq("template_id", templateId);
      if (deleteError) throw wrapSupabaseError("replace task_template_subtasks failed", deleteError);
      if (subtasks.length > 0) {
        const { error: insertError } = await this.client
          .from(DONNIT_TABLES.taskTemplateSubtasks)
          .insert(
            subtasks.map((subtask, index) => ({
              org_id: orgId,
              template_id: templateId,
              title: subtask.title,
              position: subtask.position ?? index,
            })),
          );
        if (insertError) throw wrapSupabaseError("replace task_template_subtasks failed", insertError);
      }
    }
    return (await this.listTaskTemplates(orgId)).find((item) => item.id === templateId) ?? (data as DonnitTaskTemplate);
  }

  async deleteTaskTemplate(orgId: string, templateId: string): Promise<void> {
    const { error } = await this.client
      .from(DONNIT_TABLES.taskTemplates)
      .delete()
      .eq("org_id", orgId)
      .eq("id", templateId);
    if (error) throw wrapSupabaseError("delete task_template failed", error);
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
    const insertPayload = async (nextPayload: Record<string, unknown>) => this.client
      .from(DONNIT_TABLES.emailSuggestions)
      .insert(nextPayload)
      .select("*")
      .single();
    const { data, error } = await insertPayload(payload);
    if (error) {
      if (isTimestampSyntaxError(error) && payload.received_at !== null) {
        const { data: retryData, error: retryError } = await insertPayload({ ...payload, received_at: null });
        if (!retryError) return retryData as DonnitEmailSuggestion;
      }
      if (isMissingColumnError(error)) {
        const legacyPayload = { ...payload } as Record<string, unknown>;
        for (const key of [
          "gmail_thread_id",
          "reply_suggested",
          "reply_draft",
          "reply_status",
          "reply_sent_at",
          "reply_provider_message_id",
        ]) {
          delete legacyPayload[key];
        }
        const { data: retryData, error: retryError } = await insertPayload(legacyPayload);
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

  // ---- AI observability --------------------------------------------------

  async createAiSession(
    orgId: string,
    input: Pick<DonnitAiSession, "correlation_id" | "skill_id" | "feature" | "model_policy" | "metadata">,
  ): Promise<DonnitAiSession> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.aiSessions)
      .insert({ ...input, org_id: orgId, user_id: this.userId })
      .select("*")
      .single();
    if (error) throw wrapSupabaseError("create ai_session failed", error);
    return data as DonnitAiSession;
  }

  async updateAiSession(
    sessionId: string,
    patch: Partial<Pick<DonnitAiSession, "status" | "estimated_cost_usd" | "metadata" | "completed_at">>,
  ): Promise<DonnitAiSession | null> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.aiSessions)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .select("*")
      .maybeSingle();
    if (error) throw wrapSupabaseError("update ai_session failed", error);
    return (data as DonnitAiSession | null) ?? null;
  }

  async createAiModelCall(input: DonnitAiModelCallInput): Promise<void> {
    const { error } = await this.client
      .from(DONNIT_TABLES.aiModelCalls)
      .insert({ ...input, provider: input.provider ?? "openai" });
    if (error) throw wrapSupabaseError("create ai_model_call failed", error);
  }

  async createAiToolCall(input: DonnitAiToolCallInput): Promise<void> {
    const { error } = await this.client
      .from(DONNIT_TABLES.aiToolCalls)
      .insert(input);
    if (error) throw wrapSupabaseError("create ai_tool_call failed", error);
  }

  // ---- assistant_runs (agent task execution audit) ----------------------

  async createAssistantRun(orgId: string, input: DonnitAssistantRunInput): Promise<DonnitAssistantRun> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.assistantRuns)
      .insert({
        ...input,
        org_id: orgId,
        user_id: this.userId,
        status: input.status ?? "queued",
        position_profile_id: input.position_profile_id ?? null,
        approval_required: input.approval_required ?? false,
      })
      .select("*")
      .single();
    if (error) throw wrapSupabaseError("create assistant_run failed", error);
    return data as DonnitAssistantRun;
  }

  async updateAssistantRun(
    runId: string,
    patch: Partial<Pick<
      DonnitAssistantRun,
      "status" | "output" | "approval_required" | "approved_at" | "completed_at" | "error_message" | "estimated_cost_usd"
    >>,
  ): Promise<DonnitAssistantRun | null> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.assistantRuns)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", runId)
      .select("*")
      .maybeSingle();
    if (error) throw wrapSupabaseError("update assistant_run failed", error);
    return (data as DonnitAssistantRun | null) ?? null;
  }

  async createAssistantRunEvent(
    orgId: string,
    input: Omit<DonnitAssistantRunEvent, "id" | "org_id" | "user_id" | "created_at">,
  ): Promise<DonnitAssistantRunEvent> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.assistantRunEvents)
      .insert({ ...input, org_id: orgId, user_id: this.userId })
      .select("*")
      .single();
    if (error) throw wrapSupabaseError("create assistant_run_event failed", error);
    return data as DonnitAssistantRunEvent;
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

  async listPositionProfileKnowledge(orgId: string, positionProfileId: string): Promise<DonnitPositionProfileKnowledge[]> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.positionProfileKnowledge)
      .select("*")
      .eq("org_id", orgId)
      .eq("position_profile_id", positionProfileId)
      .or("archived_at.is.null,status.eq.active")
      .order("importance", { ascending: false })
      .order("last_seen_at", { ascending: false })
      .limit(100);
    if (error) {
      if (isMissingRelationError(error) || isMissingColumnError(error)) return [];
      throw wrapSupabaseError("list position_profile_knowledge failed", error);
    }
    return (data ?? []) as DonnitPositionProfileKnowledge[];
  }

  async upsertPositionProfileKnowledge(
    orgId: string,
    input: Pick<DonnitPositionProfileKnowledge, "position_profile_id" | "kind" | "title"> &
      Partial<
        Pick<
          DonnitPositionProfileKnowledge,
          | "source_task_id"
          | "body"
          | "confidence"
          | "memory_key"
          | "markdown_body"
          | "source_kind"
          | "source_event_id"
          | "source_ref"
          | "evidence"
          | "status"
          | "importance"
          | "confidence_score"
          | "created_by"
        >
      >,
  ): Promise<DonnitPositionProfileKnowledge | null> {
    const now = new Date().toISOString();
    const payload = {
      org_id: orgId,
      position_profile_id: input.position_profile_id,
      source_task_id: input.source_task_id ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body ?? "",
      confidence: input.confidence ?? "medium",
      last_seen_at: now,
      memory_key: input.memory_key ?? undefined,
      markdown_body: input.markdown_body ?? "",
      source_kind: input.source_kind ?? "task",
      source_event_id: input.source_event_id ?? null,
      source_ref: input.source_ref ?? "",
      evidence: input.evidence ?? {},
      status: input.status ?? "active",
      importance: input.importance ?? 50,
      confidence_score: input.confidence_score ?? (input.confidence === "high" ? 0.85 : input.confidence === "low" ? 0.35 : 0.6),
      created_by: input.created_by ?? this.userId,
      updated_at: now,
    };
    const { data, error } = await this.client
      .from(DONNIT_TABLES.positionProfileKnowledge)
      .upsert(payload, { onConflict: "org_id,position_profile_id,memory_key" })
      .select("*")
      .single();
    if (error) {
      if (isMissingRelationError(error) || isMissingColumnError(error)) return null;
      throw wrapSupabaseError("upsert position_profile_knowledge failed", error);
    }
    return data as DonnitPositionProfileKnowledge;
  }
}
