# COLORS Application Improvement Tracker

> **Architecture note — 20 August 2026:** this tracker remains authoritative for
> COLORS conversation content, adaptive branches, budgets, bridges, and current
> runtime fixes. The planned replacement for universal scores, model-controlled
> terminal outcomes, application state, and human decision authority is documented
> in [the stronger V1 implementation plan](./groucho-stronger-v1-implementation-plan.md).

This document tracks content and performance improvements for the first COLORS
forum application flow. Groucho V1 remains focused on gatekeeper applications;
static onboarding is outside this work unless a later requirement depends on it.

## Goals

- Treat nine applicant answers as a soft pacing target, with the separate emergency loop stop as the only hard limit.
- Gather useful evidence about curiosity, generosity, participation, and community care.
- Make the conversation feel attentive without adding unnecessary turns.
- Keep internal outcomes private and always finish with the configured neutral closing message.
- Produce private advisory COLORS recommendations: `recommend`, `human_review`, or `decline`.
- Produce a reviewer-facing applicant report or bio with a confidence score for every completed application.
- Keep the final community decision human-owned by COLORS/the client.
- Reduce active-turn and terminal-turn latency without weakening application quality.

## Core Signal Path

The standard path defines seven evidence intents, not seven required questions. Groucho may cover several intents from one answer and should usually find a natural close within five to nine applicant turns. Nine is a soft pacing target.

| Step | Applicant-facing question | Input | Signal |
| --- | --- | --- | --- |
| 1 | Why do you want to be an early applicant for the Forum? | Open text | Initial motivation and first routing inflection |
| Early, when unresolved | Adapt to the applicant: why COLORS specifically, a meaningful performance, how COLORS presents work, or what the Forum could extend | Open text | Lived relationship to COLORS; may be covered by the opening |
| Flexible | Name an artist more people should know about. What would you want someone hearing them for the first time to notice? | Text | Taste, specificity, ability to articulate attention |
| Flexible | What's the last song you recommended, and why did you think it was worth sharing? | Text | Musical curiosity and ability to explain a recommendation |
| Curator route | Someone shares unfinished music that isn't really for you. How would you respond? | Text | Generosity, feedback style, community maturity |
| Flexible | Which sounds most like you? | Single select: I mostly listen; I like discussing music; I enjoy giving feedback; I regularly share discoveries | Current participation and the exchanges that keep them involved |
| Flexible | Prefer an existing habit; otherwise ask what they could realistically contribute | Text | Concrete, sustainable reciprocity and contribution |

### Conversation Rules

- Ask one question at a time.
- Keep acknowledgements short and specific to the answer. Do not use a routine
  acknowledgement such as "Interesting" on every turn.
- Do not add a follow-up when the current answer already provides the required signal.
- Default to one clarification for a goal. A second is available only for a core, decision-critical gap with recovery potential.
- Let relevance, the live thread, and per-intent repetition limits govern clarifications and depth turns rather than a shared application-wide cap.
- Preserve unresolved uncertainty for human review when further coaxing is unlikely to help.
- Do not introduce a closing phase after answer seven or a final-probe rule after answer eight.
- Treat nine as a soft target. Use the higher emergency limit only to prevent loops.
- Groucho may finish early when the available evidence is enough for a private recommendation.
- Establish a real relationship to COLORS early when the opening has not already done so. Adapt the route by orientation and never turn it into brand praise, recall trivia, or a fandom threshold.
- Treat sustained reciprocity as part of participation and contribution. Prefer concrete existing patterns over hypothetical first-month promises, and let one answer cover both goals when warranted.
- Do not use activity volume as the standard: quiet, repeatable listening, thoughtful replies, contextual sharing, welcoming, connecting, and creative exchange can count.
- Use situated cultural perspective as an adaptive route across cultural point of view and participation: what is happening around the applicant, what outsiders might miss, and where they place themselves relative to that scene.
- Treat city, local, online, genre, diasporic, and informal scenes as valid contexts. Do not require location, reward prestigious scenes, equate industry proximity with insight, or penalise an outsider position.
- Use contextual questions as replacements for generic routes: an artist answer should lead to one of that artist's songs and why the applicant would share it; an album mention can become a track recommendation and reason; an own-music disclosure can become a question about what the applicant makes and wants listeners to notice.
- Contextual bridges may cover several goals but never add bonus turns beyond the normal budget.
- Do not reward polished writing, fluency, status, or famous references over substance.
- Do not verify or judge whether an artist is sufficiently well known.
- Never ask who received, was sent, or was recommended the song. The recommendation signal is about the music and why it felt worth sharing.
- Never expose `recommend`, `human_review`, `decline`, `passed`, `redirected`, or `rejected` decisions to the applicant.
- Do not use name or location as scored decision evidence.
- End every terminal path with `application_experience.closing_message`. The fallback is:
  "It was good getting to understand you better."
