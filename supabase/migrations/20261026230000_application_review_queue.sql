-- One row per application with its review queue, decision and assessment summary, so the
-- dashboard can filter, count and sort the full project dataset on the server.
-- Read only through authenticated server routes (service role), like the tables it joins.

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
  END AS queue
FROM public.sessions s
LEFT JOIN public.application_decisions d ON d.session_id = s.id
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
) r ON true;

COMMENT ON VIEW public.application_review_queue IS
  'Dashboard review queue: in_progress, abandoned, awaiting_assessment, ready_for_review, approved, declined.';

REVOKE ALL ON public.application_review_queue FROM anon, authenticated;
GRANT SELECT ON public.application_review_queue TO service_role;
