# Groucho state of play — 20 August 2026

## End-of-day position

The COLORS experience is ready for continued **controlled testing in `/doorcheck`**.
It is not yet ready to make autonomous or production access decisions.

Groucho now behaves less like a fixed questionnaire and more like a COLORS-themed
presence at the door: it opens with the applicant's reason for wanting to join,
forms a revisable view of who they are, follows relevant threads, and gathers the
evidence COLORS needs without exposing an assessment process. The final output is a
private, advisory reviewer report. A recorded human decision remains the only route
to access.

## What is working now

- The opening question is: “Why do you want to be an early applicant for the Forum?”
- The first answer is the main routing inflection point rather than a preselected
  application category.
- Artist, curator, enthusiast, and hybrid orientations are treated as revisable
  conversation hypotheses.
- Groucho can pursue shared intents in different ways: reason for joining, COLORS
  relationship, taste and discovery, scene connection, participation, contribution,
  and sustained reciprocity.
- Questions are generated from intents and current evidence. Sample questions are
  guidance, not a required script.
- Artist references can lead naturally to a track, album, or song recommendation;
  references to the applicant's own music can open a thread about their practice.
- Artists are not required to answer curator-style feedback questions. Curators are
  tested on actual participation and connecting behaviour. Enthusiasts receive more
  room to explain community, discovery, and what they hope to do there.
- Conversation bridges, live-thread memory, response modes, and bounded repair logic
  help Groucho acknowledge an answer before moving somewhere useful.
- The nine-question hard cap has been replaced by soft pacing, with deterministic
  loop protection retained as an emergency guard.
- Applicant-facing endings are neutral and relational. They do not mention an
  application decision or promise that COLORS will be in touch.
- Reviewer reports separate evidence, weak or missing signals, reviewer focus, and
  an advisory recommendation. Source-turn provenance is retained.
- Missing fame, audience size, releases, credits, affiliations, or polished writing
  is not treated as negative evidence.

## Decision and safety boundary

Private reviewer recommendations are `recommend`, `human_review`, or `decline`.
They do not grant or deny access.

The currently confirmed calibration boundaries are:

| Pattern | Advisory recommendation |
| --- | --- |
| Persistently vague after several fair opportunities | `human_review` |
| Admits inventing a participation claim to improve their chances | `human_review` |
| Repeatedly seeks artist access mainly to grow their own platform | `human_review` |
| Knowingly shares private demos without permission and would continue after objection | `decline` |

Five positive reference cases are also encoded: active-contributor artist,
thoughtful listener, constructive curator, community-minded hybrid, and early-stage
intentional artist. In the latest live replay, all five produced `recommend`, and
neutral missing credentials were not turned into weaknesses.

## Verification snapshot

- 42 automated test files passed.
- 309 automated tests passed.
- Strict TypeScript validation passed.
- Focused lint validation passed.
- Repository whitespace validation passed.
- The five positive identities were replayed through the live project and matched
  their expected private recommendation.

A production build passed earlier in the day's implementation. It was not rerun
after the final calibration delta because the active local development server owned
the build directory; the final delta is covered by the tests, type, lint, and
whitespace checks above.

This establishes a strong controlled-testing baseline, not final production
calibration.

## Known limitations

- Some generated turns are still too long or contain two questions where one would
  feel more natural.
- Hybrid applicants can cause Groucho to pursue feedback evidence longer than the
  conversation warrants.
- Live replay is a manual database-backed evaluation tool rather than a required CI
  check.
- Live model turns observed during testing were commonly around 12–13 seconds.
- Legacy `passed`, `redirected`, and `rejected` compatibility states still exist
  internally while the application lifecycle migrates to explicit conversation,
  recommendation, and human-review states.
- The client calibration packet is incomplete. The present anchors are enough to
  test direction, not enough to claim dependable production decision quality.
- Deterministic sufficiency thresholds for an early recommendation are not yet
  calibrated; early completion remains part of the intended contract rather than a
  finished production policy.

## Next priorities

### P0 — complete decision calibration

1. Add clear decline examples beyond the confirmed consent violation.
2. Add a broader range of `human_review` cases, including ambiguity without
   misconduct.
3. Add early-finish, vague-answer recovery, insufficient-evidence, safety, and
   matched fairness examples.
4. Turn the full packet into repeatable evaluator and replay assertions.

### P1 — improve conversational restraint

1. Prefer one short, answerable question per turn.
2. Reduce double-barrelled bridges and unnecessary explanatory setup.
3. Stop pursuing feedback once another branch has supplied stronger, more relevant
   evidence.
4. Measure and reduce active-turn latency without weakening state integrity.

### Architecture work after calibration

- Finish separating authoritative evidence state from generated conversation text.
- Complete the migration from legacy terminal labels to explicit advisory and human
  review lifecycle states.
- Make live identity replay part of the normal release gate.

## Documentation map

- [COLORS persona specification](../COLORS_PERSONA_SPEC.md) — voice and presence.
- [Flexible conversation contract](./colors-flexible-conversation-contract.md) —
  intents, freedom, pacing, and control boundaries.
- [Calibration cases](./colors-calibration-cases-2026-08-20.md) — confirmed positive
  and integrity examples plus the remaining packet.
- [Current functionality and coverage audit](./current-functionality-and-coverage-audit-2026-08-20.md)
  — runtime and automated coverage detail.
- [Stronger V1 implementation plan](./groucho-stronger-v1-implementation-plan.md) —
  target architecture and staged delivery.
- [Adaptive flow test log](./colors-adaptive-flow-test-2026-08-20.md) — historical
  replay findings and fixes made during the day.
- [20 August changelog](../changelog-18-08-26.md) — detailed implementation history.
