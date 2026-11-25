import { readFile } from "node:fs/promises"
import { PGlite } from "@electric-sql/pglite"
import { NextRequest, NextResponse } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  start: vi.fn(),
  actor: vi.fn(),
  requireAdmin: vi.fn(),
}))

vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.from } }))
vi.mock("@/lib/start-gatekeeper-session", () => ({ startGatekeeperSession: mocks.start }))
vi.mock("@/lib/admin-actor", () => ({ resolveAdminActor: mocks.actor }))
vi.mock("@/lib/org-access", () => ({
  requireOrgAdmin: mocks.requireAdmin,
  unauthorized: () => NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}))

import { POST as runConversation } from "@/app/api/demo/project/route"
import { POST as startColorsDemo } from "@/app/api/demo/colors/start/route"
import { POST as manageLinks } from "@/app/api/admin/organisations/[orgId]/projects/[projectId]/demo-links/route"
import { DEMO_LINK_HEADER, demoLinkPath, loadDemoLink, projectDemoWalkthroughs, sharedColorsSessionId } from "@/lib/project-demo-links"
import { startProjectPreview } from "@/lib/project-conversation-preview-runtime"
import { openDemoRun, sealDemoRun } from "@/lib/project-demo-run"

const organisationId = "d4e350d8-964a-4f55-95b4-a44e77b63c15"
const projectId = "71ffa69c-c9f6-43ad-8ff9-3b34b33a0b33"
const linkId = "79965e2e-8626-43b2-98ee-cc878b91ee86"
const browserId = "3f7a690a-1ccd-4125-ae7f-aa3108b4fc3e"
const project = {
  id: projectId, slug: "forum-application", name: "Forum Application", organisation_id: organisationId,
  settings: { project_type: "gatekeeper", conversation_engine: "colors_forum", application_invitation_required: true },
}
const config = {
  version: 1 as const, openingMessage: "Hello.", openingQuestion: "What brings you here?",
  maxAnswers: 4, intent: "Get to know the applicant.", persona: { name: "Groucho", instructions: "Private instructions" }, questions: [],
}

function query<T>(data: T) {
  const chain = {
    select: vi.fn(() => chain), update: vi.fn(() => chain), eq: vi.fn(() => chain), is: vi.fn(() => chain), gt: vi.fn(() => chain),
    maybeSingle: vi.fn<() => Promise<{ data: T | null; error: null }>>(async () => ({ data, error: null })),
  }
  return chain
}

function token(id = linkId) {
  return demoLinkPath(id).split("/").at(-1)!
}

function stubDemo(variant: "artist" | "community" | "conversation" = "artist", target: Omit<typeof project, "settings"> & { settings: object } = project) {
  const projects = query(target)
  const links = query({ id: linkId, project_id: projectId, variant })
  mocks.from.mockImplementation(table => {
    if (table === "project_demo_links") return links
    if (table === "projects") return projects
    return query({ name: "COLORS" })
  })
  return { projects, links }
}

