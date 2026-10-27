import { describe, expect, it } from "vitest"
import { memberChangeError } from "@/lib/member-management"

const base = {
  actorIsPlatform: false,
  actorRole: "owner" as const,
  actorUserId: "owner-1",
  target: { user_id: "member-1", role: "member" as const },
  ownerCount: 1,
}

describe("member changes", () => {
  it("lets owners and platform admins change roles and remove people", () => {
    expect(memberChangeError({ ...base, change: { kind: "role", role: "admin" } })).toBeNull()
    expect(memberChangeError({ ...base, change: { kind: "remove" } })).toBeNull()
    expect(memberChangeError({ ...base, actorIsPlatform: true, actorRole: null, actorUserId: null, change: { kind: "remove" } })).toBeNull()
  })

  it("refuses admins and members", () => {
    expect(memberChangeError({ ...base, actorRole: "admin", change: { kind: "remove" } })?.status).toBe(403)
    expect(memberChangeError({ ...base, actorRole: "member", change: { kind: "role", role: "admin" } })?.status).toBe(403)
  })

  it("stops people changing their own membership", () => {
    expect(memberChangeError({ ...base, target: { user_id: "owner-1", role: "owner" }, ownerCount: 2, change: { kind: "remove" } })?.status).toBe(400)
  })

  it("always keeps an owner", () => {
    const lastOwner = { ...base, target: { user_id: "owner-2", role: "owner" as const } }
    expect(memberChangeError({ ...lastOwner, change: { kind: "role", role: "admin" } })?.status).toBe(409)
    expect(memberChangeError({ ...lastOwner, change: { kind: "remove" } })?.status).toBe(409)
    expect(memberChangeError({ ...lastOwner, ownerCount: 2, change: { kind: "remove" } })).toBeNull()
  })

  it("rejects unknown roles", () => {
    expect(memberChangeError({ ...base, change: { kind: "role", role: "superuser" as never } })?.status).toBe(400)
  })
})
