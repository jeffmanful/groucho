# Dashboard admin access

Platform administrators manage dashboard access at `/admin/access`. Organisation membership remains separate; a platform administrator can access every organisation and project.

## Invite and accept

Enter an email and choose **Create invitation**. Copy and share the resulting link with that person. This creates a shareable invitation; it does not automatically email the recipient. Each link expires after seven days. **Replace link** rotates the invitation and invalidates the previous link.

The recipient opens `/invite/admin/[token]`, signs in through Google, an existing Groucho password, or passwordless email, then explicitly accepts. Email sign-in uses Supabase's existing email template: a magic link or code as configured. Passwordless delivery requires working Supabase email delivery. A verified email matching the invitation is required; merely opening the link never grants access. Google remains subject to the configured consent audience.

## Manage access

The screen lists active admins, pending/expired invitations, removed accounts, and the current user. Search and status filters are available. Cancelling an invitation invalidates its link. Removing a managed admin takes effect on the next server authorization check, including existing sessions. Existing organisation memberships remain valid.

Trusted `app_metadata.groucho_role=platform_admin` accounts are core administrators and cannot be removed through this screen. A user cannot remove their own access. Legacy operators from `ALLOWED_EMAILS` can be removed; the access record then overrides the shared-password allowlist. To restore a removed legacy operator, invite them to authenticate with an individual account.

## Storage and permissions

`platform_admin_access` stores one access record per normalized email, a SHA-256 invitation hash, status, user ID, expiry, and invitation/acceptance/removal attribution. Raw invitation tokens are returned once when issued and are not stored. Only pending, unexpired tokens may be accepted; acceptance conditionally consumes the hash in the same database update. Replacement and cancellation invalidate old links.

The table has RLS enabled and no public policies intentionally: `anon` and `authenticated` have no table privileges. Only service-side handlers access it. Management endpoints independently require platform authorization. Managed grants are looked up on every server authorization check and matched to both verified email and user ID. Core metadata stays server-managed.

Migration: `supabase/migrations/20261016133943_platform_admin_access.sql` (applied to the configured Groucho project). Security verification confirms RLS and no anon/authenticated read access. The advisor's informational 'RLS enabled, no policy' finding is intentional for this service-only table: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Verification

Unit tests cover expiry, verified email, capability validation/hash storage and cross-origin mutation rejection. `scripts/test-admin-access.mjs` exercises the live handlers using a disposable `.invalid` account, without sending emails. Set `GROUCHO_TEST_ADMIN_EMAIL`, `GROUCHO_TEST_ADMIN_PASSWORD`, and optionally `GROUCHO_TEST_ORIGIN`; load the configured Supabase server environment. Never commit credentials.

Integration checks cover anonymous/member denial, wrong-email refusal, no access before acceptance, one-time acceptance, self/core protection, immediate revocation on an existing session, replaced tokens, expiry and cancellation. The script removes its synthetic account and invitations afterward. Real email delivery is not exercised by that test.

Released through PR #7 (`388096d`). Production screen: https://groucho-gatekeeper.vercel.app/admin/access . The full synthetic integration test passed against production; Google sign-in returned to this screen. Synthetic users and access records were removed afterward. An isolated production-server test confirmed that legacy removal blocks both existing cookies and shared-password re-login.
