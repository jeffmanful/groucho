# COLORS flow stabilization replay — 7 October 2026

## Scope

No new journey rules or persona prompts were added. This pass removes the per-turn
source-linked evidence audit and quote check from the applicant-visible request;
the completed-session detailed report still reconciles claims against the full
transcript and source message IDs in its background completion job. Optional
media planning now runs only when the main conversation model proposes a media
interaction. A separate media-request classifier remains a fallback for ambiguous
or subject-shift answers, rather than running on every ordinary text answer.

## Method and latency

The same four scripted identities (`artist`, `curator`, `enthusiast`, `hybrid`)
were replayed before and after the change against the V1 API and the authenticated
COLORS demo route. Times are observed HTTP message-round-trip durations, not
start requests. Each cell is one stochastic model run, not a confidence interval.

| Route | Version | Message turns | Mean | p50 | p95 | Main model mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| V1 API | Before | 23 | 10.75s | 11.00s | 12.51s | 6.12s |
| V1 API | After | 33 | 7.79s | 6.96s | 11.20s | 6.04s |
| COLORS demo | Before | 19 | 13.55s | 13.21s | 16.73s | 6.23s |
| COLORS demo | After | 20 | 7.88s | 7.06s | 9.97s | 6.16s |

The demo route improved 42% in mean and 40% in p95 turn latency. The main model
time barely moved; the saving is from secondary live calls. The after demo run
had zero `v1_evidence_audit` and `rich_interaction_planner` calls across its 20
message turns, and one `v1_media_request` call. The media catalog lookup itself
averaged 1.8ms. Later-turn sufficiency and invitation repair remain material
latency sources (four calls each in that run).

## Conversation quality

| Persona | Demo before | Demo after | Observation |
| --- | --- | --- | --- |
| Artist | Passed, 6 answers | Passed, 5 answers | Still repeated a version of the same contribution probe. |
| Curator | Passed, 4 answers | Redirected, 4 answers | Redirect followed a repeated scripted answer; not a reliable improvement. |
| Enthusiast | Redirected, 5 answers | Redirected, 7 answers | Assistant kept rephrasing its participation question after the same answer. |
| Hybrid | Passed, 4 answers | Passed, 4 answers | Specific examples elicited; no media interaction. |

The API replay moved from 23 to 33 total answers: artist 4→6, curator 4→5,
enthusiast 11→12, hybrid 4→10. All four API sessions passed in both runs, but
the after hybrid and enthusiast transcripts contained repeated probes. Thus
lower per-turn latency does **not** establish better conversation quality or a
shorter end-to-end application. On the API route, the extra turns roughly erased
the per-turn speed gain for total applicant waiting time.

The harness chooses responses by matching question wording to a fixed answer
bank. It sometimes repeats the same answer when a human would clarify or give a
new example. That exposes Groucho's tendency to get stuck, but it can also cause
a redirect that a real applicant would avoid. Exact-question duplicate counts
miss semantic repetition; manual transcript review is necessary. These four
personas also did not trigger optional media, so media quality was checked by
contract tests, not by this live sample.

## Release interpretation

The latency stabilization is successful. The quality comparison is mixed, not
a pilot-confidence pass. Before Philipp tests, the next slice should target
conversation momentum and terminal calibration using these same replays plus
human-written answers. It should not put a detailed evidence audit back in the
live turn or add another mandatory media stage. Track both per-turn latency and
end-to-end completion, and fail a quality gate on repeated semantic probes or
unsupported redirects rather than on exact question-string duplication alone.
