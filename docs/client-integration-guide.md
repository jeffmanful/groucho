# Client Integration Guide

Groucho is the assessment and client-policy layer. Your client application owns
accounts, permissions, invitations, fulfilment, and any product-specific follow-up.

Use Groucho to run a conversational application, capture applicant identity, record
the transcript, and emit an advisory conversation outcome:

- `passed`
- `redirected`
- `rejected`

Groucho also stores a final suitability score and applies the project's deterministic
client policy. Final approval or decline comes from that explicitly configured policy
or a reviewer action—never from the model outcome alone. See
[Client-owned decision policy](./client-decision-policy.md).

## Recommended Model

For a community platform with more than one application type, create one Groucho
project per decision surface.

Example:

- `Forum Applications` — decides whether someone should be invited to join the forum.
- `Competition Applications` — decides whether someone should enter a competition.

Each project gets its own:

- API key
- persona and tone
- thresholds
- independent automatic acceptance and decline settings
- sessions and transcripts
- webhook configuration
- admin session list

This keeps decisions, analytics, and prompts separate without adding a special
`flowType` prop to the SDK.

## Host-Owned Session IDs

Mounting the SDK twice is a good pattern, but do not rely only on the SDK's default
session storage when you have multiple application surfaces.

Instead, have the host app create and persist a session ID for each application
attempt.

For signed-in users:

```ts
const forumSessionId = `forum-application:${user.id}:${forumApplicationAttemptId}`
const competitionSessionId = `competition-entry:${competition.id}:${user.id}:${entryAttemptId}`
```

For anonymous applicants:

```ts
function getOrCreateLocalId(key: string) {
  const existing = window.localStorage.getItem(key)
  if (existing) return existing

  const id = crypto.randomUUID()
  window.localStorage.setItem(key, id)
  return id
}

const forumSessionId = getOrCreateLocalId("groucho:forum-application")
const competitionSessionId = getOrCreateLocalId(
  `groucho:competition:${competition.id}`,
)
```

Use a new attempt ID when the product intentionally wants to let someone re-apply.
Keep the same ID across refreshes when the applicant is continuing the same attempt.

## Proxy Routes

Keep Groucho API keys server-side. For two projects, expose two proxy routes from
the client application.

Example:

- `/api/groucho/forum/*` attaches `GROUCHO_FORUM_API_KEY`
- `/api/groucho/competition/*` attaches `GROUCHO_COMPETITION_API_KEY`

In Next.js, each route can share one relay helper and only vary which environment
variable supplies the API key.

