import { describe, expect, it } from "vitest"
import {
  createDemo,
  demoReducer,
  eligibility,
  shuffled,
} from "@/lib/ticket-access-demo"
import {
  parseProjectType,
  validateProjectSettings,
} from "@/lib/project-settings"
const at = "2026-10-16T10:00:00Z"
describe("ticket-access simulation", () => {
  it("keeps private-profile alternatives eligible and unresolved duplicates out", () => {
    const s = createDemo()
    expect(s.registrations).toHaveLength(24)
    expect(eligibility(s.registrations[2], s.registrations)).toEqual([])
    expect(eligibility(s.registrations[0], s.registrations).join()).toContain(
      "Shared",
    )
    expect(eligibility(s.registrations[22], s.registrations).join()).toContain(
      "Shared",
    )
    expect(
      s.registrations.filter((r) => !eligibility(r, s.registrations).length),
    ).toHaveLength(15)
  })
  it("does not let an unverified mailbox claim block a verified applicant", () => {
    const s = createDemo()
    const clean = s.registrations[1]
    const claim = { ...s.registrations[20], email: clean.email }
    expect(eligibility(clean, [clean, claim])).toEqual([])
  })

  it("requires a reason and cannot clear incomplete checks or a duplicate by approval", () => {
    const s = createDemo()
    expect(
      demoReducer(s, {
        type: "review",
        id: "fan-17",
        review: "eligible",
        note: " ",
        at,
      }),
    ).toBe(s)
    const pending = demoReducer(s, {
      type: "review",
      id: "fan-21",
      review: "eligible",
      note: "Reviewed",
      at,
    })
    expect(
      eligibility(pending.registrations[20], pending.registrations),
    ).toContain("Email verification pending")
    const duplicate = demoReducer(s, {
      type: "review",
      id: "fan-23",
      review: "eligible",
      note: "Reviewed",
      at,
    })
    expect(
      eligibility(duplicate.registrations[22], duplicate.registrations).join(),
    ).toContain("Shared")
    const resolved = demoReducer(s, {
      type: "review",
      id: "fan-23",
      review: "held",
      note: "Repeated account-control identifier",
      at,
    })
    expect(
      eligibility(resolved.registrations[0], resolved.registrations),
    ).toEqual([])
    expect(resolved.audit[0].message).toContain("Repeated account-control")
  })
  it("freezes an exact cohort, locks mutations, and allocates once without replacement", () => {
    const s = demoReducer(createDemo(), { type: "freeze", id: "draw-1", at })
    expect(s.snapshot?.ids).toHaveLength(15)
    expect(
      demoReducer(s, {
        type: "configure",
        name: "Changed",
        welcome: "Hello",
        places: 1,
        at,
      }),
    ).toBe(s)
    expect(
      demoReducer(s, {
        type: "review",
        id: "fan-17",
        review: "eligible",
        note: "Changed",
        at,
      }),
    ).toBe(s)
    const order = shuffled(s.snapshot!.ids, () => 123)
    const drawn = demoReducer(s, { type: "draw", order, at })
    expect(drawn.result?.winners).toHaveLength(6)
    expect(drawn.result?.waitlist).toHaveLength(9)
    expect(
      new Set([...drawn.result!.winners, ...drawn.result!.waitlist]).size,
    ).toBe(15)
    expect(
      drawn.result!.winners.every((id) => s.snapshot!.ids.includes(id)),
    ).toBe(true)
    expect(
      demoReducer(drawn, { type: "draw", order: [...order].reverse(), at }),
    ).toBe(drawn)
    expect(
      demoReducer(s, { type: "draw", order: Array(15).fill("fan-2"), at }),
    ).toBe(s)
  })
  it("rejects duplicate submissions and too few eligible entries", () => {
    const s = createDemo()
    expect(
      demoReducer(s, {
        type: "register",
        registration: { ...s.registrations[0], id: "new" },
        at,
      }),
    ).toBe(s)
    const many = demoReducer(s, {
      type: "configure",
      name: "Event",
      welcome: "Welcome",
      places: 24,
      at,
    })
    expect(demoReducer(many, { type: "freeze", id: "draw", at })).toBe(many)
    const reset = demoReducer(s, { type: "reset", run: "next" })
    expect(reset.run).toBe("next")
    expect(reset.snapshot).toBeNull()
  })
  it("forces ticket projects into simulation and removes live integrations", () => {
    expect(parseProjectType({ project_type: "ticket_access" })).toBe(
      "ticket_access",
    )
    const result = validateProjectSettings({
      project_type: "ticket_access",
      environment: "live",
      session_mode: "live",
      webhook_url: "https://example.com",
      persona_id: "live",
      decision_policy: { automatic_acceptance_enabled: true },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.settings.environment).toBe("test")
      expect(result.settings.session_mode).toBe("dry-run")
      expect(result.settings.webhook_url).toBeUndefined()
      expect(result.settings.persona_id).toBeUndefined()
      expect(result.settings.ticket_access).toEqual({ simulation: true })
    }
  })
})
