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

// Build the redirect target for password recovery. Supabase will append the
// recovery tokens as a URL fragment to whatever URL we hand it, so the URL
// must be the canonical public address of the deployed app.
//
// Resolution order:
//   1. `VITE_AUTH_REDIRECT_URL` — explicit override. Use this in any
//      environment where `window.location.origin` is not the public URL
//      (preview proxies, Perplexity Computer sandbox, local dev tunnels).
//   2. `VITE_SITE_URL` — generic site URL fallback if the more specific
//      auth redirect var is not set.
//   3. `window.location.origin + pathname` — last resort. This is what got
//      us into trouble before: in the Perplexity preview the runtime origin
//      is an internal `*.sites.pplx` URL (or even `localhost`) that the
//      mail recipient cannot reach, so the recovery link 404s or hits
//      ERR_CONNECTION_REFUSED.
//
// Whichever URL we resolve, we strip any trailing slash + existing query/
// hash so Supabase can append `#access_token=...&type=recovery` cleanly.
export function recoveryRedirectUrl(): string {
  const explicit =
    (import.meta.env.VITE_AUTH_REDIRECT_URL as string | undefined) ??
    (import.meta.env.VITE_SITE_URL as string | undefined) ??
    "";
  if (explicit) return normalizeRedirect(explicit);
  if (typeof window === "undefined") return "";
  const { origin, pathname } = window.location;
  return normalizeRedirect(`${origin}${pathname}`);
}

function normalizeRedirect(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  // Drop any existing query string or fragment — Supabase will append its
  // own. Keep the path so deep links (e.g. `/computer/a/<slug>`) survive.
  const noHash = trimmed.split("#")[0];
  const noQuery = noHash.split("?")[0];
  // Strip a single trailing slash unless the URL is just the origin
  // (e.g. `https://app.example.com/`). For `https://example.com/path/`
  // we want `https://example.com/path`.
  if (noQuery.endsWith("/")) {
    try {
      const u = new URL(noQuery);
      if (u.pathname === "/" || u.pathname === "") return noQuery;
    } catch {
      // Fall through and return as-is if URL parsing fails.
    }
    return noQuery.replace(/\/+$/, "");
  }
  return noQuery;
}

// IMPORTANT: GoTrue's `/auth/v1/recover` endpoint reads `redirect_to` from
// the URL query string, NOT from the JSON body. If you put redirect_to in
// the body it is silently ignored and the email link falls back to the
// project's "Site URL" in the Supabase dashboard — which in our case was
// still set to localhost, producing reset emails that 404 in production.
// Do not change this without verifying the link in the actual email.
export async function requestPasswordRecovery(email: string): Promise<void> {
  if (!supabaseConfig.configured) throw new Error("Supabase is not configured");
  const redirectTo = recoveryRedirectUrl();
  const endpoint = redirectTo
    ? `${url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`
    : `${url}/auth/v1/recover`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export type RecoveryTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
};

let pendingRecovery: RecoveryTokens | null = null;

// Called once at app boot (from main.tsx) before the hash router rewrites
// the URL. We pull the GoTrue recovery fragment out of the URL, hand it to
// the auth layer, and clean the address bar so the tokens are not visible
// or share-able. Supabase emits parameters in the URL fragment for the
// implicit flow; we also accept query-string variants just in case.
export function consumeRecoveryFromUrl(): RecoveryTokens | null {
  if (typeof window === "undefined") return null;
  const { hash, search, pathname, origin } = window.location;
  const params = new URLSearchParams();
  if (hash && hash.length > 1) {
    const raw = hash.startsWith("#") ? hash.slice(1) : hash;
    raw.split("&").forEach((part) => {
      const [k, v] = part.split("=");
      if (k) params.set(decodeURIComponent(k), decodeURIComponent(v ?? ""));
    });
  }
  if (search && search.length > 1) {
    const q = new URLSearchParams(search);
    q.forEach((v, k) => {
      if (!params.has(k)) params.set(k, v);
    });
  }
  const type = params.get("type");
  const accessToken = params.get("access_token");
  if (type !== "recovery" || !accessToken) return null;
  const refreshToken = params.get("refresh_token");
  const expires = params.get("expires_in");
  pendingRecovery = {
    accessToken,
    refreshToken: refreshToken ?? null,
    expiresIn: expires ? Number(expires) : null,
  };
  // Wipe the tokens from the address bar without reloading.
  try {
    window.history.replaceState(null, "", `${origin}${pathname}`);
  } catch {
    // History API can fail in sandboxed previews; the app still works,
    // we just leave the URL alone in that case.
  }
  return pendingRecovery;
}

export function getPendingRecovery(): RecoveryTokens | null {
  return pendingRecovery;
}

export function clearPendingRecovery(): void {
  pendingRecovery = null;
}

// Update the password for the user identified by the given recovery
// access token. Uses the GoTrue user endpoint, which Supabase requires
// for password changes initiated from a recovery link.
export async function updatePasswordWithRecovery(
  recoveryAccessToken: string,
  newPassword: string,
): Promise<void> {
  if (!supabaseConfig.configured) throw new Error("Supabase is not configured");
  const res = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      ...authHeaders(),
      Authorization: `Bearer ${recoveryAccessToken}`,
    },
    body: JSON.stringify({ password: newPassword }),
  });
  if (!res.ok) throw new Error(await readError(res));
}
