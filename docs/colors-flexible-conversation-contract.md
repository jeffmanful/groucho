# COLORS flexible conversation contract

## Purpose

Groucho should understand enough about an applicant to prepare a useful human
review without making the interaction feel like a disguised form. The system
therefore uses **firm evidence intents and flexible conversation**.

The application owns state, provenance, safety, human review, and access. Groucho
has freedom over wording, order, continuity, and which relevant thread to deepen.

## Fixed opening

Every COLORS Forum application starts with one open-text question and no
introductory copy:

> Why do you want to be an early applicant for the Forum?

The answer is the first conversational inflection point. It creates a revisable
orientation description rather than assigning a permanent applicant type or selecting a route:

- community motivation leads first into what community means to the applicant;
- making or sharing work leads into creative practice or desired exchange;
- curating, organising, hosting, documenting, or connecting leads into their real
  role and actions;
- discovery or listening leads into what they hope to find, how music becomes
  social, or what might help them participate;
- a genuinely ambiguous answer can receive one natural clarification.

Groucho must not automatically follow the opening with an artist question.
Orientation supports tone and reviewer context only. The applicant's explicit words
and the live thread determine which evidence intent is relevant next.

Orientations may overlap and change during the exchange. A collaboration disclosure
can take an artist towards feedback; an enthusiast's desire to organise can open a
curation thread; a curator's own music can open a maker thread. Groucho follows the
new practice or intention without announcing a change of category. Future intent
may earn a grounded follow-up, but it must not be represented later as existing
experience.

## Shared early intent: relationship to COLORS

The opening motivation and the applicant's relationship to COLORS are related but
not identical. An applicant may want “community” without yet explaining why this
particular cultural space feels meaningful to them. Groucho should establish that
relationship early enough to shape the rest of the exchange.

This is a high-priority evidence intent, not a mandatory second question. The
opening answer may cover it already. Otherwise Groucho should find a route that
fits the applicant and the live thread:

- an artist may reflect on how COLORS presents work or what the Forum could add to
  their practice;
- a curator may notice how COLORS creates context or directs attention;
- an enthusiast may describe a performance that changed how they heard someone,
  or what they hope the Forum carries forward;
- any applicant may distinguish what the Forum could make possible beyond the
  performances themselves.

The intent is to understand a lived relationship, perception, or expectation. It
must not become a request for brand praise, a COLORS knowledge quiz, a fandom
threshold, or a test of cultural status. If the applicant opens with community,
Groucho should first honour that thread by asking what community means to them,
then connect it to COLORS when the relationship is natural.

## Evidence intents, not required questions

Configured signals describe what the reviewer may need to understand. Existing
question-shaped configuration remains supported, but its wording is illustrative.

Each signal should provide:

- a private evidence intent;
- why it matters;
- relevant applicant orientations;
- examples of useful evidence;
- a small number of example question routes;
- conditions that make the signal irrelevant.

A large sample-question library is not required for V1. It would encourage
template selection and make conversations converge on the same phrasing. Groucho
should normally infer its next question from:

1. the applicant's current answer;
2. the live conversation thread;
3. the most relevant unresolved evidence intent;
4. the COLORS persona.

Example questions remain useful for configuration previews, recovery when a model
reply is malformed, and evaluation. They are not a script.

## Sustained reciprocity enhancement

Sustained reciprocity is part of the existing participation-and-contribution
intent. It does not add another signal or another expected question.

Groucho should prefer concrete evidence of what an applicant already returns to,
shares, notices, supports, hosts, connects, or keeps doing. A repeatable existing
habit is generally stronger than a polished promise about their first month. When
one answer shows both how they participate and what they could realistically keep
giving in the Forum, it can cover both existing goals.

Reciprocity is not measured by volume or professional visibility. It does not
require constant posting, unpaid labour, networking, leadership, or making work.
Quiet but consistent listening, thoughtful replies, contextual sharing, welcoming,
connecting people, and creative exchange can all count when they are concrete.

## Situated cultural perspective enhancement

Situated cultural perspective strengthens the existing cultural-point-of-view and
participation intents. It does not add another signal or a question that every
applicant must answer.

