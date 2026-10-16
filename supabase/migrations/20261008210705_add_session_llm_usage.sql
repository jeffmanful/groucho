-- One row per successful provider response, including calls later rejected by
-- Groucho's validators. The stored estimate and rate card preserve historical
-- costs when model pricing changes.
CREATE TABLE public.session_llm_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  provider_response_id text,
  operation text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  cache_creation_input_tokens integer NOT NULL CHECK (cache_creation_input_tokens >= 0),
  cache_creation_5m_input_tokens integer NOT NULL CHECK (cache_creation_5m_input_tokens >= 0),
  cache_creation_1h_input_tokens integer NOT NULL CHECK (cache_creation_1h_input_tokens >= 0),
  cache_read_input_tokens integer NOT NULL CHECK (cache_read_input_tokens >= 0),
  estimated_cost_usd numeric(16, 8),
  pricing_per_million jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_llm_usage_session_created_idx
  ON public.session_llm_usage (session_id, created_at);

CREATE INDEX session_llm_usage_project_created_idx
  ON public.session_llm_usage (project_id, created_at);

CREATE UNIQUE INDEX session_llm_usage_provider_response_idx
  ON public.session_llm_usage (provider, provider_response_id)
  WHERE provider_response_id IS NOT NULL;

ALTER TABLE public.session_llm_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.session_llm_usage FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.session_llm_usage TO service_role;

COMMENT ON TABLE public.session_llm_usage IS
  'Per-response model usage linked to a session. Costs are estimates at the stored rate card, not provider invoices.';
