create table public.saved_project_conversation_previews (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null check (status in ('active', 'completed')),
  answer_count integer not null check (answer_count > 0),
  config jsonb not null,
  reply_style text check (reply_style in ('direct', 'acknowledge')),
  transcript jsonb not null,
  signal_evidence jsonb,
  settings_conflict text
);

create index saved_project_conversation_previews_project_created_idx
  on public.saved_project_conversation_previews (project_id, created_at desc);

alter table public.saved_project_conversation_previews enable row level security;
revoke all on table public.saved_project_conversation_previews from public, anon, authenticated, service_role;
grant select, insert on table public.saved_project_conversation_previews to service_role;
