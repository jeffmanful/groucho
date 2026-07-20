# Database setup (Groucho)

Short guide for getting **Postgres + Supabase** aligned with this repo’s migrations so you can run the app and iterate locally.

**Related:** [schema-migration.md](./schema-migration.md) (Phase 0 → v1 model), [.env.example](../.env.example), [supabase/config.toml](../supabase/config.toml)

---

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed (`supabase --version`).

---

## Option A — Local Supabase (recommended to start)

From the **repository root**:

1. **Start the stack** (Postgres, API, Studio, etc.):

   ```bash
   supabase start
   ```

2. **Apply all migrations** (creates `sessions` — renamed from `conversations` in `20260410140000_*` — plus `messages`, `personas`, `profiles`, realtime, etc.):

   ```bash
   supabase db reset
   ```

   Use `db reset` when you want a clean DB; it replays every file under `supabase/migrations/` in order.

3. **Copy connection values** into `.env.local` (create from [.env.example](../.env.example)):

   ```bash
   supabase status
   ```

   Map the printed values to:

   | Env var | Typical source |
   |---------|----------------|
   | `NEXT_PUBLIC_SUPABASE_URL` | API URL (e.g. `http://127.0.0.1:54321`) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` **public** key |
   | `SUPABASE_SERVICE_KEY` | **`service_role` key — server only**, never expose to the browser |

4. **Set app auth env vars** (demo login / middleware), still required for the full app:

   - `AUTH_SECRET`, `ALLOWED_EMAILS`, `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY` (see `.env.example`).
   - Gatekeeper conversational turns default to the pinned `claude-haiku-4-5-20251001` model. Set `GROUCHO_GATEKEEPER_CONVERSATION_MODEL` server-side to test another model without changing code.

5. **Smoke check:** open Supabase **Studio** (URL from `supabase status`) → **Table Editor** → confirm `personas` has the seeded Lou row and tables exist.

---

## Option B — Hosted Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. From repo root: `supabase link --project-ref <your-project-ref>`.
3. Push migrations: `supabase db push` (applies the same `supabase/migrations/*.sql` chain to remote).
4. In Dashboard → **Settings → API**, copy URL and keys into `.env.local` / your host’s secrets (same variable names as above).

---

## What you get today (Phase 0 + Phase 1 data plane)

Migrations define the demo schema plus **multi-tenant core** (from `20260410120000_phase1_multitenant_core.sql` onward): `organisations`, `projects`, `organisation_members`, `invitations`, `api_keys`, and `organisation_id` / `project_id` on **`sessions`** and `messages` (`messages.session_id` references `sessions.id`). A clean `supabase db reset` seeds a **Development** org, **Default gate** project, and one test API key.

**Local test API key (seed only — rotate in production):** `gk_test_local_dev_secret_key`. Send it as `Authorization: Bearer gk_test_local_dev_secret_key` on `POST /api/chat` to resolve that project. Without a Bearer token, the server uses the first project by `created_at` (the seed default), unless you set `GROUPCHO_REQUIRE_API_KEY=true` or `GROUPCHO_DEFAULT_PROJECT_ID=<uuid>` in `.env.local`. See [.env.example](../.env.example).

The **access gate** (`GET /api/access`) resolves the default project the same way (no Bearer in that flow), so it stays aligned with unauthenticated doorcheck clients.

**RLS (Phase 1):** After `20260410130000_phase1_rls_and_fixture_org.sql` (policies recreated on `sessions` in `20260410140000_rename_conversations_to_sessions.sql`), anon/authenticated **SELECT** on **`sessions`** and `messages` is limited to the single project where `expose_to_anon_read = true` (the seeded **Default gate**). Other tenants’ rows are hidden from the anon admin client and Realtime. Server routes use the **service_role** client and are unaffected. Set `expose_to_anon_read` on at most one project; use `GROUPCHO_DEFAULT_PROJECT_ID` if the API default should differ (documented caveat: anon admin still follows `expose_to_anon_read` until the dashboard uses membership).

A second org **`fixture_b`** / project **`isolated`** is seeded for isolation checks (no API key, no anon read scope).

Further control-plane UI is tracked in [roadmap-github-issues.md](./roadmap-github-issues.md) (Phase 2).

---

## Phase 2 — Two auth paths (operators vs platform admin)

1. **`pe_auth` (HMAC cookie)** — Used for **`/admin`** after [`/login`](../app/login) with `ALLOWED_EMAILS` + `ADMIN_PASSWORD`. Full org/project/API-key management uses the **service role** server client.
2. **Supabase Auth (anon key + cookies)** — Used for **invited org members** at **`/invite/[token]`**: they request an **email OTP**, verify with Supabase, then **`POST /api/invitations/accept`** creates **`organisation_members`** when the signed-in email matches the invite.

**Supabase Dashboard:** enable **Email** sign-in; under **Authentication → URL configuration**, set **Redirect URLs** to include `http://localhost:3000/invite/**` (and production `https://<host>/invite/**`) so OTP and redirects work.

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| Port conflicts | Change ports in `supabase/config.toml` or stop other services using `54321` / `54322`. |
| Migration errors | Read the failing migration filename; fix SQL, then `supabase db reset` locally again. |
| `uuid_generate_v4() does not exist` | Migrations use **`gen_random_uuid()`** (no `uuid-ossp`). Pull latest migrations; if a remote DB partially applied an old revision, repair or create a fresh project before `db push`. |
| **`42501` permission denied for table `sessions`** | 1) Confirm **`SUPABASE_SERVICE_KEY`** is the **`service_role`** JWT from Supabase (Settings → API), **not** the `anon` key — then restart `next dev`. 2) Run migrations including `20260409120000_grant_app_tables_to_api_roles.sql` and `20260410140000_rename_conversations_to_sessions.sql`, then `supabase db reset` (local) or `db push` (remote). 3) In Dashboard, if you turned on **RLS** on `sessions` without policies, add policies or disable RLS for the demo (service_role bypasses RLS only when the JWT role is actually `service_role`). |
| App can’t write chat | Confirm `SUPABASE_SERVICE_KEY` is the **service_role** key, not the anon key. |
| **Invite OTP / accept fails** | Check **Redirect URLs** and **Site URL** include `/invite/**`. Confirm the invitee signs in with the **same email** as on the invitation. |

---

## Revision

| Date | Change |
|------|--------|
| 2026-04-08 | Initial team setup doc |
| 2026-04-07 | Phase 1 seed key, env vars, access gate default project |
| 2026-04-07 | Phase 1 RLS: `expose_to_anon_read`, fixture org `fixture_b` |
| 2026-04-07 | Phase 2: dual auth, invite URLs, invite troubleshooting |
