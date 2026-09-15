import type { AdminActor } from "@/lib/admin-actor"

export function changedProjectSettingKeys(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
    .sort()
}

export function projectSettingsAuditActor(actor: AdminActor): {
  actor_kind: "platform" | "member"
  actor_user_id: string | null
  actor_email: string | null
} {
  return actor.kind === "platform"
    ? {
        actor_kind: "platform",
        actor_user_id: null,
        actor_email: actor.email,
      }
    : {
        actor_kind: "member",
        actor_user_id: actor.userId,
        actor_email: actor.email,
      }
}
