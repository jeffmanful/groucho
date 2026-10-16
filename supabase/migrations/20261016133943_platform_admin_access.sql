-- Service-only: invitations never grant access until verified-email acceptance.
create table public.platform_admin_access (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(trim(email))),
  user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  token_hash text unique,
  invited_by text not null,
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoked_by text,
  check (status <> 'active' or (user_id is not null and accepted_at is not null)),
  check (status <> 'pending' or token_hash is not null)
);
create unique index platform_admin_access_user on public.platform_admin_access(user_id) where user_id is not null;
alter table public.platform_admin_access enable row level security;
revoke all on public.platform_admin_access from public, anon, authenticated;
grant all on public.platform_admin_access to service_role;
