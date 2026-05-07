import { createClient } from "@supabase/supabase-js";

// Donnit owns the `donnit` schema in the shared Supabase project. The shared
// project also hosts a Rosterstack app whose tables live in `public.profiles`
// and `public.chat_messages`. To avoid colliding with those tables, all
// Donnit production reads/writes must be scoped to the `donnit` schema.
//
// See supabase/migrations/0002_donnit_namespace.sql and docs/SUPABASE.md for
// the full background.
export const DONNIT_SCHEMA = "donnit";

// Tables Donnit owns inside the `donnit` schema. Use these constants instead
// of inline string literals so future renames stay in one place.
export const DONNIT_TABLES = {
  organizations: "organizations",
  profiles: "profiles",
  organizationMembers: "organization_members",
  tasks: "tasks",
  taskEvents: "task_events",
  chatMessages: "chat_messages",
  emailSuggestions: "email_suggestions",
  reminderPreferences: "reminder_preferences",
  gmailAccounts: "gmail_accounts",
  positionProfiles: "position_profiles",
  positionProfileAssignments: "position_profile_assignments",
  positionProfileKnowledge: "position_profile_knowledge",
} as const;

export function getSupabaseConfig() {
  return {
    projectId: process.env.SUPABASE_PROJECT_ID ?? "bchwrbqaacdijavtugdt",
    url: process.env.SUPABASE_URL ?? "",
    schema: DONNIT_SCHEMA,
    hasAnonKey: Boolean(process.env.SUPABASE_ANON_KEY),
  };
}

export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

// Returns a Supabase client whose `from(...)` calls automatically resolve to
// the `donnit` schema. Production code paths must use this helper rather than
// constructing their own client, otherwise queries will silently hit the
// shared `public.*` tables that belong to the Rosterstack app.
export function createSupabaseServerClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      schema: DONNIT_SCHEMA,
    },
  });
}
