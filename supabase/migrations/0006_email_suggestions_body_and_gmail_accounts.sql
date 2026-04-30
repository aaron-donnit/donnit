-- Donnit: extend email_suggestions with full email content + add gmail_accounts.
--
-- Background:
--   The Scan email function must read unread Gmail itself and surface the
--   sender, email date, body/preview, and extracted action items so users can
--   approve a suggestion with full context. The previous schema only stored a
--   short preview, no body, no received_at, and no action items list. We
--   extend `donnit.email_suggestions` with three nullable text/json columns
--   that the application populates on insert.
--
--   We also introduce `donnit.gmail_accounts`, the token-storage table for the
--   first-party Gmail OAuth path. The hosted Perplexity Computer preview
--   sometimes cannot reach the platform connector's runtime token; the OAuth
--   path lets a production deploy scan Gmail directly using credentials the
--   operator configures (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
--   GOOGLE_REDIRECT_URI). Tokens are kept server-side, never exposed to the
--   client.
--
-- Apply order:
--   - This migration runs after 0005. It is non-destructive: only adds new
--     columns (with safe defaults / nullable) and creates a brand-new table.
--   - Re-runnable: every CREATE / ALTER uses IF NOT EXISTS guards.
--
-- DO NOT APPLY YET in production without confirming the env wiring described
-- in docs/GMAIL_OAUTH.md is ready. Adding the columns alone is safe; the
-- gmail_accounts table only does work once OAuth env vars are configured.

-- ---------------------------------------------------------------------------
-- 1. Extend donnit.email_suggestions with body / received_at / action_items.
-- ---------------------------------------------------------------------------

alter table donnit.email_suggestions
  add column if not exists body text not null default '';

alter table donnit.email_suggestions
  add column if not exists received_at timestamptz;

alter table donnit.email_suggestions
  add column if not exists action_items jsonb not null default '[]'::jsonb;

comment on column donnit.email_suggestions.body is
  'Sanitized plain-text body of the email (HTML stripped, signatures/quotes trimmed). Capped at 4000 chars by the application before insert.';
comment on column donnit.email_suggestions.received_at is
  'Original send/received timestamp parsed from Gmail Date header or internalDate.';
comment on column donnit.email_suggestions.action_items is
  'Heuristically-extracted action item strings (max 5, each ≤ 200 chars). JSON array of strings.';

-- ---------------------------------------------------------------------------
-- 2. donnit.gmail_accounts — server-side OAuth token storage.
-- ---------------------------------------------------------------------------
--
-- One row per (user, org) Gmail connection. We deliberately key on user_id
-- (not org_id) for the primary key so each Donnit user can connect a personal
-- Gmail. The org_id is stored for visibility/cleanup but is not part of the
-- key. Tokens are stored as plain text — production deployments SHOULD wrap
-- the access_token / refresh_token columns with pgsodium-based encryption
-- (see docs/GMAIL_OAUTH.md "Encrypting tokens" section). We do NOT enable
-- pgsodium in this migration to keep it minimal and reversible.

create table if not exists donnit.gmail_accounts (
  user_id uuid primary key references donnit.profiles(id) on delete cascade,
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  email text not null,
  access_token text not null,
  refresh_token text,
  scope text not null default '',
  token_type text not null default 'Bearer',
  expires_at timestamptz not null,
  connected_at timestamptz not null default now(),
  last_scanned_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'revoked', 'error'))
);

create index if not exists donnit_gmail_accounts_org_idx
  on donnit.gmail_accounts (org_id);

alter table donnit.gmail_accounts enable row level security;

-- Policy: only the row owner (donnit user) may read/write their own token row.
-- The server already proxies all Gmail API calls; clients are never given the
-- raw token. RLS still defends against accidental cross-user access if a
-- service-role bug is ever introduced.
drop policy if exists "donnit users can manage own gmail account" on donnit.gmail_accounts;
create policy "donnit users can manage own gmail account"
  on donnit.gmail_accounts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table donnit.gmail_accounts is
  'First-party Gmail OAuth tokens. Read/written only by the server. RLS gates per-user access.';