beforeEach(() => {
  vi.stubEnv("GROUCHO_PREVIEW_SIGNING_KEY", "local-test-key")
  mocks.start.mockResolvedValue(NextResponse.json({ message: "Welcome.", status: "active" }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("project demo guest access", () => {
  it("offers only the configured walkthroughs and stops offering them when archived", () => {
    expect(projectDemoWalkthroughs(project, "COLORS").variants).toEqual(["community", "artist"])
    expect(projectDemoWalkthroughs({ ...project, settings: { ...project.settings, archived: true } }, "COLORS").variants).toEqual([])
    expect(projectDemoWalkthroughs({
      ...project,
      settings: { project_type: "gatekeeper", conversation_engine: "conversation_v1", conversation_profile: "project", project_conversation: config },
    }, "COLORS").variants).toEqual(["conversation"])
    expect(projectDemoWalkthroughs({
      ...project,
      settings: { project_type: "gatekeeper", conversation_engine: "conversation_v1", conversation_profile: "project",
        project_conversation: { ...config, version: 2, signals: [], applicationReview: "colors_forum" } },
    }, "COLORS").variants).toEqual(["community", "artist"])
  })

  it("rejects altered tokens before reading the database and checks both expiry and revocation", async () => {
    const { links } = stubDemo()
    const signed = token()
    expect(await loadDemoLink(signed.slice(0, -1) + (signed.endsWith("a") ? "b" : "a"))).toBeNull()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(await loadDemoLink(signed)).toMatchObject({ id: linkId, variant: "artist", project: { id: projectId } })
    expect(links.is).toHaveBeenCalledWith("revoked_at", null)
    expect(links.gt).toHaveBeenCalledWith("expires_at", expect.any(String))
    links.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    expect(await loadDemoLink(signed)).toBeNull()
  })

  it("opens the selected COLORS project as an isolated run and rejects the wrong walkthrough", async () => {
    stubDemo()
    const request = (artist?: object) => new NextRequest("https://example.test/api/demo/colors/start", {
      method: "POST", headers: { [DEMO_LINK_HEADER]: token() },
      body: JSON.stringify({
        projectId: "ignored", sessionId: browserId,
        applicant: { email: "guest@example.test", name: "Sample Guest", artist },
      }),
    })
    expect((await startColorsDemo(request())).status).toBe(400)
    expect(mocks.start).not.toHaveBeenCalled()
    const response = await startColorsDemo(request({ city: "London", age: 25, socialLinks: [], musicLinks: [] }))
    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toBeNull()
    const sessionId = sharedColorsSessionId(linkId, browserId)
    expect(sessionId).not.toBe(browserId)
    expect(sessionId).not.toBe(sharedColorsSessionId(projectId, browserId))
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      sessionId, demoSession: true, sharedDemoPreview: true,
      context: expect.objectContaining({ projectId, organisationId }),
      projectSettings: expect.objectContaining({
        raw: expect.objectContaining({ application_invitation_required: false }),
      }),
    }))
  })

  it("checks the link again when a guest continues an existing conversation", async () => {
    const { links } = stubDemo("conversation", {
      ...project,
      settings: { project_type: "gatekeeper", conversation_engine: "conversation_v1", conversation_profile: "project", project_conversation: config },
    })
    const request = (body: object) => new NextRequest("https://example.test/api/demo/project", {
      method: "POST", headers: { [DEMO_LINK_HEADER]: token() }, body: JSON.stringify(body),
    })
    const opened = await runConversation(request({ action: "start" }))
    expect(opened.status).toBe(200)
    const body = await opened.json()
    expect(body).toMatchObject({ status: "active", message: "Hello.\n\nWhat brings you here?" })
    expect(Object.keys(body).sort()).toEqual(["message", "run", "status", "ui"])
    links.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    expect((await runConversation(request({ action: "message", run: body.run, message: "I love music." }))).status).toBe(404)
  })

  it("keeps conversation settings private and binds each run to its link", () => {
    const { preview } = startProjectPreview(config, organisationId, linkId, projectId)
    const run = sealDemoRun(preview)
    expect(Buffer.from(run, "base64url").toString()).not.toContain("Private instructions")
    expect(openDemoRun(run, linkId)).toEqual(preview)
    expect(openDemoRun(run, projectId)).toBeNull()
    expect(openDemoRun(sealDemoRun({ ...preview, expiresAt: Date.now() - 1 }), linkId)).toBeNull()
  })
})

describe("project demo link administration", () => {
  const context = { params: Promise.resolve({ orgId: organisationId, projectId }) }
  const request = (body: object) => new NextRequest("https://example.test/api/admin/demo-links", {
    method: "POST", body: JSON.stringify(body),
  })

  it("requires organisation admin access before resolving a project or making changes", async () => {
    expect((await manageLinks(request({ action: "create" }), context)).status).toBe(401)
    mocks.actor.mockResolvedValue({ kind: "member", userId: "member" })
    mocks.requireAdmin.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }))
    expect((await manageLinks(request({ action: "create" }), context)).status).toBe(403)
    expect(mocks.requireAdmin).toHaveBeenCalledWith({ kind: "member", userId: "member" }, organisationId)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it("rejects projects outside the organisation", async () => {
    mocks.actor.mockResolvedValue({ kind: "member", userId: "admin" })
    mocks.requireAdmin.mockResolvedValue(null)
    const projects = query(null)
    mocks.from.mockReturnValue(projects)
    expect((await manageLinks(request({ action: "create", variant: "artist" }), context)).status).toBe(404)
    expect(projects.eq).toHaveBeenCalledWith("organisation_id", organisationId)
  })

  it("uses the stored recipient and a stable email idempotency key", async () => {
    vi.stubEnv("RESEND_API_KEY", "synthetic-key")
    vi.stubEnv("GROUCHO_INVITATION_FROM_EMAIL", "demo@example.test")
    vi.stubEnv("GROUCHO_INVITATION_BASE_URL", "https://groucho.example.test")
    mocks.actor.mockResolvedValue({ kind: "member", userId: "admin" })
    mocks.requireAdmin.mockResolvedValue(null)
    const links = query({ id: linkId, recipient_email: "recipient@example.test", sent_at: null, variant: "artist" })
    mocks.from.mockImplementation(table => {
      if (table === "project_demo_links") return links
      if (table === "projects") return query(project)
      return query({ name: "COLORS" })
    })
    const fetchEmail = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", fetchEmail)
    expect((await manageLinks(request({ action: "send", id: linkId, email: "ignored@example.test" }), context)).status).toBe(200)
    expect(links.eq).toHaveBeenCalledWith("project_id", projectId)
    expect(links.update).toHaveBeenCalledWith({ sent_at: expect.any(String) })
    const [url, init] = fetchEmail.mock.calls[0]
    expect(url).toBe("https://api.resend.com/emails")
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(`project-demo/${linkId}`)
    const message = JSON.parse(String(init?.body))
    expect(message.to).toEqual(["recipient@example.test"])
    expect(message.text).toContain(`https://groucho.example.test${demoLinkPath(linkId)}`)
  })
})

it("keeps the link table server-only and removes links with their project", async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create table public.projects (id uuid primary key);
      insert into public.projects values ('${projectId}');
    `)
    await db.exec(await readFile(new URL("../../supabase/migrations/20261125150313_project_demo_links.sql", import.meta.url), "utf8"))
    await db.exec("set role service_role")
    const { rows } = await db.query<{ valid_for_14_days: boolean }>(`
      insert into project_demo_links (project_id, variant) values ($1, 'artist')
      returning expires_at - created_at = interval '14 days' as valid_for_14_days
    `, [projectId])
    expect(rows[0].valid_for_14_days).toBe(true)
    await db.exec("set role authenticated")
    await expect(db.query("select * from project_demo_links")).rejects.toThrow("permission denied")
    await db.exec("reset role")
    await db.query("delete from projects where id = $1", [projectId])
    expect((await db.query("select * from project_demo_links")).rows).toEqual([])
  } finally {
    await db.close()
  }
})
