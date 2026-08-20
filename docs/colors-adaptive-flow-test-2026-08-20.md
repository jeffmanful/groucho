# COLORS adaptive flow test — 20 August 2026

## Purpose

Test the live `Forum Application` conversation with three synthetic applicants:

- an artist;
- a curator / active scene participant;
- a music and COLORS enthusiast.

The test checked whether Groucho recognized each applicant's orientation, selected relevant evidence goals, maintained a natural conversational thread, and gave the applicant a fair opportunity to demonstrate how they would participate.

## Test setup

- Project: `Forum Application`
- Project ID: `e9e6aa45-5ef3-4ec3-9451-1703d32abed3`
- Model: `claude-haiku-4-5-20251001`
- Maximum configured turns: 9
- Test sessions:
  - `colors-adaptive-artist-20260820`
  - `colors-adaptive-curator-20260820`
  - `colors-adaptive-enthusiast-20260820`
- All applicants and examples were synthetic.

## Summary

The adaptive branching works at the broad level, but the flow is not yet ready for broad client testing.

| Identity | Orientation detected | Relevant branch | Feedback question | Participation opportunity | Final status | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Artist | Artist | Yes | No dedicated feedback test | Yes | Passed | Partial pass |
| Curator | Curator, then Hybrid | Yes | Yes, appropriately | Yes | Passed | Partial pass |
| Enthusiast | Enthusiast | Yes | No | Community explored, concrete contribution skipped | Redirected | Fail |

What worked:

- All three applicants were classified correctly from their early answers.
- The artist was asked about their own practice and was not forced through the curator feedback scenario.
- The curator was tested on real participation, selection, facilitation, feedback, and a plausible first contribution.
- The enthusiast was asked what a music community would need to feel like for them to participate.
- The enthusiast was not penalized with an irrelevant feedback question.

What did not work:

- A question about the enthusiast's conditions for community participation was stored as the concrete contribution signal. Their answer was therefore counted as contribution evidence even though Groucho had not asked what they would contribute.
- The budget controller then forced the enthusiast session to close after five answers. The model had generated the missing contribution follow-up, but it was replaced by the closing message.
- One single-select turn displayed four options without an explicit question.
- Safety rewrites replaced some model-written bridges with stock questions, producing abrupt transitions in the artist and curator sessions.
- Every terminal reviewer report fell back to an empty generic report because the structured report was missing or malformed.
- Average live response time was approximately 12 seconds, with a maximum of 14 seconds.

## Artist test

### Applicant intent

The applicant selected `Share Work`, identified as an electronic-soul artist, and said they wanted process-focused exchange rather than promotion.

### Groucho's path

1. Acknowledged “process over promotion” and asked for an under-recognized artist.
2. Reflected a specific observation about vocal space and asked whether that quality also appeared in the applicant's own work.
3. After a rich answer about removing harmony stacks and retaining awkward pauses, asked for a song by the referenced artist they would share.
4. Asked what kind of exchange with artists or listeners was useful to them.
5. Asked what they could realistically contribute in their first month.

### Assessment

The branch selection was correct and the second turn was especially strong: Groucho used the applicant's taste to open a natural door into their own creative practice. The later contribution question also framed participation in an artist-relevant way.

The weakest transition came after the applicant described a detailed production decision. Groucho immediately asked, “What is one of their songs that you have—or would—share with someone, and why?” The stored metadata shows `conversation_move_adjusted: true`: the control layer replaced the model's continuation with a stock signal question. This preserved coverage but dropped the live thread about the applicant's work.

No dedicated “how do you give feedback?” question was asked. Feedback only appeared later as part of a natural reflection on the kind of exchange the artist values.

Final orientation: `artist`. Final status: `passed`. User turns: 6.

## Curator test

### Applicant intent

The applicant selected `Community`, said they run a monthly listening night, and described connecting emerging artists with independent radio hosts.

### Groucho's path

1. Recognized both the consistency of the event and the connecting role, then asked for an under-recognized artist.
2. Asked for a track and why they would share it.
3. Followed the answer into how the applicant sequences a room and creates conditions for participation.
4. Asked how they approach feedback when work is not naturally for them.
5. Asked how their relationship to music appears around other people.
6. Asked what they would contribute first in the Forum.

### Assessment

This branch gathered the right evidence. The strongest moment was the rabbit hole about pacing a listening room: Groucho noticed that the applicant was reading both the music and the people in the space. The feedback scenario was relevant to this identity and elicited a concrete example rather than a generic philosophy.

