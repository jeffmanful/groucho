import Link from "next/link"
import styles from "./scenario-switcher.module.css"

const SCENARIOS = [
  { key: "ezra", label: "Ezra Collective presale", note: "Ticket registrations, suspicious clusters, fair ballot" },
  { key: "vans", label: "Vans shoe drop", note: "Product drop, ballots by shoe size" },
] as const

/** Choose between the two illustrative access scenarios. Both are synthetic and reset on reload. */
export function ScenarioSwitcher({ selected }: { selected: "ezra" | "vans" }) {
  return (
    <nav className={styles.switcher} aria-label="Demo scenario">
      <span className={styles.label}>Demo scenario</span>
      {SCENARIOS.map((scenario) => (
        <Link
          key={scenario.key}
          href={`/admin/ticket-access?scenario=${scenario.key}`}
          className={selected === scenario.key ? styles.active : styles.option}
          aria-current={selected === scenario.key ? "page" : undefined}
        >
          <strong>{scenario.label}</strong>
          <small>{scenario.note}</small>
        </Link>
      ))}
    </nav>
  )
}
