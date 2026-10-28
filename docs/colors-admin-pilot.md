# COLORS pilot: invitation-only Forum applications

28 October 2026. Applicants complete Groucho inside the Forum. COLORS reviews
assessments and records decisions in Groucho admin, then handles outcome
communication and Forum access separately.

## Prepared configuration

The isolated COLORS project is `forum-application-pilot`
(`95c2a485-ab20-4938-bc37-e2d9f6818dda`). Its newer `colors_forum` engine uses the
COLORS persona and explicit manual review: automatic acceptance and decline are
off, and `application_invitation_required` is true. It has no webhook
subscriptions or cohorts. Historical Forum projects and their queued webhook
deliveries are unchanged.

The service-only `application_invitations` table stores token hashes, recipient,
audience, expiry, revocation, issuing reviewer and one fixed conversation key.
Migration: `20261028082435_application_invitations.sql`. Anonymous and authenticated
Supabase clients have no table privileges; admin and server API checks mediate use.
`scripts/configure-colors-pilot.ts` prepares equivalent isolated projects, defaults
to dry run and never overwrites an existing project.

## Deployment and invitations

1. Deploy Groucho's invitation endpoints, admin assessment recovery and migration.
2. Deploy the Forum integration with the bundled SDK candidate documented in
   `a-colors-forum/vendor/groucho-pilot-sdk.md`. Set server-only
   `GROUCHO_API_BASE_URL` to Groucho and `GROUCHO_FORUM_API_KEY` to a
   **conversations** key created for **COLORS Forum pilot**. Keep keys out of
   `NEXT_PUBLIC_*` variables. Existing Supabase, model and admin auth configuration
   must be valid. Completion routes need a hosting plan supporting 300 seconds.
3. Enable `GROUCHO_FORUM_PILOT_ENABLED=true` in the Forum deployment after rehearsal.
   Its default is closed. Disabling it closes both entry and proxy requests while
   preserving saved applications in Groucho admin.
4. A COLORS organisation admin opens the pilot project's **Keys & webhooks** tab and
   creates an **Application invitation** with recipient email and Community or
   Artist audience. Copy its private link before leaving: plaintext links are
   shown once, expire after seven days and can be revoked. Groucho does not email
   them. The project's optional `application_url` must point to the intended Forum
   `/apply` URL; the default is `https://forum.colorsxstudios.com/apply`.
5. Share each link privately with its intended applicant. The link opens `/apply`
   with a private fragment, which is removed immediately and exchanged for an
   HTTP-only cookie. Plain `/apply`, guessed session IDs and direct proxy starts
   cannot open a conversation. The API fixes recipient email, audience and session;
   the form cannot create another application from that invitation.

These are bearer invitation links: whoever possesses a valid link can open the
assigned application. They are not email ownership verification. If identity
verification is required for the batch, add authenticated email verification
before launch. Protect the links like other private application links.

## Applicant and reviewer boundaries

The Forum checks current expiry and revocation on page load and every session
read/start/message. Revocation also blocks continuation by a browser that already
redeemed the invitation. One invitation resumes the same conversation, including
its completed state, rather than making a duplicate on refresh. Applicants cannot
choose another project, persona, audience or recipient. The browser-facing relay
returns only conversation/intake fields and neutral completion copy. Reports,
profiles, real scores, reviewer decisions, notes and access secrets stay private.

Completion queues the existing durable completion job using `after()`. Its report,
profile and suitability score use the same verified evidence pipeline. The admin
application page shows unknowns, claims, supporting quotes, interpretation and
reservations. **Generate assessment**, **Retry assessment** and **Update assessment**
recover a saved conversation without recording a decision or sending a webhook.
An existing current report can repair a missing score without another model call.
A five-minute lease prevents concurrent regeneration. The current membership
report version is v8, reflecting the approved 19 October Forum launch scope.

Organisation members can read applications; owners/admins can decide, recover
assessments and manage invitations. A demo tester account alone has no reviewer
access. COLORS records approve/decline and reasons in admin. An application
invitation authorizes a conversation; an approval records a human decision.
Neither action itself sends an outcome message or grants Forum membership.

## Rehearsal and remaining launch work

Complete the deployed journey with a synthetic invitation: bare URL denied →
invite redeemed → intake → conversation → refresh restores → private assessment →
human decision. Also check invalid, expired and revoked links, recipient/session
mismatch, outage retry and completed restoration. Confirm the designated COLORS
reviewer can sign in, agrees the rubric and owns queue checks, turnaround and
manual outcome/access fulfilment. Deployment credentials, enabling the flag,
reviewer sign-in and that deployed rehearsal remain operational launch steps.

Start with a supervised batch. Record completion, repeated questions, provider
failures, unsupported report claims, reviewer disagreement and review time. A
suitability score is advisory and is not a calibrated probability of fit. The
current per-process rate limiter is not a distributed abuse-control service.

## Verification recorded on 28 October

- Groucho: 711 tests passed, 2 skipped; strict TypeScript and changed-source lint
  passed. SDK JavaScript/declaration build and separate strict type check passed.
- Forum: 11 focused tests passed, strict TypeScript passed, frozen offline install
  passed, production build passed. Both repositories passed `git diff --check`.
- Real browser: invited intake inside Forum, locked email, active and completed
  refresh restoration, mobile completion, private admin assessment and authorized
  invitation controls. Both production builds were checked locally.
- Live-backed synthetic checks: missing invitation, cross-origin exchange,
  wrong session/email/audience, expiry and post-redemption revocation all denied;
  assigned invitation/start succeeded. Reports and decisions stayed private.
- The synthetic conversation completed its report/profile/score job using v8.
  Manual decision saving and assessment recovery were also rehearsed locally.
  Test sessions/invitations were removed and the temporary API key was revoked.
  No applicant email, real membership grant, app deployment or SDK publication
  was performed.
