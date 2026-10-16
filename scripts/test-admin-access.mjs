/** Integration test: creates disposable .invalid accounts; never sends email. */
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
const origin = process.env.GROUCHO_TEST_ORIGIN ?? "http://127.0.0.1:3010"
const adminEmail = process.env.GROUCHO_TEST_ADMIN_EMAIL
const adminPassword = process.env.GROUCHO_TEST_ADMIN_PASSWORD
if (!adminEmail || !adminPassword)
  throw Error(
    "Set GROUCHO_TEST_ADMIN_EMAIL and GROUCHO_TEST_ADMIN_PASSWORD; do not commit credentials.",
  )
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)
const email = `admin-access-${randomBytes(6).toString("hex")}@example.invalid`
const password = randomBytes(32).toString("hex")
let userId
async function request(path, { cookie, method = "GET", body } = {}) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "manual",
  })
  const text = await response.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = null
  }
  return {
    status: response.status,
    data,
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  }
}
function check(name, actual, expected) {
  assert.equal(actual, expected, name)
  console.log("PASS", name)
}
try {
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (created.error) throw created.error
  userId = created.data.user.id
  const admin = await request("/api/auth/login", {
    method: "POST",
    body: { email: adminEmail, password: adminPassword },
  })
  assert.equal(admin.status, 200)
  const member = await request("/api/auth/login", {
    method: "POST",
    body: { email, password },
  })
  assert.equal(member.status, 200)
  check(
    "anonymous cannot list admin access",
    (await request("/api/admin/access")).status,
    401,
  )
  check(
    "ordinary user cannot list admin access",
    (await request("/api/admin/access", { cookie: member.cookie })).status,
    403,
  )
  check(
    "ordinary user cannot invite",
    (
      await request("/api/admin/access", {
        cookie: member.cookie,
        method: "POST",
        body: { email: "blocked@example.invalid" },
      })
    ).status,
    403,
  )
  const invite = await request("/api/admin/access", {
    cookie: admin.cookie,
    method: "POST",
    body: { email },
  })
  assert.equal(invite.status, 201, JSON.stringify(invite.data))
  const token = new URL(invite.data.inviteUrl).pathname.split("/").pop()
  const acceptance = `/api/invitations/admin/${token}`
  check(
    "invitation is readable before acceptance",
    (await request(acceptance)).status,
    200,
  )
  check(
    "wrong verified email cannot accept",
    (
      await request(acceptance, {
        cookie: admin.cookie,
        method: "POST",
        body: { action: "accept" },
      })
    ).status,
    403,
  )
  check(
    "pending invitation grants no platform access",
    (await request("/api/admin/session", { cookie: member.cookie })).data.kind,
    "member",
  )
  check(
    "verified invited email can accept",
    (
      await request(acceptance, {
        cookie: member.cookie,
        method: "POST",
        body: { action: "accept" },
      })
    ).status,
    200,
  )
  check(
    "invitation cannot be replayed",
    (
      await request(acceptance, {
        cookie: member.cookie,
        method: "POST",
        body: { action: "accept" },
      })
    ).status,
    410,
  )
  check(
    "accepted user has platform access",
    (await request("/api/admin/session", { cookie: member.cookie })).data.kind,
    "platform",
  )
  check(
    "cannot remove own admin access",
    (
      await request(`/api/admin/access/${invite.data.invitation.id}`, {
        cookie: member.cookie,
        method: "DELETE",
      })
    ).status,
    409,
  )
  check(
    "core admin can revoke managed admin",
    (
      await request(`/api/admin/access/${invite.data.invitation.id}`, {
        cookie: admin.cookie,
        method: "DELETE",
      })
    ).status,
    200,
  )
  check(
    "revocation applies to existing session immediately",
    (await request("/api/admin/session", { cookie: member.cookie })).data.kind,
    "member",
  )
  const first = await request("/api/admin/access", {
    cookie: admin.cookie,
    method: "POST",
    body: { email },
  })
  const second = await request("/api/admin/access", {
    cookie: admin.cookie,
    method: "POST",
    body: { email },
  })
  assert.equal(second.status, 201)
  check(
    "replacing link invalidates previous invitation",
    (
      await request(
        new URL(first.data.inviteUrl).pathname.replace(
          "/invite/admin/",
          "/api/invitations/admin/",
        ),
      )
    ).status,
    410,
  )
  const latest = new URL(second.data.inviteUrl).pathname.replace(
    "/invite/admin/",
    "/api/invitations/admin/",
  )
  const expired = await service
    .from("platform_admin_access")
    .update({ expires_at: "2020-01-01T00:00:00Z" })
    .eq("email", email)
  if (expired.error) throw expired.error
  check(
    "expired invitation cannot be accepted",
    (
      await request(latest, {
        cookie: member.cookie,
        method: "POST",
        body: { action: "accept" },
      })
    ).status,
    410,
  )
  const third = await request("/api/admin/access", {
    cookie: admin.cookie,
    method: "POST",
    body: { email },
  })
  assert.equal(third.status, 201)
  await request(`/api/admin/access/${third.data.invitation.id}`, {
    cookie: admin.cookie,
    method: "DELETE",
  })
  check(
    "cancelled invitation is unavailable",
    (
      await request(
        new URL(third.data.inviteUrl).pathname.replace(
          "/invite/admin/",
          "/api/invitations/admin/",
        ),
      )
    ).status,
    410,
  )
  const access = await request("/api/admin/access", { cookie: admin.cookie })
  const core = access.data.users.find((u) => u.email === adminEmail)
  check("core administrator remains protected", core?.protected, true)
  check(
    "API refuses protected account removal",
    (
      await request(`/api/admin/access/${encodeURIComponent(core.id)}`, {
        cookie: admin.cookie,
        method: "DELETE",
      })
    ).status,
    400,
  )
} finally {
  if (userId) {
    const result = await service.auth.admin.deleteUser(userId)
    if (result.error) throw result.error
  }
  const result = await service
    .from("platform_admin_access")
    .delete()
    .eq("email", email)
  if (result.error) throw result.error
  console.log("Disposable test account and invitations removed.")
}
