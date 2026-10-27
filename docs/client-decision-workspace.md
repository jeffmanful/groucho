# Client decision workspace

Status: direction agreed; client workspace v1, cohorts and drops built (27 Oct 2026). Fan evidence: see [fan-evidence-and-question-bank.md](fan-evidence-and-question-bank.md).
Related: [client-decision-policy.md](client-decision-policy.md), [client-integration-guide.md](client-integration-guide.md).

## Principle

Groucho is the **decision layer**. It runs the conversation, assesses the applicant,
records who was decided, by whom and why, and keeps that history. **Clients own every
communication with their audience**: invitations, outcome messages, onboarding,
reminders. Groucho never contacts an applicant after the conversation ends.

| Groucho owns | The client owns |
|---|---|
| The applicant conversation (intro, questions, closing message) | Telling applicants the outcome |
| Assessment and recommendation | Invitations and access in their own product |
| Decisions, corrections and their history | Deciding what to say about a correction |
| Allocation of tiers and seats | Onboarding and engagement |
| Decision events (signed webhooks) | Reporting what happened next |
| Metrics across the whole funnel | |

## Decide, then allocate

Two separate questions:

- **Decision:** does this person qualify? `approved` or `declined`, by a reviewer, the
  client's app or the client's rules. In a drop, approved means "a real, eligible
  person", not "gets a ticket".
- **Allocation:** what happens to them next? Approved people are placed in
  **cohorts** the client defines.

A project with no cohorts behaves as today: approved means access. With cohorts,
**only a cohort that grants access issues access** (the access secret); moving someone
out of it revokes it.

### Cohorts

One concept replaces tiers, seats and waitlists. A cohort has:

| Property | Options |
| --- | --- |
| Name | The client's own: "Guaranteed: true fans", "Ballot pool", "Waitlist", "Backlog" |
| Grants access | Yes or no |
| Capacity | A number, or unlimited |
| Who qualifies | Optional: applicant type, a drop field (e.g. shoe size), minimum score |
| Order | Ranked by score or date, by draw, manual, or none |
| Refills | Optional: the access cohort it refills when a place frees up |
| Locked | Frozen for a ballot or a sign-off; unlocking is recorded |

Presets cover the common cases: an access **tier** (grants access, capacity), a
**waitlist** (ranked, refills a tier), a **backlog** (holding, no order) and a
**ballot pool** (holding, locked before the draw).

- A person is in **one cohort at a time** within a round, so their status is never
  ambiguous.
- Approved people not yet placed sit in **Unallocated**, shown in Needs you.
- **Filling a cohort:** select people, fill by a filter ("size 8", "top 50 by score"),
  or draw at random. Each bulk fill records the rule and inputs, so the client can
  say why someone landed where they did.
- **Manual placement** (guests, partners) is allowed and recorded as manual, by whom.
- Every move is append-only history and an `application.allocated` event with the
  cohort and whether it grants access.
- Fallback between cohorts ("Featured if there's room, otherwise Member") is a
  **per-round setting**: useful for memberships, off for ballots, where nobody is
  silently moved between pools.

### Rounds

Cohorts and capacity belong to a **round**: an intake or drop with an entry window
(for example "Season 1" or "Gems drop, 16 Oct"). Every project starts with one open
round, so clients who don't need rounds never see them.

### Ballots

Running a ballot is the client's choice:

- **In Groucho:** draw N at random from a locked cohort into another cohort. The draw
  uses secure randomness without replacement, records its input, size and time, and
  can't be repeated; the remaining order becomes the ranked waitlist if the client
  wants one.
- **Outside Groucho:** lock the cohort, export it (or receive it by webhook), run the
  draw elsewhere, then report the winners back by moving them or through the API.

Either way Groucho remains the record of who entered, who was eligible, who was in
the ballot and who was selected. Over time that history lets clients recognise
returning entrants and lets Groucho measure how different routes (ranked, guaranteed,
drawn) compare once outcomes are reported.

### Rules and the Rules page

The Rules page manages suitability thresholds, automatic approve and decline, cohorts,
how freed places are refilled, and reapplication. Changing a rule never changes past
decisions. Before saving, the page replays the last 30 days with the change and shows
what the client's team actually decided for the people who would move, and whether
they joined.