The transition into feedback was abrupt. After the applicant explained how they make disagreement accessible to non-experts, Groucho jumped to the exact stock wording, “How do you approach feedback when the work is not naturally for you?” The metadata again shows `conversation_move_adjusted: true`. A natural bridge could have connected facilitation to responding when the curator's own taste differs from an artist's intent.

The orientation also drifted from `curator` to `hybrid` after the applicant expressed detailed taste. Rich taste should not, by itself, weaken an already well-supported curator identity. The route remained suitable, but this drift could make less clear sessions unstable.

Final orientation: `hybrid`. Final status: `passed`. User turns: 7.

## Music / COLORS enthusiast test

### Applicant intent

The applicant selected `Discover`, explicitly said “I mostly listen,” described discovery beyond algorithmic playlists, and wanted people with whom they could discuss why music stays with them.

### Groucho's path

1. Reflected the difference between algorithmic discovery and social meaning, then asked for an under-recognized artist.
2. Used a detailed answer about repeat listening to ask which song the applicant had shared and why.
3. Displayed a good reflection plus four role options, but did not include a question stem.
4. Asked, “What would a music community need to feel like for you to take part rather than only observe?”
5. Closed the session immediately after the answer.

### Assessment

The branch intent was correct. The community question was exactly the kind of evidence this applicant needed an opportunity to provide, and no irrelevant feedback scenario appeared.

The flow failed at signal accounting. The assistant metadata marked the community question's `application_next_signal` as the concrete first-month contribution signal. The applicant answered the actual question—what the community must feel like—but the next user message was stored as if it answered “What's one thing you could realistically contribute in your first month?” Because that core signal now appeared covered, the controller forced a close.

The hidden model reply proves Groucho itself still wanted the missing evidence:

> What would you actually contribute to the Forum if that kind of space existed—what would you share or notice that you're not offering anywhere else right now?

That reply was replaced by the closing message and `application_budget_forced_close: true`. The applicant was redirected despite providing rich, relevant community evidence and never receiving the concrete contribution question. This recreates the fairness issue the adaptive branches were intended to solve.

Final orientation: `enthusiast`. Final status: `redirected`. User turns: 5.

## Cross-flow defects

### P0 — Do not count a differently worded question as another core signal

Signal coverage should be based on the question actually asked and the evidence actually supplied, not only the controller's intended next signal. A community-condition question must not satisfy the concrete-contribution goal unless the answer independently contains a concrete contribution.

Recommended guard:

- persist both `asked_question_intent` and `target_signal`;
- validate that the visible question actually asks for the target evidence;
- only mark a core signal covered when the answer contains the evidence required by that signal;
- never budget-close while a model-generated final probe is trying to collect genuinely missing core evidence.

### P0 — Never render selection options without a question

When `inputType` is `singleSelect`, require an explicit visible prompt. If the model reply is only an acknowledgement, prepend or replace it with the configured signal question before persisting the turn.

### P1 — Preserve bridges when the controller changes the next signal

The safety layer should not replace the entire response with a bare fallback question. When it changes the target, it should retain a grounded acknowledgement and generate a bridge from the user's latest detail to the approved signal.

### P1 — Stabilize orientation once strongly evidenced

A strongly evidenced curator should not become `hybrid` merely for demonstrating taste. Orientation should describe how the person participates, not whether they also care deeply about music. Require explicit evidence of a second participation mode before promoting to `hybrid`.

### P1 — Make terminal reports reliable

All three sessions produced the generic fallback reviewer report with no evidence summary. Terminal validation should either repair the structured report or generate a deterministic report from persisted signal evidence. A pass or redirect without usable evidence defeats the internal review purpose.

### P2 — Response latency

Observed response times:

| Identity | Average | Maximum |
| --- | ---: | ---: |
| Artist | 11.9s | 13.4s |
| Curator | 11.9s | 13.4s |
| Enthusiast | 12.9s | 14.0s |

This is testable but noticeably slow for a conversational interface. It should be evaluated after correctness fixes, because reducing prompt and output size may improve both latency and structured-output reliability.

## Readiness decision

Ready for internal developer testing: **yes**.

Ready for a client-facing `/doorcheck` test: **not yet**.

