-- Donnit Intelligence Layer: persistent observability for LLM sessions,
-- model calls, and tool calls.

create table if not exists donnit.ai_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  user_id uuid references donnit.profiles(id) on delete set null,
  correlation_id text not null unique,
  skill_id text not null,
  feature text not null,
  status text not null default 'started',
  model_policy jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  estimated_cost_usd numeric(12, 8) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ai_sessions_status_check
    check (status in ('started', 'completed', 'failed', 'cancelled'))
);

create table if not exists donnit.ai_model_calls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references donnit.ai_sessions(id) on delete cascade,
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  user_id uuid references donnit.profiles(id) on delete set null,
  correlation_id text not null,
  skill_id text not null,
  provider text not null default 'openai',
  model text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  latency_ms integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  total_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 8) not null default 0,
  status text not null default 'success',
  error_message text,
  created_at timestamptz not null default now(),
  constraint ai_model_calls_status_check
    check (status in ('success', 'failed'))
);

create table if not exists donnit.ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references donnit.ai_sessions(id) on delete cascade,
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  user_id uuid references donnit.profiles(id) on delete set null,
  correlation_id text not null,
  tool_name text not null,
  side_effect text not null,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  latency_ms integer not null default 0,
  status text not null default 'success',
  error_message text,
  created_at timestamptz not null default now(),
  constraint ai_tool_calls_status_check
    check (status in ('success', 'failed', 'permission_denied')),
  constraint ai_tool_calls_side_effect_check
    check (side_effect in ('read', 'write'))
);

create index if not exists donnit_ai_sessions_org_created_idx
  on donnit.ai_sessions (org_id, created_at desc);

create index if not exists donnit_ai_model_calls_session_idx
  on donnit.ai_model_calls (session_id, created_at desc);

create index if not exists donnit_ai_tool_calls_session_idx
  on donnit.ai_tool_calls (session_id, created_at desc);

alter table donnit.ai_sessions enable row level security;
alter table donnit.ai_model_calls enable row level security;
alter table donnit.ai_tool_calls enable row level security;

grant select, insert, update on donnit.ai_sessions to authenticated, service_role;
grant select, insert on donnit.ai_model_calls to authenticated, service_role;
grant select, insert on donnit.ai_tool_calls to authenticated, service_role;

drop policy if exists "donnit members can view ai sessions" on donnit.ai_sessions;
create policy "donnit members can view ai sessions"
  on donnit.ai_sessions for select
  using (donnit.is_org_member(ai_sessions.org_id));

drop policy if exists "donnit members can create ai sessions" on donnit.ai_sessions;
create policy "donnit members can create ai sessions"
  on donnit.ai_sessions for insert
  with check (donnit.is_org_member(ai_sessions.org_id) and user_id = auth.uid());

drop policy if exists "donnit members can update own ai sessions" on donnit.ai_sessions;
create policy "donnit members can update own ai sessions"
  on donnit.ai_sessions for update
  using (donnit.is_org_member(ai_sessions.org_id) and user_id = auth.uid())
  with check (donnit.is_org_member(ai_sessions.org_id) and user_id = auth.uid());

drop policy if exists "donnit members can view ai model calls" on donnit.ai_model_calls;
create policy "donnit members can view ai model calls"
  on donnit.ai_model_calls for select
  using (donnit.is_org_member(ai_model_calls.org_id));

drop policy if exists "donnit members can create ai model calls" on donnit.ai_model_calls;
create policy "donnit members can create ai model calls"
  on donnit.ai_model_calls for insert
  with check (donnit.is_org_member(ai_model_calls.org_id) and user_id = auth.uid());

drop policy if exists "donnit members can view ai tool calls" on donnit.ai_tool_calls;
create policy "donnit members can view ai tool calls"
  on donnit.ai_tool_calls for select
  using (donnit.is_org_member(ai_tool_calls.org_id));

drop policy if exists "donnit members can create ai tool calls" on donnit.ai_tool_calls;
create policy "donnit members can create ai tool calls"
  on donnit.ai_tool_calls for insert
  with check (donnit.is_org_member(ai_tool_calls.org_id) and user_id = auth.uid());

notify pgrst, 'reload schema';
