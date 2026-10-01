# COLORS semantic-routing live replay — 1 October 2026

## Decision

**Proceed to a controlled internal pilot; do not open the external reviewer pilot
yet.** The implementation slice removed the three P0 runtime failures found in
the baseline: contextual questions now retain authority over inferred UI,
remembered evidence is not re-attributed to the current answer, and a semantic
challenge cannot also close the application.

The post-change 72-call replay completed without infrastructure failures,
false-positive coverage, or premature closes. A final focused replay also showed
zero generic-selector replacements across all three prompt variants. The
remaining risks are conservative coverage under-counting, long-memory correction
loss, and the absence of complete browser-level application/report trajectories.

## Scope and method

The replay ran the real `postSessionMessage` controller with in-memory storage and
the fixed synthetic COLORS persona. Database, media, webhook, completion-job, and
automatic-decision side effects remained mocked. Claude received the production
tool schema and a 500-token output limit.

- Model: `claude-haiku-4-5-20251001`
- Frozen fixture digest: `5b9dc077402a9151f5b2b922a8173353aded0dbe3f7cb3ddf9b005a20f19b9e5`
- Diagnostic: two fixtures × three arms = six calls
- Full replay: twelve fixtures × two repetitions × three arms = 72 calls
- Arms: production control, short instructions, and short instructions with the
  two private reason strings removed from the tool contract
- Commands:

```sh
GROUCHO_LIVE_REPLAY=1 GROUCHO_REPLAY_DIAGNOSTIC=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run evals/conversation-replay.test.ts
GROUCHO_LIVE_REPLAY=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run evals/conversation-replay.test.ts
```

This is a fixed-turn replay, not a complete application or final-report test. It
does not exercise the new reviewer-report verifier.

## Baseline full replay results

| Metric | Control | Short instructions | Short contract |
|---|---:|---:|---:|
| Successful requests | 24/24 | 24/24 | 24/24 |
| Model latency p50 | 4,285 ms | 4,163 ms | 3,287 ms |
| Model latency p95 | 5,024 ms | 4,784 ms | 3,831 ms |
| Coverage true positives | 12 | 15 | 14 |
| Coverage false positives | 4 | 5 | 4 |
| Coverage false negatives | 6 | 3 | 4 |
| Relation agreement | 16/24 | 18/24 | 19/24 |
| Premature closes | 0 | 1 | 0 |
| Visible replies rewritten | 19/24 | 19/24 | 21/24 |
| Runtime repairs | 5 | 5 | 5 |
| Token truncations | 0 | 0 | 0 |
| Input tokens | 156,388 | 78,724 | 79,108 |
| Output tokens | 9,353 | 9,501 | 7,826 |

The short-contract arm reduced median model latency by about 23% and p95 by about
24% against control. It halved uncached input tokens, did not increase false
coverage or premature closes, reduced missed coverage, and improved relation
agreement. It therefore passes the experiment's frozen aggregate candidate gates.
Short instructions alone did not meet the 15% median-latency target and increased
false coverage by one.

Passing those aggregate gates is not the same as passing the pilot. The visible
conversation was still materially changed by deterministic controller behaviour.

## Implemented slice and post-change replay

The follow-up implementation made four changes:

1. Inferred structured inputs no longer overrule a valid contextual invitation.
   The runtime downgrades the interaction to text and preserves Claude's wording;
   it appends the configured selector only when Claude leaves no invitation.
2. Only configured, newly covered signals are persisted on the current applicant
   message. Coverage already supported by prior messages is filtered out.
3. `challenge` and a terminal decision are mutually exclusive. Inconsistent
   structured output is normalised to a concerning challenge and the application
   remains active for clarification.
4. Replay output now distinguishes generic-selector insertion from ordinary copy
   normalisation and records structured-input downgrades. A single fixture can be
   selected with `GROUCHO_REPLAY_CASE=<fixture-id>` for focused live diagnosis.

The final full replay used fixture digest
`a651794dd28c41420c1b924d2deae5cd4587c100b764e74fc7f981c7291ca46c`.

| Metric | Control | Short instructions | Short contract |
|---|---:|---:|---:|
| Successful requests | 24/24 | 24/24 | 24/24 |
| Model latency p50 | 4,306 ms | 4,278 ms | 3,149 ms |
| Model latency p95 | 5,115 ms | 4,865 ms | 3,643 ms |
| Coverage true positives | 10 | 9 | 11 |
| Coverage false positives | 0 | 0 | 0 |
| Coverage false negatives | 8 | 9 | 7 |
| Relation agreement | 14/24 | 19/24 | 18/24 |
| Premature closes | 0 | 0 | 0 |
| Generic selector insertions | 1 | 1 | 0 |
| Structured-input downgrades | 3 | 4 | 4 |
| Token truncations | 0 | 0 | 0 |
| Input tokens | 158,308 | 79,804 | 80,188 |
| Output tokens | 9,461 | 9,601 | 7,538 |

