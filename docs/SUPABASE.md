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
3. `0003_donnit_bootstrap_policies.sql` — **the migration to apply next.**
   Adds `donnit.bootstrap_workspace(...)` (a `SECURITY DEFINER` RPC that the
   freshly signed-up user calls once to create their profile, default org,
   owner-membership row, and reminder preferences in a single atomic step).
   It also adds three narrow INSERT/UPDATE policies that allow a user to do
   this directly via REST in case the RPC is unavailable. Idempotent —
   `CREATE OR REPLACE FUNCTION` and `DROP POLICY IF EXISTS`.

> **Action required:** apply `0002_donnit_namespace.sql` and
> `0003_donnit_bootstrap_policies.sql` from the Supabase SQL editor (or
> `supabase db push`) before authenticated production code can run. The repo
> does not run DDL automatically.
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
- `client/src/lib/supabase.ts` builds the browser-safe Supabase client. It
  detects sandboxes that block `localStorage` and falls back to in-memory
  session storage; in those previews the user must sign in again after a
  reload (see banner in the auth screen).
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
```

No schema-related env var is needed — the schema is hard-coded to `donnit`
because changing it would require a coordinated migration. The anon key is
public by design and paired with RLS; never put a service role key in any
file checked into the repo.
