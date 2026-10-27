import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase", () => ({ supabase: {} }))
vi.mock("next/server", () => ({ after: () => { throw new Error("outside request") } }))

import { applicantSignalColumns, networkOf, parseIp, readApplicantSignals } from "@/lib/applicant-signals"
import { botSignalForApplicant } from "@/lib/bot-signals"

const h = (init: Record<string, string>) => new Headers(init)

describe("readApplicantSignals", () => {
  it("trusts forwarded details only on keyed requests", () => {
    const headers = h({ "x-groucho-applicant-ip": "203.0.113.9", "x-groucho-applicant-user-agent": "Mozilla/5.0", "user-agent": "node", "x-vercel-forwarded-for": "10.0.0.1" })
    expect(readApplicantSignals(headers, { viaApiKey: true })).toEqual({ source: "forwarded", ip: "203.0.113.9", userAgent: "Mozilla/5.0", language: null })
    // A browser calling Groucho directly can't claim someone else's IP.
    expect(readApplicantSignals(headers, { viaApiKey: false })).toMatchObject({ source: "direct", ip: "10.0.0.1", userAgent: "node" })
  })

  it("records nothing about a relay that doesn't forward", () => {
    expect(readApplicantSignals(h({ "user-agent": "node", "x-forwarded-for": "10.0.0.1" }), { viaApiKey: true })).toEqual({ source: "relay", ip: null, userAgent: null, language: null })
  })

  it("rejects invalid IPs and cleans text", () => {
    const signals = readApplicantSignals(h({ "x-groucho-applicant-ip": "not-an-ip", "x-groucho-applicant-user-agent": "UA\u0007x" }), { viaApiKey: true })
    expect(signals).toMatchObject({ ip: null, userAgent: "UAx" })
  })
})

describe("addresses", () => {
  it("parses common forms", () => {
    expect(parseIp("203.0.113.9:443")).toBe("203.0.113.9")
    expect(parseIp("[2001:db8::1]:443")).toBe("2001:db8::1")
    expect(parseIp("::ffff:203.0.113.9")).toBe("203.0.113.9")
    expect(parseIp("203.0.113.9, 10.0.0.1")).toBe("203.0.113.9")
    expect(parseIp("999.1.1.1")).toBeNull()
  })

  it("groups networks", () => {
    expect(networkOf("203.0.113.9")).toBe("203.0.113.0/24")
    expect(networkOf("2001:db8::1")).toBe("2001:0db8:0000::/48")
  })

  it("hashes, never stores the address, and matches equal addresses written differently", () => {
    process.env.GROUCHO_SIGNAL_HASH_SECRET = "test-secret"
    const a = applicantSignalColumns({ source: "forwarded", ip: "2001:db8::1", userAgent: null, language: null })
    const b = applicantSignalColumns({ source: "forwarded", ip: "2001:0db8:0:0:0:0:0:1", userAgent: null, language: null })
    const c = applicantSignalColumns({ source: "forwarded", ip: "2001:db8::2", userAgent: null, language: null })
    expect(a.applicant_ip_hash).toBe(b.applicant_ip_hash)
    expect(a.applicant_ip_hash).not.toBe(c.applicant_ip_hash)
    expect(a.applicant_network_hash).toBe(c.applicant_network_hash)
    expect(JSON.stringify(a)).not.toContain("2001")
  })
})

describe("botSignalForApplicant", () => {
  it("doesn't judge the client's own server", () => {
    expect(botSignalForApplicant({ source: "relay", userAgent: null }).likelyBot).toBe(false)
    expect(botSignalForApplicant({ source: "forwarded", userAgent: "python-requests/2.31" }).likelyBot).toBe(true)
  })
})
