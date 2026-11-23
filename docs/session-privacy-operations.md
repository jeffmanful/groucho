# Session privacy, retention and deletion

Implemented in source on 13 November 2026. Not deployed or applied to a hosted database. The legal entity remains pending. This is a session lifecycle foundation, not a complete GDPR rights service or legal retention policy.

## Behaviour

- No retention policy is created automatically. Each project needs explicit `active_days`, `abandoned_days` and `completed_days` (whole days, 1–3650) and an `enabled` switch. Bounds are engineering limits, not recommended legal periods.
- Expiry uses the latest message timestamp, otherwise session creation time. Profile generation, admin edits and reviewer updates do not extend it. Form entries use creation time when they have no messages. Every status except `active` and `abandoned` uses `completed_days`.
- Expiry removes the entire session, including any membership/cohort entitlement linked to it. Choose periods that account for ongoing service obligations; do not enable a short transcript policy expecting entitlement records to remain. Separate retention by data class is future work.
- A read-only preview works for disabled policies. Enable only after reviewing the affected sessions and approved periods. Lowering a period can make existing sessions immediately eligible at the next drain.
- Active holds block both requested deletion and automatic expiry. Holds have a reason code and expire within 366 days; renewal requires another explicit operation. Keep the actual justification, reviewer, authority and review dates in the restricted operational case record, not applicant chat text.
- Deletion is transactional and idempotent for the same internal session UUID. A failure rolls back the receipt and data changes. No email, transcript or raw session identifier is copied into the receipt.
- A private pseudonymous suppression ledger blocks reuse of erased client session keys and internal IDs within their project. Session identity cannot be reassigned. Start/message/entry creation returns HTTP 410 for a replayed key. A genuinely new application can use a new key; this is not an email ban.
- FK cascades block late completion/assessment writes from recreating session children. Access-profile capture locks the session and writes profile/link atomically, preventing the former orphan-email race. Session-message activity and the retention recheck share a parent-row lock.
- Legacy `profiles` and `profile_eligibility` now have RLS enabled and browser-role access revoked. Server access remains available. All new lifecycle tables/RPCs are service-only, with authenticated server routes responsible for tenant and admin checks.

## API operations

These are internal admin routes, not additions to the public SDK. Use an authenticated platform operator or an organisation owner/admin. Resolve the project in its organisation; a client session key is not the internal UUID used below. Cookie-authenticated mutations also require an `Origin` header matching the request origin. Responses use `Cache-Control: no-store`.

Base: `/api/admin/organisations/{orgId}/projects/{projectId}`.

| Route | Request / result |
| --- | --- |
| `GET {base}/privacy` | Policy and at most 100 currently eligible session UUIDs/expiry times. Preview includes disabled policies and excludes active holds. It does not delete anything or return a complete count. |
| `PUT {base}/privacy` | `{ "enabled": false, "active_days": 30, "abandoned_days": 30, "completed_days": 90 }`. Example values only; choose justified periods. Save disabled, preview, then explicitly enable. |
| `GET {base}/sessions/{sessionId}/privacy` | Current hold metadata for that scoped session, or 404. |
| `PUT {base}/sessions/{sessionId}/privacy` | `{ "reasonCode": "rights_request", "expiresAt": "<future ISO timestamp>" }`. Codes: `rights_request`, `legal_claim`, `legal_obligation`. |
| `PATCH {base}/sessions/{sessionId}/privacy` | `{ "releaseHold": true, "confirmSessionId": "<internal UUID>" }`. Explicitly release a hold. |
| `DELETE {base}/sessions/{sessionId}/privacy` | `{ "confirmSessionId": "<internal UUID>" }`. Returns `deletion: { receiptId, erasedAt, alreadyErased }`. A live hold returns 423; an out-of-scope/unknown record returns 404. |

These endpoints do not verify an applicant's identity or decide whether an erasure exception applies. Before deleting, an authorised operator must validate the request with the controller, find all relevant sessions across its authorised projects, check holds and record any downstream actions required. Deleting one session does not delete every record about the same person in every client organisation.

## Deletion coverage and boundaries

The migration relies on existing FK cascades for messages/metadata, session profiles, connection signals, completion jobs, LLM usage, verdict payloads, webhook deliveries, decision/correction/outcome history, entry identifiers, eligibility links and cohort membership/move records. Cultural source-event deletion invalidates historical project snapshots through the existing trigger.

