# COLORS curation question experiment

Date: 2026-09-15  
Status: Remove-one pilot and source-linked reviewer synthesis integrated in test and dry-run flows
Scope: Testing richer, COLORS-specific interactions alongside the current Forum application

## Summary

Introduce a `choice with rationale` family of questions that asks applicants to
make a meaningful cultural or curatorial decision and explain it. The first
candidate is a media-led programming exercise using four COLORS performances.

This is stronger than a conventional preference question because it produces
three kinds of evidence at once:

- the choice itself;
- how the applicant balances competing considerations;
- how clearly and thoughtfully they explain the decision.

The interaction must not become a test of whether an applicant shares an
internal COLORS favourite. Review the reasoning, contextual awareness,
curiosity and community instinct—not whether a particular artist was selected.

## Recommended first question

### Programme the room

> Four artists. One room. Three slots.
>
> Choose the three you would programme, put them in order, and tell us what you
> want the audience to feel as the room changes.

**Interaction:** Four performance cards with lightweight previews, selection of
three, ordering, and a required written or spoken rationale.

**Primary signals:** Curatorial judgement, sequencing, audience awareness,
ability to find a coherent thread across distinct work.

**Rating:** 9.5/10. This is preferable to simply asking for a top three because
the applicant has to create an experience rather than report their taste.

### Simpler pilot version

> You have four performances and three places. Which one would you leave out,
> and what do the remaining three make possible together?

**Interaction:** Remove one and provide a required rationale.

**Rating:** 8.5/10. This is easier to build and understand, but reveals less
about sequencing and the applicant's ability to construct a programme.

## Strong COLORS-specific question catalogue

### 1. Programme the room

Show four performances. Ask the applicant to choose three, order them, and
describe the intended journey through the room.

- **Format:** Select three + rank + rationale
- **Reveals:** Taste, sequencing, contrast, coherence and audience awareness
- **Use:** Lead rich-media question for the pilot

### 2. What's missing?

Show an existing three-act programme and ask what energy, perspective, place or
community is absent. Invite the applicant to nominate an addition.

- **Format:** Select a perceived gap + open nomination
- **Reveals:** Ability to identify omissions rather than only exclude
- **Use:** Strong alternative to a second elimination question

### 3. Connect two worlds

Ask the applicant to choose two performances and propose a collaboration,
conversation, shared bill or Forum thread that connects them.

- **Format:** Select two + rationale
- **Reveals:** Pattern recognition, imagination and connective thinking
- **Use:** Particularly suitable for curators, organisers and active listeners

### 4. Put us onto something

Ask for one artist, collective, venue, radio show or local scene that the wider
COLORS community should understand, including the context that makes it matter.

- **Format:** Search/link or open nomination + explanation
- **Reveals:** Local knowledge, curiosity and discovery beyond established names
- **Use:** Core contribution question; do not score follower count or status

### 5. Introduce this artist

Show an unfamiliar performance and ask the applicant to write a two-sentence
Forum introduction that helps somebody else enter the work.

- **Format:** Media preview + short text
- **Reveals:** Communication, attention and cultural contextualisation
- **Use:** Keep the artist context available so this does not become a recall test

### 6. Build the conversation

Show three representative Forum posts. Ask which one the applicant would reply
to first and have them write the opening response.

- **Format:** Select one + composed reply
- **Reveals:** Listening, generosity and conversation-building behaviour
- **Use:** High-value early-access membership question

### 7. Protect the room

Present a plausible community moment—for example, somebody dismissing music
because of its genre or language—and ask how the applicant would respond.

- **Format:** Scenario + open response
- **Reveals:** Inclusivity, judgement and ability to disagree constructively
- **Use:** Use sparingly and avoid an obviously performative “correct” answer

### 8. Map a city carefully

Ask where the applicant would begin when learning about a city's music culture,
who they would speak to first, and what they would want to avoid assuming.

- **Format:** Select a starting point + rationale, or open response
- **Reveals:** Locally grounded curiosity and non-extractive research instincts
- **Use:** Strong connection to TONES and local community programming

### 9. Change my mind

Ask for an initial selection, reveal one meaningful piece of context about the
artists or scenes, then offer the applicant a chance to keep or revise it.

- **Format:** Choice + context reveal + reconsideration
- **Reveals:** Reflection, openness and response to new information
- **Use:** Do not treat changing or retaining the answer as inherently better

### 10. A music memory

Use an image, place or sound as a prompt and invite a short voice or written
story about an early or formative music memory.

- **Format:** Visual/audio prompt + voice or text
- **Reveals:** Personal relationship to music and storytelling
- **Use:** A human counterweight to evaluative choice questions

## Recommended pilot flow

Use different interaction types to avoid making the application feel like a
sequence of tests:

1. **Personal connection:** A music memory or existing open introduction.
2. **Curatorial judgement:** Programme the room.
3. **Community behaviour:** Build the conversation.
4. **Contribution:** Put us onto something.

Use no more than one or two rich-media questions in one application. The rest of
the conversation should remain adaptive, with Groucho following useful details
instead of mechanically moving through a fixed questionnaire.

### Implemented first pilot

The current test variant inserts one media exercise after the applicant's
second answer, provided a cultural-point-of-view evidence goal is still open.
It shows the latest four full performances from the official COLORS playlist,
asks the applicant to leave one out of a three-performance programme, and
requires them to explain what that decision protects in the programme.

This prompt runs once at most and occupies the next adaptive question slot; it
does not add an extra compulsory question to the end of the application. If the
feed cannot be loaded, the conversation continues with Groucho's normal prompt.
The automatic variant is enabled for previews, test projects and dry runs only.

### Reviewer-report integration

