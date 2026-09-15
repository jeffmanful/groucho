# Backup, retention, and deletion (Groucho v1)

Operational guidance for hosted deployments. Tune to your compliance regime (GDPR, SOC 2, customer DPAs).

## Data stores

- **Postgres (Supabase)** — primary tenant data: organisations, members, projects, API keys, sessions, messages, verdicts, immutable application decisions and policy snapshots, webhooks, webhook deliveries, profiles (where used).
- **Logs** — Vercel / platform logs; application logs use structured JSON (`lib/logger.ts`) with `requestId`, `projectId`, `sessionId` where applicable. **Do not** log API key secrets or full `Authorization` headers.

## Backups

- Rely on **Supabase** (or your Postgres provider) automated backups and point-in-time recovery according to your plan.
- Document **RPO/RTO** in your internal runbook; Groucho does not prescribe vendor-specific steps.

## Retention (suggested starting points)

| Class | Suggestion |
|-------|------------|
| Session transcripts + messages | Retain while the organisation account is active; optional TTL per project in a future release. |
| Verdicts / webhook delivery rows | Retain for audit; archive or purge per legal hold after org deletion window. |
| Application decisions / policy snapshots | Retain with the application audit record so a human or automatic decision can be explained; purge under the same legal and erasure policy as its session. |
| API access logs (edge) | Follow platform default (e.g. 7–30 days) unless longer audit required. |

## Right to erasure / org deletion

Deleting an **organisation** should cascade (via FK `ON DELETE CASCADE`) to projects, API keys, sessions, messages, verdicts, application decisions, webhooks, and related rows scoped to that org. Verify in your environment:

- `organisations` delete → cascades to `projects`, `organisation_members`, etc., per migrations.
- **Profiles** (`profiles`) may be shared across flows; ensure your process either anonymises email or deletes rows consistent with your product policy before removing org-scoped session links.

## Webhooks

- Dead-letter / failed deliveries remain in `webhook_deliveries` with `status = failed` for inspection; purge periodically if required.
