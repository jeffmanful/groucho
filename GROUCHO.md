# Groucho

A conversational **doorman**: a configurable, LLM-driven gatekeeper that qualifies users across a handful of short turns and emits an auditable terminal outcome — `passed`, `redirected`, or `rejected` — plus structured metadata (per-turn scores and an extracted `profile`) that the host application can hang downstream behaviour off (email capture, role assignment, recommendations, CRM enrichment, etc.).

It is shipped as a **monorepo** with two products:

1. **Platform** — a Next.js 16 / React 19 multi-tenant control plane and HTTP API (this repo's `app/`, `lib/`, `middleware.ts`, `supabase/`).
2. **`@groucho/sdk`** — a published npm package (`packages/sdk`) with a headless TypeScript client, a server-only helper, and a React component kit (`<Gatekeeper />` + primitives) that host apps drop into their UI.

Source of truth for the broader vision lives in [`docs/PRD.md`](./docs/PRD.md); this file is a snapshot of **what is currently in the repository**.

---

## What problem it solves

Teams need to qualify visitors for culture-, community-, or premium-access surfaces — and increasingly to **onboard** new members into a community — without resorting to long static forms or opaque black-box rules. Groucho gives them:

- **Explainable outcomes** — every session has a transcript, a per-turn score breakdown, and a recorded verdict.
- **A stable, versioned HTTP API** — embeddable behind a host proxy so the secret `gk_*` key never reaches the browser.
- **Tenant isolation** — orgs, projects, members, invitations, API keys, webhooks, all scoped by Supabase RLS.
- **Structured output** — a JSON `profile` extracted from the conversation against a persona-defined schema, ready to feed downstream systems.

---

## What it currently does

### Conversation engine (gatekeeper mode)

- A terse assistant persona ("Lou", on the door at Public Equity™) implemented in [`lib/post-session-message.ts`](./lib/post-session-message.ts) — max 2 lines per turn, ~3–4 exchanges before a decision.
- Per-user-turn scoring on three dimensions (`specificity`, `authenticity`, `cultural_depth`) plus a weighted `overall`, run via the Anthropic SDK and stored on `messages.metadata.scores` ([`lib/scoring.ts`](./lib/scoring.ts)).
- Deterministic terminal phrases mapped to outcomes (`passed` / `redirected` / `rejected`); rejected sessions return `409` on further posts.
- Personas with configurable thresholds and an optional `profile_schema` for structured extraction (Supabase migration [`20260511220000_personas_profile_schema.sql`](./supabase/migrations/20260511220000_personas_profile_schema.sql)).

### Public Project HTTP API (under `/v1`)

Authenticated with `Authorization: Bearer gk_*` project API keys:

- `POST /v1/sessions/{sessionId}/messages` — user turn → assistant reply + scores + status.
- `GET  /v1/sessions/{sessionId}` — current session row.
- `POST /v1/sessions/{sessionId}/access` — post-pass email capture (only after a `passed` session).

Legacy routes `/api/chat` and `/api/access` exist for the in-repo `/doorcheck` experience and are also authenticated by API key. The public OpenAPI contract lives in [`docs/api/openapi.yaml`](./docs/api/openapi.yaml).

### Platform (admin app under `/admin`)

- Email-based platform login (`AUTH_SECRET` + Supabase Auth fallback) gated by [`middleware.ts`](./middleware.ts).
- Organisations, members, and invitation flow (`app/invite`, `app/signup`, `app/api/invitations/*`, `app/api/organisations/signup`).
- Org-scoped project list and a **multi-step project creation wizard** at [`app/admin/organisations/[orgId]/projects/new/page.tsx`](./app/admin/organisations/[orgId]/projects/new/page.tsx).
- Persona authoring under `app/admin/personas` and `app/api/admin/personas`.
- Live session feed (`components/admin/LiveConversations`) backed by Supabase Realtime, with score visibility and per-session detail at `app/api/admin/session`.
- API keys with `gk_test_` / `gk_live_` prefixes, hashed at rest, plaintext shown once on creation, with `last_used_at` and revoke (`lib/api-keys.ts`).

### Webhooks

- Webhook configuration tables and `verdicts` rows (migration [`20260422120000_phase4_webhooks_verdicts.sql`](./supabase/migrations/20260422120000_phase4_webhooks_verdicts.sql)).
- HMAC-signed deliveries enqueued from terminal turns ([`lib/verdict-webhook.ts`](./lib/verdict-webhook.ts)).
- Background drain via cron at `app/api/cron/webhook-deliveries` with retry/backoff.

### SDK (`@groucho/sdk`)

Published from [`packages/sdk`](./packages/sdk):

- `createClient` / `createServerClient` — headless HTTP clients (the latter is the only place a `gk_*` key should live in user code).
- `<Gatekeeper />` — batteries-included React component that runs a session against either a host-mounted proxy (`proxyBasePath`) or an injected client; surfaces the terminal outcome plus scores, optional success secret, and the extracted `profile`.
- Primitives — `GrouchoProvider`, `Transcript`, `Composer`, `OutcomeBanner`, `ThinkingIndicator`, `MessageBubble`, `useGroucho`.
- A single dark theme stylesheet at `@groucho/sdk/groucho.css` exposing CSS variables under `.groucho-root`.
- TypeScript types generated from the live OpenAPI spec; release flow runs through [Changesets](https://github.com/changesets/changesets) (`.github/workflows/release.yml`).

A reference consumer lives in [`examples/next-groucho`](./examples/next-groucho/) (Next.js app with a `/api/groucho/[...path]` proxy that attaches the secret server-side).

### Data layer

- Supabase Postgres with migrations under [`supabase/migrations/`](./supabase/migrations/).
- Multi-tenant core: `organisations`, `organisation_members`, `invitations`, `projects`, `api_keys`, `personas`, `sessions`, `messages`, `verdicts`, `webhooks`, plus `profiles` / `profile_eligibility` for post-pass email capture.
- Row-level security policies on every tenant table; an automated RLS test suite lives in [`lib/__tests__`](./lib/__tests__/).
- `sessions` were renamed from `conversations` mid-development (migration `20260410140000_rename_conversations_to_sessions.sql`); some historical code paths still bridge that.

### Operability

- Request tracing via `x-request-id` ([`lib/request-trace.ts`](./lib/request-trace.ts), [`lib/with-request-trace.ts`](./lib/with-request-trace.ts)).
- Structured logging ([`lib/logger.ts`](./lib/logger.ts)) with PII redaction; full `profile` payloads are not logged.
- Per-project rate limiting ([`lib/rate-limit.ts`](./lib/rate-limit.ts)) and bot signals ([`lib/bot-signals.ts`](./lib/bot-signals.ts)).
- Backfill script for legacy sessions without verdict rows: [`scripts/backfill-session-decisions.ts`](./scripts/backfill-session-decisions.ts).

---

### Onboarding flows (structured steps)

- Projects with `settings.project_type = "onboarding"` and `settings.flow_config.steps` run a **server-enforced** step engine ([`lib/post-onboarding-message.ts`](./lib/post-onboarding-message.ts)).
- The project wizard collects ordered questions (id, title, question, profile_key) and saves them in `flow_config`.
- Sessions track `current_step_id` and `flow_version`; the assistant asks **one configured question per turn** until all steps are answered, then extracts `profile` and completes with `passed`.
- `GET /v1/sessions/{id}` returns `projectType`, `flowVersion`, and `currentStep` while active.

## What it does **not** yet do

Per [`docs/PRD.md`](./docs/PRD.md) §3.2:
- **Billing** — stubs only; no real metering or invoicing.
- **BYO LLM provider keys** — all model calls go through the platform's own Anthropic credentials.
- **In-product role assignment or community recommender** — host applications are expected to consume `profile` + verdicts via webhook and apply their own rules.
- **Non-React framework SDKs** — only React is shipped; other hosts integrate via REST.

---

## Repository layout

```
app/                Next.js 16 App Router — admin UI, /v1 API, /doorcheck demo, /signup, /invite, /login
components/         Shared React components used by the admin app
docs/               PRD, ADRs, OpenAPI, schema migration notes, profile schema guide
examples/
  next-groucho/     Reference Next.js consumer of @groucho/sdk
lib/                Server-side primitives: scoring, project resolution, rate limiting, webhooks, logging, RLS-aware Supabase clients
loadtests/          k6-style load test scaffolding
middleware.ts       Auth + tracing edge middleware
packages/
  sdk/              @groucho/sdk (headless client, server client, React components)
prompts/            Source-of-truth prompt templates for the gatekeeper persona and scoring
scripts/            One-off ops scripts (e.g. backfill-session-decisions)
supabase/           Local Supabase config + SQL migrations
```

---

## Tech stack

- **Next.js 16.1** (App Router) on **React 19.2**
- **TypeScript 5**, **pnpm 11** workspaces (`packages/*`, `examples/*`), Node 22.13+
- **Supabase** (Postgres + Auth + Realtime + RLS) via `@supabase/ssr` and `@supabase/supabase-js`
- **Anthropic SDK** (`@anthropic-ai/sdk`) for the gatekeeper LLM and JSON-mode scorer
- **Tailwind CSS v4** + **motion** for the admin / demo UI
- **Vitest** for unit + RLS integration tests
- **Changesets** for SDK release management

---

## Running locally

See [`README.md`](./README.md) for the canonical setup. In short:

```bash
pnpm install
pnpm dev                # platform on :3000
pnpm run example:groucho  # reference consumer on :3001
pnpm test               # vitest
pnpm run sdk:build      # build @groucho/sdk
```

Environment variables (Supabase URL / anon / service-role key, `AUTH_SECRET`, `ANTHROPIC_API_KEY`, allow-listed platform emails) are documented in [`docs/database-setup.md`](./docs/database-setup.md).
