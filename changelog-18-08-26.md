# Changelog — 18 August 2026

## P0 adversarial trajectories and integrity boundaries — 20 August 2026

- Added reusable vague, contradictory, extractive, and artist-consent safety scenarios to the live replay runner.
- Added deterministic detection for explicit admitted fabrication, sharing private or unreleased artist work without permission, and Forum access framed primarily as growth for the applicant's own platform.
- Forced calm concern-specific challenges on active turns and persisted stable private reviewer flags even when the conversation model omits them.
- Expanded repeated-question protection from the immediately previous question to recent questions and prevented repair from selecting the same repeated fallback.
- Expanded process-language cleanup across `let me ask differently`, `let me ask you differently`, `let me ask this differently`, and `let me try something simpler`, preserving sentence capitalization.
- Added a semantic thin-evidence stop after at least six thin answers across three intents; it routes to human review rather than converting missing evidence into a private decline.
- Replayed all four adversarial scenarios and confirmed neutral endings, source-linked reports, no exact repeated questions, and the expected private concerns.
- Added a COLORS calibration worksheet containing the four observed boundary cases and the larger labelled packet still required.
- Encoded the first client-confirmed labels: persistent vagueness and admitted fabrication route to human review; repeated extractive intent routes to human review; knowingly continuing to share private artist work without consent routes to private decline.
- Preserved one calm challenge before a repeated concern resolves, with an auditable calibrated-outcome record on the terminal assistant message.

## P0 evidence provenance and fairness — 20 August 2026

- Added deterministic reviewer evidence references containing the evidence-goal key and label, exact applicant-message ID, and bounded source excerpt.
- Carried source message IDs through signal collection, current-turn coverage, multi-goal coverage, terminal persistence, API responses, webhooks, SDK types, and the internal `/doorcheck` reviewer panel.
- Stopped model-written evidence summaries from bypassing the evidence reducer; terminal evidence summaries are now reconstructed from validated application state.
- Added representative artist, curator, enthusiast, and hybrid routing trajectories.
- Added initial fairness pairs for city prestige, local versus online participation, concise versus polished listener language, and familiar versus unfamiliar artist references.
- Fixed two false-positive orientation rules: mentioning a scene no longer implies curation, and mentioning an artist no longer implies that the applicant is a maker.
- Updated the COLORS calibration brief with the exact labelled examples and annotations still required from the client.
- Prevented an immediately repeated visible question even when a covered signal is selected for a bounded deeper move.
- Expanded the doorman-voice guard to remove `before we dig into that`, `before we get into this`, `before we go further`, `before we go deeper`, and related interview-stage narration.
- Replayed representative artist, curator, enthusiast, and hybrid identities through the live project; all retained the intended orientation, completed without repeated questions or premature closing, and persisted source-linked reviewer evidence.

## Runtime and coverage cleanup — 20 August 2026

- Audited the active COLORS application path and its direct regression coverage.
- Deleted the retired artist-reference detection, artist-context enrichment, and artist-context prompt modules plus their isolated tests; no application, API, SDK, or background path imported them.
- Removed the obsolete global conversation-point and adaptive-turn counters left behind after the move to per-intent limits and flexible pacing.
- Removed the redundant adaptive-turn permission flag; remaining-question and follow-up budgets already own that boundary.
- Kept the one-per-session open-door history, semantic quality trajectory, per-intent follow-up limits, and emergency loop stop.
- Aligned local `/doorcheck` test mode and the identity replay with the soft target plus higher emergency limit instead of stopping at nine.
- Updated synthetic identity answers so replay testing can exercise the COLORS-relationship and situated-cultural-perspective routes.
- Added a dated functionality and coverage audit with the active runtime map, coverage strengths, production gaps, and separately scoped repository debt.
- Updated conversation-depth documentation and regression expectations to match the runtime contract.

## Situated cultural perspective enhancement — 20 August 2026

