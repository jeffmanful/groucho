-- Durable terminal-session work queue. The applicant-facing close is persisted
-- before this job is enqueued; profile extraction, verdict creation, webhook
-- preparation, and cultural-signal writes run outside the response path.

CREATE TABLE public.session_completion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions (id) ON DELETE CASCADE,
  likely_bot boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 8,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_completion_jobs_one_per_session UNIQUE (session_id)
);

CREATE INDEX idx_session_completion_jobs_pending
  ON public.session_completion_jobs (next_retry_at, created_at)
  WHERE status = 'pending';
CREATE INDEX idx_session_completion_jobs_stale_processing
  ON public.session_completion_jobs (locked_at)
  WHERE status = 'processing';
CREATE INDEX idx_session_completion_jobs_organisation
  ON public.session_completion_jobs (organisation_id);
CREATE INDEX idx_session_completion_jobs_project
  ON public.session_completion_jobs (project_id);

ALTER TABLE public.session_completion_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.session_completion_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.claim_session_completion_jobs(p_limit int DEFAULT 10)
RETURNS SETOF public.session_completion_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.session_completion_jobs
    WHERE attempt_count < max_attempts
      AND (
        (status = 'pending' AND next_retry_at <= now())
        OR (status = 'processing' AND locked_at < now() - interval '5 minutes')
      )
    ORDER BY next_retry_at ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 10), 50))
  )
  UPDATE public.session_completion_jobs AS jobs
  SET status = 'processing',
      attempt_count = jobs.attempt_count + 1,
      locked_at = now(),
      updated_at = now(),
      last_error = NULL
  FROM candidates
  WHERE jobs.id = candidates.id
  RETURNING jobs.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_session_completion_jobs(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_session_completion_jobs(int) TO service_role;
