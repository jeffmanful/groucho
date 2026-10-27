-- Append-only decisions with client corrections, and outcomes reported by the client.
-- See docs/client-decision-workspace.md.

-- 1. Decisions are append-only. The current decision for an application is the one that has
--    not been superseded. A correction is a new row that points at the decision it replaces;
--    the replaced row only ever gains superseded_by / superseded_at.
ALTER TABLE public.application_decisions
  ADD COLUMN supersedes_decision_id uuid REFERENCES public.application_decisions (id),
  ADD COLUMN superseded_by uuid REFERENCES public.application_decisions (id) DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN superseded_at timestamptz,
  ADD COLUMN applicant_reason text CHECK (applicant_reason IS NULL OR char_length(applicant_reason) <= 1200);

COMMENT ON COLUMN public.application_decisions.reason IS
  'Internal note for the client''s reviewers.';
COMMENT ON COLUMN public.application_decisions.applicant_reason IS
  'Optional reason the client may share with the applicant. Sent in webhooks; Groucho never sends it to the applicant.';
COMMENT ON COLUMN public.application_decisions.supersedes_decision_id IS
  'Set on a correction: the decision it replaces.';
COMMENT ON COLUMN public.application_decisions.superseded_by IS
  'Set once, when a correction replaces this decision. NULL means this is the current decision.';

-- "First decision wins" now means: one current decision per application, and a decision can be
-- corrected only once (a later correction corrects the correction).
ALTER TABLE public.application_decisions DROP CONSTRAINT application_decisions_one_per_session;
CREATE UNIQUE INDEX application_decisions_current_per_session
  ON public.application_decisions (session_id) WHERE superseded_by IS NULL;
CREATE UNIQUE INDEX application_decisions_supersedes_once
  ON public.application_decisions (supersedes_decision_id) WHERE supersedes_decision_id IS NOT NULL;

ALTER TABLE public.application_decisions
  ADD CONSTRAINT application_decisions_correction_shape CHECK (
    supersedes_decision_id IS NULL OR decision_source = 'human'
  ),
  ADD CONSTRAINT application_decisions_superseded_shape CHECK (
    (superseded_by IS NULL) = (superseded_at IS NULL)
  );

CREATE OR REPLACE FUNCTION public.application_decisions_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only superseded_by/superseded_at may change, once. api_key_id may be cleared when a key is deleted.
  IF (to_jsonb(NEW) - 'superseded_by' - 'superseded_at' - 'api_key_id')
     IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_by' - 'superseded_at' - 'api_key_id') THEN
    RAISE EXCEPTION 'application decisions are append-only; record a correction instead';
  END IF;
  IF OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by THEN
    RAISE EXCEPTION 'this decision has already been corrected';
  END IF;
  IF NEW.api_key_id IS DISTINCT FROM OLD.api_key_id AND NEW.api_key_id IS NOT NULL THEN
    RAISE EXCEPTION 'api_key_id can only be cleared';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER application_decisions_append_only
  BEFORE UPDATE ON public.application_decisions
  FOR EACH ROW EXECUTE FUNCTION public.application_decisions_append_only();

