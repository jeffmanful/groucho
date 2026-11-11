-- Keep persona previews out of review queues, exports and workload metrics.
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
    WHEN s.entry_kind = 'form' THEN 'ready_for_review'
    WHEN s.suitability_score IS NULL AND r.recommendation IS NULL THEN 'awaiting_assessment'
    ELSE 'ready_for_review'
  END AS queue,
  d.id AS decision_id,
  (d.supersedes_decision_id IS NOT NULL) AS decision_corrected,
  d.reviewer_name,
  d.applicant_reason AS decision_applicant_reason,
  o.outcome AS latest_outcome,
  o.occurred_at AS latest_outcome_at,
  s.entry_kind,
  s.entry,
  coalesce(f.email_matches, 1) AS email_matches,
  coalesce(f.phone_matches, 1) AS phone_matches,
  coalesce(f.social_matches, 1) AS social_matches,
  coalesce(de.disposable, false) AS disposable_email,
  ((coalesce(f.email_matches, 1) > 1)::integer + (coalesce(f.phone_matches, 1) > 1)::integer
    + (coalesce(f.social_matches, 1) > 1)::integer + coalesce(de.disposable, false)::integer) AS flag_count
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
) o ON true
LEFT JOIN public.application_entry_flags f ON f.session_id = s.id
LEFT JOIN LATERAL (
  SELECT true AS disposable
  FROM public.disposable_email_domains dd
  WHERE dd.domain = split_part(lower(s.applicant_email), '@', 2)
    AND NOT EXISTS (
      SELECT 1 FROM public.entry_flag_dismissals x
      WHERE x.project_id = s.project_id AND x.kind = 'disposable' AND x.value = dd.domain
    )
) de ON true
WHERE s.profile -> 'persona_preview' IS NULL;


-- Preview snapshots contain a private saved prompt. They are read through the
-- authenticated preview API using the service role, never the public Data API.
CREATE POLICY sessions_hide_persona_previews ON public.sessions
AS RESTRICTIVE FOR SELECT TO anon, authenticated
USING (profile -> 'persona_preview' IS NULL);

CREATE POLICY messages_hide_persona_previews ON public.messages
AS RESTRICTIVE FOR SELECT TO anon, authenticated
USING (EXISTS (
  SELECT 1 FROM public.sessions s
  WHERE s.id = messages.session_id
    AND s.profile -> 'persona_preview' IS NULL
));