- Enhanced cultural-point-of-view and participation routing with optional questions about the music scene around an applicant, what outsiders might miss, and whether they feel inside, adjacent to, or outside it.
- Added artist, curator, enthusiast, and hybrid scene routes without creating another private signal or compulsory question.
- Added a local-scene conversation bridge for applicant-supplied cities, venues, events, collectives, genres, online scenes, and informal communities.
- Required observable detail instead of asking applicants to declare that they possess unique cultural insight.
- Added safeguards against collecting exact location, rewarding prestigious cities or famous contacts, equating industry proximity with insight, or penalising outsider and online-only perspectives.
- Added signal-route, compact-state, prompt, and question-integrity regression coverage.

## Sustained reciprocity enhancement — 20 August 2026

- Enhanced the existing participation-and-contribution cluster with sustained reciprocity instead of adding another signal or expected question.
- Prioritised evidence from repeatable existing habits over polished hypothetical first-month promises.
- Added orientation-aware routes for the exchanges artists, curators, enthusiasts, and hybrids already sustain around music.
- Allowed concrete habitual first-person actions to satisfy contribution integrity checks while preserving rejection of passive preferences and conditional community answers.
- Instructed Groucho to mark both participation and contribution when one answer supports both, avoiding a redundant hypothetical follow-up.
- Clarified that reciprocity is not measured through posting volume, unpaid labour, professional networking, leadership, or maker status.
- Added prompt, signal-state, and turn-integrity regression coverage.

## Relationship to COLORS intent — 20 August 2026

- Added a shared, core relationship-to-COLORS evidence intent immediately after opening motivation in the private signal model.
- Made the intent high-priority early guidance rather than a mandatory second question; the opening or any later answer can cover it alongside other goals.
- Added artist-, curator-, enthusiast-, and hybrid routes grounded in how COLORS presents work, creates context, shapes listening, and might extend into the Forum.
- Explicitly prohibited treating the intent as brand praise, a knowledge quiz, a fandom threshold, or a cultural-status test.
- Preserved the existing community-first route: when community is the opening motivation, Groucho first asks what community means, then connects that answer to COLORS naturally.
- Documented the remaining possible future intents without adding a larger question library or checklist.
- Added regression coverage for signal insertion, persona-aware routes, early gap suggestion, and multi-intent coverage from the opening answer.

## Stronger V1 architecture plan — 20 August 2026

- Assessed the current Groucho application architecture against the coherence audit and recorded an 8/22, not-ready decision-system baseline while retaining readiness for controlled conversation testing.
- Documented the stronger V1 product boundary: Groucho may interpret and express, while the application owns state, evidence provenance, legal transitions, escalation, human review, and access authority.
- Defined a target architecture covering structured extraction, validated state reduction, deterministic next-action policy, dialogue generation, source-linked reviewer packets, and recorded human decisions.
- Planned the removal of universal cultural-fit scoring and model-controlled access outcomes in favour of branch-specific evidence criteria and observable uncertainty factors.
- Added a six-phase delivery sequence with dependencies, acceptance criteria, feature-flagged rollout, fairness pairs, complete trajectory tests, and an audit-based definition of done.
- Prioritised the first implementation slice: separate advisory conversation completion from eligibility and require a recorded human approval before issuing access.
- Marked the stronger V1 plan as the decision-architecture authority while retaining the existing V2 roadmap for interaction design and the COLORS tracker for conversation behaviour.

## Human decision boundary — 20 August 2026

- Added a service-role-only `application_decisions` table with row-level security, one immutable human approval or decline per session, reviewer attribution, reason, advisory snapshot, and approval-only access secret.
- Added an organisation-admin decision endpoint that accepts only completed sessions and records the authenticated reviewer rather than trusting model output.
- Stopped gatekeeper terminal turns from creating `sessions.success_secret`; legacy `passed`, `redirected`, and `rejected` values temporarily remain advisory compatibility outcomes.
- Added `reviewStatus` (`not_ready`, `pending`, `approved`, or `declined`) to gatekeeper responses and session reads so human-review state is distinct from conversational outcome.
- Changed both access routes to require an approved human-decision record and its matching secret. Scores, model recommendations, and legacy `passed` status can no longer grant access alone.
- Updated the OpenAPI and generated SDK types, retaining the optional legacy secret shape for compatibility while documenting that gatekeeper access secrets come only from human approval.
- Added decision, decision-route, access-route, and terminal contract regressions covering the new authority boundary.