The identity branches are directionally successful. The next implementation pass should fix signal-to-question alignment and the missing-question UI defect first, then preserve natural bridges during controller corrections and repair terminal reviewer reports. After those changes, rerun the same three synthetic identities as a regression set.

## P0 remediation — implemented 20 August 2026

Both P0 defects identified above are now fixed in the conversation runtime.

### Question and signal alignment

- Removed the community-condition prompt from the enthusiast's concrete-contribution routes.
- Added deterministic validation for concrete-contribution prompts and answers.
- A conditional preference such as “I'd join if the community felt...” no longer counts as a concrete first-month contribution.
- A contribution is only covered when the answer contains a first-person action such as sharing, hosting, starting, helping, writing, or contributing.
- When a useful adaptive question does not match its proposed evidence target, Groucho may keep the conversational question, but the runtime does not persist the mismatched target as the question it asked.
- If the model tries to conclude after the mismatched question, the terminal decision is deferred and the concrete contribution goal remains open.

### Structured-input question guarantee

- `singleSelect`, `multiSelect`, and `ranking` turns are checked for an explicit visible response prompt.
- If the model returns options with only an acknowledgement, the runtime appends a question matched to the next signal.
- The COLORS participation options now fall back to: “Which of these sounds most like how you participate around music?”
- Repairs are recorded privately with `application_explicit_question_added: true` for later auditing.

### Regression verification

- Reproduced the exact failed enthusiast contribution answer in an end-to-end contract test.
- Confirmed the answer remains uncovered, the session remains active, and the contribution question is asked rather than replaced by a forced close.
- Reproduced an acknowledgement-only single-select turn and confirmed the visible question is added before persistence.
- Full result: 39 test files and 232 tests passing.
- TypeScript and focused production lint checks pass.

The original live sessions remain historical evidence of the defects. A new three-identity live regression run is still required before changing the client-facing readiness decision.

## Live identity regression rerun — 20 August 2026

The same three synthetic identities were rerun against the live `Forum Application` project after the P0 remediation.

Fresh sessions:

- `colors-adaptive-artist-rerun-20260820`
- `colors-adaptive-curator-rerun-20260820`
- `colors-adaptive-enthusiast-rerun-20260820`

### Result summary

| Identity | Final orientation | User turns | Feedback question | P0 result | Final status |
| --- | --- | ---: | --- | --- | --- |
| Artist | Artist | 6 | No dedicated feedback test | Pass | Passed |
| Curator | Curator | 7 | Yes, appropriately | Pass | Passed |
| Enthusiast | Enthusiast | 6 | No | Pass, with downstream blocker | Redirected |

### P0 verification

Both implemented P0 guards passed in the live rerun.

- Every single-select, multi-select, and ranking turn contained an explicit visible question. A database check found zero structured-input turns without a question mark.
- The enthusiast again received a community-condition question before concrete contribution.
- The turn was recorded with `application_question_signal_mismatch: true` and no false `application_next_signal`.
- The conditional answer was not counted as contribution evidence.
- Groucho's attempted terminal was deferred with `application_terminal_deferred_for_unasked_core: true`.
- Groucho then asked the separate concrete question: “What could you add to a conversation here as a thoughtful listener?”
- The applicant's answer—starting a weekly thread around discoveries from repeat listening—was correctly recorded as rich contribution evidence.

### Artist rerun

The artist branch opened more directly than the first run. After the applicant said they make electronic soul, Groucho asked, “What are you trying to express in your own music?” It then connected a concrete production choice to artistic references, sharing, useful exchange, and a realistic contribution.

The artist was not asked the curator-only hypothetical feedback question. The contribution prompt did use a rough-track scenario, but it was framed as what the artist would concretely bring to an exchange rather than as a standalone feedback test.

Final orientation remained stable as `artist`. Final status: `passed`.

### Curator rerun

The curator branch again collected the right evidence: contextual selection, reading and shaping a room, adapting introduction by context, handling work outside personal taste, sharing discoveries with context, and a concrete hosted listening thread.

Unlike the first run, orientation remained stable as `curator` instead of drifting to `hybrid`.

The abrupt jump into the stock feedback question remains. This is still a bridge-quality issue rather than a branch-selection issue.

Final status: `passed`.

### Enthusiast rerun

The enthusiast branch correctly focused on listening, discovery, informal music conversation, the conditions for participation, and then a separate concrete contribution. It did not ask for feedback, formal curation, or organising experience.

