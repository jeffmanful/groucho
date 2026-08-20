# COLORS adaptive applicant branches

Status: implemented
Updated: 2026-08-20

## Why this exists

The COLORS Forum is intended for artists, curators and people active in music scenes, and music or COLORS enthusiasts. These applicants share values, but they should not have to prove those values through the same questions.

The previous runtime could choose flexibly among a common set of evidence goals, but it still treated those goals as broadly applicable to everyone. This created a fairness failure: a listener could spend turns on artist taste and hypothetical feedback, never receive a meaningful question about community or goals, and then be marked weak for missing participation, curation, and contribution evidence.

Adaptive branches separate conversational continuity from evidence relevance. A strong bridge is only useful when its destination is appropriate for the applicant.

## Shared trunk and branches

Every route may explore a small shared foundation:

- motivation and relationship to the Forum;
- cultural attention and a personal point of view;
- what community or exchange they are seeking;
- a realistic form of participation;
- dignity, care, and safety when those concerns genuinely arise.

The branch changes how those themes are investigated:

| Orientation | Evidence Groucho should seek | Evidence that is not automatically required |
| --- | --- | --- |
| Artist | Creative practice, what they are trying to make or express, the exchange they seek, and the maker perspective they could share | The generic unfinished-work feedback scenario; formal curation or organising |
| Curator / scene participant | What they select, organise, introduce, document, host, or connect; their actual role, judgment, consequence, and responsibility | Making their own work |
| Music / COLORS enthusiast | What music community means to them, what they hope to discover or understand, where music becomes social, and what would help them participate | Formal curation, multiplier activity, scene status, or maker evidence |
| Hybrid | Only the relevant goals from the roles they actually evidence | Proving every possible branch |

Listening is a valid relationship to the Forum. The evaluation should test whether an enthusiast has meaningful goals and a plausible way of taking part, not whether they already operate like a curator.

## Private orientation state

Each structured turn returns a private, revisable orientation hypothesis with scores for `artist`, `curator`, and `enthusiast`, plus short paraphrases of explicit supporting evidence. `hybrid` is derived when at least two orientations are meaningfully supported.

The state is persisted in existing assistant-message metadata as `participant_orientation`; no database migration is required. It must never be shown as an identity label, inferred from protected traits, or treated as a measure of cultural worth or professional status.

Deterministic recognition supports clear disclosures such as making music, curating or organising, selecting “Discover”, or saying “I mostly listen”. The conversational model can add nuance, and later explicit evidence can broaden the route into a hybrid.

## Routing rules

1. Update the orientation hypothesis from the current answer before selecting the next goal.
2. Remove branch-inapplicable goals from routing. The unfinished-work feedback goal is available only when curator, scene, organising, or feedback evidence supports that route.
3. Rewrite participation and contribution prompts for the active branch.
4. If the opening remains ambiguous, move the participation-orientation question earlier instead of spending the budget on an assumed route.
5. Continue to use bridge continuity, live thread state, response modes, multi-goal coverage, and normal question budgets inside the relevant branch.
6. Keep the route revisable. A listener who later reveals that they produce music becomes a hybrid rather than being trapped in the first classification.

## Fair-opportunity guard

The first non-concerning answer is always used as a routing inflection rather than a terminal decision. After that, an unattempted intent is not automatically a reason to keep questioning: Groucho may close when another question is unlikely to improve the reviewer brief. The higher emergency stop and safety boundaries remain valid forced-close conditions.

This prevents the reviewer report from treating system-created missingness as applicant weakness. The guard does not require every goal to become strong; it requires that the applicant receive a relevant opportunity before the absence is evaluated.

## Branch-aware evaluation

Reviewer reports use shared evidence plus the applicant's evidenced branch. Missing branch-inapplicable evidence is neutral:

- do not list absent curation, multiplier, organising, or feedback evidence as a weakness for an enthusiast;
- do not require an artist to answer the hypothetical feedback route;
- do not require a curator to make their own work;
- do evaluate whether the relevant goals, actions, or likely participation are concrete enough for a useful human review.

The final decision remains advisory and human-owned by COLORS.

## Verification scenarios

The runtime and prompt contracts cover:

- explicit artist, curator, enthusiast, and hybrid hypotheses;
- listener routes that exclude the feedback goal;
- curator routes that retain it;
- branch-specific participation and contribution wording;
- a listener moving from participation to a contribution/community question;
- deferring a terminal decision when a relevant core goal was never asked;
- persistence and recovery of orientation state from message metadata.
