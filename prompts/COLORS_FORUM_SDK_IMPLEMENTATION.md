# COLORS Forum Groucho SDK Implementation Prompts

Verified against Groucho and the `/doorcheck` demo on 2026-07-24.

Use these prompts in order in the COLORS forum repository. They assume a React
application and include Next.js App Router examples where a server proxy is
required. If the host uses another framework, preserve the architecture and
adapt the framework-specific files.

## Current Integration Contract

- Package: `@groucho-gatekeeper/sdk@0.1.1-next.1`
- React component: `GatekeeperV2`
- Browser API pattern: same-origin host proxy
- Groucho API key: server-only `gk_*` secret
- Applicant identity: email collected before session bootstrap
- Applicant-facing terminal behavior: neutral configured thank-you message
- Durable decision source: verified `session.completed` webhook
- Forum account creation and invitation sending: owned by the COLORS forum

Do not install `@groucho-gatekeeper/sdk@next`; as of 2026-07-24 that tag still
points to an older prerelease. Pin the exact version above.

---

## Prompt 1: Audit The Host Repository

```text
We are integrating Groucho into this repository as the application flow for the
COLORS forum.

Before editing code, inspect the repository and report:

1. Framework, router, React version, package manager, and deployment target.
2. The existing forum application route and any application form/state.
3. Existing server/API route conventions.
4. Existing database schema and migration tooling.
5. Existing webhook verification patterns.
6. Existing invitation, email, and account-creation services.
7. Existing admin/reviewer surfaces.
8. Existing test tooling and browser/E2E setup.
9. Where global CSS is imported and how product theming is implemented.
10. Whether the app already knows an applicant email before the application.

Produce a short implementation map with exact files to create or change. Do not
make code changes yet.

Important product constraints:

- Applicants do not have forum accounts yet.
- We need their email so approved applicants can receive an invitation later.
- Groucho evaluates the application, but the COLORS forum owns review status,
  account invitations, roles, and permissions.
- Never render pass, redirect, or reject to an applicant.
- Every terminal path must show only Groucho's configured neutral thank-you
  message.
- Do not build onboarding. This integration is the gatekeeper application only.
```

## Prompt 2: Install The SDK And Add A Secure Proxy

```text
Implement the secure Groucho SDK foundation using the repository patterns found
in the audit.

Requirements:

1. Install exactly:

   @groucho-gatekeeper/sdk@0.1.1-next.1

2. Add server-only environment variables:

   GROUPCHO_API_BASE_URL
   GROUPCHO_FORUM_API_KEY

3. Never expose GROUPCHO_FORUM_API_KEY through a NEXT_PUBLIC_, VITE_, PUBLIC_,
   client bundle, rendered HTML, logs, or browser response.

4. Add a same-origin proxy route at:

   /api/groucho/forum/*

   It must:
   - forward the original HTTP method, query string, body, and content type;
   - remove the incoming Host header;
   - attach `Authorization: Bearer ${GROUPCHO_FORUM_API_KEY}` server-side;
   - forward upstream status, body, content type, request ID, Retry-After, and
     other safe response headers;
   - omit hop-by-hop headers such as transfer-encoding and connection;
   - return a controlled 500 response when required environment is absent;
   - never log authorization headers or applicant answers.

5. Add a small proxy helper if that matches the host's conventions. Keep the
   forum API key specific to this route so future Groucho projects can use
   separate keys.

6. Import `@groucho-gatekeeper/sdk/groucho.css` once at the appropriate app root.

7. Add tests proving:
   - the proxy attaches the server key upstream;
   - the key is not returned downstream;
   - query strings and JSON bodies are preserved;
   - non-2xx status and Retry-After are preserved;
   - missing configuration fails safely.

Use the host repository's package manager and formatting conventions. Run its
typecheck, lint, and focused tests when complete.
```

### Next.js App Router Reference

Use this only when it matches the host stack:

```ts
import { NextRequest, NextResponse } from "next/server"

async function proxyToGroucho(req: NextRequest, path: string[]) {
  const base = process.env.GROUPCHO_API_BASE_URL?.replace(/\/$/, "")
  const key = process.env.GROUPCHO_FORUM_API_KEY

  if (!base || !key) {
    return NextResponse.json(
      { error: "Groucho forum integration is not configured" },
      { status: 500 },
    )
  }

  const url = new URL(`${base}/${path.join("/")}`)
  url.search = req.nextUrl.search

  const headers = new Headers(req.headers)
  headers.delete("host")
  headers.delete("connection")
  headers.set("Authorization", `Bearer ${key}`)

  const init: RequestInit = { method: req.method, headers }
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer()
  }

  const upstream = await fetch(url, init)
  const response = new NextResponse(upstream.body, { status: upstream.status })
  upstream.headers.forEach((value, name) => {
    if (["connection", "keep-alive", "transfer-encoding"].includes(name.toLowerCase())) {
      return
    }
    response.headers.set(name, value)
  })
  return response
}
```