## Firm goals, flexible conversation — 20 August 2026

- Added the COLORS flexible conversation contract, defining firm private evidence intents with freedom over question wording, order, continuity, and depth.
- Made every new COLORS Forum session open directly with `Why do you want to be an early applicant for the Forum?` using open text rather than a Discover / Community / Share Work choice.
- Made the opening answer the first routing inflection point and prevented an ordinary non-concerning first answer from ending the COLORS conversation.
- Reframed configured question strings and prompt routes as illustrative examples rather than required lines or an ordered question sequence.
- Removed runtime question-template regex enforcement from signal routing. Persisted assistant intent metadata now owns the private signal while Groucho can express the visible question naturally.
- Removed the deterministic answer-seven closing phase, answer-eight final probe, and answer-nine hard close.
- Changed `max_turns` into a soft pacing target and added an emergency loop stop three answers later, capped at fourteen.
- Removed the shared three-adaptive-turn restriction and relaxed the global rabbit-hole point restriction while retaining per-intent follow-up limits, one-question replies, safety boundaries, and loop protection.
- Updated `/doorcheck`, the persona specification, project guidance, realism/depth documentation, and regression coverage.

## Conversation realism

- Documented the eight-layer conversation-realism roadmap.
- Started layer 1: private live conversation-thread state.
- Added current subject, strongest detail, unresolved hook, momentum, applicant energy, and acknowledged-detail tracking.
- Persisted thread state on assistant messages and included it in the next compact application turn.
- Instructed Groucho to continue productive threads before filling unrelated evidence gaps, while preserving question, follow-up, and safety limits.
- Added normalization and tests so thread state cannot accumulate unbounded or malformed model output.
- Increased the structured turn response budget to accommodate thread state alongside assessments and terminal reviewer reports.

## Response modes

- Implemented `reflect`, `interpret`, `probe`, `deepen`, `connect`, `challenge`, `pivot`, and `close` as explicit private response modes.
- Kept response shape separate from the accepted conversation-routing move.
- Added server-side compatibility rules and safe fallbacks for malformed or incompatible mode choices.
- Persisted the resolved mode on assistant-message metadata and included recent mode history and repetition count in the next compact turn.
- Added prompt guidance to vary conversational shape, leave one clear invitation on active turns, and avoid the repeated acknowledgement-plus-question formula.

## Adaptive question budget

- Reframed the six configured COLORS items as evidence goals rather than six required questions, retaining multi-goal coverage and adding related-goal clusters.
- Added core and supporting priorities so supporting gaps cannot prolong the closing phase.
- Added a shared three-turn adaptive budget across clarifications, open doors, and rabbit holes.
- Defaulted to one clarification per goal; a second now requires a core gap with evidence of recovery potential.
- Stopped adaptive coaxing after thin evidence across three distinct goals.
- Added a five-to-seven-turn target, a core-only closing phase after answer seven, one possible final core probe after answer eight, and a hard neutral close after answer nine.
- Prevented `advance` from repeating the current unresolved goal and added regression coverage for the feedback-question loop.
- Added route-level coverage for the nine-turn hard stop and model attempts to continue past it.

## Contextual conversation bridges

