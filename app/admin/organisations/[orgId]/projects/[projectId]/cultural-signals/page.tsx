"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import type { CulturalSignalSnapshot, CulturalSignalsSettings } from "@/lib/cultural-signal-contract"

type View = {
  project: { id: string; name: string }
  config: CulturalSignalsSettings
  snapshot: CulturalSignalSnapshot | null
}

const panel: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: "1.25rem", marginTop: "1rem",
}

export default function CulturalSignalsPage() {
  const { orgId, projectId } = useParams<{ orgId: string; projectId: string }>()
  const endpoint = `/api/admin/organisations/${orgId}/projects/${projectId}/cultural-signals`
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch(endpoint, { credentials: "same-origin" })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? "Could not load cultural signals")
    setView(body)
  }, [endpoint])

  useEffect(() => {
    // Data loading is the external synchronization performed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((err) => setError(err.message))
  }, [load])

  async function act(body: Record<string, unknown>) {
    setBusy(true); setError("")
    try {
      const response = await fetch(endpoint, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error ?? "Update failed")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed")
    } finally { setBusy(false) }
  }

  if (!view && !error) return <main style={{ padding: "2rem" }}>Loading cultural signals…</main>
  return (
    <main style={{ padding: "2rem", maxWidth: 980, margin: "0 auto" }}>
      <Link href={`/admin/organisations/${orgId}/projects/${projectId}/edit`}>← Project settings</Link>
      <h1 style={{ marginBottom: ".4rem" }}>Cultural signals</h1>
      <p style={{ opacity: .7 }}>Internal aggregate memory for {view?.project.name ?? "this project"}.</p>
      {error && <p role="alert" style={{ color: "#ff8c8c" }}>{error}</p>}

      <section style={panel}>
        <h2 style={{ marginTop: 0 }}>Privacy boundary</h2>
        <p>No responses, quotes, applicants, or source conversations are shown here. Signals appear only after at least 5 distinct completed sessions, or 10 for sensitive categories. The window is 90 days.</p>
        <p style={{ marginBottom: 0 }}><strong>Conversation use is locked off.</strong> This information does not change what Groucho asks.</p>
      </section>

      <section style={panel}>
        <h2 style={{ marginTop: 0 }}>Collection</h2>
        <p>{view?.config.enabled ? "Enabled for newly completed, non-bot sessions." : "Off by default. No cultural signal events are collected for this project."}</p>
        <button disabled={busy} onClick={() => act({ action: "set_enabled", enabled: !view?.config.enabled })}>
          {view?.config.enabled ? "Disable collection" : "Enable collection"}
        </button>
        {view?.config.enabled && <button style={{ marginLeft: ".75rem" }} disabled={busy} onClick={() => act({ action: "rebuild" })}>Rebuild snapshot</button>}
      </section>

      {view?.config.enabled && view.snapshot && <>
        <section style={panel}>
          <h2 style={{ marginTop: 0 }}>Community picture</h2>
          <p style={{ opacity: .7 }}>{view.snapshot.eligibleSessionCount} eligible sessions · generated {new Date(view.snapshot.generatedAt).toLocaleString()}</p>
          {view.snapshot.signals.length === 0 ? <p>No signal has crossed its privacy threshold yet.</p> :
            <div style={{ display: "grid", gap: ".65rem" }}>{view.snapshot.signals.map((signal) =>
              <div key={`${signal.type}:${signal.normalizedKey}`} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", borderBottom: "1px solid rgba(255,255,255,.08)", paddingBottom: ".65rem" }}>
                <span>{signal.displayLabel}<small style={{ opacity: .55, marginLeft: ".5rem" }}>{signal.type.replaceAll("_", " ")}</small></span>
                <span>{signal.frequencyBand} · {signal.trend} · {signal.distinctSessions} sessions</span>
              </div>)}</div>}
        </section>

        <section style={panel}>
          <h2 style={{ marginTop: 0 }}>Emerging themes awaiting review</h2>
          <p>These have crossed the privacy threshold but remain excluded until COLORS approves them.</p>
          {view.snapshot.pendingEmergingSignals.length === 0 ? <p>Nothing awaiting review.</p> :
            view.snapshot.pendingEmergingSignals.map((signal) => <div key={signal.normalizedKey} style={{ marginTop: ".75rem" }}>
              <span style={{ marginRight: "1rem" }}>{signal.displayLabel} · {signal.distinctSessions} sessions</span>
              <button disabled={busy} onClick={() => act({ action: "review_emerging", normalizedKey: signal.normalizedKey, status: "approved" })}>Approve</button>
              <button style={{ marginLeft: ".5rem" }} disabled={busy} onClick={() => act({ action: "review_emerging", normalizedKey: signal.normalizedKey, status: "suppressed" })}>Suppress</button>
            </div>)}
        </section>
      </>}
    </main>
  )
}
