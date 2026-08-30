# COLORS conversation realism roadmap

Status: layers 1 and 2 plus adaptive applicant branches implemented
Updated: 2026-08-20

## Aim

Groucho should build a coherent picture of an applicant through an attentive conversation, not administer a disguised form. Project configuration defines the evidence COLORS needs, while Groucho responds to the person and thread in front of it.

This roadmap adds realism without weakening the bounded question budget, human-review boundary, safety rules, or evidence requirements.

## Layer 1 — Live conversation thread

Maintain a small private state describing what is happening in the exchange:

- `subject`: the subject currently being explored;
- `strongestDetail`: the most particular detail worth retaining;
- `openHook`: an unresolved observation, tension, or question;
- `momentum`: `new`, `high`, `medium`, `low`, or `exhausted`;
- `applicantEnergy`: `neutral`, `guarded`, `engaged`, `playful`, `thoughtful`, or `uncertain`;
- `acknowledgedDetails`: details Groucho has already explicitly responded to.

The state is stored privately on assistant-message metadata and passed into the next compact application turn. It is never shown as an assessment to the applicant.

Routing principle: continue a high- or medium-momentum thread while it is producing useful personal evidence. Pivot to an unresolved evidence goal when momentum is low or exhausted, the hook has been resolved, the depth budget is unavailable, or an important gap remains near the end.

The thread state must be a concise paraphrase. It must not contain contact details, inferred protected traits, medical or psychological diagnoses, hidden scoring, or unsupported claims about the applicant.

## Layer 2 — Response modes

Give Groucho explicit modes beyond asking the next question: reflect, interpret, probe, deepen, connect, challenge, pivot, and close. Vary response shape and use “receive → contribute → invite” as a principle rather than a repeated template.

Response mode is separate from conversation routing. A `rabbit_hole` move may be shaped as `deepen`, `interpret`, or `connect`; an `advance` may connect an earlier detail to an open goal rather than abruptly asking the next configured question. The server validates compatible combinations and persists recent modes so Groucho can avoid repeating the same response shape.

Active turns leave one clear invitation to respond and ask at most one question. They do not have to use an acknowledgement-plus-question formula. `close` is reserved for terminal turns.

Two initial high-value bridges are implemented for the COLORS flow:

- After an artist is named or discussed, the recommendation goal keeps that artist as the subject: “What is one of their songs that you have—or would—share with someone, and why?”
- An album, LP, or record mention can replace the generic recommendation route with: which song from that release would they recommend, and why that track?
- A disclosure that the applicant makes or shares their own music should receive a specific reaction and one question about what they make, what they are trying to express, or what they want a listener to notice.

These bridges reuse open evidence goals and the existing turn budget. They must not become bonus questions or override a required close.

The runtime now supports a general bridge planner rather than relying only on named examples. On each active turn Groucho can propose up to three private candidates using a reusable relationship grammar—person to work, work to detail, judgment to reason, personal connection to origin, maker to practice, action to consequence, sharing to selection, feedback to care, aspiration to contribution, tension to judgment, and callback—and select at most one.

Each candidate records its source detail, connective observation, relationship kind, target evidence goal, question intent, confidence, and freshness. The connective observation gives Groucho a private reason that the next question follows instead of planning only the destination. The server accepts a selection only when it clears the confidence threshold, points to a currently eligible goal, fits the remaining question phase, and has not repeated mechanically. The accepted bridge can route the next signal and is persisted privately for continuity auditing and repetition control. No second model call is added.

When one answer contains both artist appreciation and a fresh disclosure about the applicant's own music, a maker-to-practice bridge into an open core goal takes precedence over the supporting recommendation bridge. The writing layer should make transitions natural rather than narrating their mechanics: no “let me shift”, “let me pivot”, or similar stage directions. It may use one or two short sentences, including a specific receipt, interpretation, contrast, or consequence that earns the next question. Generic praise remains discouraged, and the reply still asks at most one question without stacking evidence asks.

