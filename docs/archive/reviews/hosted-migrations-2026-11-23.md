# Hosted Groucho migrations — 23 November 2026

Target: Groucho production Supabase project `qqbvcmqzwtifpyufkxhh`, verified against the linked project and application URL. User authorised all necessary migrations. No application deployment or retention activation was performed.

## Conversation quality

Will this change positively or negatively affect the conversation experience? Expected neutral conversation wording and continuity, with improved operational support for applicant signals and privacy. Privacy adds session/message locking and prevents identity reassignment; verified normal service-role writes. No automatic erasure is enabled. Existing applicant records must remain intact.

## Applied

- `20261027200000_applicant_signals.sql`: six connection-signal columns, constraint and indexes.
- `20261108210754_refresh_disposable_email_domains.sql`: disposable-domain snapshot; Apple privacy relays excluded from disposable flags.
- `20261113165156_session_privacy_retention.sql`: service-only lifecycle tables/functions, replay guards, message activity locking and hourly cron. No policies were created or enabled, so the scheduler has no eligible sessions.

Applied through the Supabase connector. Its generated migration timestamps were aligned to the repository versions after successful application. The previously applied `persona_preview_isolation` SQL was compared with the repository and matched after whitespace normalization; its historical timestamp was aligned without rerunning the policies. All 40 local migration versions/names now match hosted history, with no pending migrations.

## Verification

- Before/after: 502 sessions and 5,114 messages. No real applicant records erased. Forum Application still uses `conversation_v1` and `colors_forum` review.
- Six signal columns present; disposable-domain table grew from 29 to 70 entries; neither Apple relay domain is flagged.
- Zero retention policies, zero eligible sessions and zero erasure receipts. Cron registered at minute 43 each hour.
- New lifecycle tables have RLS enabled and no browser SELECT grants. All seven new functions use invoker security, reject browser-role execution and allow service-role execution.
- Embedded PostgreSQL migration/privacy suite: 10 tests passed.
- Live synthetic transaction under `service_role`: session/message creation, atomic access capture, hold rejection, hold release, erasure cascade, repeat erasure and erased-key suppression passed. Entire transaction rolled back, including synthetic records and receipt.
- Security advisor warning categories/counts unchanged from baseline. Three extra RLS-without-policy informational findings correspond to the intentionally service-only lifecycle tables. Existing function search-path/definer and leaked-password-protection warnings remain separate work; see [Supabase database linter](https://supabase.com/docs/guides/database/database-linter).

This verifies the database operation, not deployment of the privacy HTTP routes, legal retention periods, backups or downstream deletion workflows. Privacy operational launch requirements remain in `docs/session-privacy-operations.md`.
