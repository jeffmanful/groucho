"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/arc/button/button"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"
import styles from "@/components/admin/admin-access.module.css"

type Invitation = { email: string; expires_at: string }
export default function AdminInvitationPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [currentEmail, setCurrentEmail] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [code, setCode] = useState("")
  const [unavailable, setUnavailable] = useState(false)
  const path = `/invite/admin/${token}`
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/invitations/admin/${token}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) {
          if (res.status === 410) setUnavailable(true)
          throw new Error(body.error)
        }
        if (!controller.signal.aborted) setInvitation(body)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!controller.signal.aborted)
          setCurrentEmail(data.user?.email ?? null)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [token])
  async function accept() {
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/invitations/admin/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      router.push("/admin")
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept invitation.")
    } finally {
      setBusy(false)
    }
  }
  async function sendEmail() {
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/invitations/admin/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "email" }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      setEmailSent(true)
      setNotice(
        "Check your inbox. Follow the sign-in link, or enter the verification code if your email includes one. Then accept your invitation here.",
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "Email sign-in failed.")
    } finally {
      setBusy(false)
    }
  }
  async function verifyCode() {
    if (!invitation) return
    setBusy(true)
    setError("")
    try {
      const { data, error } =
        await createSupabaseBrowserClient().auth.verifyOtp({
          email: invitation.email,
          token: code.trim(),
          type: "email",
        })
      if (error) throw error
      setCurrentEmail(data.user?.email ?? null)
      setNotice("Email verified. You can now accept the invitation.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Code could not be verified.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className={`${styles.page} ${styles.invitePage}`}>
      <h1>You’re invited to administer Groucho</h1>
      {error && (
        <p role="alert" className={styles.message}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.message}>
          {notice}
        </p>
      )}
      {!invitation && !error && <p role="status">Loading invitation…</p>}
      {invitation && !unavailable && (
        <>
          <p>
            This invitation is for <strong>{invitation.email}</strong> and
            expires {new Date(invitation.expires_at).toLocaleDateString()}.
          </p>
          <p>
            Accepting gives you platform admin access across all organisations,
            projects and dashboard settings.
          </p>
          {currentEmail ? (
            <>
              <p>Signed in as {currentEmail}.</p>
              <Button
                loading={busy}
                disabled={
                  busy || currentEmail.toLowerCase() !== invitation.email
                }
                onClick={accept}
              >
                Accept admin invitation
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await fetch("/api/auth/logout", {
                      method: "POST",
                    })
                    if (!r.ok) throw Error("Sign out failed.")
                    setCurrentEmail(null)
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "Sign out failed.",
                    )
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Use another account
              </Button>
            </>
          ) : (
            <>
              <Link href={`/api/auth/google?next=${encodeURIComponent(path)}`}>
                Continue with Google
              </Link>
              <Link href={`/login?next=${encodeURIComponent(path)}`}>
                Sign in with a Groucho password
              </Link>
              <Button variant="secondary" disabled={busy} onClick={sendEmail}>
                {emailSent ? "Send email again" : "Sign in by email"}
              </Button>
              {emailSent && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void verifyCode()
                  }}
                >
                  <label>
                    Verification code
                    <input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                      maxLength={10}
                    />
                  </label>
                  <Button disabled={busy || !code.trim()} type="submit">
                    Verify code
                  </Button>
                </form>
              )}
            </>
          )}
        </>
      )}
    </main>
  )
}
