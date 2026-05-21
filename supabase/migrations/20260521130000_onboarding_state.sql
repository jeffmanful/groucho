-- Track per-step follow-up state for onboarding intelligence.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS onboarding_state jsonb;

COMMENT ON COLUMN public.sessions.onboarding_state IS
  'Onboarding sub-state, e.g. { "followup_step_id": "intent" } while awaiting a follow-up answer.';