Proxy routes forward whatever path the browser asks for, so the key they attach
must be a **Conversations** key (the default when you create one). Never put an
Applications key behind a proxy: it can list applications and record decisions.
See [Reviewing applications from your own app](#reviewing-applications-from-your-own-app).

Use `createGrouchoRelay` from the SDK. It keeps the key on your server, only lets the browser reach
the applicant-facing endpoints, and forwards the applicant's IP, user agent and language so Groucho
can see entries that share a connection. Without it, Groucho only sees your server.

```ts
// lib/groucho-relay.ts
import { createGrouchoRelay } from "@groucho/sdk/server"

export const forumRelay = createGrouchoRelay({
  baseUrl: process.env.GROUCHO_API_BASE_URL!,
  apiKey: process.env.GROUCHO_FORUM_API_KEY!,
})
```

Forum route:

```ts
// app/api/groucho/forum/[...path]/route.ts
import { forumRelay } from "@/lib/groucho-relay"

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forumRelay(req, (await ctx.params).path)
}
export const POST = GET
```

The applicant's IP comes from your hosting platform's headers (Vercel, Cloudflare, Fly.io, Netlify,
then `X-Real-IP` and `X-Forwarded-For`). If your server isn't behind one of those, pass `clientIp` so
the browser can't choose its own:

```ts
createGrouchoRelay({ baseUrl, apiKey, clientIp: (req) => myTrustedIp(req) })
```

The relay never passes on cookies or your own auth headers, and it replaces any `X-Groucho-Applicant-*`
headers the browser sent. Groucho trusts those headers only on requests carrying your API key. IPs are
stored as keyed hashes, never as addresses.

If you call Groucho from your server yourself (for example `submitEntry` from your own form handler),
pass the applicant's connection:

```ts
import { applicantFromRequest } from "@groucho/sdk/server"

await groucho.submitEntry(entry, { applicant: applicantFromRequest(req) })
```

If you keep a hand-written relay, set the three headers yourself from the incoming request and strip
any the browser sent: `X-Groucho-Applicant-IP`, `X-Groucho-Applicant-User-Agent`,
`X-Groucho-Applicant-Language`.

Repeat the same route for competition with `GROUCHO_COMPETITION_API_KEY`.

## Mounting Two Sessions

Use one provider per proxy route. Pass explicit `sessionId` and `applicant` props
to each `<Gatekeeper />`.

```tsx
"use client"

import "@groucho/sdk/groucho.css"
import { Gatekeeper, GrouchoProvider } from "@groucho/sdk/react"

type Props = {
  user: { id: string; email: string; name?: string }
  competition: { id: string }
  forumApplicationAttemptId: string
  competitionEntryAttemptId: string
}

export function CommunityApplications({
  user,
  competition,
  forumApplicationAttemptId,
  competitionEntryAttemptId,
}: Props) {
  return (
    <>
      <section>
        <h2>Apply to join the forum</h2>
        <GrouchoProvider proxyBasePath="/api/groucho/forum">
          <Gatekeeper
            sessionId={`forum-application:${user.id}:${forumApplicationAttemptId}`}
            applicant={{ email: user.email, name: user.name }}
            transcriptLabel="Forum application"
            onOutcome={(outcome, meta) => {
              // Optimistic UI only. Persist access decisions server-side.
              console.log("forum outcome", outcome, meta)
            }}
          />
        </GrouchoProvider>
      </section>

      <section>
        <h2>Apply to enter the competition</h2>
        <GrouchoProvider proxyBasePath="/api/groucho/competition">
          <Gatekeeper
            sessionId={`competition-entry:${competition.id}:${user.id}:${competitionEntryAttemptId}`}
            applicant={{ email: user.email, name: user.name }}
            transcriptLabel="Competition application"
            onOutcome={(outcome, meta) => {
              // Optimistic UI only. Persist access decisions server-side.
              console.log("competition outcome", outcome, meta)
            }}
          />
        </GrouchoProvider>
      </section>
    </>
  )
}
```

If the applicant is anonymous, omit `applicant` and the default SDK UI will ask for
email and optional name before the conversation starts. If the host app already
collects identity elsewhere, pass `applicant` explicitly.

## Handling Decisions

Use `onOutcome` for immediate UI feedback only.

For durable application state, configure a Groucho webhook per project and process
`session.completed` and `application.decided` on your server. Read the session after terminal completion when
you need its latest `reviewStatus`, `suitabilityScore`, or `suitabilityBand`.

Recommended host-side tables:

- `forum_applications`
- `competition_entries`
- `community_invites`

On webhook receipt:

1. Verify the webhook signature.
2. Read `payload.project_type`, `payload.session`, `payload.applicant`, `payload.outcome`,
   `payload.scores`, and `payload.profile`.
3. Upsert the host application record by Groucho session key.
4. Treat `outcome === "PASS"` only as an advisory model signal. Never infer approval
   from the outcome, recommendation, or score alone.
5. Use `reviewStatus` as the decision state. When it is `pending`, let a reviewer
   approve or decline. When it is `approved` or `declined`, retain the human/policy
   decision source for audit.
6. Send invitations or grant host access only for `approved` decisions. If using
   Groucho's access endpoint, submit the matching approval secret.

An enabled automatic-acceptance policy can record approval and issue an access
secret, but the host app remains the source of truth for users, invites, roles, and
permissions. Automatic decline is a separate opt-in and does not have to be enabled
when automatic acceptance is enabled.

### Keeping in sync with every decision

The Groucho dashboard is always where access is controlled. Decisions can be made in
three places — a reviewer in the dashboard, your own app through the API, or your
automatic decision policy — and each one sends `application.decided` to every
webhook subscribed to it. Tick **Application decided** on the webhook in the
project's Keys & webhooks page (webhooks created before this event existed only
receive `session.completed` until you do).

