# Database schema map

Current schema authority is the ordered SQL in [supabase/migrations](../supabase/migrations), not the retired Phase 0 migration proposal. Reviewed against source on 2 November 2026; verify applied migrations in the intended database separately.

| Area | Records / purpose |
| --- | --- |
| Tenant/configuration | `organisations`, `organisation_members`, `invitations`, `projects`, `api_keys`, project settings audit |
| Persona library | `personas`, organisation visibility grants, `persona_versions`, source/version lineage for clones |
| Conversations | `sessions`, `messages`; intake and audience snapshots are distinct from extracted profiles |
| Assessment/completion | Session profile/suitability, final-message reviewer metadata, `session_completion_jobs`, `verdicts` |
| Decisions | `application_decisions`: append-only decisions/corrections, one current decision per decided session |
| Allocation | `allocation_rounds`, `cohorts`, membership and allocation/move history |
| Delivery | `webhooks`, `webhook_deliveries`; signed events and retry state |
| Application invitations | `application_invitations`: hashed, scoped tokens and one assigned conversation |
| Cultural signals | Project-scoped derived observations/snapshots with source deletion dependencies |

`sessions.session_id` is the client-provided key. `sessions.id` is the internal UUID referenced by `messages.session_id` and completion jobs. Do not join a client key as if it were the internal ID.

## Permissions

Server routes use the service-role client and must enforce organisation/project scope themselves. RLS and Data API grants are separate controls. Do not infer that possession of an anon key authorises admin/reviewer access. Inspect actual migrations/policies; some historical demo-read policies have a narrower `expose_to_anon_read` purpose, not a production tenant-dashboard design.

Persona ownership, platform access, invitation-only application tables, decision corrections and key scopes were added by later migrations. Replaying the early base schema alone is insufficient. See [ownership](persona-ownership.md), [admin access](admin-access.md), [decision policy](client-decision-policy.md) and [COLORS pilot](colors-admin-pilot.md).

## Changes

Apply schema changes with migrations. Public-demo activation only merges project JSON settings; it is not a schema migration. Do not rewrite a deployed migration to make a fresh local database pass. Check an upgrade path and a disposable clean reset, including function grants, triggers and role checks.

Profiles, report metadata and aggregate derived data may contain different views of the same session. Test deletion/correction effects through all dependencies and external deliveries; see [retention](backup-retention.md). No universal automatic retention policy is implied by this schema map.
