# COLORS conversation realism roadmap

Status: layers 1 and 2 implemented  
Updated: 2026-08-18

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

Each candidate records its source detail, relationship kind, target evidence goal, question intent, confidence, and freshness. The server accepts a selection only when it clears the confidence threshold, points to a currently eligible goal, fits the remaining question phase, and has not repeated mechanically. The accepted bridge can route the next signal and is persisted privately for continuity auditing and repetition control. No second model call is added.

When one answer contains both artist appreciation and a fresh disclosure about the applicant's own music, a maker-to-practice bridge into an open core goal takes precedence over the supporting recommendation bridge. The writing layer must make transitions invisible: no “that matters”, “let me shift”, “let me pivot”, or similar narration. It should ask one direct question whose wording carries the connection, without stacking a second evidence ask.

## Layer 3 — Graded evidence strength

Replace purely binary goal coverage with `unseen`, `hinted`, `supported`, and `strong`. This lets Groucho remember partial evidence and return to it naturally without pretending that a passing reference fully answers a goal.

## Layer 4 — Groucho's point of view

Allow brief, grounded observations and respectful disagreement. Groucho should contribute a perspective in response to the applicant, without turning reusable aphorisms into canned copy or requiring agreement.

## Layer 5 — Conversational repair

Let Groucho recognise when a question was too broad, check an interpretation, rephrase, or offer another route. Applicants may skip a route without that choice automatically becoming negative character evidence.

## Layer 6 — Flexible pacing

Keep nine applicant-facing questions as a ceiling, not a target. Let evidence, engagement, safety, and remaining important gaps determine whether a session needs five turns or nine. Treat depth as a bounded resource rather than a compulsory special event.

Implementation baseline: the runtime now targets five to seven turns, enters a
core-only closing phase after answer seven, reserves answer eight for one final
decision-changing core gap, and forces the neutral close after answer nine. All
clarifications, open doors, and rabbit holes share a three-turn adaptive budget.
One clarification per goal is the default; a second requires a core gap with
recovery potential. The six evidence goals do not require six separate questions.

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
