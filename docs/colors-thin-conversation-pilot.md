# COLORS thin conversation pilot

The new conversation path is limited to **new COLORS demo sessions** started with
`GROUCHO_COLORS_THIN_PILOT=1`. A marker on the opening message keeps sessions
already using the previous engine on that engine. The public `/v1` route and its
required score fields are unchanged.

## Runtime boundary

The live model returns an applicant-facing reply, a close signal, a narrow
consent/safety boundary signal, and optionally approved media IDs. It does not
score answers, mark evidence coverage, or make a suitability decision. Its
instructions follow the [initial Forum membership brief](./colors-forum-membership-brief.md):
why the person came, their actual connection to COLORS and music, how they
participate in communities, what they hope to find or do, and an optional
TONES branch. One concrete answer can cover several purposes. Already-answered
purposes can be skipped or combined. Media remains optional.

The demo stores the transcript and interaction answers. A close stores
`sessions.status = 'completed'` with no suitability score or automatic decision.
The demo report request then audits process turns and source-linked integrity
concerns, reconciles evidence from the full transcript, generates and verifies
the reviewer report, and extracts a profile. A failed report remains retryable.
The report's recommendation is advisory.
The current thin pilot reconciles six post-conversation membership lenses:
joining motivation, COLORS connection, music relationship, community
participation, intended Forum participation, and optional TONES connection.
Unasked lenses stay unverified; lack of TONES familiarity or attendance cannot
create a material gap. Reports use `colors_forum_membership_report_v1`; older
thin reports are marked outdated and can be regenerated without another
conversation. The legacy five-lens rubric remains on older sessions.
Profile risk flags are limited to source-linked concerns from the post-conversation
audit; unspecified custom fields are omitted.
The pilot report uses `claude-sonnet-5-5` by default, with
`GROUCHO_COLORS_THIN_REVIEWER_MODEL` as an override. Legacy reports keep their
existing model selection. The profile and report must both succeed before the
report is marked ready.

## Activation order

1. Apply `supabase/migrations/20261007120000_completed_gatekeeper_conversation.sql`
   to the target database.
2. Deploy this code.
3. Set `GROUCHO_COLORS_THIN_PILOT=1` for the demo environment.
4. Start a **new** demo session; existing sessions retain their opening-message
   engine marker.

The migration must precede the flag. Without it, PostgreSQL rejects the new
`completed` status. No new demo session uses the thin path while the flag is
unset.

## Replay review

Review the conversation and report independently for each synthetic persona in
`docs/colors-pilot-persona-replays-2026-10-06.md`. The interactive harness is
`scripts/replay-colors-founder-interactive.ts`; use the demo settings and
answer adaptively from each persona brief. Do not force a fixed question list.

Conversation review: note whether Groucho follows a concrete answer, asks one
clear question, avoids repeated probes, uses media when it helps, handles a
consent concern promptly, and closes once there is enough to review. Compare
the routes across personas rather than expecting identical questions.

Report review: check each material claim against its cited applicant message,
keep completed conduct separate from future intention, treat unasked topics as
unknown, and confirm that the recommendation follows the verified record.
Check the profile for invented identity or practice claims separately.

The initial October 8 replays could exercise live turns but could not complete
an end-to-end demo report before the `completed` status migration. Their saved
synthetic transcripts were analyzed without changing session status using
`PILOT_REPLAY_REPORT_SESSION_ID=<id> PILOT_REPLAY_ANALYZE_UNCLOSED=1`.

| Persona | Conversation review | Separate report review |
| --- | --- | --- |
| Quiet listener (`f244a10b-7732-45b7-aa3f-d682fb292b42`) | Followed the person's voice-note exchange, listening example, and asynchronous participation. The last discovery question felt one beat longer than needed. No media was forced. | Verified report recommends, with a cited account of community exchange and contribution. Artist engagement stays unverified rather than being inferred from general listening. |
| Emerging artist (`0f47f283-5881-43ed-a437-b1dedbde71be`) | Followed unfinished work, a creative decision, feedback, and consent. One reply initially contained two questions; the one-question guard was added after that replay. | Verified report recommends, with source-linked artist and community evidence and no integrity flag. |
| Access-first promoter (`6ce23319-0330-4243-b7ab-4d32d731e2f8`) | Stated the prior-permission boundary on the first turn, asked one focused question, then attempted to close after the applicant refused. | Verified report advises decline on the applicant's own account of posting unreleased clips without asking and their stated intent to continue. It keeps community participation and reciprocal contribution unverified. |

The promoter's final refusal was supplied as an unpersisted diagnostic answer
because the connected database rejected the closing status. These are three
qualitative synthetic replays, not a measured naturalness or accuracy benchmark.

## Local activation verification

On October 8, migration `20261007120000_completed_gatekeeper_conversation`
was applied to the linked `groucho` Supabase project and verified in migration
history and the live `sessions_status_check` constraint. The ignored local
`.env.local` now contains `GROUCHO_COLORS_THIN_PILOT=1`. A new synthetic demo
session (`9dd9a0a8-37e9-4c22-a396-0d307569a5c9`) used the thin path,
closed as `completed` after two applicant answers, and produced a ready,
source-linked report and a saved profile. The report advised decline on the
applicant's explicit prior-permission statements; the profile retained only
the audited `artist_consent_violation` risk flag. This verification covers the
local demo process and its linked database. A hosted app still needs this code
and the flag in its own deployment environment.

## October 8 applicant replay follow-up

The latest local applicant session (`8337fba8-58fb-4f38-b543-b18e607294ef`)
showed a useful music-community example: a two-week Migos discussion changed
how the applicant appreciated the group. They also said they hoped to meet
interesting people and share music and references. Groucho then spent several
turns probing why they share and introduced a broad artist-permission scenario.
The saved report treated an uncertain answer to that scenario as a reservation.
There was no applicant-initiated disclosure of private or unreleased work.

The live prompt now recognizes when one answer covers multiple purposes, favors
closing once a concrete example and Forum hope or contribution are heard, and
reserves a consent boundary for a concern the applicant actually raises. The
target is about five answers with an eight-answer loop limit. The report prompt
and verifier now reject a reservation based only on Groucho's hypothetical.
The profile hint asks for a named song or artist before filling those specific
fields. The profile summary uses the verified report snapshot so a separate
extractor cannot reintroduce an unsupported concern. A replay of the same
transcript yielded a recommendation with no consent reservation; that corrected
report and profile were saved to the completed local session and read back. A
fresh local conversation reached a natural close after four answers without
the permission detour. These are qualitative checks.
