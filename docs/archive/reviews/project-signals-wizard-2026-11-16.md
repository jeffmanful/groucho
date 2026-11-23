# Signal-based project wizard verification

16 November 2026. Builds on the project-owned conversation wizard, with version-2 signal authoring and evidence rendering. Existing version-1 project configurations and authored COLORS/demo profiles retain their runtime behaviour.

Conversation quality question: **Will this change positively or negatively affect the conversation experience?** Expected positive effect: clients define what they want to understand before specifying interview wording. The tradeoff is overfitting to supplied examples. Examples therefore remain illustrative; the prompt welcomes informal, occasional and online involvement, and no signal creates an acceptance rule.

## Implementation

Each signal contains a name, desired understanding, optional informative-evidence guidance and up to six example answers. A native disclosure contains optional exact wording and answer format. Choices have a server-registered catalogue; exact wording is optional even for choices. The opening derives from the first signal unless an older explicit opening override is retained. Existing version-1 questions can be edited as a version-2 draft without silently changing the saved project.

The shared runtime returns Evidence found, Partly understood, Not explored or Declined to share for every configured signal. Updates need a registered ID, applicant attribution and exact quotes from the current answer. Source links use stable applicant answer numbers. Corrections replace superseded interpretation and sources. Preview and persisted execution use the same model request, schema, normalizer and configuration hash. Only the latest preview transcript entry retains the accumulated evidence snapshot.

These checks validate quote presence and attribution labels, not semantic truth or independent verification. No scoring, acceptance decision, assessment job or webhook is introduced. Missing evidence remains unknown, and an honest incomplete conversation can close without filling every signal.

## Complete-conversation review

Reviewed complete synthetic conversations using the local authenticated preview endpoint and the configured `claude-haiku-5-5` model, inspecting all visible replies and successive evidence states:

- **Named gathering:** an applicant described attending Cedar Hall most Thursdays and welcoming newcomers because the group helped them settle. Quotes supported community participation; an optional hopes signal remained unknown until the applicant answered it. No event attendance was independently verified or promised.
- **Different valid experience:** neighbourly check-ins and grocery support were recognised as evidence despite differing from the event-based examples. The applicant could withhold the neighbour's name. A subsequent request not to say more ended the conversation.
- **Attribution and correction:** a sister's listening night remained outside the applicant's evidence. Their later online-group account was recorded, then removed when they corrected it as their brother's activity. The replacement state carried the correction quote and stayed unknown, rather than retaining the earlier account.
- **Partial understanding and uncertainty:** occasional online involvement produced Partly understood. The first run offered another topic after the applicant declined to say more. The signal-specific stopping contract was tightened: an ambiguous refusal ends the exchange unless the applicant explicitly continues elsewhere. The recheck closed without another question and preserved the partial/unknown states with `complete: false`.
- **One-answer budget:** uncertainty closed at the hard ceiling; unknown signals were not invented to make the conversation complete.

The review assesses continuity, warmth, useful follow-ups, attribution, corrections and stopping. Model phrasing remains stochastic; these samples do not guarantee every future conversation. The evidence inspector makes the underlying account and uncertainty visible to the client.

## Browser, persistence and verification

The browser walkthrough created a community-participation signal with two contrasting examples. Its exact question was blank; optional single-select controls supplied three configured options. The preview showed the same generated opening question and catalogue as the ordinary saved-session start endpoint.

Selecting informal help produced Partly understood with a quote linked to Answer 1. Describing neighbourly check-ins and groceries then produced Evidence found with quotes from Answers 1 and 2. Clicking Answer 2 navigated to the exact applicant message. The evidence inspector was visually checked at 390px width with no horizontal clipping.

The project saved as configuration version 2, preserving both examples, the blank optional question and selected answer format. Its sessions endpoint returned zero records after the wizard preview. A synthetic conversation was then exercised through the normal start/chat endpoints. It returned grounded signal evidence and completed with `reviewStatus: not_required`. Reading its stored transcript confirmed the evidence metadata and source turn references; custom sessions no longer carry a public-demo simulation marker.

The saved project was reopened in the wizard. Preview isolation, frozen configuration, retry behaviour, legacy compatibility and normal/preview request parity also have deterministic coverage.

Validation: 916 tests passed, 7 skipped. The same three pre-existing synthetic culture load-test failures remain; they were already reproduced against unchanged HEAD during the initial wizard work. TypeScript and changed implementation-file lint passed. No existing assertions or load-test fixtures were weakened.

The production build passed. The synthetic project and its test sessions were removed through the normal admin route, and a subsequent read confirmed 404. The local test browser/server were closed and temporary authentication state was removed. No deployment or database migration was made.
