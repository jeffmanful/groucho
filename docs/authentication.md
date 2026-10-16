# Groucho authentication

Email/password and Google OAuth use Supabase Auth. Platform access requires a server-managed `app_metadata.groucho_role` of `platform_admin` and a confirmed email; ordinary authenticated users retain organisation-scoped permissions. User-editable metadata never grants platform access.

The requested core administrator, `jeff@cursive-studios.com`, has been provisioned in the configured Supabase project. Its password is stored by Supabase Auth, not in this repository. Signing in uses `/api/auth/login`, and logout clears Supabase and legacy cookies. Existing shared-password operators and isolated demo testers are retained for compatibility.

## Enable Google

1. In Google Cloud Console, select or create the Groucho project. Configure Google Auth Platform branding, audience and consent (openid, email, profile). While in testing, add the intended test users.
2. Create an OAuth client of type **Web application**. Add the deployed Groucho origin and development origin `http://localhost:3010` as authorised JavaScript origins.
3. Add this exact authorised redirect URI: `https://qqbvcmqzwtifpyufkxhh.supabase.co/auth/v1/callback`.
4. In the matching Supabase project's **Authentication → Sign In / Providers → Google**, enable Google and enter the client ID and secret. Keep the secret out of Git and client bundles.
5. Under **Authentication → URL Configuration**, set Site URL to the deployed Groucho origin. Allow the exact app callback URL `https://YOUR-GROUCHO-HOST/api/auth/callback` and local callbacks `http://localhost:3010/api/auth/callback` and `http://127.0.0.1:3010/api/auth/callback` when needed. Include callback query strings in the allowlist pattern as required by Supabase redirect matching.
6. Test Google login with the core admin and an ordinary user; check `/api/admin/session` returns platform only for the administrator. Check organisation access and logout. The Google provider remains disabled until credentials are configured; no end-to-end Google login has been claimed.

Google starts at `/api/auth/google`; PKCE code exchange happens in `/api/auth/callback`. Only local redirect destinations are accepted. Google authentication alone does not grant access to all organisations. Supabase normally links matching verified emails; confirm the resulting account/role during the admin Google test.

The password endpoint validates input and applies a per-email, per-process throttle in addition to Supabase's own auth rate limits. Distributed deployments should configure shared abuse protection. Provision additional platform administrators through a trusted server-side Supabase admin process, never a public signup request.

## Local OAuth setup status — 16 October 2026

Created Google Cloud project **Groucho** (`healthy-spark-511813-i8`) under Cursive Studios and web client **Groucho Web**. The client uses the hosted Supabase callback above and local origins on port 3010. Consent audience is External / Testing. No client secret is stored in this repository.

Supabase callback allowlist entries saved:

- `http://localhost:3010/api/auth/callback**`
- `http://127.0.0.1:3010/api/auth/callback**`

The suffix permits the callback's `next` query string; application code restricts its destination to local paths. The previous localhost:3000 invite entry is retained. Local callbacks remain allowed. The fallback Site URL is now the verified production origin (see below).

Google provider activation verified through Supabase Auth settings. End-to-end Google sign-in completed for `jeff@cursive-studios.com`, returning to `/admin`; `/api/admin/session` confirmed `kind: platform`. The Google identity linked to the existing administrator. Check the Google External / Testing audience includes any additional intended test accounts if Google denies access.

Local testing caught Next.js reconstructing the request URL with `localhost` even when the browser used `127.0.0.1`. OAuth handlers now preserve validated local Host headers in development so the PKCE verifier cookie stays on the same host. Production uses the request URL origin.

## Production configuration — 16 October 2026

Vercel project `verlay/groucho-gatekeeper` is connected to `jeffmanful/groucho` on `main`. Its production domain is `https://groucho-gatekeeper.vercel.app`, confirmed in the project dashboard. The similarly named `groucho` project at `demo.pstrn.xyz` tracks another repository and is not this deployment.

Supabase Site URL is set to the production origin, with `https://groucho-gatekeeper.vercel.app/api/auth/callback**` allowed alongside local callbacks. Google Web client includes the production origin; its authorised redirect URI remains the hosted Supabase callback. Released through PR #6 (`0f9c415`). End-to-end production Google login completed for `jeff@cursive-studios.com`; it returned to `/admin`, and `/api/admin/session` verified `kind: platform`.

Vercel was configured with Framework Preset **Other**, which published only `public` assets despite a successful Next build. Changed it to **Next.js** and redeployed the same authentication release using current project settings, without build cache. Preserve the Next.js preset for future deployments.

Verified corrected production deployment: `https://vercel.com/verlay/groucho-gatekeeper/FBDBZHfZojWUd4ss1K28yKPXy89w`. Login serves HTTP 200 with Google sign-in, and the production OAuth callback preserves the HTTPS production domain. The broader dashboard redesign is not included in this authentication-only release.
