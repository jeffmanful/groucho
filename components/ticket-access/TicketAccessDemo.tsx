"use client"

import { useReducer, useState } from "react"
import {
  createDemo,
  demoReducer,
  eligibility,
  shuffled,
  type DemoState,
  type Registration,
  type DemoAction,
} from "@/lib/ticket-access-demo"
import { MetricCard } from "@/components/arc/metric-card/metric-card"
import { SortableDataTable } from "@/components/arc/sortable-data-table/sortable-data-table"
import { SearchField } from "@/components/arc/search-field/search-field"
import { Badge } from "@/components/arc/badge/badge"
import { Button } from "@/components/arc/button/button"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/arc/tabs/tabs"
import styles from "./ticket-access.module.css"

type Tab = "registrations" | "allocation" | "fan-preview" | "event-setup"
const now = () => new Date().toISOString()
const time = (at: string) =>
  at === "Fixture"
    ? at
    : new Date(at).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/London",
      })
export default function TicketAccessDemo({
  projectName = "Ticket access",
  projectId = "standalone",
}: {
  projectName?: string
  projectId?: string
}) {
  const [state, dispatch] = useReducer(demoReducer, undefined, () =>
    createDemo(),
  )
  const [tab, setTab] = useState<Tab>("registrations")
  const [filter, setFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState("fan-17")
  const [note, setNote] = useState("")
  const [reset, setReset] = useState(false)
  const [notice, setNotice] = useState("")
  const selected = state.registrations.find((r) => r.id === selectedId)
  const eligible = state.registrations.filter(
    (r) => !eligibility(r, state.registrations).length,
  )
  const visible = state.registrations.filter((r) => {
    const matches = `${r.name} ${r.email}`
      .toLowerCase()
      .includes(query.toLowerCase())
    return (
      matches &&
      (filter === "all" ||
        (filter === "eligible" &&
          !eligibility(r, state.registrations).length) ||
        (filter === "flagged" && r.flags.length > 0 && !r.cleared) ||
        (filter === "pending" && !r.emailVerified) ||
        (filter === "held" && r.review === "held"))
    )
  })
  const act = (action: DemoAction, message: string) => {
    dispatch(action)
    setNotice(message)
  }
  return (
    <main className={styles.workspace}>
      <div className={styles.simulation}>
        Synthetic demo · All identity checks, fan history and ticket delivery
        are simulated. Changes last until this page is refreshed.
      </div>
      <header className={styles.header}>
        <div>
          <h1>{state.name}</h1>
          <p>{projectName}. Review the evidence, then allocate fairly.</p>
        </div>
        <Button variant="secondary" onClick={() => setReset(true)}>
          Reset demo
        </Button>
      </header>
      {reset && (
        <div className={styles.confirm} role="alert">
          <span>
            Start a new demo run? This clears reviews, fan submissions and the
            draw.
          </span>
          <Button
            variant="secondary"
            onClick={() => {
              dispatch({ type: "reset", run: crypto.randomUUID() })
              setReset(false)
              setNote("")
              setNotice("A new demo run is ready.")
            }}
          >
            Reset everything
          </Button>
          <Button variant="secondary" onClick={() => setReset(false)}>
            Keep this run
          </Button>
        </div>
      )}
      <section
        className={styles.metrics}
        aria-label="Event registration totals"
      >
        <MetricCard
          label="Registrations"
          value={state.registrations.length}
          context="Synthetic applicants"
        />
        <MetricCard
          label="Eligible now"
          value={eligible.length}
          context="Checks and review resolved"
        />
        <MetricCard
          label="Pending or excluded"
          value={state.registrations.length - eligible.length}
          context="Not in the eligible cohort"
        />
        <MetricCard
          label="Opportunities"
          value={state.places}
          context="One ticket per selected entry"
        />
      </section>
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList aria-label="Ticket access views">
          {(
            [
              { value: "registrations", label: "Registrations" },
              { value: "allocation", label: "Allocation" },
              { value: "fan-preview", label: "Fan preview" },
              { value: "event-setup", label: "Event setup" },
            ] as const
          ).map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <p className={styles.notice} role="status">
          {notice ||
            (state.snapshot
              ? "Cohort frozen. Reviews and event setup are locked until reset."
              : "Filters only change the view. Eligibility is recorded separately.")}
        </p>
        <TabsContent value="registrations">
          <div className={styles.reviewGrid}>
            <section
              className={styles.registrationList}
              aria-label="Registrations"
            >
              <div className={styles.toolbar}>
                <SearchField
                  label="Search registrations"
                  placeholder="Name or email"
                  value={query}
                  onValueChange={setQuery}
                />
                <label className={styles.fieldLabel}>
                  Show
                  <select
                    className={styles.nativeSelect}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">All registrations</option>
                    <option value="eligible">Eligible</option>
                    <option value="flagged">Unresolved flags</option>
                    <option value="pending">Email pending</option>
                    <option value="held">Held</option>
                  </select>
                </label>
              </div>
              <div className={styles.tableWrap}>
                <SortableDataTable
                  rows={visible}
                  rowKey="id"
                  caption="Synthetic event registrations"
                  emptyMessage="No registrations match these filters."
                  itemName={{ one: "registration", other: "registrations" }}
                  columns={[
                    {
                      key: "name",
                      label: "Applicant",
                      render: (_, r) => (
                        <button
                          className={styles.rowButton}
                          aria-pressed={selectedId === r.id}
                          onClick={() => {
                            setSelectedId(r.id)
                            setNote("")
                          }}
                        >
                          <span>{r.name}</span>
                          <small>{r.email}</small>
                        </button>
                      ),
                    },
                    {
                      key: "emailVerified",
                      label: "Checks",
                      sortable: false,
                      render: (_, r) => (
                        <div>
                          <span>
                            {r.emailVerified
                              ? "Email confirmed"
                              : "Email pending"}
                          </span>
                          <small>
                            {r.socialId
                              ? "Instagram control"
                              : r.alternative
                              ? "Phone alternative"
                              : "Control pending"}
                          </small>
                        </div>
                      ),
                    },
                    {
                      key: "review",
                      label: "Eligibility",
                      render: (_, r) => (
                        <div>
                          <Badge
                            tone={
                              !eligibility(r, state.registrations).length
                                ? "success"
                                : r.review === "held"
                                ? "neutral"
                                : "warning"
                            }
                            size="sm"
                          >
                            {!eligibility(r, state.registrations).length
                              ? "Eligible"
                              : r.review === "held"
                              ? "Held"
                              : "Needs review"}
                          </Badge>
                          {r.flags.length > 0 && !r.cleared && (
                            <small>{r.flags.length} unresolved flag</small>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
              <p className={styles.footnote}>
                {visible.length} shown · Fictional people and reserved
                example.com addresses
              </p>
            </section>
            <aside className={styles.panel} aria-label="Registration evidence">
              {selected && (
                <>
                  <div className={styles.detailHeader}>
                    <h2>{selected.name}</h2>
                    <p>{selected.email}</p>
                    <Badge tone="neutral" size="sm">
                      Synthetic evidence
                    </Badge>
                  </div>
                  <div className={styles.detailBody}>
                    <h3>Verified · simulated</h3>
                    <p>
                      Email:{" "}
                      {selected.emailVerified
                        ? "control confirmed"
                        : "not yet confirmed"}
                    </p>
                    <p>
                      {selected.socialId
                        ? `Instagram sender: ${selected.socialId}`
                        : `Alternative account control: ${
                            selected.alternative ?? "not completed"
                          }`}
                    </p>
                    <h3>Observed · fixture</h3>
                    {selected.flags.length ? (
                      selected.flags.map((flag) => (
                        <p className={styles.flag} key={flag}>
                          {flag}
                          {selected.cleared && " Reviewer cleared this flag."}
                        </p>
                      ))
                    ) : (
                      <p>No registration anomalies in this fixture.</p>
                    )}
                    <h3>Claimed · applicant context</h3>
                    <p>“{selected.answer}”</p>
                    <h3>Unknown</h3>
                    <p>
                      {selected.privateProfile
                        ? "Private profile. Social history is unavailable; this is not negative evidence."
                        : "Unique personhood and resale intent are not established. No public profile research performed."}
                    </p>
                    <h3>Eligibility</h3>
                    {eligibility(selected, state.registrations).length ? (
                      <ul>
                        {eligibility(selected, state.registrations).map(
                          (reason) => (
                            <li key={reason}>{reason}</li>
                          ),
                        )}
                      </ul>
                    ) : (
                      <p>
                        Eligible under this demo policy. This does not grant a
                        ticket.
                      </p>
                    )}
                    {selected.note && (
                      <p>
                        <strong>Last review:</strong> {selected.note}
                      </p>
                    )}
                    <label className={styles.fieldLabel}>
                      Review reason
                      <textarea
                        className={styles.nativeTextarea}
                        value={note}
                        maxLength={500}
                        disabled={!!state.snapshot}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Explain why this registration is eligible or needs to be held."
                      />
                    </label>
                    <div className={styles.actions}>
                      <Button
                        variant="primary"
                        disabled={!note.trim() || !!state.snapshot}
                        onClick={() =>
                          act(
                            {
                              type: "review",
                              id: selected.id,
                              review: "eligible",
                              note,
                              at: now(),
                            },
                            "Review recorded. Identifier conflicts and incomplete checks still prevent allocation.",
                          )
                        }
                      >
                        Clear flags & mark eligible
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={!note.trim() || !!state.snapshot}
                        onClick={() =>
                          act(
                            {
                              type: "review",
                              id: selected.id,
                              review: "held",
                              note,
                              at: now(),
                            },
                            "Registration held with a recorded reason.",
                          )
                        }
                      >
                        Hold registration
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="allocation">
          <section className={styles.panel}>
            <div className={styles.detailBody}>
              <h2>
                {state.result
                  ? "Allocation complete"
                  : state.snapshot
                  ? "Cohort frozen"
                  : "Preview the eligible cohort"}
              </h2>
              <p>
                One entry per eligible registration. One purchase opportunity
                each. Equal chance, with no replacement.
              </p>
              {!state.snapshot && (
                <>
                  <p>
                    <strong>{eligible.length}</strong> eligible ·{" "}
                    <strong>
                      {state.registrations.length - eligible.length}
                    </strong>{" "}
                    pending or excluded · <strong>{state.places}</strong>{" "}
                    opportunities
                  </p>
                  <p>
                    Freezing records this exact cohort and locks reviews, new
                    registrations and event policy.
                  </p>
                  <Button
                    variant="primary"
                    disabled={eligible.length < state.places}
                    onClick={() =>
                      act(
                        { type: "freeze", id: crypto.randomUUID(), at: now() },
                        "Cohort frozen. Ready for the random draw.",
                      )
                    }
                  >
                    Freeze {eligible.length} entries
                  </Button>
                  {eligible.length < state.places && (
                    <p>
                      Resolve more registrations or reduce the number of
                      opportunities before freezing.
                    </p>
                  )}
                </>
              )}
              {state.snapshot && (
                <>
                  <p className={styles.footnote}>
                    Draw {state.snapshot.id} · {state.snapshot.ids.length}{" "}
                    entries · frozen {time(state.snapshot.at)}
                  </p>
                  <p>{state.snapshot.policy}</p>
                  {!state.result && (
                    <Button
                      variant="primary"
                      onClick={() =>
                        act(
                          {
                            type: "draw",
                            order: shuffled(state.snapshot!.ids),
                            at: now(),
                          },
                          "Draw complete. No messages sent or real tickets issued.",
                        )
                      }
                    >
                      Run random draw
                    </Button>
                  )}
                </>
              )}
              {state.result ? (
                <div className={styles.results}>
                  <div>
                    <h3>Selected · {state.result.winners.length}</h3>
                    {state.result.winners.map((id, i) => (
                      <p key={id}>
                        <strong>
                          {state.registrations.find((r) => r.id === id)?.name}
                        </strong>
                        <small>
                          Simulated purchase opportunity · DEMO-
                          {projectId.slice(0, 8)}-{i + 1} · No delivery or
                          checkout
                        </small>
                      </p>
                    ))}
                  </div>
                  <div>
                    <h3>Waitlist · {state.result.waitlist.length}</h3>
                    {state.result.waitlist.map((id, i) => (
                      <p key={id}>
                        {i + 1}.{" "}
                        {state.registrations.find((r) => r.id === id)?.name}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <div className={styles.cohort}>
                  <h3>Included</h3>
                  <p>
                    {(state.snapshot?.ids ?? eligible.map((r) => r.id))
                      .map(
                        (id) =>
                          state.registrations.find((r) => r.id === id)?.name,
                      )
                      .join(" · ") || "No eligible registrations."}
                  </p>
                </div>
              )}
              <details>
                <summary>Pending or excluded registrations</summary>
                {state.registrations
                  .filter((r) => eligibility(r, state.registrations).length)
                  .map((r) => (
                    <p key={r.id}>
                      <strong>{r.name}:</strong>{" "}
                      {eligibility(r, state.registrations).join("; ")}
                    </p>
                  ))}
              </details>
            </div>
          </section>
        </TabsContent>
        <TabsContent value="fan-preview">
          <FanPreview
            key={state.run}
            state={state}
            dispatch={dispatch}
            onAdded={(id) => {
              setSelectedId(id)
              setTab("registrations")
              setNotice(
                "Your fictional applicant is now linked to the dashboard.",
              )
            }}
          />
        </TabsContent>
        <TabsContent value="event-setup">
          <EventSetup
            key={state.run}
            state={state}
            dispatch={dispatch}
            onSave={() =>
              setNotice(
                "Event setup saved for this run. Open Fan preview to see the welcome.",
              )
            }
          />
        </TabsContent>
      </Tabs>
      <section className={`${styles.panel} ${styles.audit}`}>
        <details>
          <summary>Run history · {state.audit.length} events</summary>
          <p className={styles.footnote}>
            Browser-session demonstration, not a production audit ledger. Run:{" "}
            {state.run}
          </p>
          <ol>
            {state.audit.map((entry, i) => (
              <li key={`${entry.at}-${i}`}>
                <time>{time(entry.at)}</time> {entry.message}
              </li>
            ))}
          </ol>
        </details>
      </section>
    </main>
  )
}
function EventSetup({
  state,
  dispatch,
  onSave,
}: {
  state: DemoState
  dispatch: (a: DemoAction) => void
  onSave: () => void
}) {
  const [name, setName] = useState(state.name)
  const [welcome, setWelcome] = useState(state.welcome)
  const [places, setPlaces] = useState(state.places)
  return (
    <form
      className={`${styles.panel} ${styles.form}`}
      onSubmit={(e) => {
        e.preventDefault()
        dispatch({ type: "configure", name, welcome, places, at: now() })
        onSave()
      }}
    >
      <h2>Event setup</h2>
      <p>
        Settings apply to this isolated demo run. One opportunity allows one
        ticket; no real inventory is connected.
      </p>
      <fieldset disabled={!!state.snapshot}>
        <label className={styles.fieldLabel}>
          Event name
          <input
            className={styles.nativeInput}
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={styles.fieldLabel}>
          Fan welcome
          <textarea
            className={styles.nativeTextarea}
            required
            maxLength={300}
            value={welcome}
            onChange={(e) => setWelcome(e.target.value)}
          />
        </label>
        <label className={styles.fieldLabel}>
          Purchase opportunities
          <input
            className={styles.nativeInput}
            type="number"
            min={1}
            max={24}
            required
            value={places}
            onChange={(e) => setPlaces(Number(e.target.value))}
          />
        </label>
        <p>
          Email plus Instagram control or phone alternative. Missing social
          history is neutral. Unresolved duplicate identifiers are excluded.
        </p>
        <Button
          type="submit"
          variant="primary"
          disabled={!name.trim() || !welcome.trim()}
        >
          Save event setup
        </Button>
      </fieldset>
    </form>
  )
}
function FanPreview({
  state,
  dispatch,
  onAdded,
}: {
  state: DemoState
  dispatch: (a: DemoAction) => void
  onAdded: (id: string) => void
}) {
  const [name, setName] = useState("Demo Listener")
  const [email, setEmail] = useState(false)
  const [control, setControl] = useState<"instagram" | "phone" | null>(null)
  const [answer, setAnswer] = useState("")
  const [followup, setFollowup] = useState(false)
  const [reply, setReply] = useState("")
  const [error, setError] = useState("")
  function submit() {
    const id = `fan-${crypto.randomUUID()}`
    const alias = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
    const address = `${alias || "listener"}@example.com`
    if (state.registrations.some((r) => r.email === address)) {
      setError(
        "That demo name already has a registration. Use another name or inspect the existing record.",
      )
      return
    }
    const registration: Registration = {
      id,
      name: name.trim(),
      email: address,
      emailVerified: email,
      socialId: control === "instagram" ? `ig-${id}` : null,
      alternative: control === "phone" ? `phone-${id}` : null,
      privateProfile: control === "phone",
      flags: [],
      cleared: false,
      review: "eligible",
      note: "",
      answer:
        [answer, reply].filter(Boolean).join(" / ") ||
        "Optional conversation skipped.",
    }
    dispatch({ type: "register", registration, at: now() })
    onAdded(id)
  }
  return (
    <section className={`${styles.panel} ${styles.fan}`}>
      <p className={styles.pill}>
        Fan preview · scripted conversation, no live AI
      </p>
      <h2>{state.name}</h2>
      <p className={styles.welcome}>{state.welcome}</p>
      <p>
        Register for a chance to buy one ticket. Selection is by lottery;
        telling us more does not improve your odds.
      </p>
      {state.snapshot ? (
        <p className={styles.flag}>
          Registration is closed for this draw. Reset the demo to start again.
        </p>
      ) : (
        <>
          <label className={styles.fieldLabel}>
            Fictional applicant name
            <input
              className={styles.nativeInput}
              maxLength={60}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p className={styles.footnote}>
            A reserved example.com address is generated. Please use a fictional
            name.
          </p>
          <div className={styles.checks}>
            <div>
              <h3>Email control · simulated</h3>
              <Button
                variant="secondary"
                disabled={email}
                onClick={() => setEmail(true)}
              >
                {email
                  ? "Email confirmed (simulation)"
                  : "Simulate email confirmation"}
              </Button>
            </div>
            <div>
              <h3>Account control · simulated</h3>
              <div className={styles.actions}>
                <Button
                  variant="secondary"
                  aria-pressed={control === "instagram"}
                  onClick={() => setControl("instagram")}
                >
                  Simulate Instagram DM
                </Button>
                <Button
                  variant="secondary"
                  aria-pressed={control === "phone"}
                  onClick={() => setControl("phone")}
                >
                  Use phone alternative
                </Button>
              </div>
              <p>
                {control === "instagram"
                  ? "Fictional DM challenge completed. No Instagram account accessed."
                  : control === "phone"
                  ? "Fictional phone check completed. No SMS sent."
                  : "Choose either route. No social history is required."}
              </p>
            </div>
          </div>
          <div className={styles.conversation}>
            <h3>Meet Groucho · optional</h3>
            <p>
              Which song do you keep returning to, and what brings you back?
            </p>
            <label className={styles.fieldLabel}>
              Your answer
              <textarea
                className={styles.nativeTextarea}
                value={answer}
                maxLength={600}
                onChange={(e) => setAnswer(e.target.value)}
              />
            </label>
            {!followup && (
              <Button
                variant="secondary"
                disabled={!answer.trim()}
                onClick={() => setFollowup(true)}
              >
                Continue conversation
              </Button>
            )}
            {followup && (
              <>
                <p>
                  Thanks for sharing. What would make an intimate live show
                  special for you?
                </p>
                <label className={styles.fieldLabel}>
                  Your follow-up
                  <textarea
                    className={styles.nativeTextarea}
                    maxLength={600}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                </label>
                <p className={styles.footnote}>
                  This follow-up is a fixed demo script. Answers are stored
                  verbatim, not assessed for humanity or fan quality.
                </p>
              </>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
          <Button
            variant="primary"
            disabled={!name.trim() || !email || !control}
            onClick={submit}
          >
            Complete demo registration
          </Button>
        </>
      )}
    </section>
  )
}