The original unfair evidence omission is fixed. However, the session still ended as `redirected` after the applicant supplied rich concrete contribution evidence and held an overall score of `0.83`.

The stored terminal metadata explains why:

- all applicable core goals were covered;
- the model nevertheless proposed another optional question about what remained unclear;
- the conversation was already in its closing phase;
- the budget controller correctly prevented the extra question, but `application_budget_forced_close` always converted that situation to `redirect` rather than deriving an advisory outcome from the accumulated evidence.

This is a new outcome-integrity blocker. The P0 evidence guards worked, but the forced-close fallback can still turn a strong completed enthusiast application into an unsupported redirect.

### Reviewer reports and latency

All three terminal turns still produced the generic fallback reviewer report with an empty evidence summary. That P1 issue is unchanged.

Observed response times:

| Identity | Average | Maximum |
| --- | ---: | ---: |
| Artist | 11.8s | 13.2s |
| Curator | 11.6s | 12.8s |
| Enthusiast | 13.5s | 16.7s |

### Updated readiness

The two original P0 regressions are fixed in live sessions. The flow is still **not ready for client-facing testing** because a budget-forced close can produce an unsupported `redirected` outcome after all core evidence is covered.

Recommended next fix: replace the hard-coded redirect on budget closure with a deterministic advisory decision derived from accumulated scores and thresholds, or require a terminal decision from the model without allowing another applicant-facing question. Add a regression for a completed enthusiast application with all core signals covered.

## Forced-close outcome remediation — 20 August 2026

The hard-coded redirect has been removed. When the question budget requires Groucho to close a completed application, the advisory outcome is now derived from the accumulated overall score using the project's configured thresholds:

- at or above the pass threshold: `passed`;
- at or below the reject threshold: `rejected`;
- between the thresholds: `redirected` for human review.

The persisted structured terminal now matches that result (`pass`, `reject`, or `redirect`). The applicant still receives the same neutral closing copy, so this change does not disclose the internal assessment.

Forced decisions are auditable through `application_budget_forced_close_outcome`, which records the decision source, overall score, configured thresholds, and resulting status.

Regression coverage now includes strong, uncertain, and weak score bands. The end-to-end enthusiast reproduction confirms that complete evidence with an overall score of `0.83` and a pass threshold of `0.65` produces `passed` and persists `gatekeeper_terminal: pass`. The existing nine-answer hard-stop test confirms an uncertain `0.50` score still routes to human review.

Verification after the fix: 39 test files and 236 tests pass, alongside TypeScript and focused production lint checks.

The outcome-integrity blocker is fixed in automated testing. A short live enthusiast rerun remains recommended before client-facing testing; the generic fallback reviewer report and curator bridge quality remain separate P1 improvements.

## Live forced-close enthusiast rerun — 20 August 2026

The earlier enthusiast transcript was replayed against a fresh local runtime connected to the live `Forum Application` project.

Primary synthetic session:

- `colors-enthusiast-forced-close-rerun-20260820111335`

### Outcome

- Final status: `passed`
- Persisted terminal: `pass`
- Success secret: created
- Final overall score: `0.89`
- Final orientation: `enthusiast` at `0.95` confidence
- Feedback question on the exact replay: no
- Concrete contribution opportunity: yes

The applicant proposed a weekly thread built around what repeat listening reveals and then described returning each week, replying to other listeners, and carrying those observations into the next thread. The database retained the enthusiast orientation rather than treating close listening alone as formal curation.

The original bad outcome did not recur: this strong enthusiast application passed instead of being redirected. However, the terminal decision at turn nine was an explicit model `pass`, not a budget-forced fallback. Accordingly, `application_budget_forced_close` and `application_budget_forced_close_outcome` were absent. The live run validates the practical outcome, while the deterministic unit and route regressions remain the direct verification of the new forced-close threshold branch.

### New P0 conversation-state defect

The replay exposed a separate state-integrity problem:

- After the song recommendation, Groucho returned a reflection with no question while the API status remained `active`.
- After the concrete contribution, Groucho wrote “Thank you. We'll get in touch about your application soon.” while persisting `terminal: none` and leaving the session `active`.
- A further acknowledgement produced the same applicant-facing closing while the session again remained active.
- The synthetic runner could continue, but a real applicant would reasonably believe the application had ended and would have no visible invitation to respond.

This should be treated as P0 before client-facing testing. Every active text turn needs a clear invitation or question, and terminal-sounding closing copy must either be converted into a real terminal outcome or replaced with the next valid prompt. The existing structured-input question guarantee does not cover ordinary text turns.

