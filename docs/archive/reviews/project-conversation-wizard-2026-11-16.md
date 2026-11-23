# Client-created conversation wizard verification

16 November 2026. Local application build, authenticated synthetic tests in the Development organisation, shared engine using the configured `claude-haiku-5-5` model. Synthetic project and sessions were removed afterwards; cleanup was verified with a 404. No deployment was made.

Conversation quality question: **Will this change positively or negatively affect the conversation experience?** Expected positive effect: purpose, character, opening and topics become explicit, and clients can test their own configuration. Tradeoff: rigid topics and limits can produce an interview. The runtime accepts details out of order, treats refusals/uncertainty honestly, permits earlier completion and respects stopping. The UI describes its limit as visitor answers, including the opening and follow-ups, and explains incomplete endings.

## Complete-conversation review

Reviewed full synthetic exchanges, including all visible replies and final details, rather than only terminal assertions:

- A beginner wanting a breakfast bowl: the configured opening led into registered experience and multi-select questions; details were grounded in the visitor's answers and the conversation completed without approval or booking language.
- A visitor describing their sister's pottery, their own lack of experience and then correcting a mug to a small vase for their brother: the summary retained the visitor's experience and corrected their own intended object, without attributing the sister's hobby to them. The final runtime acknowledged the correction before showing the still-unanswered optional selector. An indirect refusal to continue ended without another question.
- A visitor asking for class prices, followed by a request to stop: the host acknowledged that no prices were supplied, did not invent a price or delivery, and stopped with incomplete required details.
- A one-answer limit with a booking question: the host explained that booking/availability was unavailable and closed at the configured ceiling, with `complete: false`.

The first review found two defects: choice composition discarded acknowledgements, and an indirect refusal could receive another wrap-up question. Client-authored flows now use a structured choice introduction and semantic visitor stopping intent. Existing authored demos retain their previous response contract. These controls were rechecked with the real model and deterministic failure tests. Model phrasing remains stochastic; this review is evidence for these samples, not a guarantee about every possible prompt.

## Browser and persistence

Checked desktop and 390px mobile layouts, labelled controls, choice buttons, pending state, completion, saving, reopening the project and editing its answer limit. An edit marked the old preview stale and disabled saving; restarting enabled saving again. Saved configuration restored all six controls.

The initial save exposed a stale organisation summary that hid the newly created project after navigation. The wizard now refreshes that summary before navigation. The edited project saved and returned to its integration page successfully.

Before executing any saved-project conversation, the project's sessions endpoint returned `sessions: []`, `total: 0`, despite completed wizard previews. The saved project was then exercised through the ordinary authenticated start/chat endpoints. Its exact opening, hashed project profile, early answers to later questions, `completed` status and `reviewStatus: not_required` were verified. No global persona record was required.

Preview tests cover actor/organisation isolation, origin checks, admin permissions, rate limiting, expiration, tampering, frozen configuration, retryable failure without transcript advancement, and identical model requests and visible responses between preview and stored-session execution. Preview execution does not access application storage or queue completion jobs. The saved custom runtime also does not queue assessment/delivery jobs.

## Checks

- Production build: passed (`pnpm build`).
- TypeScript: passed (`pnpm exec tsc --noEmit`).
- ESLint for every changed implementation file and the new tests: passed. Global generated-output exclusion remains `**/.next/**`.
- Full suite: 893 passed, 7 skipped, 3 failed. All three failures are the existing `loadtests/culture/routes.test.ts` synthetic completion-contract checks. They were reproduced in an isolated checkout of unchanged HEAD using the same installed runner. No load-test fixtures or existing assertions were weakened.
- Whitespace/diff check: passed.
