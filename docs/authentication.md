# Authentication

Current supported paths, reviewed 3 November 2026. Source authority: `app/api/auth`, `lib/admin-actor.ts`, `lib/org-access.ts`, demo-token helpers and [dashboard access](admin-access.md).

## Identity and authorisation

Supabase email/password, email-link/code and Google OAuth authenticate identities. A confirmed identity alone does not grant platform access. Trusted `app_metadata.groucho_role` and/or active managed platform access determine administrator authority; user-editable metadata does not. Organisation members retain organisation-scoped permissions.

The shared `/login` screen is invite only. Password sign-in, the OAuth/email callback, protected-page proxy and server-side actor resolution require an existing organisation membership or an active platform grant. A pending invitation permits a verified matching identity to sign in only to its exact acceptance page; it grants no dashboard rights until accepted. Uninvited identities are signed out after password/OAuth sign-in and shown an invitation-required message. Provider authentication records alone never grant Groucho access.

Public organisation creation is retired: `/signup/organisation` redirects to the shared login and `POST /api/organisations/signup` always returns 403. Platform administrators create organisations through `/api/admin/organisations`, then invite clients. Organisation invitation email codes are sent by `/api/invitations/send-code`, which resolves a live unused token on the server and chooses its stored recipient. Acceptance requires the confirmed invited email and conditionally consumes the invitation before creating the membership; expired, used, cancelled or concurrently consumed invitations cannot create a grant.

Existing allowlisted shared-password operators remain a compatibility path, subject to their password and active access checks. They are not the recommended provisioning mechanism for new administrators. Managed invitations are documented in [dashboard access](admin-access.md).

`/api/auth/login` validates input and applies a per-email, per-process throttle as well as provider limits. Distributed abuse controls require deployment configuration. Logout clears relevant Supabase and legacy cookies. Redirect destinations must remain local paths.

## Protected demos versus public demos

`/demos` sign-in sends `demo: true`. Configured demo testers and authenticated authorised platform administrators can enter the protected demo hub. Confirmed administrators are checked against trusted `app_metadata` or active managed platform access; legacy operators still require their allowlist, password and access check. Ordinary organisation membership and user-editable metadata do not grant demo access. Administrators receive a signed expiring demo cookie carrying their own identity, which also carries through to COLORS conversation cookies; tester access does not become platform or reviewer permission. Successful login reloads the destination so server-rendered pages see the cookie.

The protected COLORS conversation additionally binds the selected session with its own signed cookie. Its sample report is a controlled reviewer demonstration, not a public applicant response. See [COLORS reviewer demo](colors-forum-demo.md).

The three public branded demos at `demos.grcho.com` use their own website controller and server project-key proxy. Their applicant email form is not a platform login. Do not apply protected tester cookies or admin credentials as their integration pattern.

## OAuth setup

1. Configure the intended Supabase project's Google provider and a Google web OAuth client. Store the client secret only in the provider/server configuration.
2. Register that Supabase project's exact provider callback, `https://<project-ref>.supabase.co/auth/v1/callback`, with Google.
3. Set Supabase Site URL to `https://admin.groucho.app` and configure the production return paths below, plus the exact development callbacks in use. Keep localhost/127.0.0.1 consistent for the PKCE cookie.
4. `/api/auth/google` starts the flow; `/api/auth/callback` exchanges the code. If Google's consent audience is still testing, include intended test users.
5. Verify login/logout, local redirect handling and `/api/admin/session` for both an administrator and an ordinary member. Google sign-in must not promote the ordinary member.

Configure `NEXT_PUBLIC_SUPABASE_URL`, public anon key, server-only service key and `AUTH_SECRET` for the same intended environment. See [database setup](database-setup.md). Do not copy a historical project callback or deployment ID without checking the current target.

### Production domain

The production dashboard is [admin.groucho.app](https://admin.groucho.app). The hosted Groucho Supabase project (`qqbvcmqzwtifpyufkxhh`) uses this origin as its Site URL. Its production redirect allowlist includes:

- `https://admin.groucho.app/api/auth/callback`
- `https://admin.groucho.app/api/auth/callback?**` (preserves the local `next` destination for Google and administrator email sign-in)
- `https://admin.groucho.app/invite/**` (organisation invitation email returns)
- `https://admin.groucho.app/signup/organisation`

These settings live in [Supabase URL Configuration](https://supabase.com/dashboard/project/qqbvcmqzwtifpyufkxhh/auth/url-configuration); `supabase/config.toml` configures the local development stack. Existing development and legacy Vercel callbacks remain allowed for compatibility. Keep production entries restricted to the auth paths; see [Supabase redirect URL matching](https://supabase.com/docs/guides/auth/redirect-urls).

The app derives callbacks and links copied from the dashboard from the request or browser origin. Supabase and legacy auth cookies are host-only: users sign in again on the new domain. Google's registered provider callback remains `https://qqbvcmqzwtifpyufkxhh.supabase.co/auth/v1/callback`, because Google returns through Supabase before returning to the app.

### Organisation invitation emails

**Send invitation email** is available after creating an invitation or reopening a pending link in **Members & settings**. Enable delivery with these server environment variables:

- `RESEND_API_KEY` with permission to send email.
- `GROUCHO_INVITATION_FROM_EMAIL` with a sender address on a domain verified in Resend.
- `GROUCHO_INVITATION_BASE_URL` with the public HTTPS dashboard origin for that environment. Use `https://admin.groucho.app` in production.

The dashboard keeps **Copy link** available if email delivery is unavailable. The invitation email contains the existing link. Sign-in codes still use Supabase Auth.

## Deployment verification

Use the Next.js framework preset and a deployment containing the intended environment values. A successful static-assets deployment is not proof that auth route handlers were published. Test the real deployed sign-in path, not only a build or provider toggle.

On 3 November 2026, live checks confirmed the new Vercel domain is verified, `/login` loads, protected pages return to its login screen, and Google sign-in creates a host-only PKCE cookie with an `admin.groucho.app` callback. Supabase accepted the callback (including `next`), organisation invitation and sign-up return paths using invalid-token error redirects without sending email. External `next` destinations fall back to `/admin`. These checks do not complete a real Google account sign-in or exercise email delivery.

The administrator demo-access fix is recorded in PR #9; it avoids treating an authorised administrator as a tester-password failure. This is implementation history, not a claim that every provider/account in every deployment has been configured or rehearsed.