### Other observations

- When the replayed community-condition answer arrived after a concrete-contribution question, the signal-integrity guard correctly left contribution unresolved and asked for concrete contribution again.
- The exact replay remained on the enthusiast branch and did not ask the curator feedback question.
- The fallback reviewer report remains generic and contains no evidence summary.

### Revised readiness

The unsupported redirect is no longer reproduced, and the final advisory outcome is correct. The flow is still **not ready for client-facing testing** because an active session can present closing language or no response invitation without actually concluding.

## Active-response integrity remediation — 20 August 2026

The active-with-closing-language defect is now guarded at runtime for compact application flows.

- Every active text or voice turn must contain a clear question or direct invitation to respond.
- A grounded reflection without an invitation is preserved and followed by the next applicable open evidence question.
- Terminal-sounding language on an active turn is never shown as-is.
- If an applicable evidence goal remains, the false closing is replaced with that goal's prompt.
- If no applicable goal remains, the session closes using the project's pass and reject thresholds.
- A covered current signal cannot be reused merely because the model proposed a follow-up move.
- Repairs are recorded privately in `application_active_reply_repair`, including the detected issue, repair action, and replacement signal where applicable.

Regression coverage reproduces both live failures: a reflection with no question and configured closing copy returned with `terminal: none`. Route tests confirm that the former remains active with a real next question, while the latter becomes a score-derived terminal decision when the evidence is complete.

Verification after remediation: 39 test files and 240 tests pass, alongside TypeScript, focused production lint, and diff checks.

The P0 defect is fixed in automated coverage. A short live enthusiast replay remains the final validation step before revising client-facing readiness. Generic reviewer reports and occasional curator bridge quality remain separate P1 work.

## Live active-response replay — 20 August 2026

The enthusiast branch was replayed after the active-response integrity remediation.

Validated synthetic session:

- `colors-enthusiast-active-integrity-replay-20260820113503`

### Result

- Final status: `passed`
- Persisted terminal: `pass`
- User turns: 6
- Final overall score: `0.82`
- Final orientation: `enthusiast` at `0.89` confidence
- Feedback question: no
- Concrete participation opportunity: yes
- Active responses with a clear invitation: 6 of 6
- Active responses containing terminal language: 0
- Runtime repairs required: 0

The conversation stayed with discovery, attentive repeat listening, recommending music for a particular listener, where music becomes social, and what the applicant would bring to shared conversation. The listener orientation remained stable and the curator-only feedback route did not appear.

Every active response independently passed the invitation check. Groucho used the configured neutral close only after the API and database both concluded the session as `passed`.

The validated replay ended through an explicit model pass, so it did not require repair metadata or a forced-close fallback. A preceding controller-only run did exercise the live forced-close branch: an overall score of `0.82` against the live pass threshold of `0.75` produced `passed`, persisted `gatekeeper_terminal: pass`, created a success secret, and recorded `application_budget_forced_close_outcome` with `source: score_thresholds`. That preliminary run is not used for identity-routing assessment because its synthetic option matcher selected the wrong participation option.

All temporary replay API keys were revoked after the runs.

### Revised readiness

The active-response P0 is fixed in both automated coverage and a live replay. The conversation flow is now **ready for controlled `/doorcheck` testing**. It should not yet be treated as release-complete: the generic fallback reviewer report still lacks an evidence summary, and curator bridge quality remains a P1 issue.

## Community-intent continuity and doorman voice — 20 August 2026

- Inspected the latest live session and confirmed that selecting `Community` produced only a `0.40` enthusiast hypothesis, leaving orientation unknown and allowing the default artist route to take over.
- Confirmed a second integrity fault in the same turn: the visible artist question was privately tagged as the participation question, so the stored target did not match what the applicant was asked.
- Made an explicit `Community` or “here for community” opening a strong enthusiast routing signal and reserved the immediate follow-up for `What does community mean to you?`.
- Expanded question-to-signal validation across the known COLORS goals so an artist question can no longer masquerade as participation evidence.
- Added a runtime voice guard that removes `before we wrap`, `before we finish`, `before we close`, and `one last question` while retaining any grounded receipt and invitation.
- Reframed Groucho as an attentive, selectively warm COLORS presence at the door: the assessment remains private and the conversation never announces its progress.
- Replaced the applicant-facing close with `It was good getting to understand you better.` in both the product default and the live `Forum Application` project settings.
- Added unit and end-to-end regressions that reproduce the latest session's wrong artist jump and verify the corrected community follow-up, orientation, and audit metadata.
- Verified the full automated suite, TypeScript, focused lint, and diff checks after the changes.