## Prompt 3: Build The COLORS Application Experience

```text
Implement the actual COLORS forum application route using:

  GrouchoProvider
  GatekeeperV2

from `@groucho-gatekeeper/sdk/react`.

Architecture:

- Wrap the application in:

  <GrouchoProvider proxyBasePath="/api/groucho/forum">

- Render `GatekeeperV2` as the primary experience, not inside a marketing landing
  page or decorative preview card.
- Keep `showOutcome={false}`.
- Keep the decision moment enabled.
- Do not provide opening questions or options client-side. The Groucho COLORS
  project configuration is the source of truth for question copy, order,
  structured options, and the terminal thank-you message.

Applicant identity:

- If this host already has a verified application email, pass:

  applicant={{ email }}
  collectApplicant={false}

- Otherwise omit `applicant` and leave `collectApplicant` enabled so
  GatekeeperV2 collects and validates email before creating the session.
- Do not require a forum account or forum authentication.
- Do not collect the email again after the application.

Session identity:

- Prefer an explicit host-owned application attempt ID if the repository already
  has application records.
- Otherwise allow GatekeeperV2 to create and preserve its session ID.
- Never reuse one session ID for two email addresses.
- Preserve an active attempt across refreshes.
- Create a new attempt only when the product intentionally offers “start over”
  or reapplication.

Applicant-facing behavior:

- Show one question at a time.
- Support text and single-select controls returned by Groucho.
- Disable duplicate submission while a request is active.
- Keep the email and answers out of analytics event properties and error logs.
- Show concise recoverable errors for network failures and 429 responses.
- Do not display scores, profile data, outcome enums, secrets, internal status,
  or access controls.
- On any terminal outcome, show only the configured Groucho closing message.
- Do not redirect to an access page and do not send an invitation directly from
  `onOutcome`.
- Use `onOutcome` only to switch the local UI to a generic “application
  submitted” state if additional host chrome is needed. Do not branch visible
  copy by outcome.

Expected project-configured COLORS flow:

1. What brought you here?
   Single select: Discover, Community, Share Work
2. Name an artist more people should know about. What would you want someone
   hearing them for the first time to notice?
3. What's the last song you recommended, and why did you think it was worth
   sharing?
4. Someone shares unfinished music that isn't really for you. How would you
   respond?
5. Which sounds most like you?
   Single select:
   - I mostly listen
   - I like discussing music
   - I enjoy giving feedback
   - I regularly share discoveries
6. What's one thing you could realistically contribute in your first month?

Groucho must never ask who received, was sent, or was recommended music.

Design:

- Integrate with the existing COLORS visual system.
- Preserve the focused, one-question `/doorcheck` rhythm and dot-matrix presence.
- Override SDK CSS variables/classes locally rather than editing node_modules.
- Keep controls accessible, keyboard operable, responsive, and free of layout
  shifts.
- Do not expose instructions, internal evaluation language, or implementation
  details in the interface.

Add focused component tests for email capture, session bootstrap, text answers,
single-select answers, loading state, generic completion, and error recovery.
Run typecheck, lint, component tests, and a production build.
```

### Minimal Component Reference

```tsx
"use client"

import {
  GatekeeperV2,
  GrouchoProvider,
} from "@groucho-gatekeeper/sdk/react"

export function ForumApplication() {
  return (
    <GrouchoProvider proxyBasePath="/api/groucho/forum">
      <GatekeeperV2
        showOutcome={false}
        decisionMoment
        onOutcome={() => {
          // Optional generic submitted-state analytics only.
          // Never branch applicant-facing UI on the private outcome.
        }}
      />
    </GrouchoProvider>
  )
}
```

## Prompt 4: Persist Completed Applications From Webhooks

