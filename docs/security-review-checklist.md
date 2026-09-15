# Security review checklist (Groucho v1)

Use for internal review or customer questionnaires. Not exhaustive.

## Tenant isolation

- [ ] **RLS** enabled on tenant tables; policies scoped by `organisation_id` / membership where documented in migrations.
- [ ] **Service role** (`SUPABASE_SERVICE_KEY`) used only on server routes that must bypass RLS; never exposed to the browser.
- [ ] **API keys** stored hashed; only prefix shown in admin UI; full secret shown once on create.

## API surface

- [ ] **Project resolution** from `Authorization: Bearer gk_*` only on intended routes (`/v1/*`, `/api/chat`, etc.).
- [ ] **Rate limits** enforced (`GROUCHO_RL_*`); 429 returns `Retry-After` where implemented.
- [ ] **Middleware** does not log full `Authorization` headers (see [ADR-0001](./adr/0001-api-key-and-client-access.md)).

## Application decisions and access

- [ ] Advisory model outcome, recommendation, and suitability score cannot grant
  access without an immutable `application_decisions` approval row.
- [ ] Automatic acceptance and automatic decline are independent project settings;
  both default off and require an explicit operator action to enable.
- [ ] `review_threshold` is lower than `acceptance_threshold`, and both are validated
  as values from `0` to `1` on every admin write path.
- [ ] Automatic decisions store `decision_source = policy`, `reviewer_kind = policy`,
  the suitability score, and a complete policy snapshot.
- [ ] Human decisions store `decision_source = human` and a verified platform or
  organisation-member reviewer identity.
- [ ] The unique session constraint makes decisions immutable; policy retries and
  reviewer actions do not overwrite an existing decision.
- [ ] Access capture requires `decision = approved` and a constant-time-equivalent
  exact match against that decision's `access_secret`; declines never have a secret.
- [ ] `application_decisions` remains RLS-protected and server-controlled. Data API
  grants are reviewed separately from RLS when provisioning Supabase projects.

## Webhooks

- [ ] **HTTPS-only** URLs enforced in DB (`CHECK` on `webhooks.url`).
- [ ] **HMAC** body signing (`X-Groucho-Signature`); integrators verify before trusting payloads.
- [ ] **Retries** bounded (`max_attempts`); cron route protected by `CRON_SECRET`.

## Observability

- [ ] Structured logs avoid PII where possible; use `requestId` / `projectId` correlation (`lib/logger.ts`, `x-request-id`).

## Client / SDK

- [ ] **ADR-0001**: production integrations use host **proxy** or server-side key; browser-direct `gk_live_*` discouraged.

## Load / availability

- [ ] Run k6 script (`loadtests/k6/chat-messages.js`) against staging before major releases; compare to PRD NFR-PERF-1 targets.
