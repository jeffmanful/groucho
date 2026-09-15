-- Client-owned decision policy.
--
-- Groucho produces a suitability score. A deterministic project policy may turn
-- that score into an approval or decline when the corresponding client switch is
-- enabled. Both switches default to off in application settings.

ALTER TABLE public.sessions
  ADD COLUMN suitability_score numeric
    CHECK (suitability_score >= 0 AND suitability_score <= 1);

CREATE INDEX sessions_project_suitability_idx
  ON public.sessions (project_id, suitability_score DESC NULLS LAST, created_at DESC);

COMMENT ON COLUMN public.sessions.suitability_score IS
  'Final Groucho overall suitability score, retained separately from client decision policy.';

ALTER TABLE public.application_decisions
  ADD COLUMN decision_source text NOT NULL DEFAULT 'human'
    CHECK (decision_source IN ('human', 'policy')),
  ADD COLUMN suitability_score numeric
    CHECK (suitability_score >= 0 AND suitability_score <= 1),
  ADD COLUMN policy_snapshot jsonb;

ALTER TABLE public.application_decisions
  DROP CONSTRAINT IF EXISTS application_decisions_reviewer_kind_check,
  DROP CONSTRAINT IF EXISTS application_decisions_reviewer_identity;

ALTER TABLE public.application_decisions
  ADD CONSTRAINT application_decisions_reviewer_kind_check
    CHECK (reviewer_kind IN ('platform', 'member', 'policy')),
  ADD CONSTRAINT application_decisions_reviewer_identity CHECK (
    (decision_source = 'human' AND reviewer_kind = 'platform' AND reviewer_email IS NOT NULL)
    OR (decision_source = 'human' AND reviewer_kind = 'member' AND reviewer_user_id IS NOT NULL)
    OR (
      decision_source = 'policy'
      AND reviewer_kind = 'policy'
      AND reviewer_user_id IS NULL
      AND reviewer_email IS NULL
      AND suitability_score IS NOT NULL
      AND policy_snapshot IS NOT NULL
    )
  );

COMMENT ON TABLE public.application_decisions IS
  'Immutable client decisions. Human reviewers or an explicitly enabled deterministic project policy may create rows; model outputs cannot.';
COMMENT ON COLUMN public.application_decisions.decision_source IS
  'human for an explicit reviewer action; policy for a deterministic client-configured automatic action.';
COMMENT ON COLUMN public.application_decisions.suitability_score IS
  'Groucho overall suitability score used by the client policy, when decision_source is policy.';
COMMENT ON COLUMN public.application_decisions.policy_snapshot IS
  'Immutable snapshot of the client decision policy used for an automatic decision.';
COMMENT ON COLUMN public.application_decisions.access_secret IS
  'Created for any approval and required by the applicant access endpoint.';
