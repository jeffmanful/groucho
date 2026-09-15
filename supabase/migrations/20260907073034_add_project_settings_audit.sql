-- Immutable history for client-controlled project settings. Writes are made by
-- the trusted admin API; reads are also mediated by that API.

CREATE TABLE public.project_settings_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  actor_kind text NOT NULL CHECK (actor_kind IN ('platform', 'member', 'system')),
  actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  actor_email text,
  source text NOT NULL DEFAULT 'admin_api',
  changed_keys text[] NOT NULL DEFAULT '{}',
  previous_settings jsonb NOT NULL CHECK (jsonb_typeof(previous_settings) = 'object'),
  new_settings jsonb NOT NULL CHECK (jsonb_typeof(new_settings) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_settings_audit_project_created
  ON public.project_settings_audit (project_id, created_at DESC);

CREATE INDEX idx_project_settings_audit_organisation_created
  ON public.project_settings_audit (organisation_id, created_at DESC);

ALTER TABLE public.project_settings_audit ENABLE ROW LEVEL SECURITY;

-- The service-role server client is the only application principal that needs
-- direct access. Browser roles receive no grants or policies.
REVOKE ALL ON TABLE public.project_settings_audit FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.project_settings_audit TO service_role;

COMMENT ON TABLE public.project_settings_audit IS
  'Append-only audit history for changes to projects.settings made by trusted admin operations.';
