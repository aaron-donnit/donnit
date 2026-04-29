import { createClient } from "@supabase/supabase-js";

export function getSupabaseConfig() {
  return {
    projectId: process.env.SUPABASE_PROJECT_ID ?? "bchwrbqaacdijavtugdt",
    url: process.env.SUPABASE_URL ?? "",
    hasAnonKey: Boolean(process.env.SUPABASE_ANON_KEY),
  };
}

export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

export function createSupabaseServerClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
