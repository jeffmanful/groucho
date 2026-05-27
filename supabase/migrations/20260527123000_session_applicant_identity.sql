-- First-class applicant contact envelope for application/gatekeeping flows.
alter table public.sessions
  add column if not exists applicant_email text,
  add column if not exists applicant_name text;

create index if not exists sessions_project_applicant_email_idx
  on public.sessions (project_id, applicant_email)
  where applicant_email is not null;

comment on column public.sessions.applicant_email is
  'Applicant contact email captured before or at session start; stored separately from flow/profile answers.';

comment on column public.sessions.applicant_name is
  'Optional applicant display name captured before or at session start.';
