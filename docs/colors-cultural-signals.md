# COLORS cultural signals

Implemented aggregate collection/dashboard/review boundary, reviewed 2 November 2026. Source authority: `lib/cultural-signals.ts`, related admin routes and migrations. This replaces the mixed five-phase implementation plan.

Collection is opt-in per project. Eligible completed non-bot applications can contribute curated observations; the public simulations do not run this completion pipeline. Observations are project community memory, not a hidden applicant evaluation rubric.

## Implemented boundaries

- Broad curated categories, not protected/sensitive trait inference or arbitrary raw quotations.
- Source-message relationships for lifecycle/deletion, without applicant drill-down in the aggregate dashboard.
- A rolling 90-day view and distinct-session thresholds: ordinary signals need five sessions; sensitive categories need ten.
- Repetition in one session cannot inflate a signal. Emerging themes need review before entering the approved picture.
- Project-scoped versioned snapshots; deletion dependencies must be tested alongside retained historical snapshots.
- `conversation_use_enabled` remains false in application code. Aggregates are not inserted into live conversation prompts or used to determine suitability/decisions.

Enable and review collection only within the intended project. Check taxonomy, suppression, snapshot freshness, access roles and deletion behaviour. A project setting or dashboard alone is not evidence that every privacy/deletion property is working in a new deployment.

## Proposed, not implemented here

Conversation shadow evaluation and later limited question assistance remain separate research gates. They require an evaluation set, client review, popularity-bias/leakage checks and explicit rollout design. Do not describe these as active runtime features or use aggregate popularity as applicant evidence.

See [retention](backup-retention.md), [decision policy](client-decision-policy.md) and [runtime map](architecture.md).