## Drops

A drop (a limited product or ticket release) uses the same pipeline as the Forum:
entry, review, decision, cohorts and events. It is not a separate engine.

1. **Entry.** A branded Groucho experience: name, email, social links, drop-specific
   fields (e.g. shoe size), and optionally a short conversation with the client's
   persona. A **form-only entry** is supported; not every entrant has a conversation.
2. **Review.** The goal is a clean, eligible list: remove spam and duplicates. Socials
   are for reviewers to check manually. Review works **in bulk**: filter (for example
   "no flags, entry complete"), approve or decline the set, and leave uncertain
   entries for a person.
3. **Cohorts.** Approved entries are placed into the client's cohorts: for example
   "Guaranteed: true fans" and "Ballot pool" (by size if stock differs by size). The
   ballot runs in Groucho or outside it, as above.

### Duplicates and spam

Groucho always flags simple, explainable matches for review: the same email, social
handle or phone across entries in a round, and known disposable email providers. Each
flag shows what matched; the reviewer decides. It is not presented as bot detection.

### What the client decides

- **The scoring mechanism is always the client's.** For a simple drop it can be
  "remove spam and duplicates, nothing else". Effort or familiarity from the
  conversation is used only where the client chooses, typically to fill a guaranteed
  "true fans" cohort.
- **Nobody is penalised for effort they weren't asked for.** The client states the
  expected level of participation before the entry flow starts (what's asked, what's
  optional, how places are allocated), so entrants know what counts.
- **Further authenticity checks are opt-in** per client (for example account-control
  checks or a unique-person credential), and bespoke checks can be plugged in as
  additional signals for review. None is required by default.

## Application lifecycle

```text
entered (form or conversation) → in review ⇄ clarification requested
                                      ↓
                                   decided ──→ placed in a cohort ⇄ moved / drawn
                                      ↓
               (client reports) invited → joined → active | inactive | left
```

Side paths: **correction** (a decision is revised) and **reapplication** (a new
application linked to earlier ones by applicant email).

## Decision record

Decisions become **append-only**:

- A decision is never updated or deleted. The current decision is the latest one
  that has not been superseded.
- "First decision wins" stays as the rule for *concurrent* decisions: two reviewers
  deciding at once cannot overwrite each other (`409`).
- Each decision has an **internal note** (reviewers only) and an optional
  **applicant-facing reason**, sent in the webhook for the client to use or ignore.

### Corrections

- A correction **comes from the client**: an owner or admin in the dashboard, or the
  client's app through the API with an applications key. Groucho staff can see
  corrections but do not make them.
- A correction is a new decision that points to the one it replaces
  (`supersedes_decision_id`) and requires a reason. Who and when are recorded.
- Approved → declined revokes the access secret and frees the seat. Declined →
  approved issues a new secret and allocates.
- Groucho sends `application.decision_corrected`. Whether and how to tell the
  applicant is the client's call.

Open: whether members (not only owners and admins) may correct.

## Events

All signed with `X-Groucho-Signature`, as today. Clients subscribe per webhook.

| Event | The client's system then… |
|---|---|
| `session.completed` (exists) | Records the finished application |
| `application.decided` (exists) | Without cohorts: invites the applicant or tells them the outcome |
| `application.allocated` | Placed in or moved between cohorts; says whether the cohort grants access, so the client grants, revokes or tells them they're waiting |
| `cohort.locked` / `cohort.drawn` | A ballot pool was frozen, or a draw in Groucho selected winners |
| `application.clarification_requested` | Sends the applicant the follow-up link in the event |
| `application.clarified` | Usually nothing; the application returns to review |
| `application.decision_corrected` | Revokes or grants access and decides what to say |

Failed deliveries are a first-class problem: an undelivered decision means an
applicant is stuck. The dashboard shows delivery health and lets clients retry.

## Clarification

A reviewer asks one follow-up question. Groucho opens a short follow-up conversation
on the same application and puts a resume link in the event. The client sends the
link; the applicant answers in the client's own front end through the SDK. The answer
is marked as new when the application returns to review.

