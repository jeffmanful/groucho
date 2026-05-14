"use client"

import Link from "next/link"
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase-browser"
import { useCallback, useEffect, useState } from "react"

function slugify(str: string) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

type MeOrg = { id: string; name: string; slug: string; created_at: string; role: string }

export default function OrganisationSignupPage() {
  const [email, setEmail] = useState("")
  const [otpSent, setOtpSent] = useState(false)
  const [code, setCode] = useState("")
  const [sessionReady, setSessionReady] = useState(false)

  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugManual, setSlugManual] = useState(false)

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [created, setCreated] = useState<{ id: string; name: string; slug: string } | null>(null)
  const [myOrgs, setMyOrgs] = useState<MeOrg[] | null>(null)

  useEffect(() => {
    if (!slugManual) setSlug(slugify(name))
  }, [name, slugManual])

  const refreshMe = useCallback(async () => {
    const res = await fetch("/api/me/organisations", { credentials: "same-origin" })
    if (res.ok) {
      const data: MeOrg[] = await res.json()
      setMyOrgs(data)
    }
  }, [])

  useEffect(() => {
    const supabase = tryCreateSupabaseBrowserClient()
    if (!supabase) {
      void refreshMe()
      return
    }
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (session?.user) setSessionReady(true)
      await refreshMe()
    })()
  }, [refreshMe])

  async function sendOtp() {
    const trimmed = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setMsg("Enter a valid email.")
      return
    }
    setBusy(true)
    setMsg(null)
    const supabase = tryCreateSupabaseBrowserClient()
    if (!supabase) {
      setMsg("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.")
      setBusy(false)
      return
    }
    const origin =
      typeof window !== "undefined" ? `${window.location.origin}/signup/organisation` : undefined
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: origin,
      },
    })
    setBusy(false)
    if (error) {
      setMsg(error.message)
      return
    }
    setOtpSent(true)
    setMsg("Check your email for the 6-digit code.")
  }

  async function verifyCode() {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || code.trim().length < 6) return
    setBusy(true)
    setMsg(null)
    const supabase = tryCreateSupabaseBrowserClient()
    if (!supabase) {
      setMsg("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.")
      setBusy(false)
      return
    }
    const { error } = await supabase.auth.verifyOtp({
      email: trimmed,
      token: code.trim(),
      type: "email",
    })
    setBusy(false)
    if (error) {
      setMsg(error.message)
      return
    }
    setSessionReady(true)
    setMsg("Signed in. Choose a name and URL slug for your organisation below.")
    await refreshMe()
  }

  async function createOrganisation(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await fetch("/api/organisations/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ name: name.trim(), slug }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg(body.error ?? "Could not create organisation")
      return
    }
    setCreated({ id: body.id, name: body.name, slug: body.slug })
    setMsg(null)
    await refreshMe()
  }

  if (created) {
    return (
      <div style={{ padding: "2.5rem", maxWidth: "28rem", margin: "0 auto" }}>
        <h1
          style={{
            fontSize: "0.7rem",
            letterSpacing: "0.14em",
            opacity: 0.4,
            marginBottom: "0.75rem",
          }}
        >
          Organisation ready
        </h1>
        <p style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>{created.name}</p>
        <p style={{ fontSize: "0.8rem", opacity: 0.45, marginBottom: "1.5rem", fontFamily: "monospace" }}>
          {created.slug} · <span style={{ opacity: 0.7 }}>{created.id}</span>
        </p>
        <p style={{ fontSize: "0.85rem", opacity: 0.55, lineHeight: 1.5, marginBottom: "1.5rem" }}>
          You are the <strong style={{ color: "#fafafa" }}>owner</strong> in Groucho. The operator
          console at <code style={{ opacity: 0.8 }}>/admin</code> stays password-gated for platform
          staff; your org exists for invitations, API keys, and future member dashboards.
        </p>
        <a href="/signup/organisation" style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.55)" }}>
          Create another organisation
        </a>
      </div>
    )
  }

  return (
    <div style={{ padding: "2.5rem", maxWidth: "28rem", margin: "0 auto" }}>
      <h1
        style={{
          fontSize: "0.7rem",
          letterSpacing: "0.14em",
          opacity: 0.4,
          marginBottom: "0.5rem",
        }}
      >
        Create an organisation
      </h1>
      <p style={{ fontSize: "0.85rem", opacity: 0.5, marginBottom: "1.75rem" }}>
        No invite required. Sign in with email, then name your org.
      </p>

      {msg && (
        <p style={{ fontSize: "0.85rem", marginBottom: "1rem", opacity: 0.75 }}>
          {msg}
        </p>
      )}

      {!sessionReady && (
        <>
          <label
            style={{
              display: "block",
              fontSize: "0.65rem",
              letterSpacing: "0.1em",
              opacity: 0.35,
              marginBottom: "0.35rem",
            }}
          >
            Email
          </label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={otpSent}
            type="email"
            autoComplete="email"
            style={{
              width: "100%",
              maxWidth: "22rem",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#fff",
              padding: "0.5rem 0.75rem",
              fontSize: "0.9rem",
              marginBottom: "1rem",
              boxSizing: "border-box",
            }}
          />
          {!otpSent ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void sendOtp()}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.35)",
                color: "#fafafa",
                padding: "0.5rem 1rem",
                cursor: busy ? "wait" : "pointer",
                fontSize: "0.8rem",
              }}
            >
              Email me a sign-in code
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="6-digit code"
                autoComplete="one-time-code"
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.2)",
                  color: "#fff",
                  padding: "0.5rem 0.75rem",
                  fontSize: "1rem",
                  letterSpacing: "0.2em",
                  maxWidth: "12rem",
                }}
              />
              <button
                type="button"
                disabled={busy || code.trim().length < 6}
                onClick={() => void verifyCode()}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.35)",
                  color: "#fafafa",
                  padding: "0.5rem 1rem",
                  cursor: busy ? "wait" : "pointer",
                  fontSize: "0.8rem",
                  alignSelf: "flex-start",
                }}
              >
                Verify and continue
              </button>
            </div>
          )}
        </>
      )}

      {sessionReady && (
        <form onSubmit={createOrganisation} style={{ marginTop: sessionReady ? "1.5rem" : 0 }}>
          <div style={{ marginBottom: "1rem" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.65rem",
                letterSpacing: "0.1em",
                opacity: 0.35,
                marginBottom: "0.35rem",
              }}
            >
              Organisation name (2–128 characters)
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={128}
              style={{
                width: "100%",
                maxWidth: "22rem",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid rgba(255,255,255,0.15)",
                color: "#fff",
                padding: "0.45rem 0",
                fontSize: "0.9rem",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginBottom: "1.25rem" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.65rem",
                letterSpacing: "0.1em",
                opacity: 0.35,
                marginBottom: "0.35rem",
              }}
            >
              URL slug (unique across Groucho)
            </label>
            <input
              value={slug}
              onChange={(e) => {
                setSlugManual(true)
                setSlug(e.target.value)
              }}
              required
              style={{
                width: "100%",
                maxWidth: "22rem",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid rgba(255,255,255,0.15)",
                color: "#fff",
                padding: "0.45rem 0",
                fontSize: "0.9rem",
                fontFamily: "monospace",
                boxSizing: "border-box",
              }}
            />
          </div>
          <button
            type="submit"
            disabled={busy || name.trim().length < 2}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.35)",
              color: "#fafafa",
              padding: "0.5rem 1rem",
              cursor: busy ? "wait" : "pointer",
              fontSize: "0.8rem",
            }}
          >
            {busy ? "…" : "Create organisation"}
          </button>
        </form>
      )}

      {sessionReady && myOrgs && myOrgs.length > 0 && (
        <div style={{ marginTop: "2rem", paddingTop: "1.5rem", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <p style={{ fontSize: "0.65rem", letterSpacing: "0.1em", opacity: 0.35, marginBottom: "0.5rem" }}>
            Your memberships
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "0.82rem", opacity: 0.55 }}>
            {myOrgs.map((o) => (
              <li key={o.id} style={{ padding: "0.35rem 0" }}>
                {o.name} <span style={{ opacity: 0.4 }}>({o.role})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p style={{ marginTop: "2.5rem", fontSize: "0.72rem", opacity: 0.3 }}>
        <Link href="/login" style={{ color: "rgba(255,255,255,0.45)" }}>
          Platform operator login →
        </Link>
      </p>
    </div>
  )
}
