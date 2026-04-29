// Donnit talks to Supabase Auth (GoTrue) directly via fetch instead of the
// `@supabase/supabase-js` client. The official client pulls in `auth-js`
// which references browser storage APIs that the preview deploy validator
// forbids. Implementing the few endpoints we actually use keeps the bundle
// clean and lets us hold the session entirely in memory for the page.
//
// Trade-off: there is no persistence, so reloads sign the user out. That is
// the documented preview-environment limitation.

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

export const supabaseConfig = {
  url,
  hasAnonKey: Boolean(anonKey),
  configured: Boolean(url && anonKey),
};

export type DonnitUser = {
  id: string;
  email: string | null;
};

export type DonnitSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  user: DonnitUser;
};

type Listener = (session: DonnitSession | null) => void;

let currentSession: DonnitSession | null = null;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((fn) => fn(currentSession));
}

export function onAuthChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCurrentSession(): DonnitSession | null {
  return currentSession;
}

function authHeaders(): Record<string, string> {
  return {
    apikey: anonKey,
    "Content-Type": "application/json",
  };
}

type GoTrueTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id: string; email?: string | null } | null;
  error?: string;
  error_description?: string;
  msg?: string;
  message?: string;
};

function sessionFromTokenResponse(payload: GoTrueTokenResponse): DonnitSession {
  if (!payload.access_token || !payload.user?.id) {
    throw new Error("Invalid auth response from Supabase");
  }
  const expiresAt = payload.expires_in
    ? Math.floor(Date.now() / 1000) + payload.expires_in
    : null;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt,
    user: {
      id: payload.user.id,
      email: payload.user.email ?? null,
    },
  };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as GoTrueTokenResponse;
    return (
      body.error_description ||
      body.message ||
      body.msg ||
      body.error ||
      `${res.status} ${res.statusText}`
    );
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

export async function signInWithPassword(email: string, password: string): Promise<DonnitSession> {
  if (!supabaseConfig.configured) throw new Error("Supabase is not configured");
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const payload = (await res.json()) as GoTrueTokenResponse;
  currentSession = sessionFromTokenResponse(payload);
  emit();
  return currentSession;
}

export async function signUpWithPassword(email: string, password: string): Promise<DonnitSession | null> {
  if (!supabaseConfig.configured) throw new Error("Supabase is not configured");
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const payload = (await res.json()) as GoTrueTokenResponse;
  // When email confirmation is required GoTrue returns the user without a
  // session. Surface that to callers so they can prompt to verify.
  if (!payload.access_token || !payload.user?.id) {
    return null;
  }
  currentSession = sessionFromTokenResponse(payload);
  emit();
  return currentSession;
}

export async function signOut(): Promise<void> {
  const session = currentSession;
  currentSession = null;
  emit();
  if (!session || !supabaseConfig.configured) return;
  try {
    await fetch(`${url}/auth/v1/logout`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        Authorization: `Bearer ${session.accessToken}`,
      },
    });
  } catch {
    // The client-side state is already cleared; ignore network errors here.
  }
}