- Replaced the generic “What have you found yourself sharing lately?” route with an artist-linked question: “What is one of their songs that you have—or would—share with someone, and why?”
- Added an explicit artist-to-song bridge so Groucho keeps the named artist as the subject instead of resetting the conversation.
- Added an album bridge that turns a named album, LP, or record into a track recommendation question when recommendation evidence remains open.
- Added a maker bridge that reacts when applicants disclose making or sharing their own music and asks naturally about their work.
- Defined both bridges as replacements for generic questions, not extra turns, with multi-goal coverage and normal closing-budget enforcement.
- Added the bridge rules to the COLORS persona, application prompt, compact live state, documentation, and prompt-contract tests.
- Added a general bridge grammar covering person-to-work, work-to-detail, judgment, personal connection, maker practice, consequence, sharing, feedback, contribution, tension, and callbacks.
- Added a structured three-candidate bridge plan with source detail, target evidence goal, question intent, confidence, and freshness.
- Added server-side validation for bridge confidence, eligible goals, closing phase, remaining questions, and repeated bridge kinds.
- Persisted bridge candidates and accepted selections privately so later turns can avoid mechanical repetition and reviewers can audit continuity.
- Allowed an accepted bridge to route the next evidence goal even when the model's generic next-signal field points elsewhere.
- Kept bridge planning inside the existing model turn and increased the response allowance without adding another AI request.
- Prioritized a fresh maker-to-practice candidate into an open core goal over a supporting recommendation bridge when the same answer contains both artist appreciation and the applicant's own music.
- Added a server-side maker-priority fallback so this preference still affects routing when the model selects the supporting artist bridge.
- Banned narrated transitions such as “that matters”, “let me shift”, and “moving on”; bridges must now be carried by one direct question rather than an evaluative preamble.
- Prevented bridge questions from stacking a sharing reason and a separate “what should they notice?” ask in the same turn.
- Grounded contribution bridges in the applicant's concrete action or wording before asking what they would actually do in the Forum.
- Added guidance against abstract contribution phrasing such as “that kind of listening”, “that approach”, “that instinct”, and “how would that show up”.
- Expanded bridge planning from source-to-question routing into receive → connect → invite, including a private connective observation for every candidate.
- Added continue, connect, and pivot transition shapes so Groucho can distinguish staying with a subject, earning a related question, and honestly changing direction.
- Relaxed the bare-question overcorrection: bridges may now use one or two short sentences and a specific meaningful receipt, while generic praise, narrated pivots, stacked questions, and invented connections remain disallowed.

## Adaptive applicant branches

- Added a private, revisable participant-orientation state for artists, curators or scene participants, music or COLORS enthusiasts, and hybrids.
- Persisted orientation scores and explicit evidence in existing message metadata, requiring no database migration.
- Split the COLORS flow into a shared evidence trunk with branch-aware goal eligibility and question routes.
- Limited the unfinished-work feedback goal to curator, scene, organising, or feedback-relevant routes instead of asking every applicant.
- Added artist-specific questions about practice and exchange, curator-specific questions about concrete participation and consequence, and enthusiast-specific questions about community meaning, goals, and likely participation.
- Added deterministic support for clear disclosures such as “Discover”, “Share Work”, “I mostly listen”, making music, and curating or organising.
- Moved participation-orientation discovery earlier when the opening remains ambiguous.
- Added a fair-opportunity guard that defers ordinary completion while an applicable core goal has never been attempted and question budget remains.
- Made reviewer guidance branch-aware so absent curation, multiplier, feedback, organising, or maker evidence is neutral when it does not apply.
- Added regression coverage for the listener path that previously closed without asking about contribution or community goals.

## Verification

- Ran focused and full tests, type checking, lint, diff checks, and a production build.

## P0 adaptive-flow integrity fixes — 20 August 2026

