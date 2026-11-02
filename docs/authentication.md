# Authentication

Current supported paths, reviewed 2 November 2026. Source authority: `app/api/auth`, `lib/admin-actor.ts`, `lib/org-access.ts`, demo-token helpers and [dashboard access](admin-access.md).

## Identity and authorisation

Supabase email/password, email-link/code and Google OAuth authenticate identities. A confirmed identity alone does not grant platform access. Trusted `app_metadata.groucho_role` and/or active managed platform access determine administrator authority; user-editable metadata does not. Organisation members retain organisation-scoped permissions.

Existing allowlisted shared-password operators remain a compatibility path, subject to their password and active access checks. They are not the recommended provisioning mechanism for new administrators. Managed invitations are documented in [dashboard access](admin-access.md).

`/api/auth/login` validates input and applies a per-email, per-process throttle as well as provider limits. Distributed abuse controls require deployment configuration. Logout clears relevant Supabase and legacy cookies. Redirect destinations must remain local paths.

## Protected demos versus public demos

`/demos` sign-in sends `demo: true`. Configured demo testers and authenticated authorised platform administrators can enter the protected demo hub. Administrators receive a signed expiring demo cookie carrying their own identity; tester access does not become platform or reviewer permission. Successful login reloads the destination so server-rendered pages see the cookie.

The protected COLORS conversation additionally binds the selected session with its own signed cookie. Its sample report is a controlled reviewer demonstration, not a public applicant response. See [COLORS reviewer demo](colors-forum-demo.md).

The three public branded demos at `demos.grcho.com` use their own website controller and server project-key proxy. Their applicant email form is not a platform login. Do not apply protected tester cookies or admin credentials as their integration pattern.

## OAuth setup

1. Configure the intended Supabase project's Google provider and a Google web OAuth client. Store the client secret only in the provider/server configuration.
2. Register that Supabase project's exact provider callback, `https://<project-ref>.supabase.co/auth/v1/callback`, with Google.
3. Set Supabase Site URL to the intended deployed application origin and allow its `/api/auth/callback` plus the exact development callbacks in use. Keep localhost/127.0.0.1 consistent for the PKCE cookie.
4. `/api/auth/google` starts the flow; `/api/auth/callback` exchanges the code. If Google's consent audience is still testing, include intended test users.
5. Verify login/logout, local redirect handling and `/api/admin/session` for both an administrator and an ordinary member. Google sign-in must not promote the ordinary member.

Configure `NEXT_PUBLIC_SUPABASE_URL`, public anon key, server-only service key and `AUTH_SECRET` for the same intended environment. See [database setup](database-setup.md). Do not copy a historical project callback or deployment ID without checking the current target.

## Deployment verification

Use the Next.js framework preset and a deployment containing the intended environment values. A successful static-assets deployment is not proof that auth route handlers were published. Test the real deployed sign-in path, not only a build or provider toggle.

The administrator demo-access fix is recorded in PR #9; it avoids treating an authorised administrator as a tester-password failure. This is implementation history, not a claim that every provider/account in every deployment has been configured or rehearsed.