## Reapplication

New applications are linked to earlier ones by applicant email and reviewers see the
history. A client can set a cooldown after a decline; starting a session during it
returns "not eligible until <date>", and the client decides what to tell the person.

## Reported outcomes

Clients report what happened after the decision with an applications key:

```http
POST /v1/applications/{sessionId}/outcomes
{ "outcome": "joined", "occurredAt": "2026-11-02T10:00:00Z" }
```

Outcomes: `invited`, `joined`, `invite_declined`, `no_response`, `active`,
`inactive`, `left`, `removed`. They are append-only, like decisions, and optional.

This is the strongest quality signal Groucho can have: **do the people Groucho
recommends actually join and take part?** It lets us calibrate thresholds, compare
policy decisions with reviewers', and show clients whether the gate is working.

## Client dashboard

Optimised for making decisions, not for operating Groucho. Five areas, each answering
one question:

| Area | Question | Contents |
|---|---|---|
| **Needs you** | What do I have to look at? | Applications in the review band, low confidence, clarification answers, waitlist movement, failed deliveries |
| **Decisions** | Who got what, and why? | Each person's decision, source, reason, tier, corrections and reported outcome |
| **Rules** | What happens automatically? | Thresholds, automatic accept/decline, tiers and seats, waitlist order, reapplication cooldown, with a simulation over recent applications |
| **Experience** | What do applicants see? | Intro, questions, closing message, with a preview |
| **Insights** | Is the gate working? | Funnel, drop-off by question, question effectiveness, approval and decline rates, agreement with Groucho, join and participation rates |

### Shape: inside the current app (decided 27 Oct)

The client workspace is a view of the current dashboard, not a separate product.
It keeps one codebase and one sign-in, and the Decisions ledger handles corrections
and later changes well. From the lighter-product exploration it takes:

- **The application screen:** Groucho's summary and recommendation, what the
  applicant said, earlier applications, and a decision panel with access tier, a note
  for the team and a reason the client can share.
- **A theme toggle:** System, Light and Dark, in the sidebar footer, remembered in
  that browser. Older setup and conversation pages stay dark until they are redesigned. Dashboard tokens get a light set alongside the current dark one.

Client roles see Needs you, Decisions, Rules, Experience, Insights and Settings.
Designs are in the admin canvas ("Client workspace" page), in both themes.

## Metrics

- **Funnel:** entered → finished → assessed → decided → placed in a cohort → invited → joined → active.
- **Routes compared:** join and participation rates for guaranteed, ranked and drawn
  places, once outcomes are reported.
- **Abandonment:** by question and by turn.
- **Question effectiveness:** which questions separate approved from declined, which
  get thin answers, and which people leave on (per COLORS evidence ID).
- **Outcomes:** approval and decline rates, time to decision, correction rate, how often
  reviewers disagree with Groucho, and join and participation by score band.

## Phasing

1. Append-only decisions with corrections; the event set; delivery health and retry. **Built.**
2. Client dashboard v1: Needs you, Decisions, the application screen, corrections and
   the theme toggle. **Built.**
3. Reported outcomes API **(built)** and the join and participation metrics (the
   Decisions page shows the join rate; Insights to follow).
4. Cohorts and rounds: allocation, lock, export, draw in Groucho, `application.allocated`;
   access issued by cohort. Bulk review, duplicate and spam flags, form-only entry and
   drop fields (shared with drops). **Built** (Entries and Cohorts pages, `POST /v1/entries`,
   `GET /v1/cohorts`, `POST /v1/cohorts/{id}/members`). One round per project for now; there is
   no screen yet for opening and closing the entry window or starting a new round.
5. Clarification requests, reapplication history and cooldowns.
6. Experience settings, then the rest of Insights and rule simulation.

## Open questions

- Whether members may correct decisions, or only owners and admins.
- Whether a bulk move of many people sends one event per person or a batch event. (Built as one
  `application.allocated` per person, queued for the delivery worker when there are more than ten.)
- How long a round's history is kept, and whether returning entrants are recognised
  across rounds by default.
- How long a reported outcome window stays open (for example, 90 days after joining).
