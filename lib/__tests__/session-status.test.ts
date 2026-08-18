import { describe, expect, it } from "vitest"
import { isConcludedSessionStatus } from "@/lib/session-status"

describe("isConcludedSessionStatus", () => {
  it("treats abandoned sessions as concluded", () => {
    expect(isConcludedSessionStatus("abandoned")).toBe(true)
  })

  it("keeps active and unknown sessions open", () => {
    expect(isConcludedSessionStatus("active")).toBe(false)
    expect(isConcludedSessionStatus("unknown")).toBe(false)
  })
})
