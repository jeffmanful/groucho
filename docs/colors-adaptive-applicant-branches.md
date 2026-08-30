# COLORS adaptive applicant branches

Status: implemented
Updated: 2026-08-20

## Why this exists

The COLORS Forum is intended for artists, curators and people active in music scenes, and music or COLORS enthusiasts. These applicants share values, but they should not have to prove those values through the same questions.

The previous runtime could choose flexibly among a common set of evidence goals, but it still treated those goals as broadly applicable to everyone. This created a fairness failure: a listener could spend turns on artist taste and hypothetical feedback, never receive a meaningful question about community or goals, and then be marked weak for missing participation, curation, and contribution evidence.

Adaptive lenses separate conversational continuity from evidence relevance. Orientation describes the relationship to music emerging in the exchange; it does not select a fixed route. A strong bridge is only useful when its destination is supported by the applicant's actual words.

## Shared foundation and descriptive lenses

Every route may explore a small shared foundation:

- motivation and relationship to the Forum;
- cultural attention and a personal point of view;
- what community or exchange they are seeking;
- a realistic form of participation;
- dignity, care, and safety when those concerns genuinely arise.

The orientation lens helps Groucho understand the language and context of those themes, without opening or closing evidence goals:

| Orientation | Evidence Groucho should seek | Evidence that is not automatically required |
| --- | --- | --- |
| Artist | Creative practice, what they are trying to make or express, the exchange they seek, and the maker perspective they could share | The generic unfinished-work feedback scenario; formal curation or organising |
| Curator / scene participant | What they select, organise, introduce, document, host, or connect; their actual role, judgment, consequence, and responsibility | Making their own work |
| Music / COLORS enthusiast | What music community means to them, what they hope to discover or understand, where music becomes social, and what would help them participate | Formal curation, multiplier activity, scene status, or maker evidence |
| Hybrid | Only the relevant goals from the roles they actually evidence | Proving every possible branch |

Listening is a valid relationship to the Forum. The evaluation should test whether an enthusiast has meaningful goals and a plausible way of taking part, not whether they already operate like a curator.

## Fluid roles and crossover threads

Artist, curator, and enthusiast are overlapping facets, not fixed positions. Groucho
should follow a newly revealed practice or intention even when it crosses the
applicant's current primary description:

- an artist who collaborates, trades unfinished work, or wants to curate may enter
  a feedback or selection thread;
- an enthusiast who wants to start a listening night, playlist, or other gathering
  may explore an emerging curatorial role;
- a curator who makes or wants to upload their own music may enter a maker-practice
  thread;
- a hybrid should not have to demonstrate every facet once the relevant exchange is
  already clear.

These are not exceptions and Groucho should not announce a relabelling. The current
answer opens the conversational possibility. Existing practice and future intent
are both meaningful, but the reviewer record must preserve the difference between
“does this now” and “wants to begin.”

## Private orientation state

Each structured turn returns a private, revisable orientation hypothesis with scores for `artist`, `curator`, and `enthusiast`, plus short paraphrases of explicit supporting evidence. `hybrid` is derived when at least two orientations are meaningfully supported.

The state is persisted in existing assistant-message metadata as `participant_orientation`; no database migration is required. It must never be shown as an identity label, inferred from protected traits, or treated as a measure of cultural worth or professional status.

Deterministic recognition supports clear disclosures such as making music, curating or organising, selecting “Discover”, or saying “I mostly listen”. The conversational model can add nuance, and later explicit evidence can broaden the description into a hybrid. A mistaken or drifting description cannot remove an applicant's opportunities because it does not control routing.

## Relevance and conversation rules

1. Update orientation only from explicit evidence of what the applicant currently does, as descriptive context for tone. Future intent may open a thread but does not change orientation scores.
2. Never add, remove, force, rewrite, or prioritise an evidence goal from the orientation label or scores.
3. Make conditional goals relevant from explicit conversational evidence. The unfinished-work feedback goal becomes available after the applicant discusses feedback, collaboration, creative exchange, curation, hosting, organising, unfinished work, or a comparable present or intended practice.
4. Infer each visible question from the live thread; examples remain inspiration rather than branch scripts.
5. If the opening remains ambiguous, continue from its actual motivation rather than spending the budget on classification.
6. Continue to use bridge continuity, live thread state, response modes, multi-goal coverage, and normal question budgets across all relevant goals.

## Fair-opportunity guard

The first non-concerning answer is always used as a conversational inflection rather than a terminal decision. After that, an unattempted intent is not automatically a reason to keep questioning: Groucho may close when another question is unlikely to improve the reviewer brief. The higher emergency stop and safety boundaries remain valid forced-close conditions.

This prevents the reviewer report from treating system-created missingness as applicant weakness. The guard does not require every goal to become strong; it requires that the applicant receive a relevant opportunity before the absence is evaluated.

## Branch-aware evaluation

Reviewer reports use the evidence actually gathered and the descriptive orientation as context. Missing conditional evidence is neutral when the applicant never made that area relevant:

- do not list absent curation, multiplier, organising, or feedback evidence as a weakness for an enthusiast;
- do not require an artist to answer the hypothetical feedback route;
- do not require a curator to make their own work;
- do evaluate whether the relevant goals, actions, or likely participation are concrete enough for a useful human review.

The final decision remains advisory and human-owned by COLORS.

## Verification scenarios

The runtime and prompt contracts cover:

- explicit artist, curator, enthusiast, and hybrid descriptions;
- identical goal availability across orientation labels;
- listener evidence that leaves feedback conditional;
- direct hosting, curation, organising, or feedback evidence that makes it relevant;
- artist-to-collaborator, listener-to-curator, and curator-to-maker crossovers;
- future intentions that open a thread without being reported as established practice;
- a listener moving from participation to a contribution/community question;
- deferring a terminal decision when a relevant core goal was never asked;
- persistence and recovery of orientation state from message metadata.
