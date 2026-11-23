# Forum Application migration — 23 November 2026

## Delivered

Migrated the existing COLORS **Forum Application** in place to the project wizard. Added **Edit project** in the overview header and used the same label in the Projects list and project integration navigation. These management actions retain existing permission checks.

- Organisation: `8f945897-31bf-4072-9aad-1c02e090e6dd`.
- Existing project: `e9e6aa45-5ef3-4ec3-9451-1703d32abed3`; slug `forum-application`.
- Editor: https://admin.groucho.app/admin/organisations/8f945897-31bf-4072-9aad-1c02e090e6dd/projects/e9e6aa45-5ef3-4ec3-9451-1703d32abed3/edit
- Production deployment: `dpl_EAEJjsqjcY4Wdp9JbyqFySXoZo5E`, READY, from release commit `3d291a47452a629c080ec605031415227df51baa` on `codex/project-conversation-wizard`.
- Production code was staged and checked before promotion; project settings were migrated afterward using the authenticated, optimistic-concurrency-checked admin PATCH route, which records the previous/new settings in project settings audit history. No schema migration ran.

## Conversation-quality gate and configuration

Will this change positively or negatively affect the conversation experience? Expected positive effect: client ownership of the opening, purpose, context, persona, progression, signals/examples and ending. Tradeoff: the conversation follows semantic signals rather than the older ordered prompts, and evidence interpretation remains model-dependent. Preserve reporting and continuity instead of replacing the application with a conversation-only demo.

Kept the original opening question **What brought you here?**, opening options **Discover / Community / Share Work**, nine-answer ceiling and default closing statement. The inline persona retains Groucho's existing calm, observant voice and removes in-conversation private judgement instructions because assessment is separate. Approved project context comes from the existing COLORS membership brief, including its limitations on planned features and TONES knowledge.

Six editable signals organise the Forum evidence goals:

1. Joining motivation.
2. Relationship with COLORS.
3. Music and discovery.
4. Community participation.
5. Care and reciprocity.
6. Forum hopes and contribution.

Examples include informal and online/offline participation and honest uncertainty. Names/venues can add detail but are not verification or requirements. Only the opening signal has fixed wording and preserved options; other question wording/formats remain optional. New custom signal conversations support text and registered single/multi-select choices; the older media-choice handling remains with legacy conversations.

## Application processing and continuity

`applicationReview: colors_forum` opts this version-2 configuration into the existing private COLORS membership assessment, decision-policy, verdict and configured webhook pipeline. A generic custom conversation still skips this processing. The mode does not author a new arbitrary scoring rubric: COLORS membership reporting remains a separate stage, and the final membership decision belongs to COLORS.

New application conversations carry the COLORS engine marker and a project configuration profile. Their opening metadata stores the server-authored configuration snapshot so later turns keep the original persona, context, signals and budget after project edits. Legacy sessions keep the engine they started with. Saving an application configuration omits `application_experience` from its patch, retaining the legacy questions/options needed by old sessions. Older browser tabs that omit the application-processing flag receive 409 rather than silently disabling review.

Stateless previews use the same conversation configuration while disabling application storage, completion jobs and webhooks. No real applicant messages or decisions were changed for verification, and no test webhook deliveries were sent.

## Live data verification

Before the settings write, re-read the project and confirmed it still matched the prepared backup. Afterward, fetched it again and compared every original setting value by deep equality; all matched. Only the new engine/profile/configuration settings were introduced. Original review objective, decision policy, thresholds, environment/session mode, persona reference and legacy experience values were retained. The shared persona record was not edited, so another project using it was not changed.

Verified the same project ID/slug, four registered webhook records and 58 API-key records. Session total was **344 before and after**. No existing sessions, cohorts, keys or webhook records were migrated or deleted. The original settings are available in the admin API's project-settings audit record; a private local backup is `/tmp/groucho-forum-before.json`. Because the stale-form guard intentionally prevents removing application processing through ordinary conversation setup, an operational rollback of the data should restore the audited settings through a deliberate administrator data operation, together with a compatible code deployment.

## Complete staged conversation review

Reviewed continuity, warmth, curiosity, useful contribution, attribution and corrections. The host followed the music-sharing thread, answered a planned-feature question without guaranteeing availability, replaced online participation with the corrected in-person account, and closed without another question or admission promise. Some replies exceeded the requested concise style and used mild generic praise; no phrase-specific rewriting was added. Signal states remained honest partial/known interpretations rather than acceptance decisions.

**Groucho:** What brought you here?

**Synthetic applicant:** Community. I want to find people who enjoy talking about music beyond just sending a link. I watch COLORS performances because the stripped-back setting lets me hear small details in a voice. I share music with two friends in an online listening group.

**Groucho:** That sounds like a real appetite for conversation, not just links. I'm curious about the listening group with your two friends: when one of you shares something, what usually happens next?

**Synthetic applicant:** I usually ask what caught their ear and listen for that before giving my reaction. Once a friend helped me notice the bass in a track I had dismissed. I would like to bring that kind of curious exchange to the Forum. Are Scenes guaranteed to be available when I join?

**Groucho:** Scenes isn't guaranteed to be available to you when you join. The planned launch includes Scenes (Beta) with Scene chat, but not every feature is enabled in the pilot, and I don't know what will be live for you. Your friend opening your ear to the bass sounds like the kind of exchange you'd bring here. What would you most like to find in a conversation like that?

**Synthetic applicant:** A small correction: the listening group meets in person, not online. We take turns choosing a track and sharing what we noticed. I would like to start by listening and sharing an occasional discovery in the Forum. Please stop here; that is all I wanted to add.

**Groucho:** Thanks for the correction, an in-person group that takes turns choosing tracks is a lovely way to listen.

It was good getting to understand you better.

Final signal states: s_joining=evidence_found, s_colors=partly_understood, s_music=evidence_found, s_community=evidence_found, s_reciprocity=partly_understood, s_contribution=evidence_found.

## Verification

- 182 targeted tests passed across nine files: configuration validation, application-mode queueing, preview isolation, legacy routing, startup snapshots, pinned conversations, stale-save protection and existing completion/report processing.
- Full suite in the isolated release checkout: **921 passed, 7 skipped, 3 failed**. The same existing synthetic culture route load-test failures at 2/100/200 users remain (unexpected synthetic completion/missing details), previously reproduced against unchanged HEAD during the original wizard work. No load-test fixtures or assertions were changed.
- TypeScript and changed implementation/test lint passed; `**/.next/**` lint ignores retained.
- Both staged production builds reached READY; the final build took about 26 seconds. No production environment values were changed.
- Full real-model staged conversation and final application-mode stop smoke passed. Report/decision/webhook dispatch was checked with existing automated completion tests; actual downstream delivery was not exercised.
- Browser check on the live domain: overview's Edit project link opened the wizard; verified all five steps, original opening/limit, six migrated signals and examples, and start/stop in the live stateless preview. The wizard draft was not saved again during this read/preview verification.
- Screenshot: `output/playwright/forum-migrated-flow.png`.
- Production error/fatal log scan found no matching records. This is a release smoke check, not a continuous monitoring guarantee.
- The staging automation bypass created by the CLI was revoked; deployment protection was unchanged. Temporary browser/authentication state was removed. Philip's demo-only permissions were not changed.

Unrelated privacy work in the original workspace remained excluded from the release. Source is pushed on the release branch; main was not merged or advanced.
