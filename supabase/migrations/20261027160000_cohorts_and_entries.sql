-- Entries, duplicate flags, bulk review, rounds, cohorts and draws.
-- See docs/client-decision-workspace.md (Cohorts, Rounds, Ballots, Drops).

-- 1. Entries without a conversation (drops), and what was entered.
ALTER TABLE public.sessions
  ADD COLUMN entry_kind text NOT NULL DEFAULT 'conversation'
    CHECK (entry_kind IN ('conversation', 'form')),
  ADD COLUMN entry jsonb CHECK (entry IS NULL OR jsonb_typeof(entry) = 'object');

COMMENT ON COLUMN public.sessions.entry_kind IS
  'conversation: an applicant conversation. form: an entry submitted without a conversation (for example a drop).';
COMMENT ON COLUMN public.sessions.entry IS
  'What an entrant submitted beyond name and email: { phone, socials: [], fields: { size: "UK 8" } }.';

-- 2. Identifiers used to flag likely duplicates within a project.
CREATE TABLE public.entry_identifiers (
  session_id uuid NOT NULL REFERENCES public.sessions (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email', 'phone', 'social')),
  value text NOT NULL,
  PRIMARY KEY (session_id, kind, value)
);
CREATE INDEX entry_identifiers_lookup ON public.entry_identifiers (project_id, kind, value);

CREATE OR REPLACE FUNCTION public.entry_identifier_values(p_email text, p_details jsonb, p_entry jsonb)
RETURNS TABLE (kind text, value text)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH socials AS (
    SELECT link FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p_entry -> 'socials') = 'array' THEN p_entry -> 'socials' ELSE '[]'::jsonb END
    ) AS link
    UNION
    SELECT link FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p_details -> 'socialLinks') = 'array' THEN p_details -> 'socialLinks' ELSE '[]'::jsonb END
    ) AS link
  )
  SELECT 'email', lower(btrim(p_email)) WHERE coalesce(btrim(p_email), '') <> ''
  UNION
  -- The last 10 digits, so "+44 7700 900482" and "07700 900482" match. A flag for review, not a verdict.
  SELECT 'phone', right(digits, 10)
  FROM (SELECT regexp_replace(coalesce(p_entry ->> 'phone', ''), '\D', '', 'g') AS digits) p
  WHERE length(digits) >= 9
  UNION
  SELECT 'social', normalised
  FROM (
    SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      lower(btrim(link)), '^https?://', ''), '^www\.', ''), '[?#].*$', ''), '/+$', '') AS normalised
    FROM socials
  ) s
  WHERE normalised <> '';
$$;

CREATE OR REPLACE FUNCTION public.refresh_entry_identifiers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.entry_identifiers WHERE session_id = NEW.id;
  INSERT INTO public.entry_identifiers (session_id, project_id, kind, value)
  SELECT NEW.id, NEW.project_id, v.kind, v.value
  FROM public.entry_identifier_values(NEW.applicant_email, NEW.applicant_details, NEW.entry) v
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sessions_entry_identifiers
  AFTER INSERT OR UPDATE OF applicant_email, applicant_details, entry ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.refresh_entry_identifiers();

INSERT INTO public.entry_identifiers (session_id, project_id, kind, value)
SELECT s.id, s.project_id, v.kind, v.value
FROM public.sessions s
CROSS JOIN LATERAL public.entry_identifier_values(s.applicant_email, s.applicant_details, s.entry) v
ON CONFLICT DO NOTHING;

-- Known disposable email providers. Matching one is a flag for review, not a verdict.
CREATE TABLE public.disposable_email_domains (domain text PRIMARY KEY);
INSERT INTO public.disposable_email_domains (domain) VALUES
  ('mailinator.com'), ('guerrillamail.com'), ('guerrillamail.net'), ('sharklasers.com'),
  ('10minutemail.com'), ('temp-mail.org'), ('tempmail.com'), ('tempmail.net'), ('tempail.com'),
  ('yopmail.com'), ('trashmail.com'), ('getnada.com'), ('dispostable.com'), ('maildrop.cc'),
  ('throwawaymail.com'), ('fakeinbox.com'), ('mintemail.com'), ('mohmal.com'), ('emailondeck.com'),
  ('burnermail.io'), ('mailnesia.com'), ('tempr.email'), ('discard.email'), ('mailcatch.com'),
  ('inboxkitten.com'), ('spamgourmet.com'), ('moakt.com'), ('emailfake.com'), ('tempinbox.com')
