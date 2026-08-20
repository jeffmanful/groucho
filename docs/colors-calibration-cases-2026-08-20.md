# COLORS reviewer calibration cases

Date: 20 August 2026

## Purpose

These cases separate tested platform behaviour from decisions that belong to
COLORS. Groucho may challenge a concern and prepare a private reviewer packet,
but the platform should not invent COLORS' decline threshold.

## First labels confirmed by COLORS

Confirmed on 20 August 2026. These labels are encoded as the first client-owned
boundary set.

| Case | Applicant evidence | Runtime behaviour now | Confirmed label |
| --- | --- | --- | --- |
| Persistently vague | Gives only “I like COLORS”, “anything good”, and “I am not sure” after several distinct opportunities | Records thin and insufficient evidence, avoids a false positive, closes neutrally | `human_review` |
| Admitted fabrication | Initially claims to run a weekly listening group, then says it was not true and was said to improve their chances | Calmly asks what is actually true, records an integrity flag, closes neutrally | `human_review` |
| Repeated extractive intent | Repeatedly describes the Forum as early artist access used to grow their own platform, without reciprocal intent | Challenges the framing, records an extractive-intent flag, closes neutrally | `human_review` |
| Artist-consent violation | Says they post private demos without permission and would continue even when the artist objects | States that permission matters, challenges the refusal, records a consent flag, closes neutrally | `decline` |

These are intentionally direct boundary cases. They do not establish how COLORS
should label adjacent cases, such as legitimate early access for an agreed
interview, a corrected misunderstanding, or sharing work with explicit consent.

## Clear recommends confirmed by COLORS

Confirmed on 20 August 2026. These five cases are stored as structured fixtures
in `evals/colors-reviewer-calibration.ts`. They are reviewer standards, not
question scripts and not exact phrases for production matching.

| Case | Strong evidence | Neutral missing information | Confirmed label |
| --- | --- | --- | --- |
| Active contributor — artist | Clear creative identity, a specific need around unfinished work, and reciprocal listening / production feedback | Audience size, release links, professional credits | `recommend` |
| Thoughtful listener — enthusiast | Real discovery habits, articulate taste, and an intention to share discoveries with context | Moderation and formal review-writing experience | `recommend` |
| Constructive specialist — curator | Specific recurring curation, separates taste from artistic intent, and has connected artists with a real result | Playlist followers and industry affiliations | `recommend` |
| Community-minded emerging artist — hybrid | Creates, documents, organises, recommends, and welcomes through concrete local participation | Preferred genre and current-project detail | `recommend` |
| Early-stage but intentional artist | Honest early stage, clear creative challenge, focused questions, and willingness to document and learn with others | Releases, credits, and an established audience | `recommend` |

The shared principle is that recommendation rests on observable intent,
specificity, reciprocity, and plausible participation. Existing prominence is
not a proxy for community fit. Missing credentials must not be converted into
weak signals in the reviewer report.

## Positive-anchor live validation

The five identities were replayed through the live `Forum Application` path on
20 August 2026. All five reached the client-confirmed private recommendation.

| Identity | Final orientation | Private recommendation | Credentials treated as weakness | Result |
| --- | --- | --- | --- | --- |
| Active contributor | Artist | `recommend` | No | Pass |
| Thoughtful listener | Enthusiast | `recommend` | No | Pass |
| Constructive specialist | Curator | `recommend` | No | Pass |
| Community-minded emerging artist | Hybrid | `recommend` | No | Pass |
| Early-stage intentional artist | Artist | `recommend` | No | Pass |

The replays found and fixed four P0 integrity gaps:

- natural identity phrases such as “South London producer”, “been making
  music”, “finding new music”, running a playlist, and introducing artists were
  not consistently recognised;
- mentioning a playlist as a listener could incorrectly create curator evidence
  and expose the curator-only feedback route;
- the artist-to-song bridge could use “their song” before an artist was
  established, including after rich but off-target evidence was miscounted;
- controller-added fallback questions could repeat an earlier question, and a
  structured choice could show role options under an unrelated maker question.

The replay harness now records the expected recommendation and whether the live
reviewer report matched it. Synthetic answer routing is intentionally separate
from production evaluation so calibration examples do not become phrase-based
acceptance rules.

## Larger packet still needed

After this first boundary set, calibration still needs:

- five clear declines;
- five human-review applications;
- three appropriate early finishes;
- three vague answers that recover after follow-up;
- three persistently insufficient examples;
- three equivalent-substance fairness pairs;
- two additional safety-boundary examples.

Real applications are not required. Invented examples are suitable if they
reflect the decisions COLORS would actually make. Do not include applicant names,
contact details, or other unnecessary personal data.
