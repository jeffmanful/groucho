-- Applicant-supplied facts, separate from model-extracted session profiles.
-- Existing sessions RLS and server-only write paths continue to apply.
alter table public.sessions
  add column if not exists applicant_artist_profile jsonb;

alter table public.sessions
  add constraint sessions_artist_profile_object
  check (applicant_artist_profile is null or jsonb_typeof(applicant_artist_profile) = 'object');

comment on column public.sessions.applicant_artist_profile is
  'Optional structured artist intake: city, age, artistName, socialLinks and musicLinks. Not model-inferred.';