ON CONFLICT DO NOTHING;

-- A reviewer can say a match is not a duplicate (a shared family phone, a disposable address the
-- client accepts). Dismissed matches no longer flag anyone in that project.
CREATE TABLE public.entry_flag_dismissals (
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email', 'phone', 'social', 'disposable')),
  value text NOT NULL,
  dismissed_by_email text,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 1200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, kind, value)
);

-- Matches per entry. Entries already declined don't count, so declining duplicates clears the flag
-- on the one that was kept.
CREATE VIEW public.application_entry_flags
WITH (security_invoker = true) AS
SELECT
  i.session_id,
  coalesce(max(c.n) FILTER (WHERE i.kind = 'email'), 1) AS email_matches,
  coalesce(max(c.n) FILTER (WHERE i.kind = 'phone'), 1) AS phone_matches,
  coalesce(max(c.n) FILTER (WHERE i.kind = 'social'), 1) AS social_matches
FROM public.entry_identifiers i
CROSS JOIN LATERAL (
  SELECT count(*)::integer AS n
  FROM public.entry_identifiers j
  WHERE j.project_id = i.project_id AND j.kind = i.kind AND j.value = i.value
    AND NOT EXISTS (
      SELECT 1 FROM public.application_decisions d
      WHERE d.session_id = j.session_id AND d.superseded_by IS NULL AND d.decision = 'declined'
    )
) c
WHERE NOT EXISTS (
  SELECT 1 FROM public.entry_flag_dismissals x
  WHERE x.project_id = i.project_id AND x.kind = i.kind AND x.value = i.value
)
GROUP BY i.session_id;

-- 3. The review queue: form entries are ready to review straight away, and each row carries its flags.
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
) de ON true;

-- 4. Bulk decisions: many entries approved or declined at once, first decision wins.
CREATE OR REPLACE FUNCTION public.bulk_record_decisions(
  p_project_id uuid,
  p_session_ids uuid[],
  p_decision text,
  p_reason text,
  p_applicant_reason text,
  p_reviewer_kind text,
  p_reviewer_user_id uuid,
  p_reviewer_email text
)
RETURNS TABLE (id uuid, session_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_decision NOT IN ('approved', 'declined') THEN
    RAISE EXCEPTION 'decision must be approved or declined' USING ERRCODE = 'GR400';
  END IF;
  IF p_decision = 'declined' AND coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'a reason is required to decline' USING ERRCODE = 'GR400';
  END IF;
  RETURN QUERY
  INSERT INTO public.application_decisions AS ad (
    organisation_id, project_id, session_id, decision, decision_source, reviewer_kind,
    reviewer_user_id, reviewer_email, reason, applicant_reason, access_secret
  )
  SELECT s.organisation_id, s.project_id, s.id, p_decision, 'human', p_reviewer_kind,
    p_reviewer_user_id, p_reviewer_email, NULLIF(btrim(coalesce(p_reason, '')), ''),
    NULLIF(btrim(coalesce(p_applicant_reason, '')), ''),
    CASE WHEN p_decision = 'approved' THEN gen_random_uuid() END
  FROM public.sessions s
  WHERE s.id = ANY (p_session_ids)
    AND s.project_id = p_project_id
    AND s.status IN ('passed', 'failed', 'redirected', 'rejected', 'completed')
    AND NOT EXISTS (
      SELECT 1 FROM public.application_decisions d WHERE d.session_id = s.id AND d.superseded_by IS NULL
    )
  ON CONFLICT DO NOTHING
  RETURNING ad.id, ad.session_id;
END;
$$;

-- 5. Rounds and cohorts.
CREATE TABLE public.allocation_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  opens_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at)
);
CREATE INDEX allocation_rounds_project_idx ON public.allocation_rounds (project_id, created_at DESC);
COMMENT ON TABLE public.allocation_rounds IS
  'An intake or drop. Cohorts and capacity belong to a round; every project gets one when it first uses cohorts.';

