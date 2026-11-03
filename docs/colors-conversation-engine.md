# COLORS conversation engine

Current implementation, reviewed 2 November 2026. COLORS uses the shared runtime through `lib/colors-thin-conversation.ts`. “Thin” and `colors_thin_pilot_v1` are retained compatibility names, not a separate recommended pilot engine. See [shared architecture](reusable-conversation-engine.md).

## Routing and voice

| Entry | Selection |
| --- | --- |
| Protected `/demo/colors`, artist/community | Newer adapter explicitly; retired pilot environment flag is not the switch |
| Project `/v1` API and `/doorcheck` | New sessions use the adapter when project settings contain `conversation_engine: colors_forum` |
| Compatible historical sessions | Opening metadata determines the previously selected engine |
| Public Odile/Warden/Mo demos | Separate `conversation_v1` profiles on the same runtime, not COLORS admission conversations |

The COLORS adapter retains code-defined voice/context, model selection, privacy fallback and rich media catalogue. Community/artist direction comes from persisted audience, not a mutable per-turn persona choice. [Membership brief](colors-forum-membership-brief.md) defines approved product context; [intake](artist-forum-application.md) defines submitted facts.

## Conversation contract

The engine asks through `groucho_converse` or equivalent structured output. It validates clear active questions, repairs missing questions with bounded attempts, handles direct applicant questions, tracks no-new-context progress and closes neutrally. A repair failure is retryable before the answer pair is persisted. It does not score each turn; required `scores` values are neutral compatibility placeholders.

COLORS retains its own media validation and consent handling. The quality rubric is a review standard, not a second executable controller. Pacing/stop rules live in the engine; do not revive an older fixed interview sequence or promise a fixed number of questions. Existing historical paths can differ, so evaluate a fresh session on the intended engine.

## Completion

Real newer-engine applications finish `status: completed` and queue `lib/session-completion-jobs.ts`:

1. Reuse a current ready assessment/profile or generate them via `generateColorsThinAssessment`.
2. Persist a grounded profile and derive suitability from recommendation/confidence.
3. Apply the independently configured client decision policy.
4. Write the compatibility verdict and enqueue subscribed signed webhooks.
5. Record eligible cultural signals where enabled.

Report version authority is `COLORS_FORUM_MEMBERSHIP_REPORT_VERSION` in `lib/reviewer-report.ts` (v8 at this review). Failed stages are recorded for retry; assessment recovery in admin does not itself record a new decision. Completion leases/backoff are not proof of exactly-once model execution.

Protected reviewer demos suppress automatic completion jobs/decisions/webhooks and generate a sample report separately. Their opening `colors_demo_session` marker also prevents a later API turn from invoking the real completion path. Public persona simulations suppress assessment altogether and finish with their simulation message instead. Do not queue old reviewer-demo sessions as a score backfill: completion jobs can emit real project events.

## Suitability score

`lib/colors-suitability.ts` derives the initial score:

| Recommendation | Formula |
| --- | --- |
| recommend | `0.60 + 0.30 × confidence` |
| human_review | `0.55 + 0.05 × confidence` |
| decline | `0.45 × (1 − confidence)` |

The completion pipeline aligns human-review/decline ranges with project policy so a human-review recommendation cannot be automatically declined or accepted, and decline cannot become automatic acceptance. Recommend remains subject to client thresholds. Confidence/suitability are advisory heuristics, not calibrated probabilities. See [decision policy](client-decision-policy.md#score-bands-and-actions) for authority; its score-band section explains policy actions.

## Integration and rollout

Use a compatible SDK source/release that treats `completed` as terminal, or the appropriate custom renderer. Backend deployment does not publish the SDK or update a host. The shared runtime's immediate `profile` property is a string profile ID; extracted profile objects arrive through the separate authorised session/assessment flow. See [SDK surface](sdk-surface.md).

Deploy backend/host support and required migrations before setting a real project's engine. Back up settings, test with an isolated configured project, then verify neutral closing, persisted report/profile/score, decision policy, subscribed deliveries and resume/error recovery. Invitation-only launch requires the extra [pilot rehearsal](colors-admin-pilot.md), not just setting `colors_forum`.

Main/production deployment state must be checked separately from local source. Current integration instructions supersede the earlier thin-pilot setup/scorebackfill recipes. Dated run evidence is in the [archive](archive/README.md).
