-- Session lifecycle controls. No retention periods are enabled or backfilled here.
-- Only authenticated server routes may call these service-role RPCs.
-- Legacy access profiles are server-owned; never rely on provider default grants.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_eligibility ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles, public.profile_eligibility FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.profile_eligibility TO service_role;

CREATE TABLE public.project_retention_policies (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  active_days integer NOT NULL CHECK (active_days BETWEEN 1 AND 3650),
  abandoned_days integer NOT NULL CHECK (abandoned_days BETWEEN 1 AND 3650),
  completed_days integer NOT NULL CHECK (completed_days BETWEEN 1 AND 3650),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.session_privacy_holds (
  session_id uuid PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
  reason_code text NOT NULL CHECK (reason_code IN ('legal_obligation', 'legal_claim', 'rights_request')),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '366 days')
);
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.session_erasure_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  session_row_hash bytea NOT NULL,
  session_key_hash bytea NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('requested', 'retention')),
  erased_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, session_row_hash),
  UNIQUE (project_id, session_key_hash)
);
COMMENT ON TABLE private.session_erasure_receipts IS
  'Pseudonymous deletion/suppression ledger. No transcript, email or raw session identifier. Retain for replay/restore suppression until a separate approved ledger lifecycle exists.';

ALTER TABLE public.project_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_privacy_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.session_erasure_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_retention_policies, public.session_privacy_holds,
  private.session_erasure_receipts FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_retention_policies,
  public.session_privacy_holds TO service_role;
GRANT SELECT, INSERT ON private.session_erasure_receipts TO service_role;

CREATE FUNCTION public.guard_erased_session()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.session_id, NEW.project_id, NEW.organisation_id)
       IS DISTINCT FROM (OLD.id, OLD.session_id, OLD.project_id, OLD.organisation_id) THEN
      RAISE EXCEPTION 'Session identity cannot change' USING ERRCODE = 'GR409';
    END IF;
    RETURN NEW;
  END IF;
  -- Serialize a retried start with erasure for the same project/client key.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.project_id::text || ':' || NEW.session_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('session-row:' || NEW.id::text, 0));
  IF EXISTS (
    SELECT 1 FROM private.session_erasure_receipts r
    WHERE r.project_id = NEW.project_id AND (
      r.session_key_hash = sha256(convert_to(NEW.session_id, 'UTF8')) OR
      r.session_row_hash = sha256(convert_to(NEW.id::text, 'UTF8'))
    )
  ) THEN
    RAISE EXCEPTION 'This session is no longer available. Start a new session.' USING ERRCODE = 'GR410';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sessions_privacy_guard BEFORE INSERT OR UPDATE ON public.sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_erased_session();
REVOKE ALL ON FUNCTION public.guard_erased_session() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_erased_session() TO service_role;

