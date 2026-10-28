-- Application invitations authorize one conversation; they never grant membership or access.
CREATE TABLE public.application_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 320),
  name text CHECK (name IS NULL OR char_length(name) <= 160),
  audience text NOT NULL CHECK (audience IN ('community', 'artist')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  session_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_by_email text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX application_invitations_project_created ON public.application_invitations(project_id, created_at DESC);
ALTER TABLE public.application_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.application_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.application_invitations TO service_role;
COMMENT ON TABLE public.application_invitations IS 'Service-only, project-scoped application invitations. Tokens are stored hashed. One fixed session key per invitation prevents multiple applications. No invitation grants membership.';
