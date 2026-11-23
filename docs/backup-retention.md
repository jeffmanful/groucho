# Backup, retention, and deletion (Groucho v1)

Operational checklist, updated 13 November 2026. Configurable session retention, transactional deletion and expiring holds are now implemented in source; see [session privacy operations](session-privacy-operations.md) for activation, coverage and limitations. No project policy is enabled automatically. Provider recovery and approved retention periods remain deployment responsibilities. Verify against [the schema/migrations](database-schema.md).

## Data stores

- **Postgres (Supabase)** — primary tenant data: organisations, members, projects, API keys, sessions, messages, verdicts, immutable application decisions and policy snapshots, webhooks, webhook deliveries, profiles (where used).
- **Logs** — Vercel / platform logs; application logs use structured JSON (`lib/logger.ts`) with `requestId`, `projectId`, `sessionId` where applicable. **Do not** log API key secrets or full `Authorization` headers.

## Backups

- Rely on **Supabase** (or your Postgres provider) automated backups and point-in-time recovery according to your plan.
- Document **RPO/RTO** in your internal runbook; Groucho does not prescribe vendor-specific steps.

## Retention (policy decisions required)

Do not treat an active organisation account as sufficient justification to retain every applicant transcript. Set documented, purpose-based retention periods and deletion triggers per data class and client instruction. No universal GDPR duration applies; see [ICO storage limitation guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/). The following are policy decisions to resolve; the implemented session schedule removes the entire session and its dependent records together. Separate periods per data class remain future work. See the [compliance workstream](compliance-review.md).

| Class | Suggestion |
|-------|------------|
| Session transcripts + messages | Define separate periods/triggers for demos, abandoned applications and completed applications; include derived profiles and reports. Implement and verify expiry. |
| Verdicts / webhook delivery rows | Define the necessary operational/audit period, minimise retained payloads and account for recipient copies. |
| Application decisions / policy snapshots | Define the necessary explanation, dispute and legal-claim period. Append-only history does not create an unlimited retention exemption; scope and expire any justified hold. |
| API access logs (edge) | Verify the actual provider settings and data fields, then justify/configure the necessary period. Provider defaults are not a retention rationale. |

## Right to erasure / org deletion

Deleting an **organisation** should cascade (via FK `ON DELETE CASCADE`) to projects, API keys, sessions, messages, verdicts, application decisions, webhooks, and related rows scoped to that org. Verify in your environment:

- `organisations` delete → cascades to `projects`, `organisation_members`, etc., per migrations.
- **Profiles** (`profiles`) may be shared across flows; ensure your process either anonymises email or deletes rows consistent with your product policy before removing org-scoped session links.

## Webhooks

- Dead-letter / failed deliveries remain in `webhook_deliveries` with `status = failed` for inspection; purge periodically if required.
