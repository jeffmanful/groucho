-- Project-scoped, aggregate-only cultural signals.
-- Source events retain deletion lineage but never store raw applicant responses.

CREATE TABLE public.cultural_signal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions (id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL REFERENCES public.messages (id) ON DELETE CASCADE,
  signal_type text NOT NULL CHECK (signal_type IN (
    'artist_reference',
    'creative_discipline',
    'scene_or_genre',
    'participation_style',
    'community_care',
    'artist_sustainability',
    'discovery_and_curation',
    'feedback_and_criticism',
    'ai_and_authorship',
    'access_or_exposure',
    'emerging_theme'
  )),
  normalized_key text NOT NULL CHECK (normalized_key ~ '^[a-z0-9][a-z0-9_]{0,79}$'),
  display_label text NOT NULL CHECK (char_length(display_label) BETWEEN 1 AND 80),
  confidence numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  is_sensitive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_message_id, signal_type, normalized_key)
);

CREATE INDEX cultural_signal_events_project_created_idx
  ON public.cultural_signal_events (project_id, created_at DESC);
CREATE INDEX cultural_signal_events_project_signal_idx
  ON public.cultural_signal_events (project_id, signal_type, normalized_key);
CREATE INDEX cultural_signal_events_session_idx
  ON public.cultural_signal_events (session_id);

CREATE TABLE public.cultural_signal_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  signal_type text NOT NULL CHECK (signal_type = 'emerging_theme'),
  normalized_key text NOT NULL CHECK (normalized_key ~ '^[a-z0-9][a-z0-9_]{0,79}$'),
  display_label text NOT NULL CHECK (char_length(display_label) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'suppressed')),
  reviewed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, signal_type, normalized_key)
);

CREATE INDEX cultural_signal_definitions_project_status_idx
  ON public.cultural_signal_definitions (project_id, status);

CREATE TABLE public.cultural_signal_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  version bigint NOT NULL,
  window_days integer NOT NULL CHECK (window_days BETWEEN 1 AND 365),
  minimum_sessions integer NOT NULL CHECK (minimum_sessions >= 2),
  sensitive_minimum_sessions integer NOT NULL CHECK (
    sensitive_minimum_sessions >= minimum_sessions
  ),
  eligible_session_count integer NOT NULL DEFAULT 0 CHECK (eligible_session_count >= 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE INDEX cultural_signal_snapshots_project_generated_idx
  ON public.cultural_signal_snapshots (project_id, generated_at DESC);

CREATE TABLE public.cultural_signal_project_state (
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  project_id uuid PRIMARY KEY REFERENCES public.projects (id) ON DELETE CASCADE,
  snapshot_dirty boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.mark_cultural_signal_snapshot_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Historical snapshots are derived data too. Remove them when a source event
  -- is deleted so an erased response cannot survive inside an older snapshot.
  IF TG_TABLE_NAME = 'cultural_signal_events' AND TG_OP = 'DELETE' THEN
    DELETE FROM public.cultural_signal_snapshots
    WHERE project_id = OLD.project_id;
  END IF;

  INSERT INTO public.cultural_signal_project_state (
    organisation_id,
    project_id,
    snapshot_dirty,
    updated_at
  )
  VALUES (
    COALESCE(NEW.organisation_id, OLD.organisation_id),
    COALESCE(NEW.project_id, OLD.project_id),
    true,
    now()
  )
  ON CONFLICT (project_id) DO UPDATE
  SET snapshot_dirty = true, updated_at = now();
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_cultural_signal_snapshot_dirty() FROM PUBLIC;

CREATE TRIGGER cultural_signal_events_mark_snapshot_dirty
AFTER INSERT OR UPDATE OR DELETE ON public.cultural_signal_events
FOR EACH ROW EXECUTE FUNCTION public.mark_cultural_signal_snapshot_dirty();

CREATE TRIGGER cultural_signal_definitions_mark_snapshot_dirty
AFTER INSERT OR UPDATE OR DELETE ON public.cultural_signal_definitions
FOR EACH ROW EXECUTE FUNCTION public.mark_cultural_signal_snapshot_dirty();

ALTER TABLE public.cultural_signal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cultural_signal_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cultural_signal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cultural_signal_project_state ENABLE ROW LEVEL SECURITY;

-- Cultural signals are available only through authenticated, organisation-scoped
-- server routes. The browser roles cannot read source events or snapshots directly.
REVOKE ALL ON TABLE public.cultural_signal_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.cultural_signal_definitions FROM anon, authenticated;
REVOKE ALL ON TABLE public.cultural_signal_snapshots FROM anon, authenticated;
REVOKE ALL ON TABLE public.cultural_signal_project_state FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cultural_signal_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cultural_signal_definitions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cultural_signal_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cultural_signal_project_state TO service_role;

COMMENT ON TABLE public.cultural_signal_events IS
  'Project-scoped structured signal events with source lineage and no raw applicant responses.';
COMMENT ON TABLE public.cultural_signal_snapshots IS
  'Thresholded aggregate cultural-signal snapshots safe for internal client display.';
