-- Persona ownership: Groucho personas, organisation clones, visibility and versions.
-- See docs/persona-ownership.md. Tables stay service-role only (RLS on, no policies), like personas.

-- 1. Ownership, provenance, version and visibility on personas.
ALTER TABLE public.personas
  ADD COLUMN owner_organisation_id uuid REFERENCES public.organisations(id) ON DELETE CASCADE,
  ADD COLUMN source_persona_id uuid REFERENCES public.personas(id) ON DELETE SET NULL,
  ADD COLUMN source_version integer,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN visibility text NOT NULL DEFAULT 'all';

ALTER TABLE public.personas
  ADD CONSTRAINT personas_visibility_check CHECK (visibility IN ('all', 'restricted')),
  ADD CONSTRAINT personas_clone_has_owner CHECK (source_persona_id IS NULL OR owner_organisation_id IS NOT NULL),
  ADD CONSTRAINT personas_default_is_groucho CHECK (NOT is_default OR owner_organisation_id IS NULL);

CREATE INDEX personas_owner_organisation_id_idx ON public.personas (owner_organisation_id);
CREATE INDEX personas_source_persona_id_idx ON public.personas (source_persona_id);

COMMENT ON COLUMN public.personas.owner_organisation_id IS 'Null: a Groucho persona. Otherwise the only organisation that can see and use it.';
COMMENT ON COLUMN public.personas.source_persona_id IS 'The Groucho persona this one was cloned from.';
COMMENT ON COLUMN public.personas.source_version IS 'Version of the source persona this clone last took its content from.';
COMMENT ON COLUMN public.personas.version IS 'Increases on every content change; maintained by trigger.';
COMMENT ON COLUMN public.personas.visibility IS 'Groucho personas only: all organisations, or those in persona_organisation_access.';

-- 2. Which organisations can see a restricted Groucho persona.
CREATE TABLE public.persona_organisation_access (
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (persona_id, organisation_id)
);
CREATE INDEX persona_organisation_access_organisation_id_idx ON public.persona_organisation_access (organisation_id);
ALTER TABLE public.persona_organisation_access ENABLE ROW LEVEL SECURITY;

-- 3. A snapshot of every version of every persona.
CREATE TABLE public.persona_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  version integer NOT NULL,
  name text NOT NULL,
  prompt text NOT NULL,
  pass_threshold numeric,
  reject_threshold numeric,
  profile_schema jsonb,
  profile_extractor_hint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (persona_id, version)
);
ALTER TABLE public.persona_versions ENABLE ROW LEVEL SECURITY;

INSERT INTO public.persona_versions (persona_id, version, name, prompt, pass_threshold, reject_threshold, profile_schema, profile_extractor_hint)
SELECT id, version, name, prompt, pass_threshold, reject_threshold, profile_schema, profile_extractor_hint
FROM public.personas
ON CONFLICT (persona_id, version) DO NOTHING;

-- 4. Versions are kept by the database, so every writer (API, scripts, SQL) is covered.
CREATE OR REPLACE FUNCTION public.personas_track_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
  ELSIF (NEW.name, NEW.prompt, NEW.pass_threshold, NEW.reject_threshold, NEW.profile_schema, NEW.profile_extractor_hint)
     IS DISTINCT FROM (OLD.name, OLD.prompt, OLD.pass_threshold, OLD.reject_threshold, OLD.profile_schema, OLD.profile_extractor_hint) THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.personas_snapshot_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.persona_versions (persona_id, version, name, prompt, pass_threshold, reject_threshold, profile_schema, profile_extractor_hint)
  VALUES (NEW.id, NEW.version, NEW.name, NEW.prompt, NEW.pass_threshold, NEW.reject_threshold, NEW.profile_schema, NEW.profile_extractor_hint)
  ON CONFLICT (persona_id, version) DO NOTHING;
  RETURN NULL;
END;
$$;

CREATE TRIGGER personas_track_version
  BEFORE INSERT OR UPDATE ON public.personas
  FOR EACH ROW EXECUTE FUNCTION public.personas_track_version();

CREATE TRIGGER personas_snapshot_version
  AFTER INSERT OR UPDATE ON public.personas
  FOR EACH ROW EXECUTE FUNCTION public.personas_snapshot_version();

-- 5. Client-specific Groucho personas: restricted to COLORS and to any organisation already using one.
UPDATE public.personas
SET visibility = 'restricted'
WHERE owner_organisation_id IS NULL AND name ILIKE 'COLORS%';

INSERT INTO public.persona_organisation_access (persona_id, organisation_id)
SELECT p.id, o.id
FROM public.personas p
JOIN public.organisations o ON lower(o.name) = 'colors'
WHERE p.visibility = 'restricted'
UNION
SELECT p.id, pr.organisation_id
FROM public.projects pr
JOIN public.personas p ON p.id::text = pr.settings->>'persona_id'
WHERE p.visibility = 'restricted'
ON CONFLICT DO NOTHING;

-- 6. One clone per organisation and Groucho persona in use, plus COLORS's own copy of each COLORS persona.
INSERT INTO public.personas (
  name, slug, prompt, is_active, is_default, pass_threshold, reject_threshold,
  profile_schema, profile_extractor_hint, owner_organisation_id, source_persona_id, source_version, visibility
)
WITH plan AS (
  SELECT pr.organisation_id, p.id AS source_id
  FROM public.projects pr
  JOIN public.personas p ON p.id::text = pr.settings->>'persona_id'
  WHERE p.owner_organisation_id IS NULL
  UNION
  SELECT o.id, p.id
  FROM public.personas p
  JOIN public.organisations o ON lower(o.name) = 'colors'
  WHERE p.owner_organisation_id IS NULL AND p.name ILIKE 'COLORS%'
)
SELECT
  s.name,
  coalesce(nullif(o.slug, ''), left(o.id::text, 8)) || '-' || s.slug,
  s.prompt, s.is_active, false, s.pass_threshold, s.reject_threshold,
  s.profile_schema, s.profile_extractor_hint, plan.organisation_id, s.id, s.version, 'restricted'
FROM plan
JOIN public.personas s ON s.id = plan.source_id
JOIN public.organisations o ON o.id = plan.organisation_id;

-- 7. Point each project at its organisation's clone, with an audit record of the change.
WITH repointed AS (
  UPDATE public.projects pr
  SET settings = jsonb_set(pr.settings, '{persona_id}', to_jsonb(c.id::text))
  FROM public.personas c
  WHERE c.owner_organisation_id = pr.organisation_id
    AND c.source_persona_id::text = pr.settings->>'persona_id'
  RETURNING pr.id, pr.organisation_id, pr.settings AS new_settings, c.source_persona_id
)
INSERT INTO public.project_settings_audit (organisation_id, project_id, actor_kind, source, changed_keys, previous_settings, new_settings)
SELECT
  r.organisation_id, r.id, 'system', 'migration:persona_ownership', ARRAY['persona_id'],
  jsonb_set(r.new_settings, '{persona_id}', to_jsonb(r.source_persona_id::text)), r.new_settings
FROM repointed r;