Structured media answers now remain typed through report generation. The report
receives the question ID, selection mode, selected or excluded option labels,
rank positions where applicable, and the applicant's rationale. A dedicated
curatorial-approach section may describe supported evidence of sequencing,
coherence, audience awareness, context, trade-offs, curiosity or reconsideration.

The client report now opens with a concise snapshot: a one- or two-sentence
applicant summary, controlled evidence-backed tags, the primary strength, an
open reviewer question where present, and the suggested next action. The full
assessment and source evidence are collapsed initially and can be expanded.
The snapshot and detailed view come from the same verified report rather than
separate model calls, preventing the two layers from drifting apart.

The report and its semantic verifier treat the exercise as hypothetical evidence.
They assess the rationale, not whether a particular artist was selected or
excluded, and must not upgrade one exercise into an established curatorial
practice. The client view displays the source question, selection, rationale and
interpretation together with that caveat.

## Interaction requirements

- Start with lightweight cards; load only the media the applicant chooses to play.
- Never autoplay four YouTube embeds.
- Allow keyboard selection, visible focus and clear selected/unselected states.
- Provide captions, a transcript and a useful still-image fallback.
- Preserve the selection while the applicant writes or records the rationale.
- Submit the structured choice and rationale together.
- State the required number of selections and prevent accidental over-selection.
- On mobile, use one active player rather than four embedded players in a long grid.
- Do not require watching every clip to continue.
- Avoid options whose fame or genre makes one answer feel socially mandatory.

## What should be assessed

The reviewer and Groucho may consider:

- whether the rationale is specific to the work shown;
- whether the applicant can articulate a curatorial thread;
- awareness of audience, setting and cultural context;
- curiosity about unfamiliar work;
- ability to notice gaps and trade-offs;
- openness to complexity or reconsideration;
- community-minded language and behaviour.

They must not infer suitability from:

- selecting or excluding a particular artist;
- prior familiarity with an artist, genre, language or scene;
- whether the applicant finishes every video;
- prestige, follower count, professional access or insider vocabulary;
- agreement with an assumed internal COLORS taste.

## Experiment structure

### Recommendation for the first controlled test

Keep one codebase and deployment. Create two Groucho project records within the
existing COLORS organisation:

| Arm | Suggested project name | Experience |
| --- | --- | --- |
| Control | `COLORS Forum Application — Current` | Current adaptive application |
| Variant | `COLORS Forum Application — Curation Pilot` | Same baseline plus the new interaction family |

This is the lightest clean comparison in the current architecture because
project settings, sessions, reports and outcomes are already scoped by project.
It also prevents pilot settings from changing the live control experience.

Initially configure the variant with the test environment and dry-run session
mode. Move to a limited live allocation only after interaction, accessibility
and reviewer calibration checks pass.

Keep the following identical between arms wherever possible:

- audience and entry point;
- persona and conversational tone;
- opening and closing treatment;
- maximum conversation length;
- reviewer rubric and decision policy;
- device support and performance budget;
- invitation window and traffic source.

Only the experimental interaction and the minimum prompt changes needed to use
it should differ.

### Assignment

Assign each eligible applicant to one arm before the session begins, ideally
50/50 for a usability and signal-quality pilot. Persist that assignment so a
returning applicant does not switch versions midway. The host should choose the
corresponding project ID when creating the session.

Do not let applicants choose their arm. Internal previews may continue to use
the existing project selector.

### When a second project record is unnecessary

For design critique, internal usability sessions or a very small moderated
prototype, the existing COLORS test project is enough. Select the pilot manually
and collect qualitative notes. Create the second project record when comparing
real cohorts or reporting outcomes separately.

### Longer-term experiment model

If Groucho will run many experiments, add explicit `experience_version`,
`experiment_id` and `variant_id` values to each session and support versioned
flows inside one project. That avoids multiplying project records and permits
shared keys, webhooks and project-level cultural context. This is not required
for the first COLORS pilot.

## Measures of success

Compare control and variant on:

| Measure | Desired signal |
| --- | --- |
| Completion rate | No material drop caused by media or interaction effort |
| Median completion time | Increase is proportionate to richer evidence |
| Question abandonment | No concentrated exits at media loading or ranking |
| Rationale specificity | More references to concrete artistic or contextual details |
| Reviewer usefulness | Reviewers report greater confidence and less need to infer taste |
| Reviewer agreement | Different reviewers reach similar signal judgements from the rationale |
| Applicant experience | The flow feels engaging, relevant to COLORS and not like an exam |
| Accessibility success | Keyboard, captions, transcripts and mobile completion all work |

Do not use acceptance rate as the primary success metric. The experiment should
first demonstrate a better participant experience and more useful evidence,
without introducing taste conformity or familiarity bias.

## Implementation outcome

Production support now uses an explicit `mediaChoice` interaction contract
capable of carrying:

- media metadata and accessible fallbacks;
- selection mode (`select`, `remove` or `rank`);
- minimum and maximum selections;
- whether and how a rationale is required;
- a stable structured answer containing option IDs, order and rationale.

The interaction is reusable rather than hard-coded to COLORS. The server
validates answers against the active question, persists stable option IDs and
order as structured metadata, and includes the validated answers in completion
webhooks. The SDK and COLORS preview render poster-first YouTube cards with one
active player, accessible selection and ranking controls, explicit rationale
rules, captions/transcripts, responsive layouts, and reduced-motion handling.

The remaining pilot work is editorial: select the official performances,
provide accurate metadata and accessible fallbacks, calibrate the reviewer
rubric, and configure the curation-pilot project record.

## Pilot decision

Proceed with **Programme the room** as the primary prototype. Pair it with
**Build the conversation** or **Put us onto something** so the pilot measures
community contribution as well as taste. Use the two-project configuration for
a controlled comparison, while keeping both variants in the existing Groucho
repository and COLORS organisation.
