# COLORS Application Improvement Tracker

This document tracks content and performance improvements for the first COLORS
forum application flow. Groucho V1 remains focused on gatekeeper applications;
static onboarding is outside this work unless a later requirement depends on it.

## Goals

- Keep the application to nine applicant-facing questions or fewer, including follow-ups.
- Gather useful evidence about curiosity, generosity, participation, and community care.
- Make the conversation feel attentive without adding unnecessary turns.
- Keep internal outcomes private and always finish with the configured neutral closing message.
- Produce private advisory COLORS recommendations: `recommend`, `human_review`, or `decline`.
- Produce a reviewer-facing applicant report or bio with a confidence score for every completed application.
- Keep the final community decision human-owned by COLORS/the client.
- Reduce active-turn and terminal-turn latency without weakening application quality.

## Core Signal Path

The standard path defines six evidence goals, not six required questions. Groucho may cover several goals from one answer and should usually finish in five to seven applicant turns. Nine is the hard ceiling.

| Step | Applicant-facing question | Input | Signal |
| --- | --- | --- | --- |
| 1 | What brought you here? | Single select: Discover, Community, Share Work | Initial intent |
| 2 | Name an artist more people should know about. What would you want someone hearing them for the first time to notice? | Text | Taste, specificity, ability to articulate attention |
| 3 | What's the last song you recommended, and why did you think it was worth sharing? | Text | Musical curiosity and ability to explain a recommendation |
| 4 | Someone shares unfinished music that isn't really for you. How would you respond? | Text | Generosity, feedback style, community maturity |
| 5 | Which sounds most like you? | Single select: I mostly listen; I like discussing music; I enjoy giving feedback; I regularly share discoveries | Likely participation style |
| 6 | What's one thing you could realistically contribute in your first month? | Text | Concrete contribution intent |

### Conversation Rules

- Ask one question at a time.
- Keep acknowledgements short and specific to the answer. Do not use a routine
  acknowledgement such as "Interesting" on every turn.
- Do not add a follow-up when the current answer already provides the required signal.
- Default to one clarification for a goal. A second is available only for a core, decision-critical gap with recovery potential.
- Share three adaptive turns across all clarifications, open doors, and rabbit holes.
- Repeated thin evidence across three goals ends coaxing; preserve the uncertainty for human review.
- After answer seven, ask only for unresolved core evidence. Answer eight is the final possible decision-changing probe. Answer nine always closes.
- Do not exceed nine applicant-facing questions total; the total cap overrides the per-question follow-up allowance.
- Groucho may finish early when the available evidence is enough for a private recommendation.
- Use contextual questions as replacements for generic routes: an artist answer should lead to one of that artist's songs and why the applicant would share it; an album mention can become a track recommendation and reason; an own-music disclosure can become a question about what the applicant makes and wants listeners to notice.
- Contextual bridges may cover several goals but never add bonus turns beyond the normal budget.
- Do not reward polished writing, fluency, status, or famous references over substance.
- Do not verify or judge whether an artist is sufficiently well known.
- Never ask who received, was sent, or was recommended the song. The recommendation signal is about the music and why it felt worth sharing.
- Never expose `recommend`, `human_review`, `decline`, `passed`, `redirected`, or `rejected` decisions to the applicant.
- Do not use name or location as scored decision evidence.
- End every terminal path with `application_experience.closing_message`. The fallback is:
  "Thank you. We'll get in touch about your application soon."
- The final close may mention an accurate, non-evaluative detail from the applicant's answers, but must not imply acceptance.

## Architecture Direction

Use a bounded, conversational evidence-gathering flow:

1. The project defines stable evidence goals, not a compulsory question order.
2. Groucho can mark several goals as covered by one answer and follow the strongest conversational thread.
3. Groucho chooses any unresolved goal that connects naturally; the configured order is only a gap-filling fallback.
4. Groucho privately generates a maximum of three bridge candidates, selects at most one, and writes the question from its intent rather than a fixed template.
5. The server validates bridge confidence, target-goal eligibility, phase, and repetition before letting the bridge influence routing.
6. Clarifications and depth turns consume a shared three-turn adaptive budget as well as the bounded nine-question and conversation-point budgets.
7. The application is evaluated once Groucho has enough evidence, reaches the cap, or encounters a safety boundary.
8. Profile extraction and webhook delivery happen after the applicant-facing response through durable background work.

This keeps the evaluation legible while allowing different applicants to take different
routes. Existing `required_signals` question strings remain compatible, but the runtime
maps the COLORS set to private goals and adaptable prompt routes.

Reviewer-facing COLORS recommendations are advisory only:

