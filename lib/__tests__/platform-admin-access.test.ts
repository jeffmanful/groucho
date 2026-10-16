import { beforeEach, describe, expect, it, vi } from "vitest"
const db = vi.hoisted(() => ({
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({ supabase: { from: () => db } }))
beforeEach(() => {
  db.select.mockReturnValue(db)
  db.eq.mockReturnValue(db)
})
import {
  legacyPlatformEnabled,
  accessStatus,
  inviteHash,
  validInviteToken,
  verifiedInviteEmail,
  isSameOriginMutation,
} from "@/lib/platform-admin-access"

describe("admin invitation boundaries", () => {
  it("expires pending invitations without expiring accepted grants", () => {
    const expires_at = "2026-10-01T00:00:00Z"
    expect(
      accessStatus({ status: "pending", expires_at }, Date.parse(expires_at)),
    ).toBe("expired")
    expect(accessStatus({ status: "active", expires_at })).toBe("active")
    expect(accessStatus({ status: "revoked", expires_at })).toBe("revoked")
  })
  it("requires a verified matching email", () => {
    expect(
      verifiedInviteEmail({ email: "admin@example.com" }, "admin@example.com"),
    ).toBe(false)
    expect(
      verifiedInviteEmail(
        { email: "other@example.com", email_confirmed_at: "now" },
        "admin@example.com",
      ),
    ).toBe(false)
    expect(
      verifiedInviteEmail(
        { email: "ADMIN@example.com", email_confirmed_at: "now" },
        "admin@example.com",
      ),
    ).toBe(true)
  })
  it("hashes random capabilities and rejects malformed tokens", () => {
    expect(validInviteToken("a".repeat(64))).toBe(true)
    for (const token of [
      null,
      3,
      "",
      "x".repeat(64),
      "a".repeat(63),
      "a".repeat(65),
    ])
      expect(validInviteToken(token)).toBe(false)
    expect(inviteHash("a".repeat(64))).toHaveLength(64)
    expect(inviteHash("a".repeat(64))).not.toBe("a".repeat(64))
  })
  it("rejects browser mutations from a different origin", () => {
    expect(
      isSameOriginMutation(
        new Request("https://groucho.test/api", {
          headers: { origin: "https://evil.test" },
        }),
      ),
    ).toBe(false)
    expect(
      isSameOriginMutation(
        new Request("https://groucho.test/api", {
          headers: { origin: "http://groucho.test" },
        }),
      ),
    ).toBe(false)
    expect(
      isSameOriginMutation(
        new Request("https://groucho.test/api", {
          headers: { origin: "https://groucho.test" },
        }),
      ),
    ).toBe(true)
    expect(
      isSameOriginMutation(
        new Request("http://localhost:3010/api", {
          headers: { host: "127.0.0.1:3010", origin: "http://127.0.0.1:3010" },
        }),
      ),
    ).toBe(true)
  })
})

describe("legacy operator overrides", () => {
  it("allows an unchanged legacy operator, but denies any managed override", async () => {
    db.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    expect(await legacyPlatformEnabled("operator@example.com")).toBe(true)
    db.maybeSingle.mockResolvedValueOnce({
      data: { id: "revoked" },
      error: null,
    })
    expect(await legacyPlatformEnabled("operator@example.com")).toBe(false)
  })
  it("fails closed when override storage is unavailable", async () => {
    db.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "offline" },
    })
    expect(await legacyPlatformEnabled("operator@example.com")).toBe(false)
  })
})