```text
Implement durable COLORS forum application persistence using Groucho's
`session.completed` webhook. Do not treat the browser's `onOutcome` callback as
the source of truth.

Add or adapt a host-side table with fields equivalent to:

- id
- groucho_verdict_id, unique
- groucho_session_key, unique
- applicant_email
- groucho_outcome: PASS | REDIRECT | REJECT
- groucho_scores JSON, private
- groucho_profile JSON, private and nullable
- review_status: pending_review | approved | declined | invited | accepted
- submitted_at
- reviewed_at, nullable
- reviewed_by, nullable
- invited_at, nullable
- created_at
- updated_at

Webhook endpoint requirements:

1. Read the raw request body before JSON parsing.
2. Verify `X-Groucho-Signature`, formatted as `sha256=<hex>`, using HMAC-SHA256
   and GROUPCHO_FORUM_WEBHOOK_SECRET.
3. Compare signatures using a timing-safe comparison.
4. Reject absent or invalid signatures with 401.
5. Accept only the `session.completed` event.
6. Validate the payload shape before persistence.
7. Upsert idempotently using the webhook/verdict `id`.
8. Store `payload.applicant.email` as the invitation contact.
9. Store outcomes, scores, and profile as private reviewer data.
10. Return 2xx for already-processed valid deliveries.
11. Do not send invitations in the webhook request.
12. Do not log the raw payload, answers, email, signature, API key, or profile.

The webhook payload includes:

- event
- id
- occurred_at
- project
- project_type
- session.client_session_key
- session.internal_id
- session.status
- applicant.email
- outcome
- scores
- optional profile

Configure the webhook URL and signing secret in the Groucho Forum Applications
project. Add tests for valid signatures, invalid signatures, malformed payloads,
duplicate delivery, and persistence failure.
```

## Prompt 5: Add Reviewer Approval And Invitation Sending

```text
Connect completed Groucho applications to the existing COLORS reviewer and
invitation workflow.

Requirements:

- Only authorized forum reviewers can see private Groucho outcomes, scores,
  profile data, or transcript references.
- Add a review queue for completed applications with applicant email,
  submission date, private outcome, concise profile summary, and review status.
- Keep the forum database as the source of truth for review and invitation state.
- Do not automatically create an account from a Groucho outcome.
- Require an explicit reviewer action to approve and send an invitation unless
  the existing product has a separately approved automation policy.
- The invitation must use the `applicant_email` received in the verified webhook.
- Make invitation sending idempotent and prevent duplicate active invites.
- Record reviewer, review timestamp, invitation timestamp, and provider message
  ID where available.
- Use the existing invitation/email service and templates.
- Invitation acceptance may create or link the forum account; the application
  flow itself must not require an account.
- Applicant-facing application completion remains the neutral Groucho thank-you
  message. Do not reveal reviewer decisions inside the application route.

Add authorization tests, state-transition tests, duplicate-invite tests, and an
audit-log assertion. Run the repository's relevant database and integration
tests.
```

## Prompt 6: End-To-End Verification And Release

```text
Perform a production-readiness pass for the COLORS forum Groucho application.

Verify the real browser flow against the configured Forum Applications project:

1. A new applicant is asked for email before Groucho creates the session.
2. Invalid email is rejected locally.
3. The opening question is a three-option single select.
4. The remaining COLORS questions appear in the configured order.
5. “Which sounds most like you?” uses the four expected options.
6. Groucho never asks who received a recommendation.
7. Text and select answers survive normal rendering transitions.
8. Duplicate submission is blocked while requests are pending.
9. Refresh resumes the same active attempt.
10. A new attempt never reuses a session belonging to another email.
11. Every terminal path shows only the configured neutral thank-you message.
12. No pass, redirect, reject, scores, profile, secret, or access redirect is
    rendered.
13. The browser never receives the `gk_*` project API key.
14. Groucho API errors and 429 Retry-After responses degrade cleanly.
15. A valid completed-session webhook creates one application record.
16. Duplicate webhook delivery does not duplicate the application.
17. Invalid webhook signatures are rejected.
18. Reviewer approval sends one invitation to the captured email.
19. Application answers and applicant PII are absent from client analytics and
    server logs.
20. Mobile and desktop layouts have no overlapping or clipped controls.

Use the repository's browser/E2E tooling. Inspect the Network panel or captured
requests to confirm browser calls use `/api/groucho/forum`, not the Groucho
origin directly.

Run:

- typecheck
- lint
- unit tests
- integration tests
- E2E application flow
- production build

Document environment variables, webhook setup, database migration, rollback
steps, and the exact SDK version. Do not mark the work complete if the API key is
present in a client bundle or if any applicant-facing outcome differs by the
private Groucho decision.
```

## Host Environment Checklist

```text
GROUPCHO_API_BASE_URL=
GROUPCHO_FORUM_API_KEY=
GROUPCHO_FORUM_WEBHOOK_SECRET=
```

All three values are server-only. The forum application's public URL, analytics
IDs, and ordinary client configuration may use the host's existing public
environment conventions, but Groucho secrets must not.
