# Protected COLORS reviewer demo

Current scope, reviewed 2 November 2026. `/demo/colors` demonstrates a COLORS conversation and a separate **sample reviewer report**. It is distinct from the three public brand simulations and the invitation-only Forum applicant pilot.

## Access and experience

An authorised platform administrator or configured demo tester enters through the protected demo hub/login. Signed expiring demo cookies do not grant organisation reviewer/admin rights. The server fixes the COLORS project and binds the chosen conversation to an HTTP-only session cookie; the browser cannot choose another project.

The applicant supplies intake, completes the newer COLORS conversation, receives a neutral closing, then sees a clearly disclosed sample private report. In a real applicant integration that report stays private. Artist/community modes share the engine and assessment pipeline; see [intake](artist-forum-application.md).

The report contains an evidence-backed summary, advisory recommendation, supported claims, reservations/unknowns and suggested reviewer action. It is generated from persisted applicant evidence, with grounding/verification. Failure is shown explicitly with a report-only retry rather than a generic fallback presented as a final opinion.

## Boundaries

- Demo completion suppresses automatic completion jobs, decisions and webhooks. A report is generated separately for demonstration; it does not accept/reject anybody or grant Forum membership.
- Missing evidence stays uncertain. Fame, fluency, geography, status and unfamiliar references are not substitute suitability evidence.
- A tester cookie does not authorise `/admin`, other projects or review decisions. A real platform administrator's existing authority is separate from demo access.
- Report generation/refetch must preserve project/session ownership and private evidence boundaries.

## Setup and verification

Use the current server demo-tester environment supported by the auth helpers (primary/additional tester pairs or extra-testers configuration) and independent secrets, or an authorised administrator identity. Keep passwords out of docs and share them only through an appropriate private channel. Configure backend Supabase/model/auth settings and deploy route handlers with the Next.js preset.

Check signed-out login/return, administrator and tester permissions, fresh artist/community sessions, active/completed restoration, visible sample-report disclosure, source excerpts, report-only retry and a second fresh attempt. Inspect that no automatic decision/completion job/webhook was created. Also check that an ordinary member/tester cannot obtain platform access.

Do not use the old October “pilot no-go” paragraph as today's launch status. Those failures and repairs are dated [historical evidence](archive/README.md). A new public launch still needs a deployed rehearsal for the intended environment. Real invited applicants follow [COLORS pilot](colors-admin-pilot.md), not this sample-report page.
