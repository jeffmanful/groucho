-- The applicant's own connection details, recorded when a session or entry is first seen.
-- No raw IP addresses: a keyed hash of the address and of its network (/24 or /48) is enough to see
-- that entries share a connection. The key lives in the app (GROUCHO_SIGNAL_HASH_SECRET).

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS applicant_signal_source text,
  ADD COLUMN IF NOT EXISTS applicant_ip_hash text,
  ADD COLUMN IF NOT EXISTS applicant_network_hash text,
  ADD COLUMN IF NOT EXISTS applicant_user_agent text,
  ADD COLUMN IF NOT EXISTS applicant_language text,
  ADD COLUMN IF NOT EXISTS applicant_signals_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_applicant_signal_source_check') THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_applicant_signal_source_check
      CHECK (applicant_signal_source IS NULL OR applicant_signal_source IN ('forwarded', 'direct', 'relay'));
  END IF;
END $$;

COMMENT ON COLUMN public.sessions.applicant_signal_source IS
  'forwarded: the client''s server passed on the applicant''s details; direct: the browser called Groucho; relay: keyed request without forwarded details.';
COMMENT ON COLUMN public.sessions.applicant_ip_hash IS 'HMAC of the applicant IP. Never the address itself.';
COMMENT ON COLUMN public.sessions.applicant_network_hash IS 'HMAC of the applicant network (IPv4 /24, IPv6 /48).';

-- For finding entries that share a connection within a project.
CREATE INDEX IF NOT EXISTS sessions_project_ip_hash_idx
  ON public.sessions (project_id, applicant_ip_hash) WHERE applicant_ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_project_network_hash_idx
  ON public.sessions (project_id, applicant_network_hash) WHERE applicant_network_hash IS NOT NULL;
-- For the forwarding health check on Keys & webhooks.
CREATE INDEX IF NOT EXISTS sessions_project_created_signal_idx
  ON public.sessions (project_id, created_at DESC) INCLUDE (applicant_signal_source);
