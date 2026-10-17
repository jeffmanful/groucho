import { describe, it, expect } from "vitest"
import {
  createDrop,
  dropReducer,
  exclusions,
  sizes,
  stock,
  type DropState,
} from "@/lib/consumer-drop-demo"
function draw(state = createDrop()) {
  state = dropReducer(state, { type: "freeze", id: "test-draw", at: "fixture" })
  return dropReducer(state, { type: "draw", order: state.snapshot!.ids })
}
describe("consumer drop allocation", () => {
  it("excludes unresolved clusters and both sides of shared control until review resolves them", () => {
    let s = createDrop()
    expect(
      exclusions(s.entries.find((e) => e.id === "cluster-0")!, s.entries)
        .length,
    ).toBeGreaterThan(0)
    expect(exclusions(s.entries[1], s.entries)).toContain(
      "Shared identifier unresolved",
    )
    s = dropReducer(s, {
      type: "review",
      id: "duplicate",
      review: "held",
      note: "Duplicate resolved",
    })
    expect(exclusions(s.entries[1], s.entries)).toEqual([])
    s = dropReducer(s, {
      type: "review",
      id: "weak",
      review: "eligible",
      note: "Coincidental digits",
    })
    expect(
      exclusions(s.entries.find((e) => e.id === "weak")!, s.entries),
    ).toEqual([])
  })
  it("blocks a duplicate person across size pools even when both entries are cleared", () => {
    let s = createDrop()
    s = dropReducer(s, {
      type: "review",
      id: "duplicate",
      review: "eligible",
      note: "Attempted clear",
    })
    for (const id of ["shopper-6-1", "duplicate"]) {
      expect(
        exclusions(s.entries.find((e) => e.id === id)!, s.entries),
      ).toContain("Shared identifier unresolved")
    }
    s = dropReducer(s, {
      type: "review",
      id: "duplicate",
      review: "held",
      note: "Keep the original UK 6 entry only",
    })
    s = draw(s)
    expect(s.snapshot!.ids).toContain("shopper-6-1")
    expect(s.snapshot!.ids).not.toContain("duplicate")
    expect(s.pools![7]).not.toContain("duplicate")
  })
  it("keeps distinct shoppers in the same household eligible without merging identities", () => {
    const s = draw()
    const household = s.entries.filter((e) => e.household === "household-patel")
    expect(household).toHaveLength(2)
    expect(new Set(household.map((e) => e.identity)).size).toBe(2)
    for (const entry of household) {
      expect(exclusions(entry, s.entries)).toEqual([])
      expect(s.pools![entry.size]).toContain(entry.id)
    }
  })
  it("requires individual decisions for possible coordination and keeps clarification pending", () => {
    let s = createDrop()
    s = dropReducer(s, {
      type: "review",
      id: "cluster-0",
      review: "eligible",
      note: "Evidence insufficient to exclude this applicant",
    })
    s = dropReducer(s, {
      type: "review",
      id: "cluster-1",
      review: "review",
      note: "Awaiting clarification; no fraud finding",
    })
    s = draw(s)
    expect(s.snapshot!.ids).toContain("cluster-0")
    expect(s.snapshot!.ids).not.toContain("cluster-1")
    expect(s.snapshot!.ids).not.toContain("cluster-2")
    expect(s.entries.find((e) => e.id === "cluster-1")?.review).toBe("review")
  })
  it("verifies a shopper once and blocks duplicate registration and late changes", () => {
    let s = createDrop()
    const entry = {
      ...s.entries[0],
      id: "new",
      identity: "new",
      email: "new@example.invalid",
      verified: true,
    }
    s = dropReducer(s, { type: "register", entry })
    expect(s.entries.at(-1)?.verified).toBe(false)
    expect(dropReducer(s, { type: "register", entry })).toBe(s)
    s = dropReducer(s, { type: "verify", id: "new" })
    expect(exclusions(s.entries.at(-1)!, s.entries)).toEqual([])
    s = draw(s)
    expect(
      dropReducer(s, {
        type: "review",
        id: "new",
        review: "held",
        note: "too late",
      }),
    ).toBe(s)
  })
  it("allocates within each size's stock without redraw or repeated awards", () => {
    const s = draw()
    for (const size of sizes)
      expect(s.offers.filter((o) => o.size === size)).toHaveLength(stock[size])
    expect(new Set(s.offers.map((o) => o.entryId)).size).toBe(12)
    expect(dropReducer(s, { type: "draw", order: s.snapshot!.ids })).toBe(s)
    const invalid = dropReducer(createDrop(), {
      type: "freeze",
      id: "x",
      at: "fixture",
    })
    expect(
      dropReducer(invalid, {
        type: "draw",
        order: invalid.snapshot!.ids.map(() => "same"),
      }),
    ).toBe(invalid)
  })
  it("consumes a purchase once and recycles only expired same-size reservations", () => {
    let s = draw()
    const first = s.offers[0]
    s = dropReducer(s, { type: "purchase", id: first.entryId })
    expect(dropReducer(s, { type: "purchase", id: first.entryId })).toBe(s)
    const oldOffers = s.offers.filter((o) => o.status === "reserved")
    s = dropReducer(s, { type: "advance", hours: 24 })
    expect(s.offers.find((o) => o.entryId === first.entryId)?.status).toBe(
      "purchased",
    )
    for (const old of oldOffers) {
      expect(s.offers.find((o) => o.entryId === old.entryId)?.status).toBe(
        "expired",
      )
      expect(dropReducer(s, { type: "purchase", id: old.entryId })).toBe(s)
    }
    for (const size of sizes)
      expect(
        s.offers.filter((o) => o.size === size && o.status !== "expired"),
      ).toHaveLength(stock[size])
  })
  it("handles empty and undersubscribed size pools and exhausts waitlists without overselling", () => {
    let s: DropState = createDrop()
    s.entries = s.entries.slice(0, 1)
    s = draw(s)
    expect(s.offers).toHaveLength(1)
    s = dropReducer(s, { type: "advance", hours: 24 })
    expect(s.offers.filter((o) => o.status === "reserved")).toHaveLength(0)
    expect(dropReducer(s, { type: "reset" }).entries).toHaveLength(55)
  })
})
