# Current functionality and coverage audit

Date: 20 August 2026

## Outcome

The COLORS application runtime is coherent enough for controlled `/doorcheck`
testing. Its core state, routing, integrity, terminal, reviewer, and human-decision
boundaries have automated regression coverage. This audit removed confirmed dead
code and retired state, but it does not claim production readiness: conversational
quality still needs transcript evaluation, the repository has no measured line or
branch coverage, and the wider admin and SDK React surfaces have pre-existing lint
debt.

## Active application path

1. `start-gatekeeper-session` resolves project settings, chooses the fixed COLORS
   opener, persists the initial assistant message, and records its private signal.
2. `post-session-message` loads prior messages and constructs compact evidence,
   orientation, thread, response-mode, bridge, and question-budget state.
3. The structured model proposes answer quality, covered goals, orientation,
   bridge, response mode, next signal, scores, and an advisory terminal state.
4. Server-side reducers validate goal coverage, contribution evidence, question
   compatibility, bridge eligibility, repetition, safety, and the emergency stop.
5. The applicant receives either one active invitation or the neutral close.
6. Reviewer evidence remains advisory. Access requires a separate recorded human
   decision and cannot be granted by model scores or legacy terminal status.

## Automated coverage map

| Area | Principal regression coverage | Current confidence |
| --- | --- | --- |
| Opening and session start | `start-gatekeeper-session`, `opening-message` | Strong deterministic coverage |
| Evidence intents and adaptive branches | `application-signal-state`, `application-participant-orientation` | Strong unit coverage; transcript quality remains evaluative |
| COLORS relationship, sustained reciprocity, situated perspective | signal-state, experience-prompt, turn-integrity | Contract and routing coverage; no full model trajectory assertion yet |
| Conversation depth, thread, modes, and bridges | dedicated depth, thread, response-mode, and bridge tests | Strong reducer coverage |
| Active-turn integrity and emergency pacing | turn-integrity, question-budget, contract post-message | Strong deterministic coverage |
| Reviewer packet fallback | reviewer-report and contract post-message | Covered for evidence-backed fallback; source-link architecture remains planned |
| Human decision and access boundary | application-decision, decision route, access route, session status | Strong authority-boundary coverage |
| Local `/doorcheck` fallback | local-gatekeeper-test-turn | Covered, but intentionally not equivalent to live model conversation quality |
| SDK request and interaction contract | SDK client, bootstrap, decision moment, input serialization | Covered in package tests |
| Onboarding path | start and post onboarding, flow helpers | Basic coverage; outside the current COLORS gatekeeper focus |

The suite verifies behaviour through examples and contracts. It does not currently
produce instrumented statement, branch, or function coverage percentages.

## Cleanup completed

- Removed the unreferenced artist-reference detector, artist-context enrichment,
  and artist-context prompt modules and their isolated tests.
- Removed obsolete application-wide conversation-point counters.
- Removed the obsolete adaptive-turn counter from question-budget state.
- Removed a redundant adaptive-turn permission flag already represented by
  remaining-question and per-intent follow-up limits.
- Updated local test mode so `maxTurns` is a soft target and the shared emergency
  budget owns its hard stop.
- Updated the identity replay ceiling and its synthetic answers for the COLORS
  relationship and situated-cultural-perspective routes.
- Excluded generated `dist` and coverage output from lint traversal.
- Verified that every remaining `lib/*.ts` module has at least one non-test
  consumer and that strict TypeScript unused-local and unused-parameter checks pass.

## Remaining gaps and candidates

### P0 before production decisions

- Add source-linked evidence spans to reviewer claims and validate them in complete
  session trajectories.
- Run representative transcript evaluation for artist, curator, enthusiast,
  hybrid, vague, contradictory, extractive, and safety-boundary identities.
- Add fairness pairs for equivalent evidence expressed with different fluency,
  length, cultural references, city prestige, and insider/outsider scene position.
- Confirm reviewer calibration with COLORS examples of `recommend`,
  `human_review`, and `decline`.

### P1 engineering coverage

- Add an instrumented coverage provider and establish branch targets for reducers,
  session transitions, authority boundaries, and malformed model output.
- Promote the identity replay from a manual database script into a deterministic
  CI evaluation harness with assertions for route relevance and prohibited copy.
- Add refresh/resume trajectories spanning opening, multi-goal coverage,
  orientation revision, early completion, emergency close, and human decision.
- Add a regression where one recurring real-world habit covers both participation
  and contribution without a redundant first-month question.
- Add full trajectories for local-scene context across insider, adjacent, outside,
  online-only, and no-scene applicants.

### Repository debt not removed as dead code

- Full-repository lint currently reports pre-existing React effect/ref violations
  in admin and SDK UI code plus explicit-`any` debt in test fixtures. These require
  behavioural component refactors, not deletion, and should be handled as a
  separate UI-maintenance change.
- Universal score fields and legacy pass/redirect/reject statuses remain live
  compatibility data. They are no longer access authority, but removing them
  requires the migration sequence in the stronger V1 architecture plan.
- `packages/sdk/groucho-sdk-0.1.0.tgz` is a tracked release artifact with no runtime
  import. Confirm whether it is intentionally retained for distribution before
  deleting it.
- The local fallback still infers legacy untagged answers positionally. It is a
  recovery and test aid, not evidence that the live adaptive conversation has been
  evaluated.

## Definition of a clean next checkpoint

- Full tests, strict TypeScript, focused changed-file lint, and production build
  pass.
- No runtime module is kept alive only by an isolated test.
- No retired global question or adaptive-depth limit remains in live state.
- New conversational intents have both reducer coverage and representative
  trajectory evaluation.
- Full-repository lint debt is separately scoped rather than hidden by the COLORS
  flow work.
