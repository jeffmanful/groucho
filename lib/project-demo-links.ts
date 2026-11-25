import { createHmac, timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { projectUsesColorsEngine } from "@/lib/colors-engine"
import { demoConversationProfile } from "@/lib/demo-conversation-profiles"
import { normalizeProjectSettings } from "@/lib/project-settings"
import { readProjectConversation } from "@/lib/project-conversation-config"
import { supabase } from "@/lib/supabase"

export const DEMO_LINK_HEADER = "x-groucho-project-demo"
export const DEMO_LINK_TABLE = "project_demo_links"
export const DEMO_LINK_COLUMNS = "id, recipient_email, variant, created_at, expires_at, sent_at, revoked_at"
export const DEMO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type DemoVariant = "conversation" | "community" | "artist"
export const demoJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } })

function demoHmac(purpose: string, value: string) {
  const secret = process.env.GROUCHO_PREVIEW_SIGNING_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!secret) throw new Error("Demo signing is not configured")
  return createHmac("sha256", secret).update(`project-demo:${purpose}:v1:${value}`).digest()
}

export function demoLinkPath(id: string) {
  return `/demo/project/${id}.${demoHmac("link", id).toString("base64url")}`
}

export async function loadDemoProject(projectId: string, orgId?: string) {
  if (!DEMO_UUID.test(projectId)) return null
  let query = supabase.from("projects").select("id, name, slug, organisation_id, settings").eq("id", projectId)
  if (orgId) query = query.eq("organisation_id", orgId)
  const { data: project, error } = await query.maybeSingle()
  if (error) throw error
  if (!project) return null
  const { data: organisation, error: orgError } = await supabase.from("organisations")
    .select("name").eq("id", project.organisation_id).maybeSingle()
  if (orgError) throw orgError
  if (!organisation) return null
  return { project, organisation, ...projectDemoWalkthroughs(project, organisation.name) }
}

export function projectDemoWalkthroughs(project: { slug: string; settings: unknown }, organisationName: string) {
  const config = readProjectConversation(project.settings)
  const settings = normalizeProjectSettings(project.settings)
  const builtin = config ? null : demoConversationProfile(project.settings)
  const variants: DemoVariant[] = []
  if (settings.raw.archived !== true && settings.projectType === "gatekeeper") {
    if (config?.version === 2 && config.applicationReview === "colors_forum") {
      variants.push("community", "artist")
    } else if (config || (builtin && typeof settings.raw.persona_id === "string")) {
      variants.push("conversation")
    } else if (projectUsesColorsEngine(settings.raw) ||
      (organisationName.trim().toLowerCase() === "colors" && project.slug === "forum-application")) {
      variants.push("community", "artist")
    }
  }
  return { config, builtin, variants }
}

export async function loadDemoLink(token: string) {
  const [id, signature, extra] = token.split(".")
  if (!DEMO_UUID.test(id) || !signature || !/^[\w-]{43}$/.test(signature) || extra !== undefined) return null
  const expected = Buffer.from(demoHmac("link", id).toString("base64url"))
  if (!timingSafeEqual(expected, Buffer.from(signature))) return null
  const { data: link, error } = await supabase.from(DEMO_LINK_TABLE)
    .select("id, project_id, variant").eq("id", id).is("revoked_at", null)
    .gt("expires_at", new Date().toISOString()).maybeSingle()
  if (error) throw error
  if (!link) return null
  const target = await loadDemoProject(link.project_id)
  if (!target?.variants.includes(link.variant)) return null
  return { ...target, id: link.id as string, variant: link.variant as DemoVariant }
}

export async function loadSharedColorsDemo(token: string) {
  const link = await loadDemoLink(token)
  if (!link || link.variant === "conversation") return null
  const { project, organisation } = link
  const settings = normalizeProjectSettings({ ...project.settings, application_invitation_required: false })
  return { ...link, colors: {
    context: { organisationId: project.organisation_id, projectId: project.id, apiKeyId: null, settings },
    option: {
      id: project.id, name: project.name, slug: project.slug, organisationName: organisation.name,
      projectType: "gatekeeper" as const,
      applicationOpeningMessage: link.config?.openingQuestion || settings.applicationExperience.opening_message,
    },
  } }
}

export function sharedColorsSessionId(linkId: string, clientSessionId: string) {
  // A guest-supplied ID can only address a demo run. Live session IDs are never passed through.
  const bytes = demoHmac("colors-session", `${linkId}:${clientSessionId.toLowerCase()}`)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.subarray(0, 16).toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
