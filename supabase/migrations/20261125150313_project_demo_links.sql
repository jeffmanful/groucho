create table public.project_demo_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  recipient_email text,
  variant text not null check (variant in ('conversation', 'community', 'artist')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  sent_at timestamptz,
  revoked_at timestamptz
);

create index project_demo_links_project_created_idx
  on public.project_demo_links (project_id, created_at desc);

alter table public.project_demo_links enable row level security;
revoke all on table public.project_demo_links from public, anon, authenticated, service_role;
grant select, insert, update on table public.project_demo_links to service_role;
