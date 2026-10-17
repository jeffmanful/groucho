"use client"

import { useReducer, useState } from "react"
import {
  createDrop,
  dropReducer,
  exclusions,
  sizes,
  stock,
  ballotOrder,
  type ShoeSize,
} from "@/lib/consumer-drop-demo"
import styles from "./consumer-drop.module.css"

export default function ConsumerDropDemo() {
  const [state, dispatch] = useReducer(dropReducer, undefined, createDrop)
  const [view, setView] = useState("shopper")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [size, setSize] = useState<ShoeSize>(8)
  const [mine, setMine] = useState<string | null>(null)
  const [selected, setSelected] = useState("cluster-0")
  const [note, setNote] = useState("")
  const [filter, setFilter] = useState("all")
  const [error, setError] = useState("")
  const [offerId, setOfferId] = useState("")
  const [reset, setReset] = useState(false)
  const [message, setMessage] = useState("")
  const entry = state.entries.find((e) => e.id === selected)
  const shopper = state.entries.find((e) => e.id === mine)
  const eligible = state.entries.filter(
    (e) => !exclusions(e, state.entries).length,
  )
  const offered = state.offers.find((o) => o.entryId === (offerId || mine))
  const offerEntry = state.entries.find((e) => e.id === offered?.entryId)
  const inspected = state.entries.find((e) => e.id === (offerId || mine))
  const inspectedExcluded = inspected
    ? exclusions(inspected, state.entries)
    : []
  const related = entry
    ? state.entries.filter(
        (e) =>
          e.id !== entry.id &&
          ((entry.cluster && e.cluster === entry.cluster) ||
            e.identity === entry.identity ||
            (entry.household && e.household === entry.household)),
      )
    : []
  const pending = state.entries.filter(
    (e) => exclusions(e, state.entries).length,
  )
  const rows = state.entries.filter(
    (e) =>
      filter === "all" ||
      (filter === "flagged"
        ? !!e.flag
        : filter === "eligible"
        ? !exclusions(e, state.entries).length
        : !!exclusions(e, state.entries).length),
  )
  function register(event: React.FormEvent) {
    event.preventDefault()
    setError("")
    const address = email.trim().toLowerCase()
    if (state.entries.some((e) => e.email.toLowerCase() === address)) {
      setError(
        "This email already has a registration. Use another fictional address.",
      )
      return
    }
    const id = crypto.randomUUID()
    dispatch({
      type: "register",
      entry: {
        id,
        name: name.trim(),
        email: address,
        size,
        identity: id,
        verified: false,
        flag: "",
        cluster: null,
        review: "review",
        note: "",
      },
    })
    setMine(id)
    setMessage(
      "Registration saved in this browser. Simulate email control to complete it.",
    )
  }
  return (
    <main className={styles.page}>
      <div className={styles.banner}>
        Synthetic demo · no Vans affiliation · no live verification, stock,
        emails or payments. Refresh resets everything.
      </div>
      <header className={styles.header}>
        <div>
          <p className={styles.subtitle}>
            Vans × Satoshi Nakamoto · illustrative drop
          </p>
          <h1>A fairer way to drop.</h1>
          <p>
            Register without the rush. Review the evidence. Give every eligible
            entry a fair chance in its size.
          </p>
        </div>
        <button onClick={() => setReset(true)}>Reset demo</button>
      </header>
      {reset && (
        <section className={styles.notice} aria-label="Confirm reset">
          <p>
            Discard this run, including registrations, reviews and reservations?
          </p>
          <button
            onClick={() => {
              dispatch({ type: "reset" })
              setMine(null)
              setOfferId("")
              setReset(false)
              setMessage("Demo reset.")
            }}
          >
            Reset this run
          </button>{" "}
          <button onClick={() => setReset(false)}>Keep this run</button>
        </section>
      )}
      <nav className={styles.tabs} aria-label="Drop views">
        {[
          ["shopper", "Shopper registration"],
          ["review", "Applicant review"],
          ["ballot", "Size ballot"],
          ["purchase", "Reserved purchase"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-current={view === id ? "page" : undefined}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <p className={styles.status} role="status">
        {message}
      </p>
      {view === "shopper" && (
        <div className={styles.split}>
          <section className={styles.panel}>
            <h2>Your size. Your chance.</h2>
            <p>
              Era “Gems” · illustrative price $195. All stock and size mappings
              here are fictional.
            </p>
            <div className={styles.facts}>
              <span>12 pairs across 5 sizes</span>
              <span>One entry per shopper</span>
              <span>24-hour purchase window</span>
            </div>
            <p>
              Register before the operator freezes the pool. Arriving earlier
              gives no advantage. No purchase is required to register.
            </p>
            <p>
              No Instagram following or purchase history needed. This demo asks
              for fictional details only.
            </p>
            <button onClick={() => setView("review")}>
              See the operator view →
            </button>
          </section>
          <section className={styles.panel}>
            {shopper ? (
              <>
                <h2>
                  {shopper.verified
                    ? "You’re registered."
                    : "Complete your registration"}
                </h2>
                <p>
                  {shopper.name} · UK {shopper.size}
                </p>
                <p>{shopper.email}</p>
                <p>
                  {shopper.verified
                    ? "Your simulated email check is complete. Results become available after the operator runs the ballot."
                    : "In a live flow, an email link or code would establish account control. No message is sent here."}
                </p>
                {!shopper.verified && (
                  <button
                    disabled={!!state.snapshot}
                    onClick={() => {
                      dispatch({ type: "verify", id: shopper.id })
                      setMessage(
                        "Email control simulated. Registration eligible for review and ballot.",
                      )
                    }}
                  >
                    Simulate email verification
                  </button>
                )}
                <button
                  onClick={() => {
                    setOfferId("")
                    setView("purchase")
                  }}
                >
                  Check my outcome
                </button>
              </>
            ) : (
              <form onSubmit={register}>
                <h2>Register interest</h2>
                <label>
                  Name
                  <input
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Fictional shopper"
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="shopper@example.invalid"
                  />
                </label>
                <label>
                  UK shoe size
                  <select
                    value={size}
                    onChange={(e) =>
                      setSize(Number(e.target.value) as ShoeSize)
                    }
                  >
                    {sizes.map((s) => (
                      <option key={s} value={s}>
                        UK {s}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  One chosen size. Equal chance within that size; odds vary with
                  demand and stock. Registration does not guarantee a pair.
                </p>
                <button className={styles.primary} disabled={!!state.snapshot}>
                  Register for the ballot
                </button>
                {state.snapshot && (
                  <p>Registration closed. Reset to start a new run.</p>
                )}
                {error && <p role="alert">{error}</p>}
              </form>
            )}
          </section>
        </div>
      )}
      {view === "review" && (
        <>
          <div className={styles.actions} aria-label="Review scenarios">
            {[
              ["shopper-6-1", "Duplicate across sizes"],
              ["shopper-7-0", "Shared household"],
              ["cluster-0", "Possible coordinated group"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  setSelected(id)
                  setNote("")
                  setFilter("all")
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.sectionHeading}>
            <div>
              <h2>Evidence before decisions.</h2>
              <p>
                {state.entries.length} registrations · {eligible.length}{" "}
                eligible · {pending.length} excluded or awaiting review
              </p>
            </div>
            <label>
              View
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All registrations</option>
                <option value="flagged">Flagged evidence</option>
                <option value="eligible">Eligible</option>
                <option value="pending">Excluded / pending</option>
              </select>
            </label>
          </div>
          <div className={styles.split}>
            <section className={styles.panel}>
              <div className={styles.list}>
                {rows.map((e) => (
                  <button
                    key={e.id}
                    aria-pressed={selected === e.id}
                    onClick={() => {
                      setSelected(e.id)
                      setNote("")
                    }}
                  >
                    <span>
                      <strong>{e.name}</strong>
                      <small>
                        {e.email} · UK {e.size}
                      </small>
                    </span>
                    <span>
                      {exclusions(e, state.entries).length
                        ? e.review === "held"
                          ? "Held"
                          : "Review"
                        : "Eligible"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
            {entry && (
              <section className={styles.panel}>
                <h2>{entry.name}</h2>
                <p>
                  {entry.email} · UK {entry.size}
                </p>
                <h3>Verified in simulation</h3>
                <p>
                  {entry.verified
                    ? "Email account-control check complete"
                    : "Email check incomplete"}
                </p>
                <h3>Observed in fixtures</h3>
                <p>{entry.flag || "No coordination flags in this fixture."}</p>
                {entry.observation && <p>{entry.observation}</p>}
                {entry.household && (
                  <p>
                    Household link: {entry.household}. This contextual link does
                    not merge identities or reduce ballot eligibility.
                  </p>
                )}
                <p>
                  Simulated person identifier: {entry.identity}. This fixture
                  link is not inferred from names, addresses or writing style.
                </p>
                {related.length > 0 && (
                  <>
                    <h3>Related registrations</h3>
                    {related.map((e) => (
                      <p key={e.id}>
                        {e.name} · {e.email} · UK {e.size}
                        {" — "}
                        {e.identity === entry.identity
                          ? "Same simulated person"
                          : e.household && e.household === entry.household
                          ? "Shared household, distinct simulated person"
                          : "Pattern link only, distinct simulated person"}
                        <button
                          onClick={() => {
                            setSelected(e.id)
                            setNote("")
                          }}
                        >
                          Inspect {e.name}
                        </button>
                      </p>
                    ))}
                  </>
                )}
                <h3>Unknown</h3>
                <p>
                  Real identity, resale intent and real account ownership. A
                  flag is not a fraud finding.
                </p>
                <p>
                  {exclusions(entry, state.entries).join(" · ") ||
                    "Eligible for its size pool"}
                </p>
                {entry.note && (
                  <p className={styles.notice}>Review note: {entry.note}</p>
                )}
                <label>
                  Review reason
                  <textarea
                    value={note}
                    maxLength={400}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Explain why you are clearing or holding this case"
                  />
                </label>
                <div className={styles.actions}>
                  {(
                    [
                      ["eligible", "Clear / mark eligible"],
                      ["held", "Hold entry"],
                      ["review", "Keep pending / request clarification"],
                    ] as const
                  ).map(([review, label]) => (
                    <button
                      key={review}
                      disabled={!!state.snapshot || !note.trim()}
                      onClick={() => {
                        dispatch({ type: "review", id: entry.id, review, note })
                        setNote("")
                        setMessage(`${entry.name}: review recorded.`)
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {state.snapshot && <p>Review locked for this frozen ballot.</p>}
                <p>
                  Clearing a flag cannot bypass incomplete verification or a
                  shared identifier. Hold the duplicate to release the other
                  entry. A shared household alone is not a duplicate.
                  Pattern-linked entries require individual review; clearing one
                  does not clear the group. Clarification is recorded as pending
                  here; no request is sent.
                </p>
              </section>
            )}
          </div>
        </>
      )}
      {view === "ballot" && (
        <section className={styles.panel}>
          <h2>One ballot. Separate size pools.</h2>
          <p>
            Each eligible shopper enters once in their chosen size. Equal chance
            within a pool; no weighting for optional evidence.
          </p>
          <div className={styles.tableWrap}>
            <table>
              <caption>Illustrative inventory and ballot pools</caption>
              <thead>
                <tr>
                  <th>UK size</th>
                  <th>Pairs</th>
                  <th>Eligible</th>
                  <th>Excluded</th>
                  <th>Initial chance</th>
                  <th>Reserved / purchased</th>
                </tr>
              </thead>
              <tbody>
                {sizes.map((s) => {
                  const count = eligible.filter((e) => e.size === s).length
                  return (
                    <tr key={s}>
                      <th>{s}</th>
                      <td>{stock[s]}</td>
                      <td>{count}</td>
                      <td>{pending.filter((e) => e.size === s).length}</td>
                      <td>
                        {count
                          ? `${Math.min(count, stock[s])}/${count}`
                          : "No entries"}
                      </td>
                      <td>
                        {
                          state.offers.filter(
                            (o) => o.size === s && o.status !== "expired",
                          ).length
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!state.snapshot ? (
            <>
              <p>
                Freezing closes registration and locks eligible IDs, sizes,
                inventory and policy. Held or incomplete cases remain excluded.
                Review exceptions before continuing.
              </p>
              <button
                className={styles.primary}
                disabled={!eligible.length}
                onClick={() => {
                  dispatch({
                    type: "freeze",
                    id: crypto.randomUUID(),
                    at: new Date().toISOString(),
                  })
                  setMessage(
                    "Cohorts frozen. Registration and review are now locked.",
                  )
                }}
              >
                Freeze eligible pools
              </button>
            </>
          ) : (
            <>
              <p>
                Snapshot {state.snapshot.id} · {state.snapshot.at}
              </p>
              <p>{state.snapshot.policy}</p>
              <details>
                <summary>
                  {state.snapshot.ids.length} eligible IDs frozen — inspect
                  snapshot
                </summary>
                <p>{state.snapshot.ids.join(", ")}</p>
              </details>
              <button
                className={styles.primary}
                disabled={!!state.pools}
                onClick={() => {
                  dispatch({ type: "draw", order: ballotOrder(state) })
                  setMessage(
                    "Ballot complete. Reserved offers and ranked waitlists created.",
                  )
                }}
              >
                {state.pools
                  ? "Ballot complete — redraw blocked"
                  : "Run fair size ballot"}
              </button>
            </>
          )}
          {state.pools && (
            <>
              <h3>Ranked waitlists</h3>
              <div className={styles.poolGrid}>
                {sizes.map((s) => (
                  <div key={s}>
                    <h3>UK {s}</h3>
                    <ol>
                      {state
                        .pools![s].filter(
                          (id) => !state.offers.some((o) => o.entryId === id),
                        )
                        .map((id) => (
                          <li key={id}>
                            {state.entries.find((e) => e.id === id)?.name}
                          </li>
                        ))}
                    </ol>
                    {!state.pools![s].some(
                      (id) => !state.offers.some((o) => o.entryId === id),
                    ) && <p>No waiting entries.</p>}
                  </div>
                ))}
              </div>
              <button onClick={() => setView("purchase")}>
                Inspect reserved offers →
              </button>
            </>
          )}
        </section>
      )}
      {view === "purchase" && (
        <div className={styles.split}>
          <section className={styles.panel}>
            <h2>A window, not another race.</h2>
            <p>
              Selected shoppers receive an account-bound opportunity for their
              allocated size. A real store must reserve inventory and enforce
              recipient, quantity and expiry.
            </p>
            <p className={styles.notice}>
              Demo clock: {state.now} hours after the ballot. Time advances only
              when you click below; this is not a live countdown.
            </p>
            <button
              disabled={!state.pools}
              onClick={() => {
                dispatch({ type: "advance", hours: 24 })
                setMessage(
                  "Demo clock advanced 24 hours. Expired stock offered to same-size waitlists.",
                )
              }}
            >
              Advance demo clock 24 hours
            </button>
            <p>
              Purchased pairs stay sold. Expired offers cannot be redeemed. No
              emails, payment requests or commerce calls occur.
            </p>
            <h3>Inspect a simulated shopper session</h3>
            <label>
              Shopper
              <select
                value={offerId || mine || ""}
                onChange={(e) => setOfferId(e.target.value)}
              >
                <option value="">Choose a shopper</option>
                {state.entries.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · UK {e.size}
                    {state.offers.some(
                      (o) => o.entryId === e.id && o.status === "reserved",
                    )
                      ? " · Reserved"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <p>The selector is a presentation tool, not real authentication.</p>
          </section>
          <section className={styles.panel}>
            {offered && offerEntry ? (
              <>
                <h2>
                  {offered.status === "purchased"
                    ? "Your demo order is confirmed."
                    : offered.status === "expired"
                    ? "This purchase window has ended."
                    : "Your pair is reserved."}
                </h2>
                <p>
                  {offerEntry.name} · {offerEntry.email}
                </p>
                <div className={styles.product}>
                  <strong>Era “Gems”</strong>
                  <span>UK {offered.size}</span>
                  <span>$195 · illustrative price</span>
                </div>
                <p>
                  {offered.status === "reserved"
                    ? `${
                        offered.expires - state.now
                      } demo hours remaining. Reserved until demo hour ${
                        offered.expires
                      }.`
                    : offered.status === "purchased"
                    ? "Simulated receipt. No payment taken and no order sent to Vans."
                    : "The pair has been released to the next shopper in the same size, if one is waiting."}
                </p>
                <button
                  className={styles.primary}
                  disabled={offered.status !== "reserved"}
                  onClick={() => {
                    dispatch({ type: "purchase", id: offered.entryId })
                    setMessage(
                      "Simulated purchase confirmed. No payment taken.",
                    )
                  }}
                >
                  Simulate purchase — no payment
                </button>
                <p>
                  One pair, fixed size. Refreshing the whole demo discards this
                  local reservation.
                </p>
              </>
            ) : (
              <>
                <h2>
                  {state.pools
                    ? !inspected
                      ? "Choose a shopper to inspect."
                      : inspectedExcluded.length
                      ? "This entry was excluded."
                      : "You’re on the waitlist."
                    : "Results aren’t ready yet."}
                </h2>
                <p>
                  {state.pools
                    ? "Eligible entries without an offer remain in their chosen size’s ranked waitlist. Held or incomplete entries are excluded."
                    : "Complete review, freeze the eligible pools and run the size ballot."}
                </p>
                {(offerId || mine) && (
                  <p>
                    {exclusions(
                      state.entries.find((e) => e.id === (offerId || mine))!,
                      state.entries,
                    ).join(" · ") ||
                      (state.pools
                        ? "Eligible — waiting for an available pair in this size."
                        : "Registration eligible for the ballot.")}
                  </p>
                )}
                <button onClick={() => setView("ballot")}>
                  View size ballot
                </button>
              </>
            )}
          </section>
        </div>
      )}
      <details className={styles.audit}>
        <summary>Run activity · {state.audit.length} events</summary>
        <ul>
          {state.audit.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        <p>
          Browser-only demonstration, not a durable or independently verified
          allocation ledger.
        </p>
      </details>
    </main>
  )
}