| COLORS recommendation | Current Groucho terminal | Review meaning |
| --- | --- | --- |
| `recommend` | `passed` | Evidence supports approval, but the client still makes the final decision. |
| `human_review` | `redirected` | Evidence is incomplete, contradictory, borderline, or uncertain. |
| `decline` | `rejected` | Evidence suggests poor fit, but the client still makes the final decision. |

The applicant must never see either the COLORS recommendation or the raw Groucho terminal status. The forum must not grant access, reject an applicant, send an invitation, or update final community status solely from Groucho's recommendation.

## Implementation Tracker

### P0: Measure The Current Path

- [ ] Add timing spans for project resolution, persona lookup, session lookup, message persistence, history loading, scoring, artist enrichment, response generation, profile extraction, and verdict/webhook work.
- [ ] Emit aggregate request duration and stage durations with `requestId`, `projectId`, session phase, and terminal state. Do not log applicant answers or PII.
- [ ] Add `Server-Timing` headers in development or preview environments.
- [ ] Capture baseline p50 and p95 latency for ordinary, artist-reference, and terminal turns.
- [ ] Set final latency targets after collecting the baseline. Initial working targets are p95 under 3 seconds for active turns and under 2 seconds to display the neutral terminal close.

### P1: Make Evidence Coverage Deterministic

- [x] Derive stable signal keys and private evidence goals from existing project configuration.
- [x] Store the prompted goal and every goal covered by each answer in message metadata.
- [x] Let Groucho choose an unresolved goal based on conversational continuity.
- [x] Permit targeted clarification without losing the current thread.
- [x] Enforce a hard nine-question total budget, closing and final-probe phases, and a shared three-turn adaptive budget.
- [x] Default to one clarification per goal and permit a second only for a core gap with recovery potential.
- [ ] Persist `insufficient_evidence` when a signal remains unusable after two follow-ups.
- [ ] Allow early completion once the evaluator has enough evidence for a private recommendation.
- [x] Replace the COLORS community-quality question with the unfinished-music scenario.
- [x] Update the artist, recommendation, and contribution question copy to the target flow above, without asking who received the recommendation.
- [ ] Add contract tests covering question order, structured options, refresh/resume behavior, and early finish.
- [x] Add contract coverage for exhausted follow-up routing and the nine-question hard stop.

### P1: Remove Redundant Model Work

- [x] Stop calling the standalone scoring model on every turn. The main structured response now returns the accumulated assessment.
- [ ] Evaluate the application when enough evidence exists or the cap is reached, returning private COLORS recommendation, applicant bio/report, evidence by signal, confidence score, missing signals, reviewer focus, and safety flags as structured data.
- [ ] Keep early safety termination available without running the full final evaluation.
- [ ] Compare the final evaluator against representative accepted, uncertain, and unsuitable applications before changing production decisions.
- [ ] Ensure every completed application is reviewable by a human regardless of advisory recommendation.

### P1: Complete The COLORS Evaluation Rubric

- [ ] Ask COLORS for representative examples of `recommend`, `human_review`, and `decline` applications.
- [ ] Define maker and multiplier evidence with concrete examples.
- [ ] Define the minimum evidence required for early `recommend`.
- [ ] Define when weak evidence should produce `human_review` versus private `decline`.
- [ ] Decide whether the participation-style answer is scored or descriptive profile data only.
- [ ] Confirm safety boundaries that should force human review or private decline.
- [ ] Convert the final rubric into structured evaluator instructions with examples.
- [ ] Define the reviewer packet fields, including applicant bio, confidence score, evidence summary, weak signals, flags, and reviewer focus.

See [colors-evaluation-rubric-discovery.md](./colors-evaluation-rubric-discovery.md).

### P1: Shorten The Critical Path

- [x] Remove artist enrichment from the applicant response path. Artist answers now go directly to the main conversational model.
- [ ] Decide whether artist enrichment provides enough reviewer value to retain as background metadata. If retained, connect it only through durable background work.
- [ ] Return the configured closing message after the terminal outcome and session state are durably persisted.
- [ ] Move profile extraction, verdict creation, and webhook-delivery creation to a durable background job or transactional outbox.
- [ ] Ensure background failures can retry and never change the closing message already shown to the applicant.

### P2: Model And Prompt Efficiency

