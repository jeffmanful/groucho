# Changelog — 18 August 2026

## Conversation realism

- Documented the eight-layer conversation-realism roadmap.
- Started layer 1: private live conversation-thread state.
- Added current subject, strongest detail, unresolved hook, momentum, applicant energy, and acknowledged-detail tracking.
- Persisted thread state on assistant messages and included it in the next compact application turn.
- Instructed Groucho to continue productive threads before filling unrelated evidence gaps, while preserving question, follow-up, and safety limits.
- Added normalization and tests so thread state cannot accumulate unbounded or malformed model output.
- Increased the structured turn response budget to accommodate thread state alongside assessments and terminal reviewer reports.

## Response modes

- Implemented `reflect`, `interpret`, `probe`, `deepen`, `connect`, `challenge`, `pivot`, and `close` as explicit private response modes.
- Kept response shape separate from the accepted conversation-routing move.
- Added server-side compatibility rules and safe fallbacks for malformed or incompatible mode choices.
- Persisted the resolved mode on assistant-message metadata and included recent mode history and repetition count in the next compact turn.
- Added prompt guidance to vary conversational shape, leave one clear invitation on active turns, and avoid the repeated acknowledgement-plus-question formula.

## Adaptive question budget

- Reframed the six configured COLORS items as evidence goals rather than six required questions, retaining multi-goal coverage and adding related-goal clusters.
- Added core and supporting priorities so supporting gaps cannot prolong the closing phase.
- Added a shared three-turn adaptive budget across clarifications, open doors, and rabbit holes.
- Defaulted to one clarification per goal; a second now requires a core gap with evidence of recovery potential.
- Stopped adaptive coaxing after thin evidence across three distinct goals.
- Added a five-to-seven-turn target, a core-only closing phase after answer seven, one possible final core probe after answer eight, and a hard neutral close after answer nine.
- Prevented `advance` from repeating the current unresolved goal and added regression coverage for the feedback-question loop.
- Added route-level coverage for the nine-turn hard stop and model attempts to continue past it.

## Contextual conversation bridges

- Replaced the generic “What have you found yourself sharing lately?” route with an artist-linked question: “What is one of their songs that you have—or would—share with someone, and why?”
- Added an explicit artist-to-song bridge so Groucho keeps the named artist as the subject instead of resetting the conversation.
- Added an album bridge that turns a named album, LP, or record into a track recommendation question when recommendation evidence remains open.
- Added a maker bridge that reacts when applicants disclose making or sharing their own music and asks naturally about their work.
- Defined both bridges as replacements for generic questions, not extra turns, with multi-goal coverage and normal closing-budget enforcement.
- Added the bridge rules to the COLORS persona, application prompt, compact live state, documentation, and prompt-contract tests.
- Added a general bridge grammar covering person-to-work, work-to-detail, judgment, personal connection, maker practice, consequence, sharing, feedback, contribution, tension, and callbacks.
- Added a structured three-candidate bridge plan with source detail, target evidence goal, question intent, confidence, and freshness.
- Added server-side validation for bridge confidence, eligible goals, closing phase, remaining questions, and repeated bridge kinds.
- Persisted bridge candidates and accepted selections privately so later turns can avoid mechanical repetition and reviewers can audit continuity.
- Allowed an accepted bridge to route the next evidence goal even when the model's generic next-signal field points elsewhere.
- Kept bridge planning inside the existing model turn and increased the response allowance without adding another AI request.
- Prioritized a fresh maker-to-practice candidate into an open core goal over a supporting recommendation bridge when the same answer contains both artist appreciation and the applicant's own music.
- Added a server-side maker-priority fallback so this preference still affects routing when the model selects the supporting artist bridge.
- Banned narrated transitions such as “that matters”, “let me shift”, and “moving on”; bridges must now be carried by one direct question rather than an evaluative preamble.
- Prevented bridge questions from stacking a sharing reason and a separate “what should they notice?” ask in the same turn.

## Verification

- Ran focused and full tests, type checking, lint, diff checks, and a production build.