-- One transaction removes all session children through their real FK cascades.
-- Invitation/session_key and legacy profile links need explicit handling.
CREATE FUNCTION public.erase_project_session(
  p_organisation_id uuid, p_project_id uuid, p_session_id uuid,
  p_reason_code text DEFAULT 'requested'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_session public.sessions;
  v_receipt private.session_erasure_receipts;
  v_profiles uuid[];
  v_identifiers jsonb;
BEGIN
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('requested', 'retention') THEN
    RAISE EXCEPTION 'Invalid erasure reason' USING ERRCODE = 'GR400';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND organisation_id = p_organisation_id) THEN
    RAISE EXCEPTION 'Not found' USING ERRCODE = 'GR404';
  END IF;
  SELECT * INTO v_session FROM public.sessions
    WHERE id = p_session_id AND project_id = p_project_id AND organisation_id = p_organisation_id;
  IF FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_project_id::text || ':' || v_session.session_id, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('session-row:' || p_session_id::text, 0));
    SELECT * INTO v_session FROM public.sessions
      WHERE id = p_session_id AND project_id = p_project_id AND organisation_id = p_organisation_id FOR UPDATE;
  END IF;
  IF v_session.id IS NULL THEN
    SELECT * INTO v_receipt FROM private.session_erasure_receipts
      WHERE project_id = p_project_id AND organisation_id = p_organisation_id
        AND session_row_hash = sha256(convert_to(p_session_id::text, 'UTF8'));
    IF NOT FOUND THEN RAISE EXCEPTION 'Not found' USING ERRCODE = 'GR404'; END IF;
    RETURN jsonb_build_object('receiptId', v_receipt.id, 'erasedAt', v_receipt.erased_at, 'alreadyErased', true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.session_privacy_holds WHERE session_id = p_session_id AND expires_at > now()) THEN
    RAISE EXCEPTION 'Session has an active privacy hold' USING ERRCODE = 'GR423';
  END IF;

  SELECT array_agg(profile_id) INTO v_profiles FROM public.profile_eligibility WHERE session_id = p_session_id;
  -- Include orphaned profiles from old or interrupted access captures, but never delete
  -- a profile still used by a session/eligibility in any other tenant.
  SELECT coalesce(v_profiles, '{}'::uuid[]) || coalesce(array_agg(id), '{}'::uuid[])
    INTO v_profiles FROM public.profiles WHERE lower(email) = lower(v_session.applicant_email);
  SELECT jsonb_agg(jsonb_build_object('kind', kind, 'value', value)) INTO v_identifiers
    FROM public.entry_identifiers WHERE session_id = p_session_id;

  INSERT INTO private.session_erasure_receipts (organisation_id, project_id, session_row_hash, session_key_hash, reason_code)
    VALUES (p_organisation_id, p_project_id, sha256(convert_to(p_session_id::text, 'UTF8')),
      sha256(convert_to(v_session.session_id, 'UTF8')), p_reason_code)
    RETURNING * INTO v_receipt;
  DELETE FROM public.application_invitations WHERE project_id = p_project_id
    AND session_key::text = v_session.session_id;
  DELETE FROM public.sessions WHERE id = p_session_id;
  DELETE FROM public.profiles p WHERE p.id = ANY(v_profiles)
    AND NOT EXISTS (SELECT 1 FROM public.profile_eligibility e WHERE e.profile_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM public.sessions s WHERE lower(s.applicant_email) = lower(p.email));
  DELETE FROM public.entry_flag_dismissals d WHERE d.project_id = p_project_id
    AND EXISTS (SELECT 1 FROM jsonb_to_recordset(coalesce(v_identifiers, '[]'::jsonb)) AS x(kind text, value text)
      WHERE x.kind = d.kind AND x.value = d.value)
    AND NOT EXISTS (SELECT 1 FROM public.entry_identifiers i WHERE i.project_id = p_project_id AND i.kind = d.kind AND i.value = d.value);
  RETURN jsonb_build_object('receiptId', v_receipt.id, 'erasedAt', v_receipt.erased_at, 'alreadyErased', false);
END;
$$;

-- Fixed activity basis: latest message, otherwise creation. Admin/report writes
-- must not reset the retention clock. Read-only preview and cron use one rule.
CREATE FUNCTION public.session_retention_candidates(
  p_project_id uuid DEFAULT NULL, p_limit integer DEFAULT 100, p_include_disabled boolean DEFAULT false
)
RETURNS TABLE (session_id uuid, organisation_id uuid, project_id uuid, eligible_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT s.id, s.organisation_id, s.project_id, expiry.at
  FROM public.sessions s
  JOIN public.project_retention_policies p ON p.project_id = s.project_id AND (p.enabled OR p_include_disabled)
  CROSS JOIN LATERAL (
    SELECT coalesce((SELECT max(m.sent_at) FROM public.messages m WHERE m.session_id = s.id), s.created_at)
      + make_interval(days => CASE s.status WHEN 'active' THEN p.active_days
          WHEN 'abandoned' THEN p.abandoned_days ELSE p.completed_days END) AS at
  ) expiry
  WHERE (p_project_id IS NULL OR s.project_id = p_project_id) AND expiry.at <= now()
    AND NOT EXISTS (SELECT 1 FROM public.session_privacy_holds h WHERE h.session_id = s.id AND h.expires_at > now())
  ORDER BY expiry.at, s.id LIMIT greatest(1, least(coalesce(p_limit, 100), 500));
$$;

CREATE FUNCTION public.process_session_retention(p_limit integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_candidate record; v_count integer := 0;
BEGIN
  -- A single bounded drain. Recheck eligibility after taking the same session lock
  -- used by explicit erasure, and the row lock used by message activity below.
  FOR v_candidate IN SELECT * FROM public.session_retention_candidates(NULL, p_limit) LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_candidate.project_id::text || ':' || s.session_id, 0))
      FROM public.sessions s WHERE s.id = v_candidate.session_id;
    PERFORM pg_advisory_xact_lock(hashtextextended('session-row:' || v_candidate.session_id::text, 0));
    PERFORM 1 FROM public.sessions WHERE id = v_candidate.session_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.session_retention_candidates(v_candidate.project_id, 500)
        WHERE session_id = v_candidate.session_id) THEN
      PERFORM public.erase_project_session(v_candidate.organisation_id, v_candidate.project_id, v_candidate.session_id, 'retention');
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Activity and expiry serialize on the parent session row. This prevents a new
-- message arriving during the expiry recheck from silently resetting eligibility.
CREATE FUNCTION public.lock_session_message_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.sessions WHERE id = NEW.session_id FOR UPDATE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER messages_privacy_activity BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.lock_session_message_activity();

