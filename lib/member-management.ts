// Rules for changing an organisation member's role or removing them.
import type { OrgRole } from "@/lib/org-access"

export const MEMBER_ROLES: OrgRole[] = ["member", "admin", "owner"]

export type MemberChange =
  | { kind: "role"; role: OrgRole }
  | { kind: "remove" }

/**
 * Why a change is refused, or null when it's allowed. Owners (and platform admins) manage members;
 * nobody changes their own membership here, and an organisation always keeps at least one owner.
 */
export function memberChangeError(input: {
  actorIsPlatform: boolean
  actorRole: OrgRole | null
  actorUserId: string | null
  target: { user_id: string; role: OrgRole }
  ownerCount: number
  change: MemberChange
}): { status: number; error: string } | null {
  const { change, target } = input
  if (!input.actorIsPlatform && input.actorRole !== "owner") {
    return { status: 403, error: "Only owners can change roles or remove people." }
  }
  if (!input.actorIsPlatform && input.actorUserId === target.user_id) {
    return { status: 400, error: "You can't change your own membership. Ask another owner." }
  }
  if (change.kind === "role" && !MEMBER_ROLES.includes(change.role)) {
    return { status: 400, error: "Role must be member, admin or owner." }
  }
  const losesOwner = target.role === "owner" && (change.kind === "remove" || change.role !== "owner")
  if (losesOwner && input.ownerCount <= 1) {
    return { status: 409, error: "An organisation needs at least one owner. Make someone else an owner first." }
  }
  return null
}