Every delivery is a `POST` with:

- `X-Groucho-Event`: `session.completed`, `application.decided` or
  `application.decision_corrected`
- `X-Groucho-Delivery-Id`: unique per delivery; retries reuse it
- `X-Groucho-Signature`: `sha256=` + hex HMAC-SHA256 of the raw body, keyed with the
  webhook's signing secret

```ts
import { createHmac, timingSafeEqual } from "crypto"

export function verifyGrouchoSignature(rawBody: string, header: string | null, secret: string) {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`
  return header !== null && header.length === expected.length &&
    timingSafeEqual(Buffer.from(header), Buffer.from(expected))
}
```

An `application.decided` body:

```json
{
  "event": "application.decided",
  "id": "5c0e…",
  "occurred_at": "2026-10-27T10:42:00.000Z",
  "project": { "id": "…", "organisation_id": "…" },
  "session": { "client_session_key": "forum_app_123", "internal_id": "…" },
  "applicant": { "email": "maya@example.com", "name": "Maya" },
  "decision": "approved",
  "review_status": "approved",
  "decision_source": "human",
  "decided_by": { "via": "dashboard", "email": "sam@colors.example", "name": null },
  "reason": null,
  "advisory_recommendation": "recommend",
  "suitability_score": 0.82,
  "access_secret": "…"
}
```

- `decided_by.via` is `dashboard`, `api` or `policy`.
- `access_secret` is present only for approvals.
- `id` is the decision's id. Retries send the same id, so use it to ignore duplicates.
- Failed deliveries are retried with backoff.

## Reviewing Applications From Your Own App

You can build review screens into your own product — for example, letting Forum
moderators approve applicants inside the Forum — with the SDK's server client.

1. In Groucho, open the project's **Keys & webhooks** page and create a key with the
   **Applications** use. Store it as a server secret (for example
   `GROUCHO_FORUM_APPLICATIONS_KEY`), separate from the conversations key your proxy uses.
2. Call it only from server code, after checking that the signed-in user may review:

```ts
import { createServerClient } from "@groucho/sdk/server"

const reviews = createServerClient({
  baseUrl: process.env.GROUCHO_API_BASE_URL!,
  apiKey: process.env.GROUCHO_FORUM_APPLICATIONS_KEY!,
})

// Queue: ready_for_review by default, sorted by suitability.
const { applications, counts } = await reviews.listApplications({ queue: "ready_for_review" })

// One application with Groucho's reviewer report and the conversation.
const detail = await reviews.getApplication("forum_app_123")

