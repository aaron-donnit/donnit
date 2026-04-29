# Supabase setup for Donnit

Donnit uses a Supabase project that is **shared with another app
(Rosterstack)**. To keep the two apps from stepping on each other, all Donnit
production data lives in a dedicated Postgres schema called `donnit`.

## Why a dedicated schema

The first foundation migration (`supabase/migrations/0001_donnit_foundation.sql`)
created tables in `public` using `CREATE TABLE IF NOT EXISTS`. The shared
project already had `public.profiles` and `public.chat_messages` belonging to
Rosterstack, so those statements **silently no-opped** and Donnit ended up
pointing at the wrong tables. Other Donnit-owned tables (`organizations`,
`tasks`, `task_events`, etc.) did get created in `public`, but reusing them
risks future collisions and makes ownership unclear.

The decision (after discussion with the user): keep the shared Supabase
project, but isolate Donnit inside its own schema instead of touching any
existing `public.*` table.

## Migration order

1. `0001_donnit_foundation.sql` — **already applied** to the shared project.
   Treat as historical. **Do not extend it destructively.** Some of the tables
   it created in `public` (notably `profiles` and `chat_messages`) collide
   with Rosterstack's tables and must not be altered or dropped from this
   repo.
2. `0002_donnit_namespace.sql` — Creates the `donnit` schema and recreates
   every Donnit-owned table inside it, with the same columns, constraints,
   indexes, and Row Level Security as `0001`, plus a couple of extra policies
   (profile insert, email suggestion insert) that were missing. Non-destructive
   (re-runnable with `DROP POLICY IF EXISTS`/`CREATE POLICY`).
3. `0003_donnit_bootstrap_policies.sql` — Adds `donnit.bootstrap_workspace(...)`
   (a `SECURITY DEFINER` RPC that the freshly signed-up user calls once to
   create their profile, default org, owner-membership row, and reminder
   preferences in a single atomic step). It also adds three narrow
   INSERT/UPDATE policies that allow a user to do this directly via REST in
   case the RPC is unavailable. Idempotent — `CREATE OR REPLACE FUNCTION`
   and `DROP POLICY IF EXISTS`.
4. `0004_fix_rls_membership_recursion.sql` — Fixes a `42P17 infinite
   recursion detected in policy for relation "organization_members"` error
   that surfaces once the `donnit` schema is exposed via PostgREST. The
   original policies in `0002`/`0003` checked membership with
   `exists (select 1 from donnit.organization_members ...)` inside the
   policies *on* `organization_members` and on every other org-scoped table.
   Each of those subqueries re-entered the same SELECT policy on
   `organization_members`, producing infinite recursion. This migration
   introduces SECURITY DEFINER helpers in schema `donnit`
   (`is_org_member`, `can_assign_in_org`, `is_org_manager`,
   `org_has_members`) with `search_path` pinned to `donnit, pg_temp`, and
   replaces the recursive policies on `organizations`,
   `organization_members`, `tasks`, `task_events`, and `email_suggestions`
   with calls to those helpers. The owner-membership insert policy from
   `0003` now uses `donnit.org_has_members(...)` instead of a
   self-referential subquery. Idempotent — `CREATE OR REPLACE FUNCTION` /
   `DROP POLICY IF EXISTS`. Non-destructive: no table or column is altered,
   and the `public` schema is untouched.
5. `0005_fix_bootstrap_workspace_conflict.sql` — **the migration to apply
   next.** Fixes a `42702 column reference "org_id" is ambiguous` error
   raised inside `donnit.bootstrap_workspace(...)` when it runs the
   `insert into donnit.organization_members ... on conflict (org_id, user_id)`
   step. Because the function's `RETURNS TABLE (user_id uuid, org_id uuid,
   is_new boolean)` clause exposes `org_id` and `user_id` as PL/pgSQL OUT
   variables inside the body, the bare names in the ON CONFLICT target list
   match both the table columns and the OUT variables, and PL/pgSQL refuses
   the call. Production symptom: `POST /api/auth/bootstrap` → 500 and
   `POST /rest/v1/rpc/bootstrap_workspace` → 400, leaving newly signed-up
   users unable to create their workspace (profiles / organizations /
   organization_members all stayed empty). The fix recreates the function
   with `#variable_conflict use_column` at the top of the body so PL/pgSQL
   resolves ambiguous identifiers to the table column. The external
   contract — `(text, text, text)` argument signature, returned column
   names/types, `SECURITY DEFINER`, `search_path = donnit, public` — is
   preserved, so application code does not need to change. Idempotent —
   `CREATE OR REPLACE FUNCTION`. Non-destructive: no table, column, or
   policy is altered.

> **Action required:** apply `0002_donnit_namespace.sql`,
> `0003_donnit_bootstrap_policies.sql`,
> `0004_fix_rls_membership_recursion.sql`, and
> `0005_fix_bootstrap_workspace_conflict.sql` from the Supabase SQL editor
> (or `supabase db push`) before authenticated production code can run. The
> repo does not run DDL automatically.
>
> **Manual dashboard step:** in Supabase → Project settings → API, add
> `donnit` to the list of "Exposed schemas" (the field is named
> `db.schemas` / `Exposed schemas`). Without this, PostgREST will reject
> `from('tasks')` calls made by the per-request client because the schema is
> not in the API search path. The defaults only expose `public`, `graphql_public`.

## Cleanup of orphaned `public.*` Donnit tables (later, optional)

The `public.organizations`, `public.tasks`, `public.task_events`,
`public.email_suggestions`, and `public.reminder_preferences` tables created
by `0001` are now orphaned (Donnit no longer references them, and Rosterstack
never did). They can be dropped in a later migration once we confirm nothing
external is reading them. **Do not include those drops in `0002`** — keep
`0002` purely additive so it is safe to re-run.

