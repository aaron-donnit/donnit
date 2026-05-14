-- Donnit Task Memory attachments: private Supabase Storage plus metadata.
--
-- Files are stored in a private bucket. Donnit routes access through the
-- server so profile owner, delegate, manager, and admin permissions can be
-- enforced consistently before generating a signed URL.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'donnit-task-memory-attachments',
  'donnit-task-memory-attachments',
  false,
  25000000,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'text/markdown',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists donnit.position_profile_task_memory_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references donnit.organizations(id) on delete cascade,
  position_profile_id uuid not null references donnit.position_profiles(id) on delete cascade,
  task_memory_id uuid not null references donnit.position_profile_task_memories(id) on delete cascade,
  bucket_id text not null default 'donnit-task-memory-attachments',
  storage_path text not null,
  file_name text not null,
  content_type text not null default 'application/octet-stream',
  file_size integer not null default 0,
  kind text not null default 'Other',
  uploaded_by uuid references donnit.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint position_profile_task_memory_attachments_kind_check
    check (kind in ('Document', 'Image', 'Spreadsheet', 'Other')),
  constraint position_profile_task_memory_attachments_size_check
    check (file_size >= 0 and file_size <= 25000000),
  constraint position_profile_task_memory_attachments_bucket_check
    check (bucket_id = 'donnit-task-memory-attachments')
);

create unique index if not exists donnit_task_memory_attachments_path_idx
  on donnit.position_profile_task_memory_attachments (bucket_id, storage_path);

create index if not exists donnit_task_memory_attachments_memory_idx
  on donnit.position_profile_task_memory_attachments (org_id, task_memory_id, created_at desc);

alter table donnit.position_profile_task_memory_attachments enable row level security;

grant select, insert, update, delete on donnit.position_profile_task_memory_attachments to authenticated, service_role;

drop policy if exists "donnit members can view task memory attachments" on donnit.position_profile_task_memory_attachments;
create policy "donnit members can view task memory attachments"
  on donnit.position_profile_task_memory_attachments for select
  using (donnit.is_org_member(position_profile_task_memory_attachments.org_id));

drop policy if exists "donnit admins can manage task memory attachments" on donnit.position_profile_task_memory_attachments;
create policy "donnit admins can manage task memory attachments"
  on donnit.position_profile_task_memory_attachments for all
  using (donnit.is_org_admin(position_profile_task_memory_attachments.org_id))
  with check (donnit.is_org_admin(position_profile_task_memory_attachments.org_id));

drop policy if exists "donnit members can read task memory storage objects" on storage.objects;
create policy "donnit members can read task memory storage objects"
  on storage.objects for select
  using (
    bucket_id = 'donnit-task-memory-attachments'
    and exists (
      select 1
      from donnit.position_profile_task_memory_attachments attachment
      where attachment.bucket_id = storage.objects.bucket_id
        and attachment.storage_path = storage.objects.name
        and donnit.is_org_member(attachment.org_id)
    )
  );

notify pgrst, 'reload schema';
