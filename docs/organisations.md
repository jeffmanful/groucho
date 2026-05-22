# Organisations

Organisations are the top-level tenant boundary in Groucho. They group members, invitations, projects, API keys, webhooks, sessions, messages, and verdicts.

An organisation answers: who owns this configuration and who is allowed to operate it?

## Data Model

Core tables:

- `organisations` stores `id`, `name`, `slug`, and timestamps.
- `organisation_members` links Supabase Auth users to an organisation with a role.
- `invitations` stores pending email invites and the role to grant when accepted.
- `projects` belong to one organisation.
- `api_keys`, `webhooks`, `sessions`, `messages`, and `verdicts` are scoped through `organisation_id` and usually `project_id`.

Roles:

- `owner` can administer the organisation and invite other owners.
- `admin` can administer organisation configuration, projects, keys, webhooks, and invites.
- `member` can view organisation resources but cannot perform admin writes.
- Platform admins bypass org membership checks.

## Access Rules

The current server-side checks are:

- `requireOrgMember` for reading organisation details, projects, members, invitations, keys, webhooks, and sessions.
- `requireOrgAdmin` for editing organisations, creating projects, editing projects, creating keys, creating webhooks, and sending invitations.
- `requireOrgOwner` for member users deleting an organisation.
- `requirePlatform` for platform-only actions, such as creating organisations through the platform admin route.

Invited members accept invitations through the invite flow. The user must sign in with the same email address as the invite.

## Creating An Organisation

There are two current paths:

- Platform admin route: `POST /api/admin/organisations`
- Public signup route: `POST /api/organisations/signup`

The platform admin route accepts:

```json
{
  "name": "COLORS",
  "slug": "colors"
}
```

Slugs are normalized by the admin slug helper. Duplicate slugs return `409`.

The signup route creates an organisation and an initial `organisation_members` row for the signed-in user.

## Inviting Members

Org admins can create invitations:

```json
{
  "email": "producer@example.com",
  "role": "admin"
}
```

Accepted roles are:

```json
["owner", "admin", "member"]
```

Invitations expire after 14 days. Only an existing owner can invite another owner when acting as an organisation member.

The invite response includes a one-time `token`; the invite URL is:

```text
/invite/<token>
```

When the invitee accepts, Groucho creates the `organisation_members` row and marks the invitation as accepted.

## Updating An Organisation

Org admins can patch name and slug:

```json
{
  "name": "COLORS Forum",
  "slug": "colors-forum"
}
```

Deletion requires a confirmation body:

```json
{
  "confirmSlug": "colors-forum"
}
```

Deleting an organisation cascades through dependent projects, keys, sessions, and related rows according to the database constraints.

## Example Setup

A typical COLORS test setup:

1. Create organisation `COLORS`.
2. Invite internal operators as `admin`.
3. Create two projects inside the organisation:
   - `COLORS Applications` with `project_type: "gatekeeper"`.
   - `COLORS Onboarding` with `project_type: "onboarding"`.
4. Issue separate API keys per project.
5. Configure webhooks on each project if the host app needs terminal outcomes.

## Operational Notes

- The admin UI lists only organisations the actor can access, unless the actor is a platform admin.
- Row-level security limits anon/authenticated table reads; server routes use the service role client and enforce access in application code.
- Keep `expose_to_anon_read` enabled on at most one project. It is mainly for the in-repo demo/read path; production integrations should use API keys or a server-side proxy.
