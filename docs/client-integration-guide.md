# Client Integration Guide

Groucho is the decision layer. Your client application owns accounts, permissions,
invitations, fulfilment, and any product-specific follow-up.

Use Groucho to run a conversational application, capture applicant identity, record
the transcript, and emit a decision:

- `passed`
- `redirected`
- `rejected`

Then let the host product decide what to do with that outcome.

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

In Next.js, the route implementation can share a forwarding helper and only vary
which environment variable supplies the API key.

```ts
import { NextRequest, NextResponse } from "next/server"

export async function proxyToGroucho(
  req: NextRequest,
  pathSegments: string[],
  apiKey: string,
) {
  const base = process.env.GROUCHO_API_BASE_URL!.replace(/\/$/, "")
  const url = new URL(`${base}/${pathSegments.join("/")}`)
  url.search = req.nextUrl.search

  const headers = new Headers(req.headers)
  headers.delete("host")
  headers.set("Authorization", `Bearer ${apiKey}`)

  const init: RequestInit = { method: req.method, headers }
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer()
  }

  const res = await fetch(url, init)
  return new NextResponse(res.body, {
    status: res.status,
    headers: res.headers,
  })
}
```

Forum proxy:

```ts
import { NextRequest } from "next/server"
import { proxyToGroucho } from "@/lib/proxy-to-groucho"

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params
  return proxyToGroucho(req, path, process.env.GROUCHO_FORUM_API_KEY!)
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params
  return proxyToGroucho(req, path, process.env.GROUCHO_FORUM_API_KEY!)
}
```

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
`session.completed` on your server.

Recommended host-side tables:

- `forum_applications`
- `competition_entries`
- `community_invites`

On webhook receipt:

1. Verify the webhook signature.
2. Read `payload.project_type`, `payload.session`, `payload.applicant`, `payload.outcome`,
   `payload.scores`, and `payload.profile`.
3. Upsert the host application record by Groucho session key.
4. Treat `outcome === "PASS"` only as an advisory signal that the application is
   ready for admin review. Never mark it approved from the Groucho outcome alone.
5. Record a separate human decision, then let the community admin dashboard send
   invites only to applicants explicitly approved by that decision.

Groucho should not directly grant forum access or competition entry unless the host
product explicitly builds that automation. The host app should remain the source of
truth for users, invites, roles, and permissions.

## Admin Dashboard Pattern

The forum admin dashboard should read from the host application's application
tables, not directly from Groucho's internal admin UI.

A useful dashboard row usually combines:

- applicant email and name
- application type (`forum` or `competition`)
- Groucho outcome
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
- Treat webhooks as the durable integration path.
- Keep access grants, invite emails, roles, and competition entry state in the host app.
