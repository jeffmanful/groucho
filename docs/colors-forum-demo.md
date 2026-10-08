# COLORS Forum reviewer demo

## Purpose

This demo exists to answer one question before any COLORS admin integration work:

> Does the Forum application conversation feel right, and does Groucho's final opinion give a COLORS reviewer something useful to act on?

The protected entry point is `/demo/colors`. A signed-out visitor is sent to login and returned to that same page after authenticating.

## What Philipp will experience

1. Log in with the configured COLORS demo tester email and a separate demo password.
2. Enter an applicant email and complete the existing COLORS Forum conversation.
3. See the neutral applicant closing message.
4. See a clearly separated **Sample reviewer report** containing:
   - a concise, evidence-backed applicant snapshot with consistent tags;
   - Groucho's advisory recommendation;
   - a concise applicant bio and overall assessment;
   - the decisive reasons for the view;
   - claim → source evidence → interpretation chains;
   - likely contribution, reservations and questions for a human reviewer; and
   - a suggested human action.

The page explicitly states that applicants would not see this report in a real application. The report remains advisory and does not accept or reject anybody automatically.

## Demo safeguards

- The demo route and its API use a separate signed tester cookie. A tester cannot use platform-admin endpoints.
- Demo tester addresses are explicitly denied platform-admin access even if an old `ALLOWED_EMAILS` entry remains. Without a configured demo password, a tester login fails closed.
- Each demo session is bound to a second signed, HTTP-only cookie. The server resolves only the COLORS `forum-application` project; the browser cannot choose another project.
- Demo completion does not run the automatic decision, completion-job or webhook path.
- The private opinion is generated after the applicant closing message, saved to the final message, and can be fetched again after refresh. A failed generation offers a report-only retry.
- The final reviewer pass may use only persisted, source-linked applicant evidence. A separate semantic verifier rejects unsupported or upgraded claims before the report is shown.
- Conversation coverage and conditional relevance come from Claude's interpretation of the applicant's meaning, expressed as validated project signal keys; word-list matches do not decide them.
- Safety and integrity flags remain server-controlled and provenance-linked rather than being invented by the report model.
- Missing information is treated as uncertainty, not negative evidence.
- Writing quality, English fluency, fame, audience size, industry access and familiarity with particular artists are not assessment criteria.
- If detailed report generation fails, the demo shows an explicit error, not a generic report presented as a finished opinion.

## Deployment setup

Before sharing the link:

1. Confirm the production project slug is `forum-application`, belongs to COLORS and has the intended early-application signals and copy.
2. Set `COLORS_DEMO_TESTER_EMAIL=philipp@colorsxstudios.com` and a strong, independent `COLORS_DEMO_PASSWORD`. Remove Philipp from `ALLOWED_EMAILS`; that list grants platform-admin access.
   An optional second demo-only login uses `COLORS_DEMO_ADDITIONAL_TESTER_EMAIL` and `COLORS_DEMO_ADDITIONAL_TESTER_PASSWORD` in the server environment. Keep its password independent and strong before sharing a public deployment.
3. Share the demo password through a secure channel. Do not put credentials in this repository or in the invitation email.
4. Ensure the Anthropic key is configured. `GROUCHO_REVIEWER_MODEL` is optional; it defaults to the existing low-cost Anthropic model.
5. Deploy, open `/demo/colors` in a signed-out browser and complete one realistic conversation.
6. Confirm the report disclaimer, source quotations, recommendation and suggested action all render clearly on desktop and mobile. Refresh after completion and retry after a simulated reviewer-model failure.

## Acceptance checklist

- [ ] Direct demo link survives login and returns to `/demo/colors`.
- [ ] The Forum project is selected even if another project was previously saved in the browser.
- [ ] Tester-only settings are absent from the demo.
- [ ] The existing COLORS conversation completes without regression.
- [ ] The sample-report disclosure is visible before the opinion.
- [ ] The compact snapshot gives a useful applicant summary, tags, primary strength, open question and suggested action before the full assessment is expanded.
- [ ] Every assessment claim displays at least one exact source excerpt.
- [ ] Recommendation and suggested human action do not contradict one another.
- [ ] Starting a second test creates a fresh session.
- [ ] A failed reviewer-model call shows an explicit report error and a report-only retry.
- [ ] The tester cannot access `/admin` or other projects, and a completed demo creates no automatic decision or completion job.

## Current verification status (1 October 2026)

- Production build and TypeScript checks pass; the repository's automated suite passes.
- The [1 October semantic-routing live replay](./colors-semantic-routing-live-replay-2026-10-01.md) completed all 78 Claude calls without infrastructure or schema failures. It found conversational pilot blockers in structured-input overrides, current-turn coverage provenance, one premature concern close and long-memory correction handling. External pilot status is therefore no-go until those P0 items are fixed and replayed.
- The configured database contains the `COLORS` organisation and `forum-application` project.
- Browser sign-in, three fresh persona runs, report quality review, refresh and retry still require a running deployment. The local workspace cannot bind a web-server port.
- A separate demo password must be configured in the deployment environment before the link can be shared. The local ignored environment file was not changed by this implementation.

## Explicitly out of scope

- COLORS admin dashboard integration
- reviewer queues, permissions or workflow
- applicant access to reports
- automated accept/reject actions
- production notifications, exports or analytics
- broad changes to the Groucho conversation engine

Those should follow only after COLORS gives a green light on the flow and sample report.
