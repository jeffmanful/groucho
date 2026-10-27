-- Decisions recorded through the API, and webhooks for every decision.
-- See docs/client-integration-guide.md (Reviewing applications from your own app).

-- 1. API key scopes. Existing keys keep what they could already do: run conversations.
--    Only a key with the applications scope can list applications and record decisions,
--    so a key sitting behind a browser-facing proxy can never approve anyone.
ALTER TABLE public.api_keys
  ADD COLUMN scopes text[] NOT NULL DEFAULT ARRAY['conversations']::text[];
ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_scopes_check
    CHECK (scopes <@ ARRAY['conversations', 'applications']::text[] AND cardinality(scopes) > 0);
COMMENT ON COLUMN public.api_keys.scopes IS
  'conversations: start and run applicant conversations. applications: list applications and record decisions (server use only).';

-- 2. Decisions recorded by a client's own app through the API: a human decision, made by
--    the reviewer the client names, authorised by an applications-scoped key.
ALTER TABLE public.application_decisions
  ADD COLUMN api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  ADD COLUMN reviewer_name text;

ALTER TABLE public.application_decisions
  DROP CONSTRAINT IF EXISTS application_decisions_reviewer_kind_check,
  DROP CONSTRAINT IF EXISTS application_decisions_reviewer_identity;

ALTER TABLE public.application_decisions
  ADD CONSTRAINT application_decisions_reviewer_kind_check
    CHECK (reviewer_kind IN ('platform', 'member', 'policy', 'api')),
  -- api_key_id is only required when the decision is recorded; revoking or deleting the key later
  -- clears it, so the row stays valid.
  ADD CONSTRAINT application_decisions_reviewer_identity CHECK (
    (decision_source = 'human' AND reviewer_kind = 'platform' AND reviewer_email IS NOT NULL)
    OR (decision_source = 'human' AND reviewer_kind = 'member' AND reviewer_user_id IS NOT NULL)
    OR (decision_source = 'human' AND reviewer_kind = 'api' AND reviewer_user_id IS NULL)
    OR (
      decision_source = 'policy'
      AND reviewer_kind = 'policy'
      AND reviewer_user_id IS NULL
      AND reviewer_email IS NULL
      AND suitability_score IS NOT NULL
      AND policy_snapshot IS NOT NULL
    )
  );

COMMENT ON COLUMN public.application_decisions.api_key_id IS
  'The applications-scoped API key a client app used to record this decision.';
COMMENT ON COLUMN public.application_decisions.reviewer_name IS
  'Reviewer name supplied by a client app when it records a decision through the API.';

-- 3. Webhook deliveries for decisions as well as completed conversations.
ALTER TABLE public.webhook_deliveries
  ALTER COLUMN verdict_id DROP NOT NULL,
  ADD COLUMN decision_id uuid REFERENCES public.application_decisions(id) ON DELETE CASCADE,
  ADD COLUMN event text NOT NULL DEFAULT 'session.completed';

ALTER TABLE public.webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_event_check
    CHECK (
      (event = 'session.completed' AND verdict_id IS NOT NULL AND decision_id IS NULL)
      OR (event = 'application.decided' AND decision_id IS NOT NULL AND verdict_id IS NULL)
    ),
  ADD CONSTRAINT webhook_deliveries_decision_unique UNIQUE (webhook_id, decision_id);

CREATE INDEX webhook_deliveries_webhook_created_idx
  ON public.webhook_deliveries (webhook_id, created_at DESC);

COMMENT ON COLUMN public.webhook_deliveries.event IS
  'session.completed (verdict_id) or application.decided (decision_id).';