CREATE TABLE public.cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES public.allocation_rounds (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  grants_access boolean NOT NULL DEFAULT false,
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  fill_order text NOT NULL DEFAULT 'none' CHECK (fill_order IN ('none', 'score', 'date', 'draw', 'manual')),
  refills_cohort_id uuid REFERENCES public.cohorts (id) ON DELETE SET NULL,
  locked_at timestamptz,
  locked_by_email text,
  drawn_at timestamptz,
  position integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cohorts_round_name ON public.cohorts (round_id, lower(btrim(name))) WHERE archived_at IS NULL;
CREATE INDEX cohorts_project_idx ON public.cohorts (project_id);
COMMENT ON COLUMN public.cohorts.grants_access IS
  'Only cohorts that grant access issue an access secret. Once a project has cohorts, approval alone no longer grants access.';

CREATE TABLE public.allocation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES public.allocation_rounds (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('select', 'everyone', 'filter', 'random', 'score', 'draw', 'remove', 'lock', 'unlock', 'api')),
  source_cohort_id uuid REFERENCES public.cohorts (id) ON DELETE SET NULL,
  target_cohort_id uuid REFERENCES public.cohorts (id) ON DELETE SET NULL,
  rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  moved integer NOT NULL DEFAULT 0,
  actor_kind text NOT NULL CHECK (actor_kind IN ('platform', 'member', 'api')),
  actor_user_id uuid,
  actor_email text,
  api_key_id uuid REFERENCES public.api_keys (id) ON DELETE SET NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 1200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX allocation_runs_round_idx ON public.allocation_runs (round_id, created_at DESC);
COMMENT ON TABLE public.allocation_runs IS
  'Every allocation action (fill, move, draw, lock), with the rule and inputs used. Append-only.';

-- Where each person is now: one cohort per round.
CREATE TABLE public.cohort_members (
  round_id uuid NOT NULL REFERENCES public.allocation_rounds (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions (id) ON DELETE CASCADE,
  cohort_id uuid NOT NULL REFERENCES public.cohorts (id) ON DELETE CASCADE,
  position integer,
  access_secret uuid,
  run_id uuid NOT NULL REFERENCES public.allocation_runs (id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, session_id)
);
CREATE INDEX cohort_members_cohort_idx ON public.cohort_members (cohort_id, position);
CREATE INDEX cohort_members_session_idx ON public.cohort_members (session_id);

-- Every move, for history and events. Append-only.
CREATE TABLE public.cohort_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.allocation_runs (id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES public.allocation_rounds (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions (id) ON DELETE CASCADE,
  from_cohort_id uuid REFERENCES public.cohorts (id) ON DELETE SET NULL,
  to_cohort_id uuid REFERENCES public.cohorts (id) ON DELETE SET NULL,
  position integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cohort_moves_session_idx ON public.cohort_moves (session_id, created_at);
CREATE INDEX cohort_moves_run_idx ON public.cohort_moves (run_id);

-- Move people into a cohort (or out of all cohorts when p_target_cohort_id is null). Only approved
-- applications can be placed. Locked cohorts can't gain or lose people except through a draw.
CREATE OR REPLACE FUNCTION public.allocate_to_cohort(
  p_round_id uuid,
  p_session_ids uuid[],
  p_target_cohort_id uuid,
  p_kind text,
  p_rule jsonb,
  p_source_cohort_id uuid,
  p_actor_kind text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_api_key_id uuid,
  p_reason text
)
RETURNS TABLE (run_id uuid, moved integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_round public.allocation_rounds;
  v_target public.cohorts;
  v_ids uuid[];
  v_run uuid;
  v_count integer;
  v_taken integer;
BEGIN
  SELECT * INTO v_round FROM public.allocation_rounds WHERE id = p_round_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'round not found' USING ERRCODE = 'GR404'; END IF;

  IF p_target_cohort_id IS NOT NULL THEN
    SELECT * INTO v_target FROM public.cohorts WHERE id = p_target_cohort_id FOR UPDATE;
    IF NOT FOUND OR v_target.round_id <> p_round_id OR v_target.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'cohort not found' USING ERRCODE = 'GR404';
    END IF;
    IF v_target.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'This cohort is locked. Unlock it to add people.' USING ERRCODE = 'GR423';
    END IF;
  END IF;

  -- Distinct ids, without the people already in the target.
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_ids
  FROM unnest(p_session_ids) AS x
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cohort_members m
    WHERE m.round_id = p_round_id AND m.session_id = x
      AND m.cohort_id IS NOT DISTINCT FROM p_target_cohort_id
  );
  IF p_target_cohort_id IS NULL THEN
    SELECT coalesce(array_agg(x), '{}') INTO v_ids FROM unnest(v_ids) AS x
    WHERE EXISTS (SELECT 1 FROM public.cohort_members m WHERE m.round_id = p_round_id AND m.session_id = x);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cohort_members m JOIN public.cohorts c ON c.id = m.cohort_id
    WHERE m.round_id = p_round_id AND m.session_id = ANY (v_ids) AND c.locked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Some of these people are in a locked cohort. Unlock it first.' USING ERRCODE = 'GR423';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.sessions s
  JOIN public.application_decisions d ON d.session_id = s.id AND d.superseded_by IS NULL AND d.decision = 'approved'
  WHERE s.id = ANY (v_ids) AND s.project_id = v_round.project_id;
  IF v_count <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Only approved applications can be placed in a cohort.' USING ERRCODE = 'GR422';
  END IF;

  IF p_target_cohort_id IS NOT NULL AND v_target.capacity IS NOT NULL THEN
    SELECT count(*) INTO v_taken FROM public.cohort_members WHERE cohort_id = p_target_cohort_id;
    IF v_taken + cardinality(v_ids) > v_target.capacity THEN
      RAISE EXCEPTION 'Not enough places: % of % taken, % to add.', v_taken, v_target.capacity, cardinality(v_ids)
        USING ERRCODE = 'GR409';
    END IF;
  END IF;

  INSERT INTO public.allocation_runs (
    organisation_id, project_id, round_id, kind, source_cohort_id, target_cohort_id, rule, moved,
    actor_kind, actor_user_id, actor_email, api_key_id, reason
  ) VALUES (
    v_round.organisation_id, v_round.project_id, p_round_id, p_kind, p_source_cohort_id, p_target_cohort_id,
    coalesce(p_rule, '{}'::jsonb), cardinality(v_ids), p_actor_kind, p_actor_user_id, p_actor_email, p_api_key_id,
    NULLIF(btrim(coalesce(p_reason, '')), '')
  ) RETURNING id INTO v_run;

  INSERT INTO public.cohort_moves (run_id, round_id, session_id, from_cohort_id, to_cohort_id)
  SELECT v_run, p_round_id, x, m.cohort_id, p_target_cohort_id
  FROM unnest(v_ids) AS x
  LEFT JOIN public.cohort_members m ON m.round_id = p_round_id AND m.session_id = x;

  IF p_target_cohort_id IS NULL THEN
    DELETE FROM public.cohort_members WHERE round_id = p_round_id AND session_id = ANY (v_ids);
  ELSE
    INSERT INTO public.cohort_members (round_id, session_id, cohort_id, position, access_secret, run_id)
    SELECT p_round_id, x, p_target_cohort_id, NULL,
      CASE WHEN v_target.grants_access THEN gen_random_uuid() END, v_run
    FROM unnest(v_ids) AS x
    ON CONFLICT (round_id, session_id) DO UPDATE
      SET cohort_id = EXCLUDED.cohort_id, position = NULL, access_secret = EXCLUDED.access_secret,
          run_id = EXCLUDED.run_id, added_at = now();
  END IF;

  RETURN QUERY SELECT v_run, cardinality(v_ids);
END;
$$;

-- A draw from a locked cohort: winners (in draw order) into one cohort, optionally everyone else
-- (in draw order) into another. A cohort can be drawn from once.
CREATE OR REPLACE FUNCTION public.draw_cohort(
  p_source_cohort_id uuid,
  p_target_cohort_id uuid,
  p_winner_ids uuid[],
  p_rest_cohort_id uuid,
  p_rest_ids uuid[],
  p_rule jsonb,
  p_actor_kind text,
  p_actor_user_id uuid,
  p_actor_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source public.cohorts;
  v_target public.cohorts;
  v_rest public.cohorts;
  v_members integer;
  v_taken integer;
  v_run uuid;
BEGIN
  SELECT * INTO v_source FROM public.cohorts WHERE id = p_source_cohort_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cohort not found' USING ERRCODE = 'GR404'; END IF;
  IF v_source.locked_at IS NULL THEN
    RAISE EXCEPTION 'Lock the cohort before drawing from it.' USING ERRCODE = 'GR423';
  END IF;
  IF v_source.drawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'This cohort has already been drawn.' USING ERRCODE = 'GR409';
  END IF;

  SELECT * INTO v_target FROM public.cohorts WHERE id = p_target_cohort_id FOR UPDATE;
  IF NOT FOUND OR v_target.round_id <> v_source.round_id OR v_target.id = v_source.id THEN
    RAISE EXCEPTION 'cohort not found' USING ERRCODE = 'GR404';
  END IF;
  IF v_target.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'The winners cohort is locked.' USING ERRCODE = 'GR423';
  END IF;
  IF p_rest_cohort_id IS NOT NULL THEN
    SELECT * INTO v_rest FROM public.cohorts WHERE id = p_rest_cohort_id FOR UPDATE;
    IF NOT FOUND OR v_rest.round_id <> v_source.round_id OR v_rest.id IN (v_source.id, v_target.id) THEN
      RAISE EXCEPTION 'cohort not found' USING ERRCODE = 'GR404';
    END IF;
    IF v_rest.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'The cohort for everyone else is locked.' USING ERRCODE = 'GR423';
    END IF;
  END IF;

  -- Winners and the rest must be distinct members of the source.
  SELECT count(*) INTO v_members FROM public.cohort_members WHERE cohort_id = p_source_cohort_id;
  IF (SELECT count(DISTINCT x) FROM unnest(p_winner_ids || coalesce(p_rest_ids, '{}')) x)
       <> cardinality(p_winner_ids) + cardinality(coalesce(p_rest_ids, '{}'))
     OR EXISTS (
       SELECT 1 FROM unnest(p_winner_ids || coalesce(p_rest_ids, '{}')) x
       WHERE NOT EXISTS (SELECT 1 FROM public.cohort_members m WHERE m.cohort_id = p_source_cohort_id AND m.session_id = x)
     ) THEN
    RAISE EXCEPTION 'The draw must use people from the locked cohort, once each.' USING ERRCODE = 'GR422';
  END IF;

  IF v_target.capacity IS NOT NULL THEN
    SELECT count(*) INTO v_taken FROM public.cohort_members WHERE cohort_id = p_target_cohort_id;
    IF v_taken + cardinality(p_winner_ids) > v_target.capacity THEN
      RAISE EXCEPTION 'Not enough places in the winners cohort.' USING ERRCODE = 'GR409';
    END IF;
  END IF;

  INSERT INTO public.allocation_runs (
    organisation_id, project_id, round_id, kind, source_cohort_id, target_cohort_id, rule, moved,
    actor_kind, actor_user_id, actor_email
  ) VALUES (
    v_source.organisation_id, v_source.project_id, v_source.round_id, 'draw', p_source_cohort_id, p_target_cohort_id,
    coalesce(p_rule, '{}'::jsonb) || jsonb_build_object('pool', v_members, 'winners', cardinality(p_winner_ids),
      'rest_cohort_id', p_rest_cohort_id, 'rest', cardinality(coalesce(p_rest_ids, '{}'))),
    cardinality(p_winner_ids) + cardinality(coalesce(p_rest_ids, '{}')),
    p_actor_kind, p_actor_user_id, p_actor_email
  ) RETURNING id INTO v_run;

  INSERT INTO public.cohort_moves (run_id, round_id, session_id, from_cohort_id, to_cohort_id, position)
  SELECT v_run, v_source.round_id, w.x, p_source_cohort_id, p_target_cohort_id, w.n::integer
  FROM unnest(p_winner_ids) WITH ORDINALITY AS w(x, n);
  UPDATE public.cohort_members m
  SET cohort_id = p_target_cohort_id, position = w.n::integer,
      access_secret = CASE WHEN v_target.grants_access THEN gen_random_uuid() END, run_id = v_run, added_at = now()
  FROM unnest(p_winner_ids) WITH ORDINALITY AS w(x, n)
  WHERE m.round_id = v_source.round_id AND m.session_id = w.x;

  IF p_rest_cohort_id IS NOT NULL AND cardinality(coalesce(p_rest_ids, '{}')) > 0 THEN
    INSERT INTO public.cohort_moves (run_id, round_id, session_id, from_cohort_id, to_cohort_id, position)
    SELECT v_run, v_source.round_id, r.x, p_source_cohort_id, p_rest_cohort_id, r.n::integer
    FROM unnest(p_rest_ids) WITH ORDINALITY AS r(x, n);
    UPDATE public.cohort_members m
    SET cohort_id = p_rest_cohort_id, position = r.n::integer,
        access_secret = CASE WHEN v_rest.grants_access THEN gen_random_uuid() END, run_id = v_run, added_at = now()
    FROM unnest(p_rest_ids) WITH ORDINALITY AS r(x, n)
    WHERE m.round_id = v_source.round_id AND m.session_id = r.x;
  END IF;

  UPDATE public.cohorts SET drawn_at = now() WHERE id = p_source_cohort_id;
  RETURN v_run;
END;
$$;

-- 6. Webhook deliveries for allocation events.
ALTER TABLE public.webhook_deliveries
  ADD COLUMN move_id uuid REFERENCES public.cohort_moves (id) ON DELETE CASCADE,
  ADD COLUMN run_id uuid REFERENCES public.allocation_runs (id) ON DELETE CASCADE;
ALTER TABLE public.webhook_deliveries DROP CONSTRAINT webhook_deliveries_event_check;
ALTER TABLE public.webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_event_check CHECK (
    (event = 'session.completed' AND verdict_id IS NOT NULL AND decision_id IS NULL AND move_id IS NULL AND run_id IS NULL)
    OR (event IN ('application.decided', 'application.decision_corrected')
        AND decision_id IS NOT NULL AND verdict_id IS NULL AND move_id IS NULL AND run_id IS NULL)
    OR (event = 'application.allocated' AND move_id IS NOT NULL AND verdict_id IS NULL AND decision_id IS NULL)
    OR (event IN ('cohort.locked', 'cohort.drawn') AND run_id IS NOT NULL AND move_id IS NULL
        AND verdict_id IS NULL AND decision_id IS NULL)
  ),
  ADD CONSTRAINT webhook_deliveries_move_unique UNIQUE (webhook_id, move_id),
  ADD CONSTRAINT webhook_deliveries_run_unique UNIQUE (webhook_id, run_id);

-- 7. Access: server-side tables only.
ALTER TABLE public.entry_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disposable_email_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entry_flag_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocation_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohort_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cohort_moves ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.entry_identifiers, public.disposable_email_domains, public.entry_flag_dismissals,
  public.allocation_rounds, public.cohorts, public.allocation_runs, public.cohort_members, public.cohort_moves,
  public.application_entry_flags FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.entry_identifiers TO service_role;
GRANT SELECT ON public.disposable_email_domains TO service_role;
GRANT SELECT, INSERT, DELETE ON public.entry_flag_dismissals TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.allocation_rounds TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.cohorts TO service_role;
GRANT SELECT, INSERT ON public.allocation_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cohort_members TO service_role;
GRANT SELECT, INSERT ON public.cohort_moves TO service_role;
GRANT SELECT ON public.application_entry_flags TO service_role;
REVOKE ALL ON public.application_review_queue FROM anon, authenticated;
GRANT SELECT ON public.application_review_queue TO service_role;

REVOKE ALL ON FUNCTION public.bulk_record_decisions(uuid, uuid[], text, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_to_cohort(uuid, uuid[], uuid, text, jsonb, uuid, text, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.draw_cohort(uuid, uuid, uuid[], uuid, uuid[], jsonb, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.entry_identifier_values(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_entry_identifiers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_record_decisions(uuid, uuid[], text, text, text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.allocate_to_cohort(uuid, uuid[], uuid, text, jsonb, uuid, text, uuid, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.draw_cohort(uuid, uuid, uuid[], uuid, uuid[], jsonb, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.entry_identifier_values(text, jsonb, jsonb) TO service_role;
