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
2. `0002_donnit_namespace.sql` — **the migration to apply next.** Creates the
   `donnit` schema and recreates every Donnit-owned table inside it, with the
   same columns, constraints, indexes, and Row Level Security as `0001`,
   plus a couple of extra policies (profile insert, email suggestion insert)
   that were missing. It is non-destructive: no `DROP TABLE`, no `ALTER
   TABLE` of existing public objects, and policies use
   `DROP POLICY IF EXISTS` + `CREATE POLICY` so re-running refreshes them
   cleanly.

> **Action required:** apply `0002_donnit_namespace.sql` from the Supabase SQL
> editor (or `supabase db push` from a trusted environment) before any
> production code is wired against the schema. The repo does not run DDL
> automatically.

## Cleanup of orphaned `public.*` Donnit tables (later, optional)

The `public.organizations`, `public.tasks`, `public.task_events`,
`public.email_suggestions`, and `public.reminder_preferences` tables created
by `0001` are now orphaned (Donnit no longer references them, and Rosterstack
never did). They can be dropped in a later migration once we confirm nothing
external is reading them. **Do not include those drops in `0002`** — keep
`0002` purely additive so it is safe to re-run.

## Code wiring

- `server/supabase.ts` exports `DONNIT_SCHEMA = "donnit"` and a
  `createSupabaseServerClient()` that pins `db.schema` to `donnit`. All
  production reads/writes must go through this client. The client returns
  `null` until `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set, which keeps the
  current SQLite-backed demo behavior intact.
- `DONNIT_TABLES` in the same file is the canonical list of table names —
  prefer it over inline string literals when wiring queries.
- `server/integrations.ts` surfaces the schema name in
  `GET /api/integrations` so the frontend and humans can confirm the wiring
  at a glance.

## Environment

Set these before enabling production Supabase:

```
SUPABASE_PROJECT_ID=bchwrbqaacdijavtugdt
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon key>
```

No schema-related env var is needed — the schema is hard-coded to `donnit`
because changing it would require a coordinated migration.