-- The correction itself, atomically: lock the current decision, check it is the one the client
-- saw, mark it superseded and insert the correction.
CREATE OR REPLACE FUNCTION public.correct_application_decision(
  p_session_id uuid,
  p_expected_decision_id uuid,
  p_decision text,
  p_reason text,
  p_applicant_reason text,
  p_reviewer_kind text,
  p_reviewer_user_id uuid,
  p_reviewer_email text,
  p_reviewer_name text,
  p_api_key_id uuid,
  p_access_secret uuid
)
RETURNS SETOF public.application_decisions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current public.application_decisions;
  v_new_id uuid := gen_random_uuid();
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required to correct a decision' USING ERRCODE = 'GR400';
  END IF;

  SELECT * INTO v_current
  FROM public.application_decisions
  WHERE session_id = p_session_id AND superseded_by IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'there is no decision to correct' USING ERRCODE = 'GR404';
  END IF;
  IF v_current.id <> p_expected_decision_id THEN
    RAISE EXCEPTION 'the decision has changed since it was loaded' USING ERRCODE = 'GR409';
  END IF;
  IF v_current.decision = p_decision THEN
    RAISE EXCEPTION 'the correction must change the decision' USING ERRCODE = 'GR422';
  END IF;

  UPDATE public.application_decisions
  SET superseded_by = v_new_id, superseded_at = now()
  WHERE id = v_current.id;

  RETURN QUERY
  INSERT INTO public.application_decisions (
    id, organisation_id, project_id, session_id, decision, decision_source,
    advisory_recommendation, reviewer_kind, reviewer_user_id, reviewer_email, reviewer_name,
    api_key_id, reason, applicant_reason, access_secret, supersedes_decision_id
  ) VALUES (
    v_new_id, v_current.organisation_id, v_current.project_id, v_current.session_id, p_decision, 'human',
    v_current.advisory_recommendation, p_reviewer_kind, p_reviewer_user_id, p_reviewer_email, p_reviewer_name,
    p_api_key_id, btrim(p_reason), NULLIF(btrim(coalesce(p_applicant_reason, '')), ''),
    CASE WHEN p_decision = 'approved' THEN p_access_secret END, v_current.id
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.correct_application_decision(uuid, uuid, text, text, text, text, uuid, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_application_decision(uuid, uuid, text, text, text, text, uuid, text, text, uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.application_decisions_append_only() FROM PUBLIC, anon, authenticated;
GRANT UPDATE (superseded_by, superseded_at) ON public.application_decisions TO service_role;

-- 2. Webhook deliveries for corrections.
ALTER TABLE public.webhook_deliveries DROP CONSTRAINT webhook_deliveries_event_check;
ALTER TABLE public.webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_event_check CHECK (
    (event = 'session.completed' AND verdict_id IS NOT NULL AND decision_id IS NULL)
    OR (event IN ('application.decided', 'application.decision_corrected')
        AND decision_id IS NOT NULL AND verdict_id IS NULL)
  );

-- 3. What happened after the decision, as reported by the client's system. Append-only.
CREATE TABLE public.application_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions (id) ON DELETE CASCADE,
  decision_id uuid REFERENCES public.application_decisions (id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN (
    'invited', 'joined', 'invite_declined', 'no_response', 'active', 'inactive', 'left', 'removed'
  )),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  reported_at timestamptz NOT NULL DEFAULT now(),
  api_key_id uuid REFERENCES public.api_keys (id) ON DELETE SET NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  -- Retries of the same report are ignored.
  CONSTRAINT application_outcomes_once UNIQUE (session_id, outcome, occurred_at)
);

COMMENT ON TABLE public.application_outcomes IS
  'Outcomes the client reports after a decision (invited, joined, active, left...). Groucho never contacts applicants.';

CREATE INDEX application_outcomes_session_idx ON public.application_outcomes (session_id, occurred_at DESC);
CREATE INDEX application_outcomes_project_idx ON public.application_outcomes (project_id, outcome, occurred_at DESC);

ALTER TABLE public.application_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.application_outcomes FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.application_outcomes TO service_role;

-- 4. The review queue reads the current decision and the latest reported outcome.
CREATE OR REPLACE VIEW public.application_review_queue
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.organisation_id,
  s.project_id,
  s.session_id,
  s.status,
  s.created_at,
  s.updated_at,
  s.applicant_email,
  s.applicant_name,
  s.applicant_details,
  s.application_audience,
  s.suitability_score,
  d.decision,
  d.decision_source,
  d.reviewer_kind,
  d.reviewer_email,
  d.reason AS decision_reason,
  d.created_at AS decided_at,
  r.recommendation,
  r.confidence,
  r.report_status,
  r.conversation_model,
  (SELECT count(*) FROM public.messages um WHERE um.session_id = s.id AND um.role = 'user')::integer
    AS answer_count,
  CASE
    WHEN s.status = 'active' THEN 'in_progress'
    WHEN s.status = 'abandoned' THEN 'abandoned'
    WHEN d.decision = 'approved' THEN 'approved'
    WHEN d.decision = 'declined' THEN 'declined'
    WHEN s.suitability_score IS NULL AND r.recommendation IS NULL THEN 'awaiting_assessment'
    ELSE 'ready_for_review'
  END AS queue,
  d.id AS decision_id,
  (d.supersedes_decision_id IS NOT NULL) AS decision_corrected,
  d.reviewer_name,
  d.applicant_reason AS decision_applicant_reason,
  o.outcome AS latest_outcome,
  o.occurred_at AS latest_outcome_at
FROM public.sessions s
LEFT JOIN public.application_decisions d ON d.session_id = s.id AND d.superseded_by IS NULL
LEFT JOIN LATERAL (
  SELECT
    m.metadata -> 'reviewer_report' ->> 'advisory_recommendation' AS recommendation,
    CASE
      WHEN jsonb_typeof(m.metadata -> 'reviewer_report' -> 'confidence_score') = 'number'
        THEN (m.metadata -> 'reviewer_report' ->> 'confidence_score')::numeric
    END AS confidence,
    m.metadata ->> 'colors_demo_report_status' AS report_status,
    m.metadata ->> 'conversation_model' AS conversation_model
  FROM public.messages m
  WHERE m.session_id = s.id AND m.role = 'assistant'
  ORDER BY m.sent_at DESC
  LIMIT 1
) r ON true
LEFT JOIN LATERAL (
  SELECT ao.outcome, ao.occurred_at
  FROM public.application_outcomes ao
  WHERE ao.session_id = s.id
  ORDER BY ao.occurred_at DESC, ao.reported_at DESC
  LIMIT 1
) o ON true;

REVOKE ALL ON public.application_review_queue FROM anon, authenticated;
GRANT SELECT ON public.application_review_queue TO service_role;