## Code wiring

- `server/supabase.ts` exports `DONNIT_SCHEMA = "donnit"` and
  `DONNIT_TABLES`. The legacy `createSupabaseServerClient()` is kept for
  scripts/tooling but **production routes do not use it** — they use the
  per-request client below.
- `server/auth-supabase.ts` reads `Authorization: Bearer <jwt>` from each
  `/api/*` request. If the JWT verifies, it builds a fresh Supabase client
  with the user's token and pins `db.schema` to `donnit`, then attaches
  `req.donnitAuth = { userId, email, accessToken, client }`. Routes branch on
  `req.donnitAuth` — present means run against Supabase under RLS; absent
  means fall back to the demo SQLite store.
- `server/donnit-store.ts` wraps every read/write so callers cannot
  accidentally hit `public.*`. Use it instead of constructing queries inline.
- `server/routes.ts` routes both bootstrap, chat, tasks, events, and email
  suggestions through `DonnitStore` when authenticated. The Gmail scan
  endpoint also writes its suggestions into the authenticated user's org.
- `client/src/lib/supabase.ts` is a tiny GoTrue REST wrapper (no
  `@supabase/supabase-js` dependency). Sessions live only in module memory:
  the deploy validator forbids `localStorage`, `sessionStorage`, `indexedDB`,
  and similar APIs in the bundle, so we cannot persist sessions in the
  browser. Reloading the page or closing the tab signs the user out — this
  trade-off is surfaced on the auth screen.
- `client/src/components/AuthGate.tsx` renders the sign-in / sign-up form,
  the first-time bootstrap form (calls `POST /api/auth/bootstrap` →
  `donnit.bootstrap_workspace(...)`), and a loading state. It then renders
  the existing `<AppShell />` once the workspace is ready.

## Environment

Set these before enabling production Supabase:

```
# server-side
SUPABASE_PROJECT_ID=bchwrbqaacdijavtugdt
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon key>

# client-side (Vite injects only VITE_-prefixed vars into the browser)
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>

# Canonical public URL the password-recovery email should return users to.
# Required in any non-localhost build (see "Password recovery redirect URL"
# below). Production should be the donnit.ai URL.
VITE_AUTH_REDIRECT_URL=https://donnit.ai
# Optional generic fallback if VITE_AUTH_REDIRECT_URL is unset.
VITE_SITE_URL=https://donnit.ai
```

No schema-related env var is needed — the schema is hard-coded to `donnit`
because changing it would require a coordinated migration. The anon key is
public by design and paired with RLS; never put a service role key in any
file checked into the repo.

## Password recovery redirect URL

The "Forgot password?" flow calls `POST {SUPABASE_URL}/auth/v1/recover`
with a `redirect_to` field. Supabase emails a magic link of the form
`{SUPABASE_URL}/auth/v1/verify?token=...&redirect_to={redirect_to}`; once
GoTrue verifies the token it 302s the browser to `redirect_to` with the
recovery `access_token`, `refresh_token`, `expires_in`, and `type=recovery`
appended in the URL fragment. `client/src/main.tsx` then calls
`consumeRecoveryFromUrl()` which lifts the tokens out of the fragment, hands
them to the auth layer, and scrubs them from the address bar. The "set new
password" form in `AuthGate.tsx` uses the recovery `access_token` to call
`PUT /auth/v1/user` and update the password.

For that round-trip to work the `redirect_to` URL MUST be reachable from the
recipient's browser. The previous implementation just used
`window.location.origin + pathname`, which fails in two situations we now
care about:

1. **Local dev** — the browser sees `http://localhost:5173/...`. The email
   recipient has no localhost server, so the link errors with
   `ERR_CONNECTION_REFUSED`.
2. **Perplexity Computer preview** — the runtime origin is an internal
   `*.sites.pplx` URL (or worse, a `localhost` proxy origin) that only
   the sandbox can resolve. Mail recipients land on the same dead URL.

`client/src/lib/supabase.ts` → `recoveryRedirectUrl()` now resolves the URL
in this order:

1. `VITE_AUTH_REDIRECT_URL` (preferred, explicit override)
2. `VITE_SITE_URL` (generic fallback)
3. `window.location.origin + pathname` (last resort, for local dev only)

It strips any trailing slash, query, or fragment from the resolved value so
Supabase can append `#access_token=...&type=recovery` cleanly. Deep paths
on the URL are preserved (`/computer/a/<slug>` survives).

### Required Supabase dashboard configuration

In **Supabase → Authentication → URL Configuration**:

- **Site URL** — set to the canonical app URL (eventually `https://donnit.ai`).
- **Redirect URLs** — add every URL that any deployed build will pass as
  `redirect_to`. GoTrue silently rewrites a redirect that is not on this
  allow-list back to Site URL, which is the second-most-common reason
  recovery emails seem to point at the wrong place. Entries to add today:
  - `https://donnit.ai`
  - `https://donnit.ai/*` (covers any sub-path)
  - `https://www.perplexity.ai/computer/a/donnit-mvp-preview-_VxG11WdRGCG2xmRPTxflg`
  - `http://localhost:5173/*` (for local dev only; remove for prod project)

### Per-environment values

| Environment           | `VITE_AUTH_REDIRECT_URL`                                                                  |
|-----------------------|-------------------------------------------------------------------------------------------|
| Production            | `https://donnit.ai`                                                                       |
| Perplexity preview    | `https://www.perplexity.ai/computer/a/donnit-mvp-preview-_VxG11WdRGCG2xmRPTxflg`          |
| Local dev             | (unset — falls back to `window.location.origin`, which is fine when you click the link in the same browser session) |
