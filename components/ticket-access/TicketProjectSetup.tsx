"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/arc/button/button"
import styles from "./ticket-access.module.css"
export default function TicketProjectSetup({
  orgId,
  name,
  slug,
  onBack,
}: {
  orgId: string
  name: string
  slug: string
  onBack: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function create() {
    setBusy(true)
    setError("")
    try {
      const response = await fetch(
        `/api/admin/organisations/${orgId}/projects`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            slug,
            settings: {
              project_type: "ticket_access",
              environment: "test",
              session_mode: "dry-run",
              ticket_access: { simulation: true },
            },
          }),
        },
      )
      const body = await response.json()
      if (!response.ok)
        throw new Error(body.error || "Could not create project.")
      router.push(
        `/admin/ticket-access?project=${encodeURIComponent(
          body.id,
        )}&org=${encodeURIComponent(orgId)}`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create project.")
      setBusy(false)
    }
  }
  return (
    <section className={styles.workspace}>
      <div className={`${styles.panel} ${styles.form}`}>
        <h1>Ticket access</h1>
        <h2>{name}</h2>
        <p>
          Create this project in your organisation with 24 synthetic
          registrations, six purchase opportunities and simulated email and
          social checks.
        </p>
        <p>
          The project record is saved. Demo reviews and draws stay in this page
          session and reset on refresh. No API key, persona, identity provider
          or ticket inventory is required.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onBack} disabled={busy}>
            Back to project details
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={
              busy ||
              name.trim().length < 2 ||
              !/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)
            }
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "Create demo project"}
          </Button>
        </div>
      </div>
    </section>
  )
}
