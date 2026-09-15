# Client-owned decision policy

Groucho assesses an applicant and stores a suitability score. The client owns the
rules that turn that score into an application decision.

The model's terminal outcome and reviewer recommendation remain advisory. They do
not approve or decline an application by themselves. A final decision is created
only by either:

- an explicit human reviewer action; or
- the client's deterministic project policy, when the corresponding automatic
  action has been enabled.

Both automatic actions are off by default.

## Project configuration

Gatekeeper project settings accept:

```json
{
  "decision_policy": {
    "automatic_acceptance_enabled": false,
    "automatic_decline_enabled": false,
    "acceptance_threshold": 0.8,
    "review_threshold": 0.55
  }
}
```

`review_threshold` must be lower than `acceptance_threshold`. Both thresholds are
numbers from `0` to `1`, inclusive.

## Score bands and actions

| Suitability score | Band | Default result | Optional automatic action |
|---|---|---|---|
| `score >= acceptance_threshold` | `recommended_acceptance` | Pending review | Approve when automatic acceptance is enabled |
| `review_threshold <= score < acceptance_threshold` | `review` | Pending review | None |
| `score < review_threshold` | `below_threshold` | Pending review | Decline when automatic decline is enabled |

Automatic acceptance and automatic decline are independent. A client can enable
one, both, or neither. There is deliberately no automatic action for the middle
review band.

## Decision lifecycle

1. Groucho completes the conversation and stores `sessions.suitability_score`.
2. The client thresholds classify the score into a suitability band.
3. If the relevant automatic switch is enabled, Groucho records an immutable
   policy decision. Otherwise the application remains pending.
4. A reviewer may approve or decline any pending application in the admin UI.
5. The first recorded decision wins. A policy retry cannot overwrite a human
   decision, and a later human request cannot replace an existing policy decision.

`reviewStatus` is the authoritative application-decision state:

- `not_ready` — the conversation has not completed;
- `pending` — completed and awaiting a human decision;
- `approved` — approved by a human or the enabled client policy;
- `declined` — declined by a human or the enabled client policy.

The legacy session values `passed`, `redirected`, and `rejected` describe the
conversation/model outcome. They are not access decisions.

## Audit record

Every final decision is stored in `application_decisions` with one immutable row
per session.

Human decisions use:

- `decision_source = "human"`;
- `reviewer_kind = "platform"` or `"member"`;
- a reviewer identity and optional reason.

Automatic decisions use:

- `decision_source = "policy"`;
- `reviewer_kind = "policy"`;
- the suitability score used for the decision;
- an immutable `policy_snapshot` containing the thresholds and switches in force;
- a generated explanation of the policy action.

An approval creates an `access_secret`; a decline never does. The access endpoint
requires both an approved decision and the matching secret. A model outcome or
suitability score without a recorded approval cannot grant access.

## API and SDK behavior

Terminal message responses and `GET /v1/sessions/{sessionId}` can return:

- `reviewStatus`;
- `suitabilityScore`;
- `suitabilityBand`;
- `secret`, only when that response can safely continue an automatic-approval
  applicant flow.

Human approvals return their access secret through the authenticated admin
decision endpoint. Do not infer approval from `status`, `outcome`, a reviewer
recommendation, or a score alone.

## Admin behavior

The application list is sorted by suitability score, highest first, with sessions
that do not yet have a stored score last. Operators see the score band, current
review status, and whether an existing decision came from a person or the policy.

Historical sessions are not backfilled by the schema migration. They may show no
suitability score until a separate backfill is run.

## Deployment

Apply
[`20260906214659_add_client_decision_policy.sql`](../supabase/migrations/20260906214659_add_client_decision_policy.sql)
before enabling the settings in production. The migration adds the session score,
policy audit fields, constraints, and the project/suitability sorting index.

The tables remain server-controlled and protected by RLS. If a Supabase project's
Data API settings do not expose newly created tables automatically, verify the
server-role grants separately; grants and RLS are distinct controls.
