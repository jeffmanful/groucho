"use client"

import { safeAuthPath } from "@/lib/auth-redirect"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import styles from "./login.module.css"

export default function LoginForm({
  initialError,
  nextPath,
  demoLogin = false,
}: {
  initialError: string
  nextPath: string
  demoLogin?: boolean
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(initialError)
  const [loading, setLoading] = useState(false)
  const [rejected, setRejected] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setRejected(false)
    setLoading(true)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        const requestedPath = new URLSearchParams(window.location.search).get(
          "next",
        )
        const safePath = safeAuthPath(requestedPath ?? nextPath)
        router.push(
          data.role === "colors_demo_tester"
            ? safePath === "/demo/colors" ||
              safePath === "/demos" ||
              safePath.startsWith("/demos/")
              ? safePath
              : "/demos"
            : safePath,
        )
        router.refresh()
        return
      }
      if (res.status === 429) {
        setError("Too many attempts. Wait a minute, then try again.")
      } else {
        setError("That email and password didn't match. Check them and try again.")
        setRejected(true)
        setPassword("")
      }
    } catch {
      setError("Groucho couldn't be reached. Check your connection and try again.")
    }
    setLoading(false)
  }

  // Focus the password field once it is enabled again after a rejected attempt.
  useEffect(() => {
    if (rejected && !loading) passwordRef.current?.focus()
  }, [rejected, loading])

  const passwordInvalid = rejected

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/login" className={styles.brand} aria-label="Groucho sign in">
          groucho<span>.</span>
        </Link>
        {demoLogin ? (
          <Link href="/login" className={styles.headerLink}>Admin sign in</Link>
        ) : (
          <Link href="/demos" className={styles.headerLink}>View demos</Link>
        )}
      </header>

      <main className={styles.main}>
        <div className={styles.panel}>
          <div className={styles.intro}>
            <h1 className={styles.title}>{demoLogin ? "Open the demo" : "Sign in to Groucho"}</h1>
            <p className={styles.lede}>
              {demoLogin
                ? "Sign in with the demo account you were given to try the COLORS application flow."
                : "Review applications and manage your projects."}
            </p>
          </div>

          {!demoLogin ? (
            <>
              <a href={`/api/auth/google?next=${encodeURIComponent(nextPath)}`} className={styles.google}>
                Continue with Google
              </a>
              <div className={styles.divider} aria-hidden="true">
                <span />or<span />
              </div>
            </>
          ) : null}

          <form onSubmit={handleSubmit} className={styles.form}>
            {error ? (
              <div role="alert" className={styles.alert}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 5v3.5M8 10.8v.01" />
                </svg>
                <span>{error}</span>
              </div>
            ) : null}
            <label className={styles.field}>
              {demoLogin ? "Demo email" : "Email"}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={demoLogin ? "tester@company.com" : "you@company.com"}
                autoComplete="username"
                required
                autoFocus
                disabled={loading}
                className={styles.input}
              />
            </label>
            <div className={styles.field}>
              <label htmlFor="login-password">Password</label>
              <span className={passwordInvalid ? styles.passwordInvalid : styles.password}>
                <input
                  id="login-password"
                  ref={passwordRef}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={loading}
                  aria-invalid={passwordInvalid || undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </div>
            <button type="submit" disabled={loading} className={styles.submit} aria-busy={loading || undefined}>
              {loading ? "Signing in…" : demoLogin ? "Open demo" : "Sign in"}
            </button>
          </form>

          <div className={styles.footer}>
            {demoLogin ? (
              <span>
                No demo account? <Link href="/demos">Browse the public demos</Link>
              </span>
            ) : (
              <>
                <span>
                  New to Groucho? <Link href="/signup/organisation">Create an organisation</Link>
                </span>
                <span>Invited to a team? Open the link in your invitation email.</span>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