Three transition shapes keep this flexible. A continuation stays in the current subject and may carry the connection entirely in its question. A connection names or clearly reuses a concrete detail and makes its relationship to the next goal perceptible. A pivot briefly lands the current thread before changing subject, without pretending the subjects are related. This constrains the conversational reasoning while leaving Groucho freedom over the wording.

Contribution bridges should also stay concrete. Groucho should recall the applicant's actual action or phrase before asking what they would do in the Forum. “You said you'd help someone understand what their song is trying to become. What would you actually do with that in the Forum?” is preferable to “How would that kind of listening show up in what you contribute here?” The second version hides the live thread behind abstract language and sounds like an assessment form.

## Adaptive applicant branches

Continuity now sits inside a shared foundation with descriptive orientation lenses for artists, curators or scene participants, music or COLORS enthusiasts, and hybrids. Groucho persists a private revisable orientation summary for tone and reviewer context, but it does not remove, rewrite, force, or prioritise goals from that label. Conditional areas such as unfinished-work feedback become relevant only when the applicant's own words introduce feedback, curation, hosting, organising, unfinished work, or a comparable practice.

The server also defers an ordinary terminal decision while a relevant core goal has never been attempted and question budget remains. This prevents the final report from blaming an applicant for evidence the conversation never invited. See [colors-adaptive-applicant-branches.md](./colors-adaptive-applicant-branches.md).

## Layer 3 — Graded evidence strength

Replace purely binary goal coverage with `unseen`, `hinted`, `supported`, and `strong`. This lets Groucho remember partial evidence and return to it naturally without pretending that a passing reference fully answers a goal.

## Layer 4 — Groucho's point of view

Allow brief, grounded observations and respectful disagreement. Groucho should contribute a perspective in response to the applicant, without turning reusable aphorisms into canned copy or requiring agreement.

## Layer 5 — Conversational repair

Let Groucho recognise when a question was too broad, check an interpretation, rephrase, or offer another route. Applicants may skip a route without that choice automatically becoming negative character evidence.

Implementation baseline: Groucho now assesses answer quality and answer-to-question
relation separately. A reply can contain useful cultural evidence while still being
`partial`, a `subject_shift`, or `ambiguous` in relation to the preceding question.
For a subject shift or ambiguous connection, Groucho opens one short clarification
turn around the new detail. The runtime removes any proposed bridge and next-signal
attachment for that turn, prevents automatic coverage of the preceding intent, and
records the repair privately. This allows a line such as `Lucki` after a question
about the applicant's current project to become `Lucki—are you bringing him up as
an influence on your own work?` rather than an invented claim about how the artist
relates to their practice.

## Layer 6 — Flexible pacing

Treat the configured turn count as a soft pacing target, not a conversational
deadline. Let evidence, engagement, safety, and the live thread determine whether a
session needs five answers or more than nine.

Implementation baseline: the answer-seven closing phase and answer-eight final
probe have been removed. Nine is the default soft target. A separate emergency
loop stop sits three answers above the target, capped at fourteen. Clarifications
and depth moves no longer share a three-turn application-wide cap; per-intent
follow-up limits and relevance prevent repetition. The evidence intents do not
require separate or verbatim questions. See
[colors-flexible-conversation-contract.md](./colors-flexible-conversation-contract.md).

## Layer 7 — Listening close

End with the neutral application status boundary while briefly reflecting one or two accurate, non-evaluative details. The close should demonstrate that Groucho listened without implying acceptance or rejection.

## Layer 8 — Transcript evaluation

Evaluate representative transcripts for continuity, accurate callbacks, unnecessary repetition, quality of pivots, respectful challenge, repair, response variety, coherent closing, evidence sufficiency, and bias across different communication styles and cultural references.

## Delivery order

1. Persist and prompt with live thread state.
2. Add response modes and mode-history variety.
3. Review fresh `/doorcheck` transcripts for thread accuracy, continuity, and response-shape repetition.
4. Add graded evidence strength and conversational repair.
5. Calibrate point of view, pacing, and listening closes.
6. Run transcript evaluation before allowing cultural community memory to influence questions.
