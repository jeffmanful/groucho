# Database and server setup

Reviewed 2 November 2026. Use [the schema map](database-schema.md) and ordered migrations as the database reference. Authentication setup is maintained in [authentication](authentication.md), not a separate legacy operator-only recipe.

## Local environment

Use the repository's configured Node/package-manager versions and install dependencies. With the Supabase CLI available, run `supabase start`, inspect `supabase status`, and populate an ignored `.env.local`:

| Variable | Source / purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Intended local/hosted API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public auth client key |
| `SUPABASE_SERVICE_KEY` | Server-only service-role key for that same project |
| `AUTH_SECRET` | Server cookie-signing secret |
| `ANTHROPIC_API_KEY` | Backend provider credential |
| `CRON_SECRET` | Authenticated completion/webhook drain |

`supabase db reset` recreates the local database and replays migrations: use it only for a disposable local stack. Inspect the seed and create/select the intended organisation/project/persona before testing. Do not assume a seed persona is suitable for a new public demo.

Use server-held project keys for `/v1` integrations. Legacy defaults in `lib/project-resolution.ts` (`GROUPCHO_REQUIRE_API_KEY`, `GROUPCHO_DEFAULT_PROJECT_ID`) support older in-repo paths; the spelling is intentional compatibility. They are not the configuration contract for a new public website. Do not copy a seed key into production.

## Hosted environment

Link the intended project with `supabase link --project-ref <project-ref>`, review unapplied SQL, then use `supabase db push` under the normal deployment process. Check service-role grants and RLS independently. Configure the host with keys for that project and apply auth redirect/provider settings from the authentication guide. Re-deploy/restart processes after environment changes.

Do not use `db reset` as hosted migration recovery or disable RLS to work around a write failure. Check the failing migration, correct service-role credential, server authorisation and grants first. Record a forward migration for an already-deployed schema change.

## Runtime checks

- Engine and model are separate settings. `lib/gatekeeper-models.ts` selects defaults/overrides; COLORS/public demos use the newer engine selector, not necessarily the standard gatekeeper default.
- Account credits alone do not validate the deployed Anthropic key. Confirm the backend deployment uses the intended credential; the demo website holds Groucho project keys, not provider keys.
- Completion and webhook retries require the authenticated drain route in `app/api/cron/webhook-deliveries/route.ts` and the intended hosting schedule. Public simulations suppress those completion jobs.
- Project and persona settings may be cached per process for about a minute.
- Use synthetic identities for live checks; model-backed checks create records and incur usage.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing table/column | Applied migration chain and correct target database |
| Permission denied / `42501` | Service-role credential, Data API grants, RLS and server authorisation; retain protections |
| Invite/Google sign-in failure | Site URL, allowed redirect, provider and matching verified identity |
| Wrong character or old runtime | Project key, engine/profile settings, active accessible persona and fresh session |
| Missing assessment | Completed real application, completion-job stage/retry and provider configuration; no assessment is expected for public simulations |

See [shared engine](reusable-conversation-engine.md), [decision policy](client-decision-policy.md) and [retention/recovery](backup-retention.md) before operating production data.
