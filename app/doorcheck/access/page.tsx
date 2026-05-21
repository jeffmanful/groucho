"use client"

import { useState, useEffect } from "react"

const PROFILE_KEY = "pe_session_profile"

function profileSummary(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null
  const p = profile as Record<string, unknown>
  const core = p.core
  if (core && typeof core === "object" && !Array.isArray(core)) {
    const summary = (core as Record<string, unknown>).summary
    if (typeof summary === "string" && summary.trim()) {
      return summary.trim()
    }
  }
  return null
}

export default function Access() {
  const [welcomeLine, setWelcomeLine] = useState<string | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROFILE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        const line = profileSummary(parsed)
        if (line) setWelcomeLine(line)
      }
    } catch {
      /* ignore */
    }
  }, [])

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 2rem",
      }}
    >
      <div style={{ maxWidth: "360px", textAlign: "center" }}>
        <p
          style={{
            fontSize: "1rem",
            lineHeight: 1.55,
            letterSpacing: "0.02em",
            margin: 0,
          }}
        >
          Thank you for your application.
        </p>
        {welcomeLine ? (
          <p
            style={{
              fontSize: "0.8rem",
              lineHeight: 1.55,
              opacity: 0.5,
              marginTop: "1.25rem",
            }}
          >
            {welcomeLine}
          </p>
        ) : null}
      </div>
    </div>
  )
}