- Separated community preferences from concrete contribution evidence in the enthusiast route.
- Added runtime validation so a visible question cannot silently record a mismatched concrete-contribution target.
- Added concrete first-person action checks before a contribution goal can be marked covered.
- Preserved useful adaptive questions without falsely tagging them as a different evidence goal.
- Prevented terminal budget closure when contribution evidence remains genuinely unasked or uncovered.
- Guaranteed an explicit visible question for single-select, multi-select, and ranking interactions.
- Added audit metadata for repaired structured-input prompts and question-to-signal mismatches.
- Added unit and end-to-end regressions reproducing both failures found in the live identity test.
- Verified 39 test files and 232 tests, TypeScript, and focused production lint.
- Reran live artist, curator, and enthusiast identities with fresh sessions.
- Confirmed both P0 guards in persisted production-shaped metadata: no structured-input turn lacked a question, and a community-condition answer no longer covered concrete contribution.
- Confirmed the artist and curator sessions passed with stable branch routing.
- Identified a downstream outcome blocker: budget-forced closure still hard-codes `redirected`, causing a completed enthusiast with rich contribution evidence and a `0.83` overall score to be redirected.

## Forced-close outcome integrity — 20 August 2026

- Replaced the hard-coded `redirected` budget fallback with a deterministic decision using each project's pass and reject thresholds.
- Strong completed evidence now produces `passed`, weak evidence produces `rejected`, and scores between the thresholds continue to route to human review.
- Aligned persisted terminal metadata with the derived status: `pass`, `reject`, or `redirect`.
- Preserved neutral applicant-facing closing copy so internal scoring and community evidence remain undisclosed.
- Added private forced-close audit metadata containing the decision source, overall score, thresholds, and resulting status.
- Added unit regressions for all three score bands and an end-to-end regression for the previously redirected enthusiast case.
- Verified 39 test files and 236 tests, TypeScript, and focused production lint.

## Live forced-close regression — 20 August 2026

- Replayed the earlier synthetic enthusiast path against a fresh runtime connected to the live `Forum Application` project.
- Confirmed the strong enthusiast application now finishes `passed`, persists `gatekeeper_terminal: pass`, and creates a success secret instead of reproducing the unsupported redirect.
- Recorded a final overall score of `0.89` and a stable enthusiast orientation at `0.95` confidence.
- Confirmed the live model made an explicit pass at turn nine; direct forced-close audit metadata was therefore not expected on this session, and the forced threshold branch remains directly covered by automated regressions.
- Identified a new P0 state-integrity defect: ordinary active text turns can contain no question, and can even use the configured terminal thank-you copy while the session remains active with `terminal: none`.
- Recorded that the generic fallback reviewer report remains unresolved.

## Active-response integrity — 20 August 2026

- Added a runtime guarantee that every active application text or voice response leaves a clear question or direct invitation.
- Preserved grounded reflections when possible by appending the next applicable open evidence question.
- Prevented configured or recognizable terminal application language from being shown while `terminal: none` remains active.
- Replaced false closings with an unresolved core prompt when evidence remains; otherwise resolved the session through the configured score thresholds.
- Prevented already-covered current signals from being reused during response repair.
- Added private `application_active_reply_repair` audit metadata with issue, action, and replacement signal.
- Added pure and end-to-end regressions for reflection-only active turns and terminal copy returned as active.
- Verified 39 test files and 240 tests, TypeScript, focused production lint, and diff checks.

## Live active-response validation — 20 August 2026

- Replayed a corrected synthetic enthusiast identity after the active-response integrity fix.
- Confirmed all six active assistant turns contained a clear question or invitation and none displayed terminal closing language.
- Confirmed the session passed in six user turns with an overall score of `0.82`, persisted `gatekeeper_terminal: pass`, and retained an enthusiast orientation at `0.89` confidence.
- Confirmed the enthusiast route did not ask the curator-only feedback question.
- Exercised the live score-threshold forced-close branch in a separate controller check: `0.82` against a `0.75` pass threshold produced and persisted `passed` with complete audit metadata.
- Confirmed all temporary replay API keys were revoked.
- Revised readiness to controlled `/doorcheck` testing; generic reviewer reports and curator bridge quality remain P1 work.

## Community-first routing and doorman voice — 20 August 2026

