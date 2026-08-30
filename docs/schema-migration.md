# Schema migration: current Groucho demo → v1 multi-tenant model

**Purpose:** Map existing Supabase tables to the v1 **organisation / project / session** model, note gaps, and define a **Row Level Security (RLS)** matrix for implementation.

**Sources:** `supabase/migrations/*.sql`, [app/api/chat/route.ts](../app/api/chat/route.ts), [app/api/access/route.ts](../app/api/access/route.ts)

---

## 1. Current schema (Phase 0)

### 1.1 `sessions` (renamed from `conversations`)

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID PK | Internal id |
| `session_id` | TEXT | Client-generated opaque id (browser `localStorage`); **unique per** `project_id` |
| `status` | TEXT | `active`, `passed`, `failed`, `redirected`, `rejected` |
| `redirect_reason` | TEXT | Optional |
| `persona_id` | UUID FK → personas | Added later |
| `success_secret` | TEXT | Legacy compatibility column; gatekeeper completion no longer writes it |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

**v1 mapping:** Table is now **`sessions`** (renamed from `conversations`). Further v1 work: add `mode` (live/dry-run), align `status` with v1 vocabulary (`in-progress` / `completed` / `abandoned`), map outcome to `outcome` enum (`PASS` / `REDIRECT` / `REJECT`). Keep `session_id` as opaque **client reference** alongside internal `id`.

| Current | v1 `sessions` |
|---------|----------------|
| `sessions.id` | `sessions.id` |
| `session_id` | `sessions.client_session_key` or keep name `session_id` |
| `status` | `sessions.status` + derived `sessions.outcome` |
| `persona_id` | FK to `project_personas` or `personas` scoped by `project_id` |
| `success_secret` | Deprecated for gatekeeper flows; human approvals use `application_decisions.access_secret` |

### 1.2 `messages`

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID PK | |
| `session_id` | UUID FK → `sessions.id` | Renamed from `conversation_id`. |
| `role` | `assistant` \| `user` | |
| `content` | TEXT | |
| `sent_at` | TIMESTAMPTZ | |
| `metadata` | JSONB | Stores `{ scores }` for user messages |

**v1 mapping:** `messages.session_id` (FK to `sessions.id`). Add `organisation_id` + `project_id` **denormalised** for RLS performance (optional but common). Roles align with v1: `user` / `assistant` (rename `assistant` only if you standardise on OpenAI-style; DB can keep `assistant`).

### 1.3 `profiles` / `profile_eligibility`

Matches post-pass email flow ([04](../prompts/04-email-flow.md)).

**v1 mapping:** Keep; add `organisation_id` (and optionally `project_id`) for tenant scope. `profile_eligibility.session_id` FK → `sessions.id`.

### 1.4 `personas`

| Column | Notes |
|--------|--------|
| `name`, `slug`, `prompt`, `is_active`, `is_default`, thresholds | Global in demo |

**v1 mapping:** Either:

- **`project_personas`:** `project_id`, persona fields, version; or  
- **`projects.gate_config` JSONB** for single-agent v1 and split later.

---

## 2. Target v1 tables (from PRD)

Cross-reference with [docs/PRD.md](./PRD.md) §8.2.

| Table | Purpose |
|-------|---------|
| `organisations` | Tenant root |
| `organisation_members` | User ↔ org + role |
| `invitations` | Pending org access |
| `projects` | Gate configuration + slug under org |
| `api_keys` | Hashed secrets, prefix, project scope |
| `sessions` | Runtime state, outcome, scores summary, mode |
| `messages` | Transcript + metadata |
| `verdicts` | Append-only outcome + reasoning + webhook state |
| `webhooks` | Endpoint + signing + events |
| `application_decisions` | Immutable human approval/decline, reviewer identity, reason, and approval-only access secret |

### 2.1 New / merged concepts

| Concept | Implementation note |
|---------|---------------------|
| **Verdict vs session** | `sessions` holds latest `outcome` for queries; `verdicts` is immutable audit row when conversation completes (feeds webhooks). |
| **Scores** | Latest aggregate optional on `sessions.score`; per-turn in `messages.metadata`. |
| **Profile** | `sessions.profile` jsonb (optional) vs normalised `profiles` table — use `profiles` for email; session may store anonymised traits only. |