- [x] Move conversational gatekeeper turns from Opus to the pinned Claude Haiku 4.5 model, with a server-side override for controlled evaluation.
- [ ] Benchmark the Haiku conversational path against a representative larger-model baseline for latency, cost, tool reliability, and decision agreement.
- [ ] Reserve the larger model for final evaluation only if offline evaluation shows a meaningful quality advantage.
- [ ] Lower conversational output limits to match the short-response contract.
- [x] Send compact structured answers and signal state instead of the full transcript for configured application flows. Answers and expected signals are persisted in message metadata; legacy sessions fall back safely.
- [ ] Cache project settings and active persona configuration with explicit invalidation after admin edits.

### P2: Content Quality

- [ ] Test the revised questions with a small set of representative applicants.
- [ ] Check that questions produce concrete answers without making the desired answer obvious.
- [ ] Check for cultural, language, and writing-style bias in reviewer outcomes.
- [ ] Add examples showing that obscure artists, short answers, and imperfect English are not negative signals by themselves.
- [ ] Review whether the participation-style answer should influence the outcome or remain descriptive profile data only.
- [ ] Confirm that all terminal paths use a client-configurable neutral thank-you message.

### P2: Conversation Depth

- [x] Add structured per-answer quality (`thin`, `usable`, `rich`, `concerning`) to the existing conversational model response.
- [x] Persist private answer assessments and accepted conversation moves in message metadata.
- [x] Add recent answer-quality trajectory and conversation-point budgets to compact application state.
- [x] Replace the short-answer length heuristic with semantic assessment while retaining deterministic budget validation.
- [x] Add one bounded `rabbit_hole` move for a rich answer.
- [x] Add one bounded `open_door` move after repeated thin answers.
- [ ] Evaluate classification and recovery quality against representative COLORS transcripts before production promotion.

See [colors-conversation-depth.md](./colors-conversation-depth.md).

## Acceptance Criteria

- The standard COLORS application contains no more than nine applicant-facing questions, including follow-ups.
- The same answers produce the same question order and interaction controls after refresh or resume.
- The LLM cannot silently skip a required step or add routine conversational turns.
- Groucho can finish early when the answer set already provides enough evidence.
- Groucho asks no more than two follow-ups per core question.
- Signals can be recorded as `insufficient_evidence` after two unsuccessful follow-ups.
- No applicant-facing response reveals acceptance, rejection, redirect, access status, raw terminal status, or private COLORS recommendation.
- Every completed application produces a reviewer-facing report or bio with confidence score.
- No final community decision is automated from Groucho's advisory recommendation.
- Ordinary turns require no more than one model call; deterministic turns may require none.
- Terminal profile extraction and webhook setup do not delay the applicant-facing closing message.
- Stage-level p50 and p95 latency are observable without logging application content.
- Automated tests cover the complete happy path, early finish, follow-up limits, insufficient evidence, a safety termination, and every private COLORS recommendation.

## Rollout

- [ ] Add instrumentation and record the baseline.
- [ ] Ship the revised copy behind a versioned COLORS flow configuration.
- [ ] Run the old and revised evaluator against a fixed test set and review disagreements.
- [ ] Enable the deterministic flow in preview/dry-run sessions.
- [ ] Verify latency, completion rate, answer quality, and terminal-message behavior.
- [ ] Promote the revised flow to production.

## Decision Log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-20 | Keep COLORS V1 focused on gatekeeper applications. | Onboarding is mostly static and does not currently need an LLM. |
| 2026-07-20 | Use neutral, configurable terminal copy for every outcome. | Application decisions remain private until the client follows up. |
| 2026-07-20 | Prefer a deterministic six-step journey with one final evaluation. | Superseded by the 2026-07-30 bounded evidence-gathering rule. |
| 2026-07-20 | Default conversational turns to pinned Claude Haiku 4.5. | The interaction is bounded and concise; a larger final evaluator will only be added if offline testing demonstrates a material quality gain. |
| 2026-07-30 | Use private COLORS recommendations: `recommend`, `human_review`, and `decline`. | The applicant-facing experience stays neutral while reviewers get more useful product language. |
| 2026-07-30 | Treat `decline` as an internal recommendation only. | Negative recommendations still require human confirmation before any applicant-facing action. |
| 2026-07-30 | Cap the application at nine applicant-facing questions, including follow-ups. | This preserves brevity while allowing targeted clarification when a signal is weak. |
| 2026-07-30 | Allow no more than two follow-ups per core question. | Repeated probing creates friction; after two failed attempts, the signal should become `insufficient_evidence`. |
| 2026-07-30 | Allow early finish once enough evidence exists. | Groucho should not keep asking questions just because a default sequence exists. |
| 2026-08-12 | Treat Groucho as an advisory reporting layer, not the final decision-maker. | The client wants a report/bio with confidence for every applicant, while final community decisions remain human-owned. |
