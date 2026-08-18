# COLORS Conversation Depth

Status: implementation baseline  
Updated: 2026-08-18

## Purpose

The standard COLORS application should remain short and predictable, while giving
Groucho permission to notice two moments that a fixed form usually misses:

- An applicant has given thin answers and the current questions have not yet
  revealed their point of view.
- An applicant has offered a particular, thoughtful, or specialist observation
  that deserves one more question.

These moments are called conversation points. They deepen the application without
turning it into a knowledge test or rewarding long, polished answers.

## Applicant Experience

Groucho has two discretionary depth moves inside a shared two-point budget:

### Open door

Use after repeated thin answers, once per application. The purpose is to offer a
different route into the applicant's perspective, not to tell them that they have
answered badly.

Example:

> Let's try this from another angle. Pick an artist, record, scene—or anything
> creative—you care about. What do people tend to miss about it?

### Rabbit hole

Use after a rich answer while conversation points remain. The purpose is to reward substance
with attention and explore perspective, care, consequence, criticism, or what
other people miss.

Example:

> Do you think becoming better known would actually be good for them—or could it
> change something important?

Neither move should test trivia, cultural status, professional access, or whether
Groucho recognises the artist.

## Internal Model

Every structured gatekeeper turn classifies the current answer:

- `thin`: the answer does not yet provide usable evidence for the current signal.
- `usable`: the answer provides enough evidence to continue.
- `rich`: the answer contains a particular observation, tension, personal
  connection, independent judgment, or meaningful context.
- `concerning`: the answer contains a possible safety, dignity, integrity, or
  extractive concern that needs a challenge or terminal decision.

The model also proposes one conversational move:

- `clarify`
- `open_door`
- `advance`
- `rabbit_hole`
- `challenge`
- `decide`

Answer quality describes evidence, not writing. Length, fluency, vocabulary,
fame, follower count, and recognisable references are not quality signals.

## Runtime Rules

The conversational model proposes the move; the server owns the route.

- Maximum applicant-facing questions: 9.
- Target session length: 5–7 applicant turns when evidence permits.
- Closing phase: after answer 7, only unresolved core evidence may justify another question.
- Final probe: after answer 8, at most one decision-changing core question remains.
- Hard stop: answer 9 always produces the neutral close.
- Default clarification allowance for one goal: 1.
- A second clarification requires a core, decision-critical goal and evidence of recovery potential.
- Maximum adaptive turns across clarifications, open doors, and rabbit holes: 3.
- Maximum conversation points: 2.
- Maximum open-door moves: 1.
- Rabbit-hole moves share the maximum two-point conversation budget with the open door.
- `open_door` requires a current `thin` answer and a previous recent `thin`
  answer.
- `rabbit_hole` requires a current `rich` answer.
- `challenge` requires a current `concerning` answer.
- A move that stays on the current signal requires remaining question and
  follow-up budget.
- Invalid adaptive moves fall back to clarification or a route into an unresolved
  evidence goal.
- `advance` cannot name the current unresolved goal as a way to repeat it. The
  runtime treats that as a clarification and applies the same budgets.
- Three distinct goals with thin evidence disable further adaptive coaxing.
- The six configured goals are not six required questions; one answer may cover
  several goals and related goals share a conversational cluster.
- Safety boundaries override conversational depth.
- Terminal applicant copy remains the configured neutral closing message.

Assessments are stored on user-message metadata. Accepted conversation moves are
stored on assistant-message metadata. The compact state contains only the recent
quality trajectory and aggregate counts; it does not expose private assessments
to the applicant.

## Delivery Sequence

### 1. Structured assessment

Add `answerAssessment` and `conversationMove` to `groucho_respond`. Normalise
malformed output and retain backward compatibility for stored legacy turns and
test fixtures.

### 2. Observe before branching

Persist assessment metadata and expose the quality trajectory in compact state.
This creates an auditable baseline without requiring a second model call.

### 3. Remove length-led routing

Stop treating short answers as automatically vague. Semantic assessment becomes
the primary quality signal; deterministic code remains responsible for budgets,
valid transitions, and hard safety handling.

### 4. Enable clarification and rabbit holes

Allow targeted clarification for thin evidence and rabbit-hole moves for rich
answers while the shared conversation-point budget remains. Follow-ups stay
attached to the current conversational thread.

### 5. Enable open doors

After tone review, allow one open-door move following repeated thin answers. It
must invite a different subject or angle without announcing an evaluation.

### 6. Evaluate

Review representative transcripts and measure:

- Recovery rate: initially thin applications that later provide usable evidence.
- Rabbit-hole yield: depth questions that add reviewer-relevant evidence.
- Completion and abandonment rates.
- Average and p95 applicant-facing question count.
- Classification consistency across short answers, imperfect English, unknown
  artists, listeners, makers, and multipliers.
- Reviewer confidence and disagreement with Groucho's advisory report.

The success metric is improved evidence and a more attentive experience, not
longer answers.
