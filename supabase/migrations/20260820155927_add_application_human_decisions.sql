-- Human-owned application decisions.
--
-- Gatekeeper terminal values and reviewer recommendations remain advisory. Only
-- an explicit decision recorded here may authorize the access flow.

CREATE TABLE public.application_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions (id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved', 'declined')),
  advisory_recommendation text CHECK (
    advisory_recommendation IS NULL
    OR advisory_recommendation IN ('recommend', 'human_review', 'decline')
  ),
  reviewer_kind text NOT NULL CHECK (reviewer_kind IN ('platform', 'member')),
  reviewer_user_id uuid,
  reviewer_email text,
  reason text,
  access_secret uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_decisions_one_per_session UNIQUE (session_id),
  CONSTRAINT application_decisions_reviewer_identity CHECK (
    (reviewer_kind = 'platform' AND reviewer_email IS NOT NULL)
    OR (reviewer_kind = 'member' AND reviewer_user_id IS NOT NULL)
  ),
  CONSTRAINT application_decisions_access_secret CHECK (
    (decision = 'approved' AND access_secret IS NOT NULL)
    OR (decision = 'declined' AND access_secret IS NULL)
  )
);

COMMENT ON TABLE public.application_decisions IS
  'Immutable human approval or decline. Model outcomes and reviewer reports cannot create these rows.';
COMMENT ON COLUMN public.application_decisions.advisory_recommendation IS
  'Optional snapshot of Groucho''s advisory recommendation at the time of human review.';
COMMENT ON COLUMN public.application_decisions.access_secret IS
  'Created only for human approval and required by the applicant access endpoint.';

CREATE INDEX application_decisions_project_created_idx
  ON public.application_decisions (project_id, created_at DESC);

ALTER TABLE public.application_decisions ENABLE ROW LEVEL SECURITY;

-- All reads and writes currently pass through authenticated server routes using
-- the service role. Do not expose human decisions or access secrets directly to
-- anon/authenticated Data API clients.
REVOKE ALL ON TABLE public.application_decisions FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.application_decisions TO service_role;
