-- Close sessions that have seen no message activity for 72 hours.
-- `abandoned` is terminal, but intentionally does not create a verdict or webhook.

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_status_check;

ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_status_check
  CHECK (status IN ('active', 'passed', 'failed', 'redirected', 'rejected', 'abandoned'));

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS profile_extracted_at timestamptz;

COMMENT ON COLUMN public.sessions.profile_extracted_at IS
  'Most recent successful or failed profile extraction attempt stored in sessions.profile.';

CREATE INDEX IF NOT EXISTS idx_sessions_active_updated_at
  ON public.sessions (updated_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_messages_session_sent_at
  ON public.messages (session_id, sent_at DESC);

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.abandon_stale_sessions(
  p_before timestamptz DEFAULT (now() - interval '72 hours')
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.sessions AS s
  SET status = 'abandoned'
  WHERE s.status = 'active'
    AND s.updated_at < p_before
    AND COALESCE(
      (
        SELECT MAX(m.sent_at)
        FROM public.messages AS m
        WHERE m.session_id = s.id
      ),
      s.updated_at,
      s.created_at
    ) < p_before;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION private.abandon_stale_sessions(timestamptz)
  FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'abandon-stale-sessions',
  '17 * * * *',
  'SELECT private.abandon_stale_sessions()'
);

-- Resolve existing stale rows immediately; subsequent runs are hourly.
SELECT private.abandon_stale_sessions();