## Reviewer and follow-through integrity — 20 August 2026

- Replaced the empty generic terminal fallback with a deterministic report assembled from branch-relevant signal definitions, covered answers, exhausted goals, participant orientation, scores, and terminal status.
- Kept complete model-generated reports, while forcing their advisory recommendation to remain consistent with the persisted terminal outcome.
- Preserved one answer-specific declarative receipt when the controller must replace a mismatched bridge or question; generic praise and the rejected question are discarded.
- Stabilised orientation merging so a strong curator, artist, or enthusiast does not become hybrid from an unsupported secondary model score. A second participation mode now needs explicit evidence.
- Persisted `application_insufficient_evidence` after an initial answer plus two unusable follow-ups, exposed that state to the compact conversation model, and excluded exhausted goals from further routing without pretending they were covered.
- Added unit and route-level regressions for evidence-backed reports, grounded correction receipts, orientation stability, and exhausted-signal advancement.

## Four-identity live rerun — 20 August 2026

The updated flow was exercised with synthetic artist, curator, enthusiast, and hybrid applicants through the local `/doorcheck` runtime connected to the live `Forum Application` project. A reusable runner now creates a scoped temporary project key, records the transcript and integrity summary, and revokes the key in a `finally` block.

Primary comparison sessions:

- Artist: `colors-artist-integrity-rerun-20260820150850`
- Curator: `colors-curator-integrity-rerun-20260820151413`
- Enthusiast: `colors-enthusiast-integrity-rerun-20260820150221`
- Hybrid: `colors-hybrid-integrity-rerun-20260820151413`

| Identity | Status | Turns | Final orientation | Feedback route | Report evidence | Result |
| --- | --- | ---: | --- | --- | ---: | --- |
| Artist | Passed | 7 | Hybrid | No standalone test; one contextual unfinished-work consequence | 5 | Partial |
| Curator | Passed | 7 | Hybrid | Yes, relevant | 6 | Partial |
| Enthusiast | Passed | 6 | Enthusiast | No | 5 | Pass |
| Hybrid | Passed | 7 | Hybrid | Yes, relevant | 6 | Pass |

### Confirmed improvements

- `Community` immediately produced `What does community mean to you?` for both curator and enthusiast openings.
- The enthusiast remained on the listener/community route, received a concrete participation opportunity, avoided the feedback scenario, and passed in six turns.
- The hybrid explicitly disclosed making music and curating a radio show; the flow used both branches and asked a relevant feedback question.
- All four completed sessions produced evidence-backed reviewer reports with five or six concrete evidence items and matching `recommend` advisory outcomes.
- Every primary-run active response had a visible invitation, all primary sessions ended with the new neutral close, and no primary run exposed application outcome language.
- Grounded controller repairs were exercised between one and three times per session.

### Remaining issues exposed

1. **Orientation still over-promotes to hybrid.** The curator finished with artist `0.82`, curator `0.96`, and enthusiast `0.78`; the artist finished with artist `0.85` and enthusiast `0.78`. The deterministic vocabulary still treats broad words such as `artist`, `label`, community intent, or selecting `I like discussing music` as evidence of a second identity rather than context or participation style.
2. **Process narration has a wider surface.** The artist used `Before we go further`, which is functionally the same interview-stage language as `before we wrap` but is not yet blocked.
3. **An intermittent compact-state escape remains.** In `colors-hybrid-integrity-rerun-20260820145516`, a maker-practice question was paired with participation options. Following the visible options produced an untagged turn; later, a neutral closing appeared while the session remained active. A subsequent clean hybrid run did not reproduce it, but the stored session proves the guard can be disabled by a current-session untagged answer.
4. **Latency remains conversationally heavy.** Primary runs averaged roughly 9.6–10.1 seconds per request, with a maximum of 14.0 seconds.

### Readiness

The branch content and reviewer reports are materially better. Controlled `/doorcheck` testing can continue, but the intermittent compact-state escape should be treated as the next P0 fix. Orientation evidence semantics and the wider process-language family remain P1 conversation-quality work.

## P0 provenance and identity validation — 20 August 2026

