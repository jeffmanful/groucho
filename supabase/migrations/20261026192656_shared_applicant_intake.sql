-- Preserve existing artist snapshots while separating intake from conversation audience.
alter table public.sessions rename column applicant_artist_profile to applicant_details;
alter table public.sessions rename constraint sessions_artist_profile_object to sessions_applicant_details_object;
alter table public.sessions add column application_audience text
  check (application_audience in ('community', 'artist'));
update public.sessions set application_audience = 'artist' where applicant_details is not null;
comment on column public.sessions.applicant_details is 'Applicant-supplied city, age, optional artist name and social/music links; separate from model-extracted profile.';
comment on column public.sessions.application_audience is 'Conversation audience; shared intake alone does not imply an artist application.';