REVOKE ALL ON FUNCTION public.erase_project_session(uuid, uuid, uuid, text),
  public.session_retention_candidates(uuid, integer, boolean), public.process_session_retention(integer),
  public.lock_session_message_activity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_project_session(uuid, uuid, uuid, text),
  public.session_retention_candidates(uuid, integer, boolean), public.process_session_retention(integer),
  public.lock_session_message_activity() TO service_role;

CREATE FUNCTION public.set_session_privacy_hold(
  p_organisation_id uuid, p_project_id uuid, p_session_id uuid,
  p_reason_code text, p_expires_at timestamptz
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.sessions WHERE id = p_session_id
    AND project_id = p_project_id AND organisation_id = p_organisation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found' USING ERRCODE = 'GR404'; END IF;
  IF p_expires_at IS NULL AND p_reason_code IS NULL THEN
    DELETE FROM public.session_privacy_holds WHERE session_id = p_session_id;
    RETURN;
  END IF;
  IF p_reason_code IS NULL OR p_reason_code NOT IN ('legal_obligation', 'legal_claim', 'rights_request')
    OR p_expires_at IS NULL OR NOT isfinite(p_expires_at) OR p_expires_at <= now() OR p_expires_at > now() + interval '366 days' THEN
    RAISE EXCEPTION 'Invalid privacy hold' USING ERRCODE = 'GR400';
  END IF;
  INSERT INTO public.session_privacy_holds(session_id, reason_code, expires_at)
    VALUES(p_session_id, p_reason_code, p_expires_at)
    ON CONFLICT(session_id) DO UPDATE SET reason_code = EXCLUDED.reason_code,
      expires_at = EXCLUDED.expires_at, created_at = now();
END;
$$;

-- Access capture used to upsert a profile before inserting its session link.
-- Locking the session and writing both rows atomically prevents an in-flight
-- capture leaving a new orphan email after the session has been erased.
CREATE FUNCTION public.capture_session_access_profile(p_project_id uuid, p_session_id uuid, p_email text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_session public.sessions; v_profile uuid;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id AND project_id = p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session unavailable' USING ERRCODE = 'GR410'; END IF;
  IF p_email IS NULL OR char_length(p_email) NOT BETWEEN 3 AND 320 OR
    (v_session.applicant_email IS NOT NULL AND v_session.applicant_email <> p_email) THEN
    RAISE EXCEPTION 'Email does not match this application' USING ERRCODE = 'GR400';
  END IF;
  IF v_session.applicant_email IS NULL THEN
    UPDATE public.sessions SET applicant_email = p_email WHERE id = p_session_id;
  END IF;
  INSERT INTO public.profiles(email) VALUES(p_email)
    ON CONFLICT(email) DO UPDATE SET email = EXCLUDED.email RETURNING id INTO v_profile;
  INSERT INTO public.profile_eligibility(profile_id, session_id) VALUES(v_profile, p_session_id)
    ON CONFLICT(profile_id, session_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.set_session_privacy_hold(uuid, uuid, uuid, text, timestamptz),
  public.capture_session_access_profile(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_session_privacy_hold(uuid, uuid, uuid, text, timestamptz),
  public.capture_session_access_profile(uuid, uuid, text) TO service_role;

-- Follows the existing database abandonment scheduler. Inert until a project
-- explicitly enables its policy. The authenticated HTTP drain is an alternative.
SELECT cron.schedule('session-retention', '43 * * * *', 'SELECT public.process_session_retention(100)');
