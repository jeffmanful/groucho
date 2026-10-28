import { createHash, randomBytes } from "node:crypto"
import type { ApplicantIdentity } from "@/lib/applicant-identity"
import { supabase } from "@/lib/supabase"

export const APPLICATION_INVITATION_LIFETIME_DAYS = 7
export type ResolvedApplicationInvitation = { id: string; email: string; name: string | null; audience: "community" | "artist"; sessionId: string; expiresAt: string }
export const invitationHash = (token: string) => createHash("sha256").update(token).digest("hex")

export async function resolveApplicationInvitation(projectId: string, token: unknown): Promise<ResolvedApplicationInvitation | null> {
  if (typeof token !== "string" || !/^gai_[A-Za-z0-9_-]{43}$/.test(token)) return null
  const { data, error } = await supabase.from("application_invitations")
    .select("id, email, name, audience, session_key, expires_at")
    .eq("project_id", projectId).eq("token_hash", invitationHash(token)).is("revoked_at", null)
    .gt("expires_at", new Date().toISOString()).maybeSingle()
  if (error) throw new Error("Application invitation service unavailable")
  if (!data) return null
  return { id: data.id, email: data.email, name: data.name, audience: data.audience, sessionId: data.session_key, expiresAt: data.expires_at }
}

export function invitationAllowsStart(invitation: ResolvedApplicationInvitation | null, sessionId: string, applicant: ApplicantIdentity | null | undefined): boolean {
  return Boolean(invitation && invitation.sessionId === sessionId && applicant?.email.toLowerCase() === invitation.email &&
    (invitation.audience === "artist" ? applicant.artist : applicant.details && !applicant.artist))
}

export async function createApplicationInvitation(input: {
  organisationId: string; projectId: string; email: string; name?: string; audience: "community" | "artist";
  actorEmail: string | null; actorUserId: string | null;
}) {
  const token = `gai_${randomBytes(32).toString("base64url")}`
  const expiresAt = new Date(Date.now() + APPLICATION_INVITATION_LIFETIME_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase.from("application_invitations").insert({
    organisation_id: input.organisationId, project_id: input.projectId, email: input.email.toLowerCase().trim(),
    name: input.name?.trim() || null, audience: input.audience, token_hash: invitationHash(token), expires_at: expiresAt,
    created_by_email: input.actorEmail, created_by_user_id: input.actorUserId,
  }).select("id, email, name, audience, session_key, expires_at, created_at").single()
  if (error || !data) throw new Error("The application invitation could not be created")
  return { invitation: data, token }
}
