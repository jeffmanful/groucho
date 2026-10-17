import { shuffled } from "@/lib/ticket-access-demo"

export const sizes = [6, 7, 8, 9, 10] as const
export type ShoeSize = (typeof sizes)[number]
export const stock: Record<ShoeSize, number> = { 6: 2, 7: 3, 8: 4, 9: 2, 10: 1 }
export type Entry = {
  id: string
  name: string
  email: string
  size: ShoeSize
  verified: boolean
  identity: string
  flag: string
  household?: string
  observation?: string
  cluster: string | null
  review: "eligible" | "review" | "held"
  note: string
}
export type Offer = {
  entryId: string
  size: ShoeSize
  expires: number
  status: "reserved" | "purchased" | "expired"
}
export type DropState = {
  entries: Entry[]
  snapshot: { id: string; ids: string[]; at: string; policy: string } | null
  pools: Record<ShoeSize, string[]> | null
  offers: Offer[]
  now: number
  audit: string[]
}
export function createDrop(): DropState {
  const entries: Entry[] = []
  for (const [index, size] of sizes.entries()) {
    const counts = [8, 12, 16, 10, 4]
    for (let i = 0; i < counts[index]; i++)
      entries.push({
        id: `shopper-${size}-${i}`,
        name: `Shopper ${size}${String(i + 1).padStart(2, "0")}`,
        email: `shopper${size}${i + 1}@example.invalid`,
        size,
        verified: true,
        identity: `person-${size}-${i}`,
        flag: "",
        cluster: null,
        review: "eligible",
        note: "",
      })
  }
  entries[0] = {
    ...entries[0],
    name: "Jordan Lee",
    note: "Private social profile. Simulated email control complete; no public history required.",
  }
  entries[1] = {
    ...entries[1],
    name: "Alex Morgan",
    cluster: "shared-control",
    observation:
      "Same simulated verified person identifier as Jules Ward in UK 7. This identity link applies across the whole drop, not just a size pool.",
  }
  for (const [index, name] of [
    [8, "Casey Patel"],
    [20, "Riley Patel"],
  ] as const) {
    entries[index] = {
      ...entries[index],
      name,
      household: "household-patel",
      observation:
        "Shared delivery household and network with another applicant. Distinct simulated verified person identifiers. Household sharing alone is not an exclusion.",
      note: "Legitimate shared-household fixture: separate shoppers, one entry each. No evidence of duplicate personhood.",
    }
  }
  entries.push(
    ...[0, 1, 2].map((i) => ({
      id: `cluster-${i}`,
      name: ["Eden Shaw", "Kit Foster", "River Hall"][i],
      email: `drop480${i}@example.invalid`,
      size: ([8, 9, 10] as ShoeSize[])[i],
      verified: true,
      identity: `cluster-person-${i}`,
      flag: "Three sequential addresses submitted in 40 seconds across UK sizes 8, 9 and 10. Distinct simulated person identifiers; a coordinated buyer group is possible but unconfirmed. Human review required.",
      cluster: "sequence-48",
      review: "review" as const,
      note: "",
    })),
  )
  entries.push({
    id: "weak",
    name: "Remy Cole",
    email: "remy4809@example.invalid",
    size: 9,
    verified: true,
    identity: "remy",
    flag: "Similar digits to the flagged sequence. Weak signal only.",
    cluster: null,
    review: "review",
    note: "",
  })
  entries.push({
    id: "duplicate",
    name: "Jules Ward",
    email: "jules@example.invalid",
    size: 7,
    verified: true,
    identity: entries[1].identity,
    flag: "Same simulated verified person identifier as Alex Morgan in UK 6. This second entry chooses UK 7; cross-size entries do not create extra chances.",
    cluster: "shared-control",
    review: "review",
    note: "",
  })
  return {
    entries,
    snapshot: null,
    pools: null,
    offers: [],
    now: 0,
    audit: [
      "Loaded 55 fictional registrations and 12 illustrative pairs. No live checks.",
    ],
  }
}
export function exclusions(entry: Entry, entries: Entry[]): string[] {
  const reasons: string[] = []
  if (!entry.verified) reasons.push("Email control incomplete")
  if (entry.review !== "eligible")
    reasons.push(
      entry.review === "held" ? "Held by reviewer" : "Awaiting review",
    )
  if (entry.flag && !entry.note) reasons.push("Flag unresolved")
  if (
    entries.some(
      (other) =>
        other.id !== entry.id &&
        other.review !== "held" &&
        other.identity === entry.identity,
    )
  )
    reasons.push("Shared identifier unresolved")
  return reasons
}
export type DropAction =
  | { type: "register"; entry: Entry }
  | { type: "verify"; id: string }
  | { type: "review"; id: string; review: Entry["review"]; note: string }
  | { type: "freeze"; id: string; at: string }
  | { type: "draw"; order: string[] }
  | { type: "purchase"; id: string }
  | { type: "advance"; hours: number }
  | { type: "reset" }
