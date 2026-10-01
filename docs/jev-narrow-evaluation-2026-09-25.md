# Jev accuracy and speed: critical review and paired evaluation

## Review of the previous evidence

The 13-turn experiment was a useful feasibility probe, but several conclusions were too strong:

- No current Claude control was tested. Classifier latency does not establish application speed or accuracy improvement.
- Some labels were debatable. The extractive answer was marked as covering a compound COLORS-specific goal even though it did not explain COLORS or the Forum. Quality and next-goal choices admit multiple reasonable answers.
- The four synthetic goals do not reproduce all runtime goals, audience branches, integrity history, budget constraints, or terminal policy.
- The `fastClose` helper was an experimental conjunction, not Groucho's real terminal controller. One positive and two blocking examples do not validate skipping a Claude call. Removing quality from the proposed contract also removes a condition that this helper relied on.
- Multi-goal coverage already exists in `lib/post-session-message.ts` and the structured Claude contract. Any Jev benefit must be incremental to that implementation.
- The first slow request was not proven to be a cold start. Report all requests; an excluded-first-request statistic cannot establish steady-state performance.
- The old `risk` metric collapsed multiple predicates into a priority label. Its 9-case version included insufficient evidence, so combining the runs into “22/22 narrow-risk cases” was not a valid common metric.
- Synthetic cases are author-labelled, with few boundary examples. Confidence intervals assuming independent sampling do not make them representative.
- The 4.67-second browser baseline is an August integration measurement, not a current production measurement. Adding medians from different runs is not a latency forecast.

Runtime inspection shows existing protections for unsupported contribution claims, conversational repairs, integrity history, question budgets, and terminal deferral. The existing 34-reply integration baseline attributed approximately 90% of server time to the conversation model. That suggests prompt/output reduction and safe streaming deserve comparison alongside Jev.

## Frozen experiment design

Fifty fresh synthetic turns: twenty contrast pairs and ten additional multi-goal, boundary, attribution, and injection cases. Labels were written before execution. They represent coverage of the four supplied evidence goals, not applicant suitability. Harmful feedback behavior can still be evidence for the care goal; a risk predicate records the harm separately.

Two requests per case, sequential, alternating which arm runs first:

1. Existing 11-question Jev contract with coverage threshold 0.5.
2. Narrow 8-question contract: four coverage predicates, three explicit-risk predicates, one conversational-repair predicate. Coverage threshold 0.75; risk threshold 0.75; repair threshold 0.5.

Both receive identical question, answer, and goal state. No goals are previously covered and closing is disabled. The narrower contract adds explicit criteria for negation, attribution, thematic near-misses, and the distinction between feedback behavior and a sustainable contribution. It drops quality, action, and next-goal choices. A third, offline readout applies threshold 0.75 to the baseline responses to distinguish threshold gains from contract gains.

All 100 requests use synthetic text through the already-tested OpenRouter endpoint. No applicant data or runtime mutation. No retries hide failures. The report includes errors, every predicate's probability, model identity, latency, usage, and cost; case text stays in the fixture. A SHA-256 digest records the corpus and both question contracts.

Frozen gates: coverage precision >=95%, recall >=90%, all four multi-goal cases exact, risk sets exact on all 50 cases, repair agreement >=90%, zero malformed/errors. A speed signal requires >=10% lower median classifier latency with no worse all-request p95. No claim about Groucho completion time or skipped questions follows from these gates alone.

This is a paired development challenge set, not an independently annotated benchmark. The prompt refinements and new labels share an author; matched pairs are correlated. There are only three positive risk cases and three subject-shift cases. Production-grade safety generalization and repair recall need substantially more varied positives. There is no current Claude comparison and one observation per case/arm cannot characterize run-to-run variability.

## Reproduce

```sh
node --env-file=.env.local --import tsx scripts/run-jev-narrow-experiment.ts --dry-run
node --env-file=.env.local --import tsx scripts/run-jev-narrow-experiment.ts
```

## Results and decision

All 100 live requests completed without errors. A preceding sandbox attempt was blocked by network restrictions and returned zero model responses; the live run used the approved network path. No labels, contracts, or thresholds were changed after seeing results.

Contract/corpus SHA-256: `c6b5f6479bcb41fd32dd6a23a88b61df241fc16c5d47f29becb1eae90dcb97bd`.

The [saved aggregate report](./jev-narrow-evaluation-2026-09-25.summary.json) includes mismatch case IDs. Terminal output truncated part of the detailed per-request list, so that list is not archived as a complete raw artifact. Aggregate output was intact. The script can reproduce a new run, not the exact stochastic responses from this one.

