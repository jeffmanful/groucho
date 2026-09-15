# Groucho v1 — GitHub / Linear issue breakdown

Copy titles into issues; **Epic** labels: `phase-0` … `phase-6`. **Depends on** links use GitHub “blocked by” or Linear relations.

Reference docs: [PRD.md](./PRD.md), [schema-migration.md](./schema-migration.md),
[client-decision-policy.md](./client-decision-policy.md),
[api/openapi.yaml](./api/openapi.yaml), [sdk-surface.md](./sdk-surface.md).

---

## Phase 0 — Baseline (documentation / freeze) — **complete**

| Title | Type | Description |
|-------|------|---------------|
| Document Phase 0 reference implementation | chore | Link doorcheck, `/api/chat`, `/api/access`, admin live view, scoring; tag release `demo-0.x`. |
| Pin Anthropic model + env vars in README | docs | List required env for reproducible demo (no secrets). |

**Depends on:** nothing.

---

## Phase 1 — Multi-tenant data plane — **feature complete**

| Title | Type | Status | Description |
|-------|------|--------|-------------|
| Migration: organisations + members + invitations | feature | done | Tables per PRD; seed migration for dev single-tenant backfill. |
| Migration: projects + api_keys | feature | done | `key_hash`, `key_prefix`, `revoked_at`, FK to org. |
| Migration: add org_id/project_id to sessions/messages | feature | done | Nullable → backfill → NOT NULL on `sessions` (formerly `conversations`); see [schema-migration.md](./schema-migration.md). |
| RLS policies: org isolation | feature | done | `api_keys` RLS (no policies — blocks anon); `sessions`/`messages` SELECT for anon/authenticated scoped to `projects.expose_to_anon_read`; org/member/invitation tables RLS for authenticated; second-org fixture `fixture_b` / `isolated`. |
| Service-role chat path: resolve project from API key | feature | done | `lib/project-resolution.ts` + `/api/chat` + `/api/access` default project scope; optional `GROUPCHO_REQUIRE_API_KEY` / `GROUPCHO_DEFAULT_PROJECT_ID`. |
| Rename `conversations` → `sessions` (optional) | chore | done | Migration `20260410140000_rename_conversations_to_sessions.sql`; `messages.session_id`; app + admin realtime updated. |
| Client-owned decision policy | feature | done | `sessions.suitability_score`; immutable human/policy decisions; configurable acceptance/review bands; independent automatic acceptance and decline; score-first admin sorting. |

**Depends on:** Phase 0 doc complete (soft).  
**Blocks:** Phase 2.

---

## Phase 2 — Platform MVP (control plane) — **feature complete**

| Title | Type | Status | Description |
|-------|------|--------|-------------|
| Auth: org signup + invite accept flow | feature | done | **Invites** + **self-serve** as before. **Org console:** middleware allows `/admin` + `/api/admin/*` with Supabase session or `pe_auth`; `resolveAdminActor()` + `requireOrgMember` / `requireOrgAdmin` / `requireOrgOwner` / `requirePlatform` on routes. **`GET /api/admin/session`**. **`POST /api/auth/logout`** clears `pe_auth` + `signOut()` Supabase. Migration `20260421130000_sessions_rls_org_members.sql` — authenticated users read sessions/messages for projects in orgs they belong to. |
| UI: organisation settings (name, slug, members) | feature | done | **`/admin/organisations`** — platform-only create org; members see their orgs only. Org detail uses **`GET /api/admin/organisations/[orgId]/access`** — member read-only vs admin vs owner (delete org / invite owner). **Personas** nav + mutations platform-only; members read list at `/admin/personas`. **LiveConversations** uses `createSupabaseBrowserClient()` so JWT + RLS apply. |
| UI: Multi-step project wizard | feature | done | **`/admin/organisations/[orgId]/projects/new`** — scope, gate behaviour, optional webhook fields (stored in `projects.settings`), review, create + API key ceremony; “Guided setup” link on org detail. See [platform-project-wizard.md](./platform-project-wizard.md). |
| UI: API keys list + revoke + last used | feature | done | Org detail → project: list, create (secret once), revoke via `/api/admin/.../api-keys`. |
| UI: Project-scoped session list (read-only) | feature | done | Org detail → project: session list + **transcript** (`GET .../sessions/[sessionId]/messages`). |

