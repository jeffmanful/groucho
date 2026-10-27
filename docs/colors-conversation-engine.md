# COLORS conversation engine

26 October 2026. All COLORS applications move to the newer conversation engine (the former
"thin pilot", marker `colors_thin_pilot_v1`). The previous engine stays in place for other
clients and for COLORS conversations that started on it, which finish where they began.

## Where the newer engine runs

| Entry point | Engine |
| --- | --- |
| COLORS demo, artist and community (`/demo/colors`) | Always the newer engine. `GROUCHO_COLORS_THIN_PILOT` is no longer read. |
| Public API `/v1/sessions/{id}/start` and `/messages`, and the `/doorcheck` preview | The newer engine for new sessions on projects whose settings contain `"conversation_engine": "colors_forum"`. A client that posts before calling start has the session started first. |
| Sessions already in progress | The engine recorded on their opening message. |

The project setting lives in `projects.settings` and survives admin edits, which keep unknown keys.
Routing is in `lib/colors-engine-routing.ts` and `lib/start-gatekeeper-session.ts`.

## Completion

When a newer-engine conversation closes outside the demo, it queues the same background
completion job as the previous engine (`lib/session-completion-jobs.ts`):

1. Reuse the reviewer report and grounded profile if the demo page already produced them;
   otherwise generate them with `generateColorsThinAssessment` (`lib/colors-thin-assessment.ts`),
   the same function the demo report route uses. A report started elsewhere less than 90 seconds
   ago is left to finish and the job retries.
2. Derive and store `sessions.suitability_score` from the report (below).
3. Apply the client decision policy (automatic actions remain off unless enabled).
4. Write the verdict and enqueue signed webhooks. The payload carries `session.status: "completed"`,
   `suitability_score`, the reviewer report and the grounded profile. `outcome` is a compatibility
   value derived from the recommendation (recommend → PASS, human_review → REDIRECT,
   decline → REJECT); access is still decided by `reviewStatus`.
5. Record cultural signals as before.

A failed assessment marks the closing message `failed` with its stage and the job retries with
back-off. Demo sessions skip this pipeline, as reviewer previews always have, because they use the
real Forum project and its webhooks; they still receive a suitability score when their report is ready.
Demo sessions are marked `colors_demo_session` on their opening message, so an API turn on one also
skips the pipeline.

## Suitability score

The newer engine does not score turns. `lib/colors-suitability.ts` derives a 0–1 score from the
reviewer report: the recommendation sets the range, confidence places the applicant within it.

| Recommendation | Score | Band with default thresholds (0.80 / 0.55) |
| --- | --- | --- |
| recommend | 0.60 + 0.30 × confidence | Confidence ≥ 0.67 → recommended_acceptance; below → review |
| human_review | 0.55 + 0.05 × confidence | Always review |
| decline | 0.45 × (1 − confidence) | Always below_threshold |

Decline always sorts below human review, which sorts below recommend. The completion job then
keeps human review inside the project's review band and decline below its review threshold, so
neither can be accepted automatically and human review can never be declined automatically,
whatever thresholds the project sets. Recommend is not adjusted. Thin but positive evidence
(confidence around 0.5–0.6) stays in review. In the live check on 26 October, two low-effort
applicants scored 0.765 and 0.78 (review) and two well-evidenced applicants 0.834
(recommended_acceptance). Projects that change their thresholds move the recommend boundary with them.

## API and SDK compatibility

The newer engine finishes with `status: "completed"`, which is now part of `SessionOutcome` in the
OpenAPI contract. It returns a neutral 0.5 placeholder for the required per-turn `scores`; the real
score is `suitabilityScore` from `GET /v1/sessions/{id}` once completion has run, and
`suitability_score` in the webhook.

`@groucho-gatekeeper/sdk` releases before this change treat only passed, redirected and rejected as
finished. On those versions a COLORS conversation would show its closing line and leave the input
open. The next SDK release (changeset `colors-completed-outcome`) treats `completed` as finished.

## Rollout

1. Deploy this branch. API clients see no behaviour change until a project has the setting; each
   message turn makes two extra small lookups to choose the engine.
2. Publish the SDK release and upgrade the COLORS Forum host. Check its webhook receiver accepts
   `session.status: "completed"` and reads `suitability_score` and `reviewer_report`.
3. Set the project setting on `forum-application-test`, run an application through the Forum host
   end to end, and confirm the verdict, webhook delivery and admin sorting.
4. Set the same setting on `forum-application`.

```sql
update projects set settings = settings || '{"conversation_engine": "colors_forum"}'::jsonb
where slug = 'forum-application-test'; -- then 'forum-application'
```

Before step 4, the 35 newer-engine demo sessions completed in the previous 30 days have no
suitability score. They can be scored by queueing completion jobs for them, which also writes
verdicts and sends webhooks, so do that only if the Forum should receive them.

## Known limits

- Completion jobs run after the message response (`after()`), as before. A newer-engine job makes
  several model calls; if the function times out mid-job, the job is reclaimed after the
  5-minute stale lock and retried.
- If queueing the job fails after the row was actually written, the inline fallback and the
  queued job can both generate the report. Verdicts, decisions and webhook deliveries are
  deduplicated, so the cost is a second report.
- A verdict insert error other than a duplicate is logged and not retried (existing behaviour).

The Converse competition project was retired on 26 October by revoking its only API key; its data
is unchanged.