The transaction also deletes an application invitation whose assigned session key matches; removes linked or matching legacy profiles only when no remaining session/eligibility needs them; and removes duplicate-review notes for identifiers with no remaining matching project entry. Shared profiles are preserved across tenants. Project-level configuration and allocation run summaries remain.

This does not identify arbitrary mentions of a person in another applicant's transcript, reviewer free text or project configuration. Such material requires scoped review. Expired/unredeemed invitations without a session, staff accounts, logs, vendor retention and general project-level data need separate schedules. Browser local/session storage needs separate expiry/clearing work; a server deletion cannot remotely clear an offline device.

Already-delivered exports/webhooks, provider requests and webhook HTTP requests already in flight cannot be recalled by this transaction. Notify recipients and fulfil their deletion/retention obligations through the operational process. The implementation does not claim provider deletion or cancellation of an in-flight model call.

## Migration and scheduling

Apply [the privacy migration](../supabase/migrations/20261113165156_session_privacy_retention.sql) before deploying the updated access-capture route. Missing lifecycle RPCs fail closed rather than falling back to the old non-atomic write sequence. No hosted migration was run during implementation.

The migration registers a `pg_cron` job at minute 43 each hour, following the existing database abandonment scheduler. It calls `process_session_retention(100)` and does nothing without enabled project policies. Each call deletes at most 100 sessions; monitor backlog and runtime before increasing frequency/limits. PostgreSQL policy/hold checks and deletion share a transaction; a database failure rolls back that drain. No provider call runs inside it.

An alternative hosting scheduler can call `GET /api/cron/session-retention` with `Authorization: Bearer <CRON_SECRET>`; missing configuration returns 503 and an invalid secret returns 401. Prefer one scheduler. No hosting schedule has been installed. Keep cron credentials server-side.

Before activation in each environment: verify applied migrations and service-role grants, run Supabase security advisors, exercise a synthetic deletion and replay, verify holds and the disabled-policy preview, inspect cron execution history, and confirm tenant isolation. Rehearse real multi-connection races for starts, messages, holds, access capture and competing drains in staging; the embedded engine verifies transactional behaviour and late writes but is not a multi-connection load test.

## Receipts and restore procedure

`private.session_erasure_receipts` stores project/organisation references, SHA-256 hashes of the internal UUID/client key, a random receipt ID, reason code and deletion time. Hashes are pseudonymous personal data, particularly if a client key is predictable. Limit access accordingly. They intentionally have no automatic expiry until replay, recovery and evidence requirements have an approved lifecycle; do not describe this as unlimited lawful retention.

Keep a protected deletion ledger outside the backup being restored, with an approved retention/access policy. A point-in-time restore can otherwise restore both deleted records and an older version of the suppression ledger. Before returning a restored database to service, reconcile later receipts, find restored rows using the same project-scoped identifier hashes, re-run erasure and verify dependent/derived deletion. Restoring a receipt alone does not erase an already-restored row. Preserve the original receipt/time in the restricted recovery record. Hold and rights decisions must also be reconciled. Automating this recovery orchestration is outstanding.

Record recipient follow-up separately; a database receipt proves the Groucho transaction, not erasure from backups or third-party systems.

## Verification and outstanding launch work

`lib/__tests__/session-privacy-database.test.ts` replays the repository migrations in embedded PostgreSQL with synthetic records and checks real FK cascades, correction history, rollback, suppression, shared-profile preservation, policy classes, holds and browser/service-role grants. Supabase auth/cron services are stubbed; the historical seed's SHA-256 digest uses PostgreSQL's built-in equivalent. It does not verify the Supabase control plane, PostgREST schema cache, cron execution or deployed backups. Route tests cover authorisation denial, origin checks, confirmation, tenant parameters, preview, validation, secret handling and sanitised errors.

Still required before real-applicant launch: approved purpose-based periods, applicant notice, request intake/identity checks, complete access/export/rectification/restriction workflows, browser cleanup, provider/recipient procedures, restore drill and deployed verification. Legacy `expose_to_anon_read` session/message policies also need a separate access review: do not enable public transcript reads for real applicants. The old platform realtime dashboard path depends on that historical mechanism and needs an authenticated replacement before retiring it. See [compliance workstream](compliance-review.md).

Verification recorded for this change: 50 focused privacy/access/start/completion tests passed; TypeScript and lint on changed TypeScript files passed. The full suite reported 871 passed, 7 skipped and 3 culture-route contract failures; the same three failures reproduced on an untouched temporary checkout of HEAD. Supabase local advisors and applied-migration listing could not connect because the local Supabase database was unavailable. Embedded SQL verification passed; deployed advisor/migration checks remain required.
