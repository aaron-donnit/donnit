import type { SupabaseClient } from "@supabase/supabase-js";
import { DONNIT_TABLES } from "./supabase";

// Production-grade store backed by the `donnit` schema in Supabase. This
// module is the only place that issues SELECT/INSERT/UPDATE against Donnit's
// production tables — every query goes through the per-request client built
// in server/auth-supabase.ts so that RLS policies see the caller's uid.

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
  source: "chat" | "manual" | "email" | "automation" | "annual";
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
  suggested_title: string;
  suggested_due_date: string | null;
  urgency: "low" | "normal" | "high" | "critical";
  status: "pending" | "approved" | "dismissed";
  assigned_to: string | null;
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
    if (error) throw error;
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

  async createTask(orgId: string, input: Omit<DonnitTask, "id" | "org_id" | "created_at" | "accepted_at" | "denied_at" | "completed_at" | "completion_notes">): Promise<DonnitTask> {
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
}