- The final close may mention an accurate, non-evaluative detail from the applicant's answers, but must not imply acceptance.

## Architecture Direction

Use a bounded, conversational evidence-gathering flow:

1. The project defines stable evidence goals, not a compulsory question order.
2. Groucho can mark several goals as covered by one answer and follow the strongest conversational thread.
3. Groucho chooses any unresolved goal that connects naturally; the configured order is only a gap-filling fallback.
4. Groucho privately generates a maximum of three bridge candidates, selects at most one, and writes the question from its intent rather than a fixed template.
5. The server validates bridge confidence, target-goal eligibility, and repetition before letting the bridge influence routing.
6. Clarifications and depth turns use per-intent repetition limits rather than a shared application-wide cap.
7. The application is evaluated once Groucho has enough evidence, reaches the emergency loop stop, or encounters a safety boundary.
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

- [ ] Add timing spans for project resolution, persona lookup, session lookup, message persistence, history loading, response generation, profile extraction, and verdict/webhook work.
- [ ] Emit aggregate request duration and stage durations with `requestId`, `projectId`, session phase, and terminal state. Do not log applicant answers or PII.
- [ ] Add `Server-Timing` headers in development or preview environments.
- [ ] Capture baseline p50 and p95 latency for ordinary, artist-reference, and terminal turns.
- [ ] Set final latency targets after collecting the baseline. Initial working targets are p95 under 3 seconds for active turns and under 2 seconds to display the neutral terminal close.

### P1: Make Evidence Coverage Deterministic

- [x] Derive stable signal keys and private evidence goals from existing project configuration.
- [x] Store the prompted goal and every goal covered by each answer in message metadata.
- [x] Let Groucho choose an unresolved goal based on conversational continuity.
- [x] Permit targeted clarification without losing the current thread.
- [x] Replace the hard nine-question budget, closing/final-probe phases, and shared adaptive cap with a soft target and higher emergency loop stop.
- [x] Default to one clarification per goal and permit a second only for a core gap with recovery potential.
- [x] Persist `insufficient_evidence` when a signal remains unusable after two follow-ups.
- [ ] Allow early completion once the evaluator has enough evidence for a private recommendation.
- [x] Replace the COLORS community-quality question with the unfinished-music scenario.
- [x] Update the artist, recommendation, and contribution question copy to the target flow above, without asking who received the recommendation.
- [ ] Add contract tests covering question order, structured options, refresh/resume behavior, and early finish.
- [x] Add contract coverage for exhausted follow-up routing and the higher emergency loop stop.

### P1: Tailor Evidence To Applicant Orientation

- [x] Add a private, revisable artist / curator / enthusiast / hybrid orientation state.
- [x] Persist orientation in existing message metadata without a schema migration.
- [x] Separate shared Forum goals from branch-specific evidence.
- [x] Remove the unfinished-work feedback route for artists and enthusiasts unless their own evidence makes it relevant.
- [x] Add artist-, curator-, and enthusiast-specific participation and contribution routes.
- [x] Move orientation discovery earlier when the opening remains ambiguous.
- [x] Prevent ordinary completion while an applicable core goal has never been attempted and budget remains.
- [x] Instruct reviewer reports to treat missing branch-inapplicable evidence as neutral.
- [x] Add regression coverage for the listener route that previously closed without a contribution opportunity.

See [colors-adaptive-applicant-branches.md](./colors-adaptive-applicant-branches.md).

### P1: Remove Redundant Model Work

- [x] Stop calling the standalone scoring model on every turn. The main structured response now returns the accumulated assessment.
- [ ] Evaluate the application when enough evidence exists or the cap is reached, returning private COLORS recommendation, applicant bio/report, evidence by signal, confidence score, missing signals, reviewer focus, and safety flags as structured data.
- [ ] Keep early safety termination available without running the full final evaluation.
- [ ] Compare the final evaluator against representative accepted, uncertain, and unsuitable applications before changing production decisions.
- [ ] Ensure every completed application is reviewable by a human regardless of advisory recommendation.

Runtime fallback reports are now evidence-backed: when the model omits a usable report, Groucho reconstructs the relevant orientation, covered evidence, unresolved or insufficient goals, confidence, and reviewer focus from persisted message metadata. This removes the previous empty generic report while keeping the final community decision human-owned.

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
- [x] Remove the unused artist enrichment, artist-context prompt, and artist-reference detector modules after confirming that no runtime path imports them.
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

### P1: Conversation Integrity Follow-through

- [x] Preserve one grounded, answer-specific receipt when the controller replaces a mismatched or invalid next question.
- [x] Prevent a strongly evidenced orientation from becoming hybrid through a secondary model score without explicit evidence of another participation mode.
- [x] Mark a goal `insufficient_evidence` after the initial answer and two unusable follow-ups, then exclude it from further routing without falsely marking it covered.
- [x] Generate an evidence-backed reviewer report from persisted application state whenever the terminal model report is absent or evidence-free.

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
