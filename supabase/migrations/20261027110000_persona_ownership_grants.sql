-- The persona ownership tables are read and written by the server (service role) only.
-- This project does not grant new tables to the API roles by default, so grant them explicitly.
REVOKE ALL ON public.persona_organisation_access FROM anon, authenticated;
REVOKE ALL ON public.persona_versions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.persona_organisation_access TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.persona_versions TO service_role;
