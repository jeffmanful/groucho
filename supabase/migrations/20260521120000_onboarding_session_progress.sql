-- Onboarding session progress and extracted profile on sessions row.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS current_step_id text,
  ADD COLUMN IF NOT EXISTS flow_version text,
  ADD COLUMN IF NOT EXISTS profile jsonb;

COMMENT ON COLUMN public.sessions.current_step_id IS
  'Active onboarding step id from project flow_config; null when not started or completed.';

COMMENT ON COLUMN public.sessions.flow_version IS
  'Snapshot of flow_config.version when the onboarding session started.';

COMMENT ON COLUMN public.sessions.profile IS
  'Final structured profile JSON for onboarding (and optional gatekeeper mirror).';

CREATE INDEX IF NOT EXISTS idx_sessions_current_step_id
  ON public.sessions (project_id, current_step_id)
  WHERE current_step_id IS NOT NULL;