Both selector insertions came from a punctuation-free declarative invitation such
as “I'm curious what shifts…”. The invitation recogniser was extended for that
form after the matrix. A focused `long-current` replay then completed 3/3 calls
with zero generic-selector insertions, zero false coverage, and zero premature
closes. A focused `consent-boundary` replay likewise completed 3/3 calls with no
early close across the three arms.

The short-contract arm remains the strongest candidate: median latency was about
27% below control, p95 about 29% below control, and input tokens about 49% lower.
It also had the best coverage recall of the three post-change arms and no generic
selector insertion in the full matrix.

## Findings

### Resolved P0 — the UI contract overrode Claude's contextual question

In the baseline, the runtime rewrote 79% of control and short-instruction replies and 88% of
short-contract replies. Some rewrites only reduced stacked questions or normalised
punctuation, which is appropriate. At least ten observed turns, however, replaced
a coherent contextual follow-up with:

> Which of these sounds most like how you participate around music?

Examples included answers that had already described a monthly listening thread,
a second-listen group, patient listening, or a weekly digest. Claude had responded
to those details directly. The controller inferred a structured participation
interaction from `nextSignalKey` and required selection wording, so presentation
logic overruled the semantic reply.

This is the clearest confirmation of the original concern: even after removing
answer-keyword routing, a deterministic downstream rule can still turn a
context-sensitive conversation back into a checklist. The implemented authority
rule now preserves the contextual invitation and converts inferred options to a
text interaction. The final focused replay recorded no generic selector
insertions.

### Resolved P0 — remembered evidence leaked into current-turn coverage

In the baseline memory fixtures, Claude correctly recalled the Sunday digest when the
marker survived compaction. It also repeatedly returned the contribution key as
covered even though the current applicant message only asked Groucho to recall the
earlier plan. The live contract says `coveredSignalKeys` must describe the current
answer, but the model sometimes treated remembered transcript evidence as current
evidence.

That behaviour accounts for recurring false-positive coverage in the memory
cases. It would make source attribution and “what changed on this turn?” auditing
less reliable even when the remembered fact itself is true. The current-turn
filter removed this leakage: all three arms recorded zero false-positive coverage
in the final full replay.

### Resolved P0 — one concern turn closed prematurely

The baseline short-instruction arm closed one consent-boundary exchange immediately after
the applicant described posting private unfinished work without permission. The
other five consent-boundary runs challenged the behaviour and continued. A single
occurrence is enough to fail the frozen no-premature-close gate for that arm and
showed that terminal policy needed a stronger server boundary around first concern
turns. The controller now treats challenge and decision as mutually exclusive;
the final full replay and the focused three-arm consent replay recorded no early
closes.

### P1 — subject-shift evidence remains unstable

Subject-shift relation handling is usually correct, but the final replay still
missed expected cultural/artist evidence on these turns. The current-turn filter
removed the earlier unrelated-signal false positives, so this is now a recall
problem rather than an attribution problem. The repair conversation was often
natural, but evidence accounting remains conservative.

### P1 — long-memory corrections are still lost

The short correction and separate follow-up correction reached Claude; the same
correction embedded beyond the compact-history limit did not. All arms then
repeated or revived the superseded listening-night plan. This was known in the
September experiment and remains unresolved.

## What worked

- All live calls returned valid tool responses; there were no network, schema,
  handler, or token-limit failures.
- Direct COLORS relevance, artist-context, contribution, and consent-boundary
  cases were generally understood semantically without applicant keyword gates.
- The short contract materially improved latency and token use without degrading
  the aggregate frozen quality measures.
- Claude often produced stronger, more grounded raw follow-ups than the visible
  reply ultimately shown by the controller.

## Next implementation slice

1. **Preserve corrections in memory compaction.** Prefer the latest correction or
   contradiction over a fixed leading substring of a long earlier answer.
2. **Improve conservative coverage recall without adding applicant-word gates.**
   The current filter has removed false positives, but direct brief answers and
   subject shifts are still under-counted. Keep Claude as the semantic authority
   and evaluate prompt/schema clarification or evidence spans rather than lexical
   fallbacks.
3. **Trial the short contract behind an internal flag.** Its performance and
   safety results justify an internal comparison, but not an unconditional
   rollout before end-to-end report testing.
4. Complete three browser applications—maker,
   listener, and curator—and explicitly exercise final report generation and its
   semantic verifier.

## Pilot gate

The implementation is **go for a controlled internal pilot** and **not yet go for
an external reviewer pilot**. The semantic-authority regressions that motivated
this slice are resolved in the live replay. External readiness now depends on
end-to-end browser/report trajectories and the long-memory correction fix, not on
adding more applicant-word checks.
