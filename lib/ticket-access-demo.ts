/** Synthetic, browser-only demonstration. No provider or ticketing authorisation. */
export type Review = "eligible" | "review" | "held"
export type Registration = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  socialId: string | null
  alternative: string | null
  privateProfile: boolean
  flags: string[]
  cleared: boolean
  review: Review
  note: string
  answer: string
}
export type Audit = { at: string; message: string }
export type Snapshot = {
  id: string
  ids: string[]
  places: number
  at: string
  policy: string
}
export type DemoState = {
  run: string
  name: string
  welcome: string
  places: number
  registrations: Registration[]
  audit: Audit[]
  snapshot: Snapshot | null
  result: { winners: string[]; waitlist: string[] } | null
}
const names = [
  "Alex Morgan",
  "Sam Ellis",
  "Jordan Lee",
  "Riley Patel",
  "Casey Williams",
  "Taylor Reed",
  "Robin Chen",
  "Frankie Jones",
  "Avery James",
  "Drew Clarke",
  "Billie Scott",
  "Charlie Green",
  "Jamie Brooks",
  "Quinn Adams",
  "Rowan Taylor",
  "Morgan Bell",
  "Eden Shaw",
  "Kit Foster",
  "River Hall",
  "Sage Wood",
  "Sky Parker",
  "Ash King",
  "Jules Ward",
  "Remy Cole",
]
export function createDemo(run = "demo-run"): DemoState {
  return {
    run,
    name: "Example Artist · intimate show",
    places: 6,
    welcome:
      "A small room. A shared love of music. Tell us what brings you here.",
    registrations: names.map((name, i) => ({
      id: `fan-${i + 1}`,
      name,
      email:
        i >= 16 && i < 20
          ? `listener${4800 + i}@example.com`
          : `${name.split(" ")[0].toLowerCase()}${i + 1}@example.com`,
      emailVerified: i !== 20 && i !== 21,
      socialId:
        i === 2 || i === 13
          ? null
          : i === 22
          ? "ig-demo-1"
          : `ig-demo-${i + 1}`,
      alternative: i === 2 || i === 13 ? `phone-demo-${i}` : null,
      privateProfile: i === 2 || i === 13,
      flags:
        i >= 16 && i < 20
          ? [
              "Four sequential email addresses submitted within four minutes. Synthetic cluster; coordination is unconfirmed.",
            ]
          : i === 22
          ? [
              "Instagram identifier is also linked to Alex Morgan. Resolve duplicate account control.",
            ]
          : i === 23
          ? ["Similar email naming pattern. Weak signal; may be a coincidence."]
          : [],
      cleared: false,
      review: i >= 16 ? "review" : "eligible",
      note: "",
      answer:
        i === 2
          ? "I'm a new listener and don't post publicly. I'd love to hear these songs in a small room."
          : "I keep returning to the live arrangements. Hearing them with a room full of people would be special.",
    })),
    audit: [
      {
        at: "Fixture",
        message:
          "Loaded 24 fictional registrations. All verification and history are simulated.",
      },
    ],
    snapshot: null,
    result: null,
  }
}
function identifiers(r: Registration) {
  return [
    ...(r.emailVerified ? [`email:${r.email.trim().toLowerCase()}`] : []),
    ...(r.socialId ? [`social:${r.socialId}`] : []),
    ...(r.alternative ? [`alternative:${r.alternative}`] : []),
  ]
}
export function eligibility(r: Registration, all: Registration[]): string[] {
  const reasons: string[] = []
  if (!r.emailVerified) reasons.push("Email verification pending")
  if (!r.socialId && !r.alternative)
    reasons.push("Account-control check pending")
  if (r.review !== "eligible")
    reasons.push(r.review === "held" ? "Held by reviewer" : "Awaiting review")
  if (r.flags.length && !r.cleared) reasons.push("Unresolved evidence flags")
  // A hold on one confirmed duplicate releases the other, but clearing a flag alone cannot.
  if (
    all.some(
      (other) =>
        other.id !== r.id &&
        other.review !== "held" &&
        identifiers(other).some((id) => identifiers(r).includes(id)),
    )
  )
    reasons.push(
      "Shared verified identifier; hold the duplicate before allocation",
    )
  return reasons
}
export type DemoAction =
  | { type: "review"; id: string; review: Review; note: string; at: string }
  | {
      type: "configure"
      name: string
      welcome: string
      places: number
      at: string
    }
  | { type: "register"; registration: Registration; at: string }
  | { type: "freeze"; id: string; at: string }
  | { type: "draw"; order: string[]; at: string }
  | { type: "reset"; run: string }
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  if (action.type === "reset") return createDemo(action.run)
  if (action.type === "draw") {
    const snapshot = state.snapshot
    if (
      !snapshot ||
      state.result ||
      new Set(action.order).size !== snapshot.ids.length ||
      action.order.length !== snapshot.ids.length ||
      action.order.some((id) => !snapshot.ids.includes(id))
    )
      return state
    return {
      ...state,
      result: {
        winners: action.order.slice(0, snapshot.places),
        waitlist: action.order.slice(snapshot.places),
      },
      audit: [
        {
          at: action.at,
          message: `Draw ${snapshot.id}: ${snapshot.places} purchase opportunities allocated; delivery and checkout simulated.`,
        },
        ...state.audit,
      ],
    }
  }
  if (state.snapshot) return state
  if (action.type === "configure") {
    if (
      !action.name.trim() ||
      !action.welcome.trim() ||
      !Number.isInteger(action.places) ||
      action.places < 1 ||
      action.places > 24
    )
      return state
    return {
      ...state,
      name: action.name.trim().slice(0, 80),
      welcome: action.welcome.trim().slice(0, 300),
      places: action.places,
      audit: [
        { at: action.at, message: "Updated event configuration." },
        ...state.audit,
      ],
    }
  }
  if (action.type === "review") {
    if (!action.note.trim()) return state
    return {
      ...state,
      registrations: state.registrations.map((r) =>
        r.id === action.id
          ? {
              ...r,
              review: action.review,
              cleared: action.review === "eligible",
              note: action.note.trim(),
            }
          : r,
      ),
      audit: [
        {
          at: action.at,
          message: `${action.id}: ${action.review}. ${action.note.trim()}`,
        },
        ...state.audit,
      ],
    }
  }
  if (action.type === "register") {
    const r = action.registration
    if (
      state.registrations.some(
        (other) =>
          other.id === r.id ||
          identifiers(other).some((id) => identifiers(r).includes(id)),
      )
    )
      return state
    return {
      ...state,
      registrations: [...state.registrations, r],
      audit: [
        {
          at: action.at,
          message: `${r.name}: added from the fan preview. Checks and conversation are simulated.`,
        },
        ...state.audit,
      ],
    }
  }
  const ids = state.registrations
    .filter((r) => !eligibility(r, state.registrations).length)
    .map((r) => r.id)
  if (new Set(ids).size !== ids.length || ids.length < state.places)
    return state
  return {
    ...state,
    snapshot: {
      id: action.id,
      at: action.at,
      ids,
      places: state.places,
      policy:
        "One entry per eligible registration; one opportunity each; equal chance; unresolved shared identifiers excluded.",
    },
    audit: [
      {
        at: action.at,
        message: `Frozen ${ids.length} eligible entries for ${state.places} opportunities. Review and policy locked.`,
      },
      ...state.audit,
    ],
  }
}
/** Uniform shuffle with rejection sampling; no modulo bias or Math.random. */
export function shuffled(
  ids: string[],
  randomUint32: () => number = () =>
    crypto.getRandomValues(new Uint32Array(1))[0],
): string[] {
  const result = [...ids]
  for (let i = result.length - 1; i > 0; i--) {
    const bound = i + 1
    const limit = Math.floor(0x100000000 / bound) * bound
    let n: number
    do {
      n = randomUint32()
    } while (n >= limit)
    const j = n % bound
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