**Depends on:** Phase 1 migrations + key resolution (full tenant RLS can land during Phase 2).  
**Blocks:** Phase 3.

---

## Phase 3 — Public project API — **feature complete**

| Title | Type | Status | Description |
|-------|------|--------|-------------|
| Mount OpenAPI contract under `/v1` | feature | done | **`POST /v1/sessions/{sessionId}/messages`**, **`GET /v1/sessions/{sessionId}`**, **`POST /v1/sessions/{sessionId}/access`** ([docs/api/openapi.yaml](./api/openapi.yaml)). Shared handler [`lib/post-session-message.ts`](../lib/post-session-message.ts); `POST /api/chat` unchanged. Middleware allows `/v1/`. |
| Contract tests: PostMessage 200/409/503 | test | done | `vitest` module-mocked contract tests: `lib/__tests__/contract-post-message.test.ts` (200/409/503 + 429). |
| Rate limit: per API key + per session | feature | done | Lightweight in-memory limiter in `lib/rate-limit.ts` enforced by `lib/post-session-message.ts` (per api key + per project/session) and `/v1/.../access` (429 + `Retry-After`). Env: `GROUCHO_RL_API_KEY_PER_MINUTE`, `GROUCHO_RL_SESSION_PER_MINUTE`. |
| Normalise outcome enum PASS/REDIRECT/REJECT | chore | done | [`lib/session-outcome.ts`](../lib/session-outcome.ts); these are advisory compatibility outcomes, separate from the client decision policy. |

**Depends on:** Phase 1 key resolution.  
**Blocks:** Phase 5 (SDK against stable API).

---

## Phase 4 — Webhooks + verdicts — **feature complete**

| Title | Type | Status | Description |
|-------|------|--------|-------------|
| Migration: webhooks + verdicts tables | feature | done | `20260422120000_phase4_webhooks_verdicts.sql` — `webhooks`, `verdicts` (one per session), `webhook_deliveries`; service_role grants; HTTPS URL check. |
| Worker: deliver webhook with HMAC + retries | feature | done | `lib/verdict-webhook.ts` — HMAC-SHA256 body signature, `GET /api/cron/webhook-deliveries` + `CRON_SECRET` drains pending queue with backoff + max attempts. |
| UI: webhook CRUD under project | feature | done | Org project panel: list, add (secret once), toggle active, rotate secret, test ping, delete; admin API under `/api/admin/.../projects/[projectId]/webhooks`. |
| Event payload schema v1 | docs | done | [event-payload-session-completed.schema.json](./event-payload-session-completed.schema.json) for `session.completed`. |

**Depends on:** Phase 3 session completion path emits verdict row.  
**Blocks:** Phase 6 hardening (partially).

---

## Phase 5 — `@groucho/sdk` v1 — **feature complete** (first npm publish still pending)

| Title | Type | Status | Description |
|-------|------|--------|-------------|
| Monorepo: `packages/sdk` scaffold | chore | done | npm workspaces; `packages/sdk` with `tsup`, exports for `.`, `./react`, `./server`, `./groucho.css`. |
| Implement `createClient` + types from OpenAPI | feature | done | `openapi-typescript` → `src/generated/openapi.ts`; `createClient`, `GrouchoApiError`, `createServerClient` in `./server`. |
| Implement `Gatekeeper` + primitives | feature | done | `GrouchoProvider`, `Gatekeeper`, `Transcript`, `Composer`, `OutcomeBanner`, `ThinkingIndicator`; default dark tokens in `styles/groucho.css`. |
| Example: `examples/next-groucho` with proxy route | docs | done | `GET/POST /api/groucho/[...path]` forwards with `GROUPCHO_API_KEY`; local `middleware.ts` so the example does not inherit repo-root auth middleware. |
| Publish npm (private or public) | chore | pending | Changesets + [`release.yml`](../.github/workflows/release.yml) on `main` (pnpm); add `NPM_TOKEN` and land the first changeset. |

**Depends on:** Phase 3 OpenAPI stable (can stub until then).  
**Parallel with:** Phase 4 optional.

---

## Phase 6 — Hardening — **feature complete**

