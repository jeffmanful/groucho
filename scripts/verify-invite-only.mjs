/** Run against an authorised deployment with --env-file=.env.local. No emails are sent. */
import { createClient } from "@supabase/supabase-js"
import { createServerClient } from "@supabase/ssr"
import { randomBytes, randomUUID } from "node:crypto"
import assert from "node:assert/strict"

const origin = process.env.GROUCHO_TEST_ORIGIN || "https://admin.groucho.app"
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_KEY
assert(url && key && service, "Supabase verification environment is missing")
const db = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
const runId = randomUUID()
const email = `invite-only-${runId}@example.invalid`
const password = randomBytes(32).toString("hex")
const token = randomBytes(32).toString("hex")
const jar = new Map()
const client = createServerClient(url, key, { cookies: {
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  setAll: values => values.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
} })
const check = (error) => { if (error) throw new Error(error.message) }
async function request(path, status, body) {
  const response = await fetch(new URL(path, origin), {
    method: body === undefined ? "GET" : "POST",
    headers: { origin, "content-type": "application/json", cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "manual", signal: AbortSignal.timeout(30000),
  })
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0]; const split = pair.indexOf("=")
    const name = pair.slice(0, split); const value = pair.slice(split + 1)
    if (value) jar.set(name, value); else jar.delete(name)
  }
  assert.equal(response.status, status, `${path}: unexpected response`)
  console.log(`PASS ${path.split("?")[0]} ${status}`)
  return response
}
let userId, organisationId
try {
  await request("/api/organisations/signup", 403, { name: "Must not exist", slug: `denied-${runId}` })
  const oldSignup = await request("/signup/organisation", 307)
  assert(new URL(oldSignup.headers.get("location"), origin).pathname === "/login")
  const loginPage = await request("/login", 200)
  const html = await loginPage.text()
  assert(html.includes("invite only") && !html.includes('href="/signup/organisation"'))
  await request("/api/invitations/send-code", 410, { token: "invalid" })

  const created = await db.auth.admin.createUser({ email, password, email_confirm: true })
  check(created.error); userId = created.data.user.id
  await request("/api/auth/login", 403, { email, password })
  check((await client.auth.signInWithPassword({ email, password })).error)
  await request("/api/admin/session", 401) // A valid provider session must not bypass invitations.

  const org = await db.from("organisations").insert({ name: "Invite-only verification", slug: `invite-check-${runId}` }).select("id").single()
  check(org.error); organisationId = org.data.id
  const inv = await db.from("invitations").insert({ organisation_id: organisationId, email, role: "member", token, expires_at: new Date(Date.now() + 3600000).toISOString() })
  check(inv.error)
  await request("/api/auth/login", 200, { email, password, next: `/invite/${token}` })
  await request("/api/admin/session", 401) // Pending invitation grants no dashboard access.

  check((await db.from("invitations").update({ email: "wrong-recipient@example.invalid" }).eq("token", token)).error)
  await request("/api/invitations/accept", 403, { token })
  check((await db.from("invitations").update({ email, expires_at: "2000-01-01T00:00:00Z" }).eq("token", token)).error)
  await request("/api/invitations/accept", 410, { token })
  check((await db.from("invitations").update({ expires_at: new Date(Date.now() + 3600000).toISOString() }).eq("token", token)).error)
  await request("/api/invitations/accept", 200, { token, role: "owner", organisationId: randomUUID() })
  const membership = await db.from("organisation_members").select("role").eq("organisation_id", organisationId).eq("user_id", userId).single()
  check(membership.error); assert.equal(membership.data.role, "member")
  const session = await request("/api/admin/session", 200)
  assert.equal((await session.json()).kind, "member")
  await request(`/api/admin/organisations/${organisationId}`, 200)
  await request(`/api/admin/organisations/${randomUUID()}`, 403)
  await request("/api/organisations/signup", 403, { name: "Still forbidden", slug: `denied-${runId}` })
  await request("/api/invitations/accept", 410, { token })
  check((await db.from("organisation_members").delete().eq("organisation_id", organisationId).eq("user_id", userId)).error)
  await request("/api/admin/session", 401) // Revocation also blocks an already-issued session.
} finally {
  const failures = []
  if (organisationId) { const r = await db.from("organisations").delete().eq("id", organisationId); if (r.error) failures.push(r.error.message) }
  if (userId) { const r = await db.auth.admin.deleteUser(userId); if (r.error) failures.push(r.error.message) }
  assert.equal(failures.length, 0, `Synthetic fixture cleanup failed: ${failures.join("; ")}`)
  console.log("Synthetic account and organisation removed; no email sent.")
}
