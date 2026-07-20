# COLORS Application Improvement Tracker

This document tracks content and performance improvements for the first COLORS
forum application flow. Groucho V1 remains focused on gatekeeper applications;
static onboarding is outside this work unless a later requirement depends on it.

## Goals

- Keep the application to six applicant inputs or fewer.
- Gather useful evidence about curiosity, generosity, participation, and community care.
- Make the conversation feel attentive without adding unnecessary turns.
- Keep internal outcomes private and always finish with the configured neutral closing message.
- Reduce active-turn and terminal-turn latency without weakening application quality.

## Target Flow

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
- Do not reward polished writing, fluency, status, or famous references over substance.
- Do not verify or judge whether an artist is sufficiently well known.
- Never ask who received, was sent, or was recommended the song. The recommendation signal is about the music and why it felt worth sharing.
- Never expose pass, redirect, or reject decisions to the applicant.
- End every terminal path with `application_experience.closing_message`. The fallback is:
  "Thank you. We'll get in touch about your application soon."

## Architecture Direction

Use a hybrid flow:

1. Groucho deterministically selects the next configured question and interaction type.
2. An LLM may produce a short, answer-specific acknowledgement or a targeted clarification.
3. A clarification does not create an extra turn unless the answer is unusable or a safety boundary is required.
4. The application is evaluated once after the final answer, with an early terminal decision reserved for clear safety cases.
5. Profile extraction and webhook delivery happen after the applicant-facing response through durable background work.

This keeps the journey predictable while retaining judgment where it is useful. The
current `required_signals` configuration describes goals rather than enforcing a fixed
sequence, so the implementation needs explicit application-step state.

## Implementation Tracker

### P0: Measure The Current Path

- [ ] Add timing spans for project resolution, persona lookup, session lookup, message persistence, history loading, scoring, artist enrichment, response generation, profile extraction, and verdict/webhook work.
- [ ] Emit aggregate request duration and stage durations with `requestId`, `projectId`, session phase, and terminal state. Do not log applicant answers or PII.
- [ ] Add `Server-Timing` headers in development or preview environments.
- [ ] Capture baseline p50 and p95 latency for ordinary, artist-reference, and terminal turns.
- [ ] Set final latency targets after collecting the baseline. Initial working targets are p95 under 3 seconds for active turns and under 2 seconds to display the neutral terminal close.

### P1: Make The Flow Deterministic

- [ ] Add a versioned gatekeeper application-flow configuration with ordered steps, stable IDs, interaction definitions, and signal keys.
- [ ] Store the current application step on the session or derive it reliably from persisted step metadata.
- [ ] Return the configured question and input type rather than asking the model to invent the next question.
- [ ] Permit a targeted clarification without losing or repeating the configured step.
- [x] Replace the COLORS community-quality question with the unfinished-music scenario.
- [x] Update the artist, recommendation, and contribution question copy to the target flow above, without asking who received the recommendation.
- [ ] Add contract tests covering question order, structured options, refresh/resume behavior, and the six-input maximum.

### P1: Remove Redundant Model Work

- [x] Stop calling the standalone scoring model on every turn. The main structured response now returns the accumulated assessment.
- [ ] Evaluate the complete application once at the end, returning private outcome, evidence by signal, confidence, and safety flags as structured data.
- [ ] Keep early safety termination available without running the full final evaluation.
- [ ] Compare the final evaluator against representative accepted, uncertain, and unsuitable applications before changing production decisions.

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

## Acceptance Criteria

- The standard COLORS application contains no more than six applicant inputs.
- The same answers produce the same question order and interaction controls after refresh or resume.
- The LLM cannot silently skip a required step or add routine conversational turns.
- No applicant-facing response reveals acceptance, rejection, redirect, or access status.
- Ordinary turns require no more than one model call; deterministic turns may require none.
- Terminal profile extraction and webhook setup do not delay the applicant-facing closing message.
- Stage-level p50 and p95 latency are observable without logging application content.
- Automated tests cover the complete happy path, a clarification, a safety termination, and every private terminal outcome.

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
| 2026-07-20 | Prefer a deterministic six-step journey with one final evaluation. | It improves consistency, testability, cost, and response latency. |
| 2026-07-20 | Default conversational turns to pinned Claude Haiku 4.5. | The interaction is bounded and concise; a larger final evaluator will only be added if offline testing demonstrates a material quality gain. |