// Approve or decline as the moderator. Declines need a reason.
const result = await reviews.decideApplication("forum_app_123", {
  decision: "declined",
  reason: "Joining mainly to promote paid services.",
  reviewer: { email: moderator.email, name: moderator.name },
})
```

- Groucho records the reviewer your server names, so authorise the user first.
- The first decision wins. If someone already decided in the dashboard, you get `409`
  with the existing decision. To change it, record a correction (below).
- The dashboard shows API decisions as made "in your app", with the reviewer's email.
- A Conversations key gets `403` from these endpoints, so a leaked proxy key cannot
  approve anyone.

HTTP equivalents: `GET /v1/applications`, `GET /v1/applications/{sessionId}` and
`POST /v1/applications/{sessionId}/decision` (see `docs/api/openapi.yaml`).

Pass `applicantReason` with a decision for a reason you may share with the applicant.
`reason` is your team's internal note. Both arrive in the webhook; Groucho never
contacts the applicant.

### Correcting a decision

Decisions are never edited. A correction is a new decision that replaces the current
one, with a reason, and the history keeps both. Corrections come from your side: your
organisation's owners and admins in the dashboard, or your app:

```ts
await reviews.correctApplication("forum_app_123", {
  decision: "declined",
  reason: "Turned out to be selling paid promotion to members.",
  expectedDecisionId: detail.decisions.at(-1)?.id, // 409 if someone changed it first
  reviewer: { email: moderator.email },
})
```

Approved → declined stops the access secret working; declined → approved returns a
new one. Groucho sends `application.decision_corrected` with a `supersedes` field
naming the decision it replaced, so your system can revoke or grant access. What you
tell the person is up to you.

### Reporting what happened next

Tell Groucho whether approved people were invited, joined and took part. This is how
Groucho measures whether the people it recommends actually join, and it shows on the
dashboard's Decisions page.

```ts
await reviews.reportOutcome("forum_app_123", { outcome: "invited" })
await reviews.reportOutcome("forum_app_123", { outcome: "joined", occurredAt: joinedAt.toISOString() })
```

Outcomes: `invited`, `joined`, `invite_declined`, `no_response`, `active`, `inactive`,
`left`, `removed`. Reports are append-only; sending the same outcome with the same
`occurredAt` twice is ignored, so retries are safe.

## Drops: Entries, Cohorts and Ballots

A drop takes entries with a form (a conversation is optional) and decides who gets a place.
Your team reviews entries in Groucho on the **Entries** page: bulk approve everything without
flags, and resolve flagged entries (same email, phone number or social account, or a
disposable email provider) one group at a time. Approved people are then placed in
**cohorts**, such as a ballot pool, guaranteed places for true fans, ballot winners and a
waitlist.

### Submitting entries

Use your conversations key, from your server or behind your host proxy:

```ts
await client.submitEntry({
  sessionId: entryId, // your key; resending it returns the first entry
  applicant: { email, name },
  phone,
  socials: [instagramUrl],
  fields: { size: "UK 9" }, // your drop's own questions
})
```

Tell people before they enter what you'll ask for and how places are given out. Groucho never
penalises a short entry; how much participation counts is your call.

### Running the ballot

Lock the pool when entries are reviewed. Then either:

- **Draw in Groucho.** One draw, or a separate draw per field value (for example per size).
  Everyone has one equal chance; Groucho records the locked list, the numbers and who ran it,
  and a cohort can be drawn only once. Everyone not drawn can go to a waitlist in draw order.
- **Run it yourself.** Export the pool as CSV, run the ballot in your own tool, and report the
  winners back with an applications key so Groucho stays the record of who entered and who
  was selected:

```ts
const { cohorts } = await reviews.listCohorts()
const winners = cohorts.find((c) => c.name === "Ballot winners")!
await reviews.addToCohort(winners.id, { sessionIds: drawn, reason: "Ballot run in our CRM" })
```

### Access and events

Once a project has cohorts, an access secret works only for someone in a cohort that grants
access, and only while their decision is approved. Subscribe your webhook to:

- `application.allocated`: one per person placed, moved or taken out. It says the cohort,
  the previous cohort, whether they now have access and, if so, their access secret. Tell the
  person what it means; Groucho never contacts them.
- `cohort.locked` and `cohort.drawn`: a pool was frozen, or a draw ran.

Correcting someone to declined takes them out of every cohort, and you get
`application.allocated` for that too.

## Admin Dashboard Pattern

The forum admin dashboard should read from the host application's application
tables, not directly from Groucho's internal admin UI.

A useful dashboard row usually combines:

- applicant email and name
- application type (`forum` or `competition`)
- Groucho outcome
- suitability score and band
- decision source (`human` or `policy`) and where it was made (`dashboard`, `api`, `policy`)
- profile summary
- transcript link or Groucho session key
- admin status (`pending_review`, `invited`, `declined`, `accepted`)

This lets admins invite selected emails while keeping Groucho focused on the
conversation and decision record.

## Rules of Thumb

- Use separate Groucho projects for materially different decisions.
- Use explicit host-owned `sessionId`s for every production application attempt.
- Use separate proxy routes or server clients for separate Groucho API keys.
- Pass `applicant` when the host already knows the user.
- Treat webhooks as the durable integration path, and subscribe to `application.decided`
  and `application.decision_corrected` so decisions made anywhere reach your app.
- Report outcomes (invited, joined, active) so Groucho can tell you whether its
  recommendations hold up.
- Keep Applications keys on your server; give proxies Conversations keys only.
- Treat `reviewStatus`, not the advisory outcome, as the application decision.
- Keep both automatic actions off until the client has deliberately calibrated its thresholds.
- Keep access grants, invite emails, roles, and competition entry state in the host app.
