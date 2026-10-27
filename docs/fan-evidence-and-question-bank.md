# Fan evidence and the question bank

Status: direction agreed 27 Oct 2026; not built.
Related: [client-decision-workspace.md](client-decision-workspace.md),
[colors-curation-question-experiment.md](colors-curation-question-experiment.md),
[colors-conversation-guide-and-rubric.md](colors-conversation-guide-and-rubric.md).

## Purpose

Help a client see how actively someone supports their brand, artist or community, with
evidence a reviewer can check. This matters more to clients than catching bots: the hard
question in a drop or a membership round is rarely "is this a person?" but "is this one of
ours?".

## Decisions (27 Oct 2026)

- **Evidence, not a verdict.** Fan evidence paints a picture for reviewers. It is shown and
  sortable during review, but no rule acts on it: cohort fills (everyone, matching, at random,
  top by score) never select by fan evidence, and automatic decisions never use it. People
  decide what it means.
- **Groucho drafts, the client approves.** Groucho drafts questions and their private truth
  notes from the client's brief. Nothing is asked until a client owner or admin approves it.
- **Two to three bank questions per applicant**, inside a short conversation.

## Principles

- **Positive only.** Evidence can show someone is engaged. Missing evidence never counts
  against anyone: no connected account, no list match and a quiet answer all leave a person
  exactly where they would otherwise be.
- **Memories, not trivia.** Ask what someone remembers or noticed, not dates and names. A fan
  who was there tells a story; someone with an answer sheet recites.
- **A way in for newer fans.** Every set includes a question any engaged person can answer
  (what drew them in, how they found the work).
- **Depth, not polish.** Assess specific, lived detail, never fluency, eloquence or length.
- **Disclosed.** The client tells applicants, before they start, that answers are read by
  people and what kind of participation the client hopes for. Groucho never implies a hidden
  test or that other applicants said something.
- **Evidence beside every summary.** A reviewer always sees the question asked, the answer and
  why Groucho read it the way it did.

## Evidence sources

| Source | Kind | How | When |
|---|---|---|---|
| **Client lists**: mailing lists, past events, previous drops, members | Known | Client uploads a list or sends fields through the API; matched on the normalised email Groucho already uses for duplicate flags | First. Strongest and cheapest |
| **History in Groucho**: earlier rounds entered, cohorts, reported outcomes (joined, active) | Known | Grouped per person within the organisation by normalised email | Second |
| **Moment recall**: the question bank below | Said, checked | Rotating questions with private truth notes | Second, with the bank |
| **YouTube subscription** to the client's channel | Shown | Optional sign-in; the subscriptions API checks one channel | When a client asks |
| **Last.fm plays** of the artist | Shown | Optional username; public API | When a client asks |
| **Apple Music library** | Shown | Optional sign-in through MusicKit | Later, if asked |
| Spotify follows and likes | – | Not viable: since 15 May 2025 Spotify only grants extended API access to organisations with at least 250,000 monthly active users | – |
| Instagram, TikTok, X follows | – | Their APIs don't reliably let an app check whether a user follows an account | Social links stay a manual check for reviewers |

Connections are always optional and never required to enter.

## The question bank

Each project has a bank of specific questions, grouped by **lens** (for example: live,
drops and launches, community, the music) and by **difficulty group** (questions within a
group should be equally answerable by an engaged fan).

A question has:

- the wording Groucho asks, and allowed variations;
- its lens and difficulty group;
- **truth notes**, private to the client and the assessment: what really happened, details
  only someone there would know, things commonly misremembered. Never shown to applicants and
  never quoted to them;
- the kind of question: a memory ("what do you remember about the Peckham store opening?"), a
  choice with a reason (the curation question family), or an open way in;
- status: draft, approved, live, resting or retired, with who approved it and when.

### Lifecycle

1. **Brief.** The client describes the moments that matter: shows, drops, launches, community
   events, rituals, in-jokes. Free text and links.
2. **Draft.** Groucho drafts questions and truth notes per lens and difficulty group, and
   flags anything that reads as trivia or that only long-standing fans could answer.
3. **Approve.** A client owner or admin edits and approves each question. Only approved
   questions go live.
4. **Live and rotating.** Each applicant gets two to three, see selection below.
5. **Watch.** Question health (below) runs continuously.
6. **Retire and refresh.** Questions that leak or stop telling engaged fans apart are rested or
   retired, and Groucho drafts replacements for approval.

### Selection for each applicant

- Two to three bank questions per conversation, from different lenses, including the open way
  in when the client wants it.
- Drawn at random within a difficulty group, so applicants face equivalent questions.
- Weighted away from questions asked most recently, so a single question isn't everywhere at
  once.
- Recorded: each answer stores which question and which version was asked, so review and health
  tracking always know the context. The conversation can still follow up naturally; follow-ups
  are recorded as such.

### Reading an answer

Groucho compares the answer with the truth notes and records one of:

- **Consistent and specific**: concrete detail that fits what happened;
- **Consistent, general**: fits but adds nothing only someone engaged would know;
- **Can't tell**: plausible but not covered by the notes;
- **Inconsistent**: contradicts the notes. Shown to reviewers as a note, never as a finding;
  memories are imperfect.

Plus the quote that supports the reading. This replaces nothing in the existing assessment; it
adds per-question evidence to it.

## Question health

Per question, for the client and for Groucho:

- **Exposure**: times asked, recently and in total.
- **Convergence**: how often different applicants give the same specific detail in very
  similar words. A sudden rise suggests an answer is circulating. Converging answers are marked
  "possibly shared" for reviewers; the question is rested automatically past a threshold.
- **Usefulness**: whether consistent, specific answers line up with known fans (list matches,
  history) and with reported outcomes (joined, active). A question that everyone answers well,
  or no one does, isn't telling fans apart.
- **Equivalence**: answer quality across questions in the same difficulty group. A question that
  is much harder or easier than its group is flagged so the rotation stays fair.

Health uses counts and similarity measures, not stored copies of answers outside the
conversation record. Aggregate views follow the cultural-signals thresholds: nothing
shown that singles out an applicant.

## What reviewers see

On Entries, in the cohort picker and on the application screen:

- **Known** chips: "Newsletter since 2022", "2 past events", "Entered Spring drop".
- **Said** evidence: per bank question, the reading (consistent and specific, general, can't
  tell, inconsistent) with the supporting quote, and "possibly shared" where it applies.
- **Shown** chips for connected accounts: "Subscribed on YouTube", "1,240 Last.fm plays".
- A **fan evidence summary** (for example: strong, some, little) built from the above, always
  expandable to its parts. Sortable for review; never a cohort rule.

## Privacy

- Client lists are matched on normalised email and kept per project; the client can delete a
  list, which removes its matches.
- Connected accounts store only the result (subscribed: yes; plays: 1,240), not the account's
  wider data, and can be disconnected.
- Truth notes are client confidential and never leave the assessment.

## Phasing

1. **Show what Groucho already knows** on Entries and in the cohort picker: assessment summary
   and evidence quotes, sortable.
2. **Client lists** (upload and API fields) and history across rounds.
3. **Question bank**: brief → drafts → approval, rotation, per-question readings.
4. **Question health**: exposure, convergence, usefulness, equivalence; automatic resting.
5. **Optional connections**: YouTube, then Last.fm.

## Open questions

- How a client describes moments in a brief: free text only, or a structured form per moment.
- Thresholds for convergence and automatic resting, before any real data.
- Whether clients can share a question bank across projects (for example several drops by the
  same brand).
- How long list matches and question-health data are kept.