When the thread supports it, Groucho can explore:

- what is happening around music where the applicant lives or participates;
- what they notice that someone outside that context might miss;
- whether they feel inside the scene, adjacent to it, or outside it;
- how that position shapes their taste, practice, or participation;
- one concrete role, action, relationship, or observation behind a claim of being
  connected.

“Scene” is deliberately broad. It may be local to a city, but it can also be a
venue, collective, genre, online network, diasporic space, or informal group.
Groucho should use a city or place name when the applicant offers it, without
requiring an exact location.

Insider access is not the desired answer. Groucho must not reward prestigious
cities, professional proximity, famous contacts, or scene status. Being adjacent,
isolated, online-only, or outside a scene is neutral and can still produce a
valuable perspective. Ask for what they observe rather than asking them to claim
that their insight is unique.

## Candidate intents after V1

Do not add all of these to the live flow by default. They are candidates to promote
only when transcript review shows that the reviewer repeatedly lacks the relevant
evidence:

| Candidate intent | What it could reveal | Main route | Caution |
| --- | --- | --- | --- |
| Sustained participation | A realistic rhythm beyond a polished first-month promise | Shared, especially enthusiasts | Ask through existing habits before hypothetical commitment |
| Creative trajectory | What an artist is exploring, changing, or protecting in their work now | Artist | Keep it about practice, not career status or promotion |
| Curiosity across difference | How they engage when taste, context, or perspective differs from their own | Curator and socially active enthusiast | Do not revive a universal feedback test for artists and quiet listeners |
| Community care and repair | How they respond when a shared space becomes uncomfortable or trust is strained | Curator, host, or moderator | Add only if COLORS needs explicit moderation evidence; avoid speculative moral tests |
| Why now | What makes this the right moment to join or participate | Shared | Often already covered by the opening and should usually remain incidental |

Sustained participation now partly overlaps the implemented reciprocity
enhancement. Keep it as a separate future intent only if transcript review shows
that repeatability remains materially unclear after the enhanced participation
and contribution routes.

## Runtime contract

On each active turn Groucho may continue, deepen, connect, clarify, challenge, or
pivot. The chosen question may cover several evidence intents at once.

The controller should enforce only durable boundaries:

- at most one clear question or invitation per turn;
- no invented applicant details or false connections;
- no disclosed scores, evidence gaps, application phases, or recommendations;
- no repeated questioning of already-supported evidence without a genuine live
  thread;
- bounded repetition on one signal;
- safety and dignity boundaries;
- an emergency loop stop;
- no model-controlled admission or rejection.

Question wording is not validated against a template regex. When a valid question
clearly expresses a configured evidence intent, `nextSignalKey` records that private
link. When a useful live-thread question does not map cleanly, the runtime records a
conversational thread turn instead of rewriting the question or falsely assigning
the applicant's next answer to another goal. That answer remains available to the
final reviewer report and may still cover several goals later.

## Flexible pacing

There is no required conversation length.

- Most useful conversations will probably take five to nine applicant answers.
- The configured `max_turns` value is treated as a soft pacing target.
- Reaching that target asks Groucho to consider whether another question would
  materially improve understanding; it does not force a close or restrict the
  conversation to core gaps.
- There are no special closing or final-probe rules after answers seven or eight.
- The emergency limit is three answers above the soft target, capped at fourteen.
- At the emergency limit, the conversation closes neutrally to prevent loops.
- Missing evidence remains uncertainty for the human reviewer rather than a reason
  to interrogate the applicant until every intent is filled.

The first non-concerning answer cannot end the application. It must be used as the
initial routing point. After that, Groucho may close whenever the available
evidence and conversational momentum make another question low-value.

## Evaluation

Transcript review should ask:

- Did the second question clearly grow from the opening answer?
- Did Groucho follow meaningful disclosures before filling unrelated gaps?
- Did different identities receive materially different but fair routes?
- Were example questions adapted rather than copied mechanically?
- Did the conversation stop because understanding was sufficient, rather than
  because a turn number was reached?
- Could every reviewer claim still be traced to an applicant turn?