export function dropReducer(state: DropState, action: DropAction): DropState {
  if (action.type === "reset") return createDrop()
  if (action.type === "advance") {
    if (!state.pools || !Number.isInteger(action.hours) || action.hours <= 0)
      return state
    const now = state.now + action.hours
    const expired = state.offers.filter(
      (o) => o.status === "reserved" && o.expires <= now,
    )
    const offers = state.offers.map((o) =>
      o.status === "reserved" && o.expires <= now
        ? { ...o, status: "expired" as const }
        : o,
    )
    for (const offer of expired) {
      const next = state.pools[offer.size].find(
        (id) => !offers.some((o) => o.entryId === id),
      )
      if (next)
        offers.push({
          entryId: next,
          size: offer.size,
          expires: now + 24,
          status: "reserved",
        })
    }
    return {
      ...state,
      now,
      offers,
      audit: [
        `Demo clock +${action.hours}h; ${expired.length} expired reservations released. Same-size waitlists advanced.`,
        ...state.audit,
      ],
    }
  }
  if (action.type === "purchase") {
    const offer = state.offers.find(
      (o) =>
        o.entryId === action.id &&
        o.status === "reserved" &&
        o.expires > state.now,
    )
    if (!offer) return state
    return {
      ...state,
      offers: state.offers.map((o) =>
        o === offer ? { ...o, status: "purchased" } : o,
      ),
      audit: [
        `${action.id}: simulated purchase confirmed. No payment taken.`,
        ...state.audit,
      ],
    }
  }
  if (action.type === "draw") {
    if (
      !state.snapshot ||
      state.pools ||
      action.order.length !== state.snapshot.ids.length ||
      new Set(action.order).size !== action.order.length ||
      action.order.some((id) => !state.snapshot!.ids.includes(id))
    )
      return state
    const pools = Object.fromEntries(
      sizes.map((size) => [
        size,
        action.order.filter(
          (id) => state.entries.find((e) => e.id === id)?.size === size,
        ),
      ]),
    ) as Record<ShoeSize, string[]>
    const offers: Offer[] = sizes.flatMap((size) =>
      pools[size].slice(0, stock[size]).map((entryId) => ({
        entryId,
        size,
        expires: state.now + 24,
        status: "reserved" as const,
      })),
    )
    return {
      ...state,
      pools,
      offers,
      audit: [
        `Ballot ${state.snapshot.id}: ${offers.length} simulated 24-hour reservations opened.`,
        ...state.audit,
      ],
    }
  }
  if (state.snapshot) return state
  if (action.type === "register") {
    const e = action.entry
    if (
      !e.name.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email) ||
      !sizes.includes(e.size) ||
      state.entries.some(
        (other) =>
          other.id === e.id ||
          other.email.toLowerCase() === e.email.toLowerCase() ||
          other.identity === e.identity,
      )
    )
      return state
    return {
      ...state,
      entries: [
        ...state.entries,
        {
          ...e,
          verified: false,
          review: "review",
          flag: "",
          cluster: null,
          note: "",
        },
      ],
      audit: [
        `${e.id}: shopper registration received. Verification pending.`,
        ...state.audit,
      ],
    }
  }
  if (action.type === "verify")
    return {
      ...state,
      entries: state.entries.map((e) =>
        e.id === action.id && !e.verified && !e.flag
          ? { ...e, verified: true, review: "eligible" }
          : e,
      ),
      audit: [
        `${action.id}: email control simulated, no email sent.`,
        ...state.audit,
      ],
    }
  if (action.type === "review") {
    if (!action.note.trim()) return state
    return {
      ...state,
      entries: state.entries.map((e) =>
        e.id === action.id
          ? { ...e, review: action.review, note: action.note.trim() }
          : e,
      ),
      audit: [
        `${action.id}: ${action.review}. ${action.note.trim()}`,
        ...state.audit,
      ],
    }
  }
  const ids = state.entries
    .filter((e) => !exclusions(e, state.entries).length)
    .map((e) => e.id)
  if (!ids.length) return state
  return {
    ...state,
    snapshot: {
      id: action.id,
      ids,
      at: action.at,
      policy:
        "One resolved identity, one size, one equal-chance entry. Stock and review locked; no redraw.",
    },
    audit: [
      `Frozen ${ids.length} eligible registrations. ${
        state.entries.length - ids.length
      } excluded.`,
      ...state.audit,
    ],
  }
}
export function ballotOrder(state: DropState) {
  return shuffled(state.snapshot?.ids ?? [])
}
