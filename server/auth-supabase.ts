import type { NextFunction, Request, Response } from "express";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DONNIT_SCHEMA, isSupabaseConfigured } from "./supabase";

// Per-request Supabase context. The client is constructed with the user's
// access token so that RLS sees `auth.uid()` correctly. The schema is pinned
// to `donnit`, which is the only schema Donnit production code is allowed to
// touch — see supabase/migrations/0002_donnit_namespace.sql.
export type DonnitAuthContext = {
  userId: string;
  email: string | null;
  accessToken: string;
  client: SupabaseClient;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      donnitAuth?: DonnitAuthContext;
    }
  }
}

function readBearerToken(req: Request): string | null {
  const header = req.header("authorization") ?? req.header("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function buildClientForToken(accessToken: string): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  // The generic typings on the JS SDK require the schema to be one of the
  // typed schemas (defaults to "public"). For our untyped runtime usage we
  // pin to `donnit` and cast back to the loose `SupabaseClient` shape used
  // throughout the codebase.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: DONNIT_SCHEMA as unknown as "public" },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  }) as unknown as SupabaseClient;
}

// Best-effort: if the request has a Supabase access token, verify it and
// attach a per-request donnit-scoped client. Always proceeds; downstream
// handlers can branch on `req.donnitAuth` to decide between authenticated
// Supabase paths and the demo SQLite path.
export async function attachSupabaseAuth(req: Request, _res: Response, next: NextFunction) {
  if (!isSupabaseConfigured()) {
    next();
    return;
  }

  const token = readBearerToken(req);
  if (!token) {
    next();
    return;
  }

  try {
    const client = buildClientForToken(token);
    if (!client) {
      next();
      return;
    }
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) {
      next();
      return;
    }
    req.donnitAuth = {
      userId: data.user.id,
      email: data.user.email ?? null,
      accessToken: token,
      client,
    };
  } catch {
    // Ignore — fall through to demo mode.
  }

  next();
}

// Admin (service-role) client used ONLY by paths that cannot carry a user
// JWT. The Gmail OAuth callback is the canonical example: Google redirects
// the browser to /api/integrations/gmail/oauth/callback as a top-level
// navigation, so no Authorization header is sent. The callback identifies
// the donnit user via a signed state token (HMAC) and writes the token row
// using this admin client. Returns null if SUPABASE_SERVICE_ROLE_KEY is not
// configured — callers MUST handle that case and surface a friendly error.
//
// Never expose this client outside the server. It bypasses RLS.
export function createSupabaseAdminClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return null;
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: DONNIT_SCHEMA as unknown as "public" },
  }) as unknown as SupabaseClient;
}

export function requireDonnitAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.donnitAuth) {
    res.status(401).json({ message: "Authentication required." });
    return;
  }
  next();
}