### 2.2 Outcome vocabulary alignment

| Model string (today) | API / DB enum |
|----------------------|----------------|
| Terminal pass (with thresholds) | `PASS` |
| `REDIRECT` | `REDIRECT` |
| `REJECTED` (with thresholds) | `REJECT` (store `REJECT` in DB; map from string in one place) |
| `failed` (legacy) | Map to `abandoned` or `REJECT` per product decision |

---

## 3. Suggested indexes (v1)

```text
sessions (organisation_id, project_id, started_at DESC)
messages (session_id, sent_at ASC)
messages (organisation_id, project_id, sent_at DESC)  -- if denormalised
api_keys (project_id) WHERE revoked_at IS NULL
webhooks (project_id) WHERE active = true
profiles (organisation_id, email)
```

---

## 4. RLS matrix (high level)

**Principle:** Every tenant row carries `organisation_id`. Project-scoped tables also carry `project_id`. Policies use `auth.uid()` joined to `organisation_members`.

| Table | SELECT | INSERT | UPDATE | DELETE | Notes |
|-------|--------|--------|--------|--------|--------|
| `organisations` | Member of org | Service role / owner signup flow | Owner | Soft-delete only | |
| `organisation_members` | Self + admins see org roster | Invite flow | Admin updates role | Admin removes | |
| `invitations` | Admin/owner | Admin/owner | Token accept updates `accepted_at` | Admin revokes | |
| `projects` | Member | Admin | Admin | Admin | |
| `api_keys` | Admin (metadata only, never hash) | Admin | Admin revoke | — | **Never** expose `key_hash` to client |
| `sessions` | Member of org (+ optional project filter) | **API key role** via service role or custom claim | System / API | — | Public chat uses **validated API key**, not end-user JWT — see §4.1 |
| `messages` | Same as session parent | Same | — | — | |
| `verdicts` | Member | System only | Webhook worker updates `webhook_*` | — | |
| `session_completion_jobs` | System only | System only | Completion worker | System only | Service-role queue; no applicant or member policies |
| `webhooks` | Admin | Admin | Admin | Admin | |
| `profiles` | Admin / own email policy | Access API with service role | Upsert via controlled API | GDPR export only | |

### 4.1 Chat API authentication model

End-user applicants **do not** have Groucho logins. Recommended approach:

- **Route Handler** validates `Bearer gk_*`, resolves `project_id` + `organisation_id`, then uses **service role** Supabase client scoped by checks in code, **or**  
- Postgres **SECURITY DEFINER** functions that accept `session_id` + signed project token.

RLS alone with anon key is insufficient for arbitrary browsers unless you use **signed session JWTs** issued by Groucho. Document in implementation: either service-role + application checks or definer functions.

---

## 5. Migration sequence (recommended)

1. Add `organisations`, `organisation_members` (bootstrap single org for existing data).  
2. Add `projects`, link default **demo project**.  
3. Add nullable `organisation_id`, `project_id` to `conversations` / `messages`; backfill.  
4. Rename `conversations` → `sessions`; `messages.conversation_id` → `session_id` — see `20260410140000_rename_conversations_to_sessions.sql`.  
5. Add `api_keys`, `webhooks`, `verdicts`.  
6. Enable RLS + policies; run regression tests on chat + access routes.  
7. Remove global-only assumptions in app code (`lib/supabase.ts` patterns).
8. Apply `20260821100000_add_session_completion_jobs.sql` before enabling
   asynchronous gatekeeper terminal completion. The runtime retains an inline
   fallback until the queue is available.

---

## 6. Realtime (admin)

Current: Supabase Realtime on `sessions` / `messages`. **Phase 1:** RLS on `sessions` / `messages` limits anon/authenticated SELECT (and Realtime delivery) to the project flagged `expose_to_anon_read` (`public.anon_readable_project_id()`). **v1 later:** membership-based policies if the admin app moves off anon.

---

## 7. Checklist for engineers

- [ ] Single migration file per phase or use `supabase db diff`.  
- [ ] Backfill script for existing `session_id` rows → `sessions`.  
- [ ] Feature flag: read from new tables while writing dual-write if zero-downtime required.  
- [ ] Update [api/openapi.yaml](./api/openapi.yaml) when `session` resource shape stabilises.