- Traced the latest live `Community` session and reproduced the premature jump into the artist route.
- Added deterministic recognition for explicit community intent, routing it to the enthusiast branch with an immediate `What does community mean to you?` clarification.
- Expanded runtime question-to-signal checks so artist, recommendation, feedback, participation, orientation, and contribution prompts cannot be silently stored under the wrong evidence goal.
- Added a runtime process-language guard for `before we wrap`, `before we finish`, `before we close`, `one last thing`, and `one last question`.
- Updated the COLORS prompt and persona documentation so Groucho behaves as an attentive, restrained doorman presence without exposing application mechanics or remaining evidence.
- Changed the default and live `Forum Application` closing message to `It was good getting to understand you better.`
- Added regressions for community orientation, the exact live routing failure, process-language removal, and artist/participation signal mismatch.
- Verified the full automated suite, TypeScript, focused lint, and diff checks.

## Reviewer and conversation follow-through — 20 August 2026

- Added deterministic evidence-backed terminal reports using persisted, branch-relevant answers and orientation state when the model report is missing or contains no evidence.
- Aligned advisory recommendations with the terminal outcome while preserving usable model-written report detail and safety flags.
- Preserved a grounded receipt from the applicant's answer when controller validation replaces a bridge or next question.
- Prevented strong participant orientations from becoming hybrid solely because of unsupported secondary model scoring.
- Persisted `application_insufficient_evidence` after two failed follow-ups and removed exhausted goals from future routing without marking them as covered.
- Added regression coverage for all four changes without introducing a database migration.

## Four-identity live verification — 20 August 2026

- Added `scripts/replay-colors-identities.ts`, a reusable synthetic artist, curator, enthusiast, and hybrid replay runner with scoped temporary API-key creation and guaranteed revocation.
- Confirmed all four primary identities completed as passed and produced evidence-backed reviewer reports with five or six evidence items.
- Confirmed the enthusiast branch asks what community means, avoids feedback, gathers concrete participation, and remains enthusiast.
- Confirmed the explicit maker-curator hybrid receives relevant questions from both branches.
- Found that artist and curator orientations can still over-promote to hybrid because broad vocabulary and participation-style answers count as second-orientation evidence.
- Found unblocked process narration in `Before we go further`.
- Captured an intermittent structured-question mismatch that can create an untagged current-session answer, disable compact guards, and display the neutral close while the session remains active.
- Recorded primary live response averages around 9.6–10.1 seconds and a maximum of 14.0 seconds.

## Positive reviewer calibration — 20 August 2026

- Added five client-confirmed `recommend` fixtures covering an active artist, a thoughtful listener, a constructive curator, a community-minded hybrid, and an intentional early-stage artist.
- Kept the calibration cases outside production question routing so they remain reviewer standards rather than scripted conversation paths or exact-phrase rules.
- Recorded neutral missing-information invariants: audience size, followers, release history or links, professional credits, industry affiliations, formal reviews, and moderation experience do not become negative community-fit evidence.
- Expanded the private COLORS reviewer rubric with branch-specific positive anchors for all five cases.
- Improved deterministic orientation recognition for naturally qualified maker language, early-stage “been making music” phrasing, playlist curation, artist introductions, and “finding new music.”
- Added a negation guard so “I'm not an artist” does not create artist evidence.
- Added calibration and orientation regressions using the client-provided wording.
- Extended the live identity runner with all five positive calibration profiles, expected recommendation matching, and semantic answer routing for paraphrased questions.
- Replayed all five profiles through the live `Forum Application`; artist, enthusiast, curator, hybrid, and early-stage artist all produced private `recommend` outcomes without treating reach or credentials as weaknesses.
- Removed a playlist false positive that could promote a thoughtful listener to hybrid and expose an irrelevant feedback route.
- Added an artist-reference prerequisite for the artist-to-song bridge and prevented rich off-target answers from satisfying the artist-reference intent.
- Prevented controller-added fallback questions from bypassing repeated-question checks.
- Replaced structured questions that do not match their displayed options with the signal's coherent structured prompt.
- Expanded valid contribution language to include reciprocal giving and concrete “take part” phrasing while retaining the guard against conditional “I'd take part if…” answers.