| Metric | Old contract, 0.5 | Old contract, 0.75 (same responses) | Narrow contract, 0.75 |
|---|---:|---:|---:|
| Coverage precision | 76.2% | 100% | 100% |
| Coverage recall | 100% | 100% | 96.9% |
| True / false / missed coverage | 32 / 10 / 0 | 32 / 0 / 0 | 31 / 0 / 1 |
| Exact coverage sets | 40/50 | 50/50 | 49/50 |
| Multi-goal exact | 3/4 | 4/4 | 4/4 |
| Exact risk sets | 50/50 | 50/50 | 50/50 |
| Repair agreement | 50/50 | 50/50 | 48/50 |
| All-request p50 | 386 ms | 386 ms | 385 ms |
| All-request p95 | 518.1 ms | 518.1 ms | 518.7 ms |
| Reported cost, 50 calls | $0.003887058 | no extra calls | $0.003080658 |
| Input tokens | 92,549 | no extra calls | 73,349 |
| Output tokens | 18,216 | no extra calls | 8,600 |

Combined cost: $0.006967716. The narrower contract reduced reported cost about 20.7% and output tokens about 52.8%. Its median latency improved by only 1 ms (0.26%), while the median paired difference was **4.4 ms slower**. Its p95 was 0.6 ms slower. These differences provide no useful evidence of a speed improvement. The pre-registered >=10% speed gate failed.

The narrower contract met this set's aggregate accuracy gates, but the old contract at 0.75 did better. Specifically, the narrower prompt missed `negative-view-positive`: a critical view of COLORS can still establish why COLORS matters and what the Forum could add. It also flagged `discovery-contrast` and `injected-instructions` for repair unnecessarily. Both contracts recognized all three positive risk cases and all 47 negative risk cases, including the attribution and negation examples. That remains a small boundary sample.

The ten old-contract coverage errors at 0.5 were additional coverage claims, often conflating an approach to feedback with a sustainable contribution. Raising the threshold removed these errors here. **This is evidence for threshold calibration, not proof that rewriting the contract improved the model.** The stricter threshold was chosen before this run, but it was informed by the earlier development set. In that earlier set it would have lost the fabrication case's 0.70 coverage signal, so the perfect score here must not be generalized.

## Best opportunities, ranked

### 1. Improve the existing contribution filter: accuracy and potentially fewer questions

`applicationAnswerSupportsSignal` uses a bounded list of action words when the goal describes a concrete contribution. A read-only replay of this existing function with a representative concrete-contribution definition rejected **4 of 9** valid contribution answers in the new set:

- `unpolished-contrast`: catalogue the discussion threads every Friday;
- `weekly-positive`: maintain a weekly list of recommendations;
- `low-status-positive`: welcome one new member each week;
- `sustainable-positive`: summarise one useful discussion on Sundays.

This function is a guard after model classification, not a complete classifier. Its 4/9 rejection rate applies only to these labelled positives and this applicable goal definition; it is not a production accuracy rate. Still, it exposes a concrete integration problem: even a correct Jev coverage signal can be discarded downstream.

The best immediate candidate is to improve this guard and its regression cases while retaining its protection against vague conditional participation. That requires no new API call and could avoid unnecessary follow-ups. Measure actual questions avoided in replay before claiming a flow improvement. Do not merely remove the guard: it protects against real unsupported coverage.

### 2. Calibrate evidence coverage before adding routing complexity

For a Jev shadow integration, retain bounded coverage questions and use a conservative, pre-tested threshold. This run favors the existing questions at 0.75 over the narrowed rewrite. Preserve confidence and an uncertain state; do not force borderline probabilities into automatic question-skipping. Jev probabilities have not been calibrated against real-world frequencies.

Potential accuracy benefit: fewer unsupported coverage claims. Potential speed benefit: fewer redundant questions when one answer supplies several goals. Neither is yet measured against current Claude behavior, which already supports multi-goal coverage. Repair and explicit-risk handling currently gain no measured advantage from the narrower contract on this corpus.

### 3. Reduce the actual conversation-model delay

The documented August integration baseline measured a conversation-model mean of 4.16 seconds against a server mean of 4.61 seconds. Profile a current replay, then compare a smaller structured Claude response and safe streaming against the current implementation. Streaming can improve time to first visible text without improving completion time; report both.

This is the largest documented latency concentration. The Jev experiment removed half its output tokens without reducing latency, illustrating why token reductions alone are insufficient proof. A fresh Claude control is needed before choosing a second inference stage.

### 4. Keep a no-Claude terminal path as a later opportunity

The earlier synthetic close helper does not establish feasibility against Groucho's real policy. A valid experiment must replay actual core/supporting goals, orientation-dependent branches, integrity history, minimum depth, budgets, and terminal persistence obligations. Coverage completeness alone cannot authorize closing. Do not count the old 1/1 result as a production speed win.

## Implementation decision

No production behavior changed. The strongest next implementation candidate is a targeted improvement to the existing contribution guard, tested on positive phrasing and its current negative regression cases. In parallel conceptually, the best Jev research candidate is conservative coverage in shadow mode, retaining the full current flow as the control.

Do not add Jev sequentially to every turn based on these results. Its approximate 0.39-second median request must be offset by a demonstrably faster Claude call or fewer turns. The API savings are tiny; the opportunity cost is additional latency and maintenance while a documented local filter problem and the much larger conversation-model delay remain.

Verification: new harness tests, TypeScript, lint, and the dry run passed. The frozen experiment made 100 synthetic requests and no runtime/database changes. This report documents a completed classification comparison and code-level diagnostic, not an end-to-end improvement claim.