The four representative identities were exercised again after adding exact
message provenance, stricter orientation evidence, repeated-question detection,
and the expanded doorman-voice guard.

Validated sessions:

- Artist: `colors-artist-integrity-rerun-20260820184629`
- Curator: `colors-curator-integrity-rerun-20260820183944`
- Enthusiast: `colors-enthusiast-integrity-rerun-20260820185152`
- Hybrid: `colors-hybrid-integrity-rerun-20260820185152`

| Identity | Status | Turns | Orientation | Feedback route | Evidence refs | Repeated questions | Process language |
| --- | --- | ---: | --- | --- | ---: | ---: | --- |
| Artist | Passed | 7 | Artist | Contextual artist exchange | 8 | 0 | No |
| Curator | Passed | 8 | Curator | Yes | 11 | 0 | No |
| Enthusiast | Passed | 7 | Enthusiast | No | 8 | 0 | No |
| Hybrid | Passed | 10 | Hybrid | Yes | 13 | 0 | No |

Every active turn retained a visible invitation and no active turn displayed the
neutral closing message. Reviewer packets contained the exact applicant-message
IDs and bounded excerpts underlying their evidence summaries. All temporary
replay API keys were revoked by the runner.

The replays also drove two additional integrity changes. A covered signal can no
longer repeat the immediately preceding visible question merely because the model
requests a deeper move. Process phrases including `before we dig into that`,
`before we go further`, and `before we go deeper` are removed while retaining the
grounded receipt and real question.

This completes representative identity validation for P0. Live vague,
contradictory, extractive, and safety-boundary trajectories remain before a
production decision. Reviewer recommendation calibration also still requires
labelled COLORS decisions.

## Adversarial P0 trajectories — 20 August 2026

Initial live sessions exposed missing deterministic handling:

- `colors-vague-integrity-rerun-20260820192159`
- `colors-contradictory-integrity-rerun-20260820192159`
- `colors-extractive-integrity-rerun-20260820192159`
- `colors-safety_boundary-integrity-rerun-20260820192159`

The model privately recognised some contradictions but did not challenge them.
It treated posting a private demo without consent as ordinary usable evidence,
created no safety flag, and could repeat a contribution question after one
intervening turn. The vague path also exposed more interview-stage narration.

The runtime now deterministically recognises only tightly scoped, explicit
evidence of admitted fabrication, sharing private artist work without consent,
and access sought primarily to grow the applicant's own platform. It forces a
calm, concern-specific challenge when the conversation remains active, persists
the concern on the exact user message, and merges a stable private flag into the
reviewer report even when the model omits it. Adjacent non-concerning language is
covered by negative regressions.

Validated post-fix sessions:

- Vague: `colors-vague-integrity-rerun-20260820194631`
- Contradictory: `colors-contradictory-integrity-rerun-20260820193136`
- Extractive: `colors-extractive-integrity-rerun-20260820205737`
- Safety boundary: `colors-safety_boundary-integrity-rerun-20260820205737`

| Scenario | Internal outcome | Turns | Challenge | Stable private flag | Repeated exact question |
| --- | --- | ---: | ---: | --- | ---: |
| Persistently vague | Human review | 7 | 0 | No concern; four weak areas | 0 |
| Admitted fabrication | Human review | 8 | 1 | Fabricated participation claim | 0 |
| Repeated extractive intent | Human review | 2 | 1 | Privileged access/platform growth | 0 |
| Artist-consent violation | Decline | 7 | 1 | Private work shared without permission | 0 |

All applicant-facing endings remained neutral. The statuses above are model
advisory outcomes and still cannot grant or deny Forum access without a recorded
human decision. The interaction and evidence-integrity behaviour is now covered.
The first four outcome labels were confirmed by COLORS and are recorded in
`docs/colors-calibration-cases-2026-08-20.md`.

The vague route now has a semantic stop rather than another global question cap.
After at least six thin answers spanning at least three distinct intents, it
closes to human review regardless of the numeric reject threshold. Missing
evidence therefore remains uncertainty rather than becoming a private decline.

The calibrated integrity boundary gives a first explicit concern one calm
challenge. Admitted fabrication remains in human review after the applicant
corrects the record, and repeated extractive access intent resolves to human
review. Repeating the consent violation after Groucho states that artist
permission matters resolves to private decline. Live replays confirmed both
changed outcomes while retaining the neutral applicant close.
