-- Profile/admin updates must not make an inactive conversation look active.
-- Prefer the latest message timestamp, falling back to the session timestamp
-- only for rows that have no messages.

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
