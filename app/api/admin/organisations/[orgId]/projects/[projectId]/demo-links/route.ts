import type { NextRequest } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgAdmin, unauthorized } from "@/lib/org-access"
import { isSameOriginMutation } from "@/lib/platform-admin-access"
import {
  DEMO_LINK_COLUMNS, DEMO_LINK_TABLE, DEMO_UUID, demoJson, demoLinkPath, loadDemoProject, type DemoVariant,
} from "@/lib/project-demo-links"
import { checkRateLimit } from "@/lib/rate-limit"
import { supabase } from "@/lib/supabase"

type Context = { params: Promise<{ orgId: string; projectId: string }> }

async function authorize({ params }: Context) {
  const actor = await resolveAdminActor()
  if (!actor) return { deny: unauthorized() }
  const { orgId, projectId } = await params
  const deny = await requireOrgAdmin(actor, orgId)
  if (deny) return { deny }
  const target = await loadDemoProject(projectId, orgId)
  if (!target) return { deny: demoJson({ error: "Project not found." }, 404) }
  return { target }
}

export async function GET(_req: NextRequest, context: Context) {
  try {
    const { deny, target } = await authorize(context)
    if (deny) return deny
    const { data, error } = await supabase.from(DEMO_LINK_TABLE).select(DEMO_LINK_COLUMNS)
      .eq("project_id", target.project.id).is("revoked_at", null)
      .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false })
    if (error) throw error
    return demoJson({
      variants: target.variants,
      links: data.map(link => ({ ...link, path: demoLinkPath(link.id) })),
    })
  } catch {
    return demoJson({ error: "Demo links could not be loaded. Try again." }, 503)
  }
}

async function sendInvitation(id: string, recipient: string, project: string, organisation: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.GROUCHO_INVITATION_FROM_EMAIL?.trim()
  const baseUrl = process.env.GROUCHO_INVITATION_BASE_URL ?? ""
  const origin = URL.canParse(baseUrl) ? new URL(baseUrl) : null
  if (!apiKey || !from || origin?.protocol !== "https:") {
    return demoJson({ error: "Invitation email is unavailable. You can copy the demo link and share it directly." }, 503)
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `project-demo/${id}`,
      },
      body: JSON.stringify({
        from, to: [recipient], subject: `Try the ${project} demo on Groucho`,
        text: `You’ve been invited to try the ${project} demo from ${organisation}.\n\nOpen the demo\n${new URL(demoLinkPath(id), origin)}\n\nThe link expires 14 days after it was created. Anyone with the link can try the demo. Please use sample details during the walkthrough.`,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok) return null
  } catch {
    // Retrying the same invitation reuses its provider idempotency key.
  }
  return demoJson({ error: "Email delivery couldn’t be confirmed. Try again or copy the demo link." }, 502)
}

export async function POST(req: NextRequest, context: Context) {
  if (!isSameOriginMutation(req)) return demoJson({ error: "Invalid request origin." }, 403)
  try {
    const { deny, target } = await authorize(context)
    if (deny) return deny
    const body = await req.json().catch(() => null)
    const projectId = target.project.id
    const now = new Date().toISOString()
    if (body?.action === "create") {
      const variant = body.variant as DemoVariant
      const recipient = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
      if (!target.variants.includes(variant)) return demoJson({ error: "Choose an available demo walkthrough." }, 400)
      if (recipient && (recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))) {
        return demoJson({ error: "Enter a valid email address." }, 400)
      }
      if (!checkRateLimit({ namespace: "project-demo-create", key: projectId, limit: 20, windowMs: 60_000 }).ok) {
        return demoJson({ error: "Too many demo links created. Try again in a minute." }, 429)
      }
      const { data, error } = await supabase.from(DEMO_LINK_TABLE)
        .insert({ project_id: projectId, recipient_email: recipient || null, variant }).select(DEMO_LINK_COLUMNS).single()
      if (error) throw error
      return demoJson({ link: { ...data, path: demoLinkPath(data.id) } }, 201)
    }
    if (typeof body?.id !== "string" || !DEMO_UUID.test(body.id)) return demoJson({ error: "Invalid demo link." }, 400)
    const link = supabase.from(DEMO_LINK_TABLE)
    if (body.action === "revoke") {
      const { error } = await link.update({ revoked_at: now }).eq("id", body.id).eq("project_id", projectId).is("revoked_at", null)
      if (error) throw error
      return demoJson({ success: true })
    }
    if (body.action !== "send") return demoJson({ error: "Invalid demo link action." }, 400)
    const { data, error } = await link.select("id, recipient_email, variant, sent_at").eq("id", body.id).eq("project_id", projectId)
      .is("revoked_at", null).gt("expires_at", now).maybeSingle()
    if (error) throw error
    if (!data?.recipient_email || !target.variants.includes(data.variant)) {
      return demoJson({ error: "This demo invitation is unavailable." }, 404)
    }
    if (data.sent_at) return demoJson({ sentAt: data.sent_at })
    if (!checkRateLimit({ namespace: "project-demo-send", key: projectId, limit: 10, windowMs: 60_000 }).ok) {
      return demoJson({ error: "Too many email attempts. Try again in a minute." }, 429)
    }
    const failure = await sendInvitation(data.id, data.recipient_email, target.project.name, target.organisation.name)
    if (failure) return failure
    const sentAt = new Date().toISOString()
    const { error: updateError } = await supabase.from(DEMO_LINK_TABLE)
      .update({ sent_at: sentAt }).eq("id", data.id).eq("project_id", projectId).is("sent_at", null)
    if (updateError) return demoJson({ error: "Email was accepted for delivery. Refresh to check the invitation’s status." }, 503)
    return demoJson({ sentAt })
  } catch {
    return demoJson({ error: "The demo link could not be updated. Try again." }, 503)
  }
}
