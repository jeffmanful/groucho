# COLORS cultural signals: five-phase plan

## Purpose and boundaries

Give COLORS an aggregate view of recurring cultural signals across applications without disclosing what any person said. This is project-level community memory, not applicant memory.

- Collection is off by default and enabled per project.
- Only completed, non-bot application sessions contribute.
- Raw answers are never copied into the signal store or dashboard.
- Events retain an internal source-message link solely so deletion cascades correctly.
- The dashboard uses a rolling 90-day window.
- Normal signals need 5 distinct sessions to appear; sensitive categories need 10.
- Repetition within one session cannot inflate a signal.
- Groucho cannot use this memory in conversations during the initial phases.
- Emerging themes require COLORS approval before joining the approved picture.
- Snapshots are versioned, but historical snapshots are erased when a source event is deleted.

## Phase 1 — Structured observation

Extract a curated set of signals while Groucho handles an application: artist references, creative disciplines, scenes or genres, participation style, community care, artist sustainability, discovery and curation, feedback and criticism, AI and authorship, and access or exposure.

Persist them only when a session completes. Record explicit evidence, reject low-confidence or overly descriptive labels, and do not infer protected or sensitive personal traits. Collection has no effect on the conversation.

Success gate: extraction is useful under manual review, deletion removes derived events, and no raw language reaches the aggregate surface.

## Phase 2 — Internal COLORS dashboard

Show authorised organisation members thresholded frequency bands, trend direction, eligible-session count, snapshot time, and a pending emerging-theme queue.

Omit responses, quotations, applicant names, source sessions, and drill-down links. Projects can opt in or out and rebuild after data-lifecycle changes.

Success gate: COLORS can identify useful patterns without reconstructing or singling out an applicant.

## Phase 3 — Emerging-signal review

Let the taxonomy grow carefully. A model may propose a broad theme, but it stays out of the approved picture until it crosses the privacy threshold and a COLORS administrator approves it. Reviewers can suppress noisy, narrow, sensitive, or misleading themes.

Success gate: the taxonomy becomes more culturally relevant without turning transient wording, identity proxies, or isolated opinions into product truth.

## Phase 4 — Conversation shadow mode

Test possible conversational uses without changing the applicant experience. Log which approved aggregate signal might have influenced question selection and compare that hypothetical choice with the actual conversation. Do not place cultural memory in Groucho's live prompt.

Evaluate depth, popularity bias, and whether minority or unfamiliar tastes receive equal room.

Success gate: reviewed evidence shows a meaningful benefit with no leakage, stereotyping, or homogenisation.

## Phase 5 — Limited conversation assistance

If shadow mode succeeds, allow only approved, thresholded, project-level signals to influence question selection—not evaluation, scoring, or decisions. Groucho may use a pattern to open a broad avenue but must never say or imply that other applicants mentioned it.

Use a separately controlled rollout, strict prompt boundary, audit trail, kill switch, and regular bias review. The feature should create more room for an applicant's point of view, never test conformity to a perceived consensus.

Success gate: conversations become richer while outcomes remain independent of aggregate taste.

## Initial implementation

The implementation covers phases 1 and 2 plus the review mechanism for phase 3. `conversation_use_enabled` is fixed to `false` in application code. The taxonomy is curated, snapshots are project-scoped and versioned, and derived events cascade from their source project, session, or message.

Before phase 4, COLORS should define an evaluation set, nominate reviewers, agree what is sensitive, and establish retention expectations for snapshots and source events.