| Title | Type | Status | Description |
|-------|------|--------|-------------|
| Observability: structured logs + trace ids | feature | done | `lib/logger.ts` JSON lines; `x-request-id` / `x-correlation-id` via `lib/with-request-trace.ts` + middleware for `/v1/*`, `/api/chat`, `/api/access`; echoed on responses; chat path logs include `requestId`, `projectId`, `sessionId` where applicable. |
| Load test: chat path k6 | test | done | [`loadtests/k6/chat-messages.js`](../loadtests/k6/chat-messages.js) — p95 &lt; 5s threshold (PRD NFR-PERF-1 draft). |
| Backup + retention policy doc | docs | done | [backup-retention.md](./backup-retention.md). |
| Security review checklist | docs | done | [security-review-checklist.md](./security-review-checklist.md). |

**Depends on:** Phases 1–4 in place.

---

## Phase 6.5 — Profile v1 (persona-scoped) — **feature complete**

| Title | Type | Status | Description |
|-------|------|--------|-------------|
| FR-PROFILE-1 — Persona-level `profile_schema` (JSON Schema) | feature | done | Migration `20260511220000_personas_profile_schema.sql` adds `personas.profile_schema jsonb` + `personas.profile_extractor_hint text`. Admin persona form accepts paste-JSON (parse-on-blur) + short hint; PUT/POST validate `{ type:"object", properties:{...} }`. |
| FR-PROFILE-2 — Extraction module | feature | done | [`lib/profile-extraction.ts`](../lib/profile-extraction.ts) — single Anthropic call, fixed `core` + per-persona `custom`; clamp / drop-unknown-keys; PII redaction (email + E.164) in `core.summary` and `core.qa[*].answer`. Unit tests in `lib/__tests__/profile-extraction.test.ts`. |
| FR-PROFILE-3 — Versioned payload + event schema | feature | done | `Profile` carries `schema_version: 1` + `core` + `custom` + `extraction`; [`profile-payload.schema.json`](./profile-payload.schema.json); extended [`event-payload-session-completed.schema.json`](./event-payload-session-completed.schema.json) with optional `profile`. |
| FR-PROFILE-4 — Wired into verdict + webhook + post-session-message | feature | done | `recordVerdictAndEnqueueWebhooks` extracts profile based on `projects.settings.profile_extract_on` (defaults to all three terminal statuses); persona + transcript plumbed from `post-session-message.ts`. |
| FR-PROFILE-5 — `GET /v1/sessions/{id}` exposes `profile` | feature | done | Reads latest `verdicts.payload.profile`. OpenAPI updated; SDK types regenerated. |
| FR-PROFILE-6 — SDK `onOutcome` carries `profile` | feature | done | `packages/sdk/src/react/Gatekeeper.tsx` forwards `profile` when `sendMessage` response includes it; `Profile` / `ProfileCore` / `ProfileExtraction` re-exported. |
| FR-PROFILE-7 — Admin Profile panel + PII masking | feature | done | Session detail under org page shows `core` chips + Q/A + custom fields. Fields whose schema entry has `"x-pii": true` are masked; **Reveal** button shown to org admins only. |
| FR-PROFILE-8 — Author guide | docs | done | [profile-schema-guide.md](./profile-schema-guide.md). |

**Depends on:** Phase 4 verdict pipeline.

---

## Phase 7 — v1.5+ (backlog epics)

| Title | Type | Description |
|-------|------|---------------|
| BYO LLM keys (encrypted, server-only routing) | feature | Per org/project; never browser. |
| Billing: Stripe customer + metered usage | feature | Stub hooks from PRD. |
| Admin: stats header + CSV export | feature | [03-admin-dashboard.md](../prompts/03-admin-dashboard.md) bonus. |
| Streaming responses (optional) | spike | AI SDK vs DB consistency ADR. |
| Profile v2 — deterministic step engine for structured onboarding | spike | PRD §6.7. |

---

## Suggested first sprint (after Phase 1 merge)

1. Migration: organisations + members (minimal).  
2. Migration: projects + api_keys + backfill single dev org/project.  
3. RLS smoke tests.  
4. Internal only: project picker in existing admin.

---

## Labels (suggested)

`area/platform`, `area/api`, `area/sdk`, `area/db`, `type/feature`, `type/chore`, `type/docs`, `priority/p0`
