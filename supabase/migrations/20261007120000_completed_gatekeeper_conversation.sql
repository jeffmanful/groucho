-- A conversation may finish before its private assessment is available.
ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_status_check;

ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_status_check
  CHECK (status IN ('active', 'passed', 'failed', 'redirected', 'rejected', 'abandoned', 'completed'));
