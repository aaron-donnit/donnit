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

export type DonnitPositionProfileTaskMemoryStep = {
  id: string;
  org_id: string;
  task_memory_id: string;
  position_profile_id: string;
  source_task_id: string | null;
  title: string;
  instructions: string;
  tool_name: string;
  tool_url: string;
  expected_output: string;
  relative_due_offset_days: number;
  estimated_minutes: number;
  dependency_step_ids: string[];
  position: number;
  created_at: string;
  updated_at: string;
};

export type DonnitPositionProfileTaskMemoryAttachment = {
  id: string;
  org_id: string;
  position_profile_id: string;
  task_memory_id: string;
  bucket_id: string;
  storage_path: string;
  file_name: string;
  content_type: string;
  file_size: number;
  kind: "Document" | "Image" | "Spreadsheet" | "Other";
  uploaded_by: string | null;
  created_at: string;
};

export type DonnitPositionProfileTaskMemory = {
  id: string;
  org_id: string;
  position_profile_id: string;
  source_task_id: string | null;
  title: string;
  objective: string;
  cadence: "none" | "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  due_rule: string;
  start_offset_days: number;
  default_urgency: "low" | "normal" | "high" | "critical";
  default_estimated_minutes: number;
  status: "suggested" | "active" | "archived";
  version: number;
  confidence_score: number;
  learned_from: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_learned_at: string;
  steps?: DonnitPositionProfileTaskMemoryStep[];
  attachments?: DonnitPositionProfileTaskMemoryAttachment[];
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

export type DonnitWorkspaceMemoryAlias = {
  id: string;
  org_id: string;
  surface_form: string;
  normalized_form: string;
  target_type: "member" | "position_profile" | "team" | "artifact" | "project" | "template" | "tool";
  target_id: string;
  scope_type: "user" | "team" | "position_profile" | "workspace";
  scope_id: string | null;
  scope_key: string;
  confidence_score: number;
  status: "active" | "contested" | "archived" | "rejected";
  source: string;
  usage_count: number;
  contradicted_count: number;
  last_used_at: string;
  contested_at: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type DonnitTaskResolutionEvent = {
  id: string;
  org_id: string;
  actor_id: string | null;
  source: "chat" | "manual" | "email" | "slack" | "sms" | "document" | "automation";
  original_text: string;
  parsed_slots: Record<string, unknown>;
  candidate_snapshot: Record<string, unknown>;
  resolution_output: Record<string, unknown>;
  decision: "created" | "asked" | "confirmed" | "corrected" | "rejected" | "ignored";
  confidence_score: number | null;
  created_task_id: string | null;
  correction: Record<string, unknown>;
  signal_type:
    | "explicit_correction"
    | "clarification_picked"
    | "clarification_unpicked"
    | "silent_edit"
    | "implicit_acceptance"
    | "undo"
    | "task_completed"
    | null;
  signal_strength: number | null;
  latency_ms: number;
  model: string | null;
  cost_usd: number;
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

  async listPositionProfileTaskMemories(orgId: string, positionProfileId: string): Promise<DonnitPositionProfileTaskMemory[]> {
    const { data: memories, error } = await this.client
      .from(DONNIT_TABLES.positionProfileTaskMemories)
      .select("*")
      .eq("org_id", orgId)
      .eq("position_profile_id", positionProfileId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false });
    if (error) {
      if (isMissingRelationError(error) || isMissingColumnError(error)) return [];
      throw wrapSupabaseError("list position_profile_task_memories failed", error);
    }
    const memoryIds = ((memories ?? []) as DonnitPositionProfileTaskMemory[]).map((memory) => memory.id);
    if (memoryIds.length === 0) return [];
    const { data: steps, error: stepsError } = await this.client
      .from(DONNIT_TABLES.positionProfileTaskMemorySteps)
      .select("*")
      .eq("org_id", orgId)
      .in("task_memory_id", memoryIds)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (stepsError) {
      if (isMissingRelationError(stepsError) || isMissingColumnError(stepsError)) {
        return ((memories ?? []) as DonnitPositionProfileTaskMemory[]).map((memory) => ({ ...memory, steps: [] }));
      }
      throw wrapSupabaseError("list position_profile_task_memory_steps failed", stepsError);
    }
    const byMemory = new Map<string, DonnitPositionProfileTaskMemoryStep[]>();
    for (const step of (steps ?? []) as DonnitPositionProfileTaskMemoryStep[]) {
      const list = byMemory.get(step.task_memory_id) ?? [];
      list.push({ ...step, dependency_step_ids: Array.isArray(step.dependency_step_ids) ? step.dependency_step_ids : [] });
      byMemory.set(step.task_memory_id, list);
    }
    const { data: attachments, error: attachmentsError } = await this.client
      .from(DONNIT_TABLES.positionProfileTaskMemoryAttachments)
      .select("*")
      .eq("org_id", orgId)
      .in("task_memory_id", memoryIds)
      .order("created_at", { ascending: false });
    if (attachmentsError) {
      if (!isMissingRelationError(attachmentsError) && !isMissingColumnError(attachmentsError)) {
        throw wrapSupabaseError("list position_profile_task_memory_attachments failed", attachmentsError);
      }
    }
    const attachmentsByMemory = new Map<string, DonnitPositionProfileTaskMemoryAttachment[]>();
    for (const attachment of (attachments ?? []) as DonnitPositionProfileTaskMemoryAttachment[]) {
      const list = attachmentsByMemory.get(attachment.task_memory_id) ?? [];
      list.push(attachment);
      attachmentsByMemory.set(attachment.task_memory_id, list);
    }
    return ((memories ?? []) as DonnitPositionProfileTaskMemory[]).map((memory) => ({
      ...memory,
      learned_from: typeof memory.learned_from === "object" && memory.learned_from !== null ? memory.learned_from : {},
      steps: byMemory.get(memory.id) ?? [],
      attachments: attachmentsByMemory.get(memory.id) ?? [],
    }));
  }

  async listPositionProfileTaskMemoryAttachments(
    orgId: string,
    taskMemoryId: string,
  ): Promise<DonnitPositionProfileTaskMemoryAttachment[]> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.positionProfileTaskMemoryAttachments)
      .select("*")
      .eq("org_id", orgId)
      .eq("task_memory_id", taskMemoryId)
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingRelationError(error) || isMissingColumnError(error)) return [];
      throw wrapSupabaseError("list position_profile_task_memory_attachments failed", error);
    }
    return (data ?? []) as DonnitPositionProfileTaskMemoryAttachment[];
  }

  async createPositionProfileTaskMemoryAttachment(
    orgId: string,
    input: Omit<DonnitPositionProfileTaskMemoryAttachment, "id" | "org_id" | "created_at">,
  ): Promise<DonnitPositionProfileTaskMemoryAttachment | null> {
    const { data, error } = await this.client
      .from(DONNIT_TABLES.positionProfileTaskMemoryAttachments)
      .insert({ ...input, org_id: orgId })
      .select("*")
      .single();
    if (error) {
      if (isMissingRelationError(error) || isMissingColumnError(error)) return null;
      throw wrapSupabaseError("create position_profile_task_memory_attachment failed", error);
    }
    return data as DonnitPositionProfileTaskMemoryAttachment;
  }

  async deletePositionProfileTaskMemoryAttachment(orgId: string, attachmentId: string) {
    const { error } = await this.client
      .from(DONNIT_TABLES.positionProfileTaskMemoryAttachments)
      .delete()
      .eq("org_id", orgId)
      .eq("id", attachmentId);
    if (error) {
      if (isMissingRelationError(error) || isMissingColumnError(error)) return;
      throw wrapSupabaseError("delete position_profile_task_memory_attachment failed", error);
    }
  }

  async upsertPositionProfileTaskMemory(
    orgId: string,
    input: Pick<DonnitPositionProfileTaskMemory, "position_profile_id" | "title"> &
      Partial<
        Pick<
          DonnitPositionProfileTaskMemory,
          | "source_task_id"
          | "objective"
          | "cadence"
          | "due_rule"
          | "start_offset_days"
          | "default_urgency"
          | "default_estimated_minutes"
          | "status"
          | "confidence_score"
          | "learned_from"
          | "created_by"
        >
      > & {
        steps?: Array<
          Pick<DonnitPositionProfileTaskMemoryStep, "title"> &
            Partial<
              Pick<
                DonnitPositionProfileTaskMemoryStep,
                | "source_task_id"
                | "instructions"
                | "tool_name"
                | "tool_url"
                | "expected_output"
                | "relative_due_offset_days"
                | "estimated_minutes"
                | "dependency_step_ids"
                | "position"
              >
            >
        >;
      },
  ): Promise<DonnitPositionProfileTaskMemory | null> {
    const now = new Date().toISOString();
    const existing = (await this.listPositionProfileTaskMemories(orgId, input.position_profile_id)).find((memory) => {
      if (input.source_task_id && memory.source_task_id === input.source_task_id) return true;
      return memory.title.trim().toLowerCase() === input.title.trim().toLowerCase() && memory.cadence === (input.cadence ?? memory.cadence);
    });
    const memoryPayload = {
      position_profile_id: input.position_profile_id,
      source_task_id: input.source_task_id ?? existing?.source_task_id ?? null,
      title: input.title,
      objective: input.objective ?? existing?.objective ?? "",
      cadence: input.cadence ?? existing?.cadence ?? "none",
      due_rule: input.due_rule ?? existing?.due_rule ?? "",
      start_offset_days: input.start_offset_days ?? existing?.start_offset_days ?? 0,
      default_urgency: input.default_urgency ?? existing?.default_urgency ?? "normal",
      default_estimated_minutes: input.default_estimated_minutes ?? existing?.default_estimated_minutes ?? 30,
      status: input.status ?? existing?.status ?? "active",
      version: existing ? existing.version + 1 : 1,
      confidence_score: input.confidence_score ?? existing?.confidence_score ?? 0.65,
      learned_from: input.learned_from ?? existing?.learned_from ?? {},
      created_by: input.created_by ?? existing?.created_by ?? this.userId,
      updated_at: now,
      last_learned_at: now,
    };

    const { data, error } = existing
      ? await this.client
          .from(DONNIT_TABLES.positionProfileTaskMemories)
          .update(memoryPayload)
          .eq("org_id", orgId)
          .eq("id", existing.id)
          .select("*")
          .single()
      : await this.client
          .from(DONNIT_TABLES.positionProfileTaskMemories)
          .insert({ ...memoryPayload, org_id: orgId })
          .select("*")
          .single();
    if (error) {
      if (isMissingRelationError(error) || isMissingColumnError(error)) return null;
      throw wrapSupabaseError("upsert position_profile_task_memory failed", error);
    }
    const memory = data as DonnitPositionProfileTaskMemory;
    if (input.steps) {
      const { error: deleteError } = await this.client
        .from(DONNIT_TABLES.positionProfileTaskMemorySteps)
        .delete()
        .eq("org_id", orgId)
        .eq("task_memory_id", memory.id);
      if (deleteError) {
        if (isMissingRelationError(deleteError) || isMissingColumnError(deleteError)) return { ...memory, steps: [] };
        throw wrapSupabaseError("replace position_profile_task_memory_steps failed", deleteError);
      }
      if (input.steps.length > 0) {
        const { error: insertError } = await this.client
          .from(DONNIT_TABLES.positionProfileTaskMemorySteps)
          .insert(
            input.steps.map((step, index) => ({
              org_id: orgId,
              task_memory_id: memory.id,
              position_profile_id: input.position_profile_id,
              source_task_id: step.source_task_id ?? input.source_task_id ?? null,
              title: step.title,
              instructions: step.instructions ?? "",
              tool_name: step.tool_name ?? "",
              tool_url: step.tool_url ?? "",
              expected_output: step.expected_output ?? "",
              relative_due_offset_days: step.relative_due_offset_days ?? 0,
              estimated_minutes: step.estimated_minutes ?? input.default_estimated_minutes ?? 30,
              dependency_step_ids: step.dependency_step_ids ?? [],
              position: step.position ?? index,
            })),
          );
        if (insertError) throw wrapSupabaseError("replace position_profile_task_memory_steps failed", insertError);
      }
    }
    return (await this.listPositionProfileTaskMemories(orgId, input.position_profile_id)).find((item) => item.id === memory.id) ?? memory;
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

  async listWorkspaceMemoryAliases(orgId: string, normalizedForm?: string): Promise<DonnitWorkspaceMemoryAlias[]> {
    let query = this.client
      .from(DONNIT_TABLES.workspaceMemoryAliases)
      .select("*")
      .eq("org_id", orgId)
      .in("status", ["active", "contested"])
      .order("confidence_score", { ascending: false })
      .order("last_used_at", { ascending: false })
      .limit(100);
    if (normalizedForm) query = query.eq("normalized_form", normalizedForm);
    const { data, error } = await query;
    if (error) {
      if (isMissingRelationError(error) || isMissingColumnError(error)) return [];
      throw wrapSupabaseError("list workspace_memory_aliases failed", error);
    }
    return (data ?? []) as DonnitWorkspaceMemoryAlias[];
  }

  async upsertWorkspaceMemoryAlias(
    orgId: string,
    input: Pick<DonnitWorkspaceMemoryAlias, "surface_form" | "normalized_form" | "target_type" | "target_id"> &
      Partial<
        Pick<
          DonnitWorkspaceMemoryAlias,
          | "scope_type"
          | "scope_id"
          | "confidence_score"
          | "status"
          | "source"
          | "usage_count"
          | "contradicted_count"
          | "contested_at"
          | "metadata"
          | "created_by"
          | "archived_at"
        >
      >,
  ): Promise<DonnitWorkspaceMemoryAlias | null> {
    const now = new Date().toISOString();
    const payload = {
      org_id: orgId,
      surface_form: input.surface_form,
      normalized_form: input.normalized_form,
      target_type: input.target_type,
      target_id: input.target_id,
      scope_type: input.scope_type ?? "workspace",
      scope_id: input.scope_id ?? null,
      scope_key: input.scope_id ?? input.scope_type ?? "workspace",
      confidence_score: input.confidence_score ?? 0.65,
      status: input.status ?? "active",
      source: input.source ?? "learned",
      usage_count: input.usage_count ?? 1,
      contradicted_count: input.contradicted_count ?? 0,
      last_used_at: now,
      contested_at: input.contested_at ?? null,
      metadata: input.metadata ?? {},
      created_by: input.created_by ?? this.userId,
      updated_at: now,
      archived_at: input.archived_at ?? null,
    };
    const { data, error } = await this.client
      .from(DONNIT_TABLES.workspaceMemoryAliases)
      .upsert(payload, { onConflict: "org_id,normalized_form,target_type,target_id,scope_type,scope_key" })
      .select("*")
      .single();
    if (error) {
      if (isMissingRelationError(error) || isMissingColumnError(error)) return null;
      throw wrapSupabaseError("upsert workspace_memory_alias failed", error);
    }
    return data as DonnitWorkspaceMemoryAlias;
  }

  async reinforceWorkspaceMemoryAlias(
    orgId: string,
    input: Pick<DonnitWorkspaceMemoryAlias, "surface_form" | "normalized_form" | "target_type" | "target_id"> &
      Partial<Pick<DonnitWorkspaceMemoryAlias, "scope_type" | "scope_id" | "source" | "metadata" | "created_by">> & {
        signalStrength?: number;
        initialConfidence?: number;
      },
  ): Promise<DonnitWorkspaceMemoryAlias | null> {
    const scopeType = input.scope_type ?? "workspace";
    const scopeId = input.scope_id ?? null;
    const scopeKey = scopeId ?? scopeType;
    const now = new Date().toISOString();
    const { data: existing, error: readError } = await this.client
      .from(DONNIT_TABLES.workspaceMemoryAliases)
      .select("*")
      .eq("org_id", orgId)
      .eq("normalized_form", input.normalized_form)
      .eq("target_type", input.target_type)
      .eq("target_id", input.target_id)
      .eq("scope_type", scopeType)
      .eq("scope_key", scopeKey)
      .maybeSingle();
    if (readError) {
      if (isMissingRelationError(readError) || isMissingColumnError(readError)) return null;
      throw wrapSupabaseError("read workspace_memory_alias failed", readError);
    }
    const strength = Math.max(0, Math.min(1, input.signalStrength ?? 0.3));
    const learningRate = 0.15;
    if (existing) {
      const alias = existing as DonnitWorkspaceMemoryAlias;
      const current = Number(alias.confidence_score ?? 0.65);
      const nextConfidence = Math.min(0.99, current + learningRate * strength * (1 - current));
      const { data, error } = await this.client
        .from(DONNIT_TABLES.workspaceMemoryAliases)
        .update({
          confidence_score: nextConfidence,
          usage_count: Number(alias.usage_count ?? 0) + 1,
          last_used_at: now,
          status: alias.status === "archived" || alias.status === "rejected" ? "active" : alias.status,
          metadata: { ...(alias.metadata ?? {}), ...(input.metadata ?? {}) },
          updated_at: now,
          archived_at: null,
        })
        .eq("id", alias.id)
        .select("*")
        .single();
      if (error) {
        if (isMissingRelationError(error) || isMissingColumnError(error)) return null;
        throw wrapSupabaseError("reinforce workspace_memory_alias failed", error);
      }
      return data as DonnitWorkspaceMemoryAlias;
    }
    return this.upsertWorkspaceMemoryAlias(orgId, {
      surface_form: input.surface_form,
      normalized_form: input.normalized_form,
      target_type: input.target_type,
      target_id: input.target_id,
      scope_type: scopeType,
      scope_id: scopeId,
      confidence_score: input.initialConfidence ?? 0.65,
      status: "active",
      source: input.source ?? "learned:chat_resolution",
      usage_count: 1,
      metadata: input.metadata ?? {},
      created_by: input.created_by ?? this.userId,
    });
  }

  async archiveWorkspaceMemoryAliasesForTarget(
    orgId: string,
    targetType: DonnitWorkspaceMemoryAlias["target_type"],
    targetId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.client
      .from(DONNIT_TABLES.workspaceMemoryAliases)
      .update({
        status: "archived",
        archived_at: now,
        updated_at: now,
      })
      .eq("org_id", orgId)
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .in("status", ["active", "contested"]);
    if (error) {
      if (isMissingRelationError(error) || isMissingColumnError(error)) return;
      throw wrapSupabaseError("archive workspace_memory_aliases failed", error);
    }
  }

  async createTaskResolutionEvent(
    orgId: string,
    input: Omit<DonnitTaskResolutionEvent, "id" | "org_id" | "actor_id" | "created_at"> &
      Partial<Pick<DonnitTaskResolutionEvent, "actor_id">>,
  ): Promise<DonnitTaskResolutionEvent | null> {
    const payload = {
      actor_id: input.actor_id ?? this.userId,
      source: input.source,
      original_text: input.original_text,
      parsed_slots: input.parsed_slots ?? {},
      candidate_snapshot: input.candidate_snapshot ?? {},
      resolution_output: input.resolution_output ?? {},
      decision: input.decision,
      confidence_score: input.confidence_score ?? null,
      created_task_id: input.created_task_id ?? null,
      correction: input.correction ?? {},
      signal_type: input.signal_type ?? null,
      signal_strength: input.signal_strength ?? null,
      latency_ms: input.latency_ms ?? 0,
      model: input.model ?? null,
      cost_usd: input.cost_usd ?? 0,
      org_id: orgId,
    };
    const { data, error } = await this.client
      .from(DONNIT_TABLES.taskResolutionEvents)
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      if (isMissingRelationError(error) || isMissingColumnError(error)) return null;
      throw wrapSupabaseError("create task_resolution_event failed", error);
    }
    return data as DonnitTaskResolutionEvent;
  }
}
