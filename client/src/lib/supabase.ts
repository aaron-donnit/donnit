import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Vite injects `import.meta.env.VITE_*` at build time. Donnit publishes the
// public anon key to the browser intentionally — that key is paired with RLS
// in the `donnit` schema and cannot grant cross-tenant access. The service
// role key must NEVER appear here.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

export const supabaseConfig = {
  url,
  hasAnonKey: Boolean(anonKey),
  configured: Boolean(url && anonKey),
};

// Some sandbox preview environments block localStorage/sessionStorage. The
// Supabase JS client treats a missing storage backend as a hard error in
// some configurations, so we swap in an in-memory store. The trade-off is
// that the session is forgotten on page reload inside the preview, which is
// the documented limitation.
function safeStorage(): Storage | undefined {
  try {
    const probeKey = "__donnit_storage_probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    return undefined;
  }
}

class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  key(index: number) { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

export const usingPersistentSession = Boolean(safeStorage());

let cachedClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfig.configured) return null;
  if (cachedClient) return cachedClient;
  const storage = safeStorage() ?? (new MemoryStorage() as unknown as Storage);
  cachedClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage,
      storageKey: "donnit.auth",
    },
  });
  return cachedClient;
}
