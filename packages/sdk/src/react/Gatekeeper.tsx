"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type {
  ApplicantIdentity,
  OpeningInteraction,
  Profile,
  ScoreBreakdown,
  SessionOutcome,
} from "../client.js"
import { GrouchoApiError } from "../errors.js"
import { useGroucho } from "./context.js"
import { Composer } from "./Composer.js"
import { OutcomeBanner } from "./OutcomeBanner.js"
import { ThinkingIndicator } from "./ThinkingIndicator.js"
import { Transcript, type TranscriptLine } from "./Transcript.js"

const STORAGE_PREFIX = "groucho.session:"
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type GatekeeperProps = {
  sessionId?: string
  onSessionId?: (id: string) => void
  personaId?: string | null
  /** Gatekeeper opener for new sessions; falls back to project config when omitted */
  openingMessage?: string
  /** Initial input shape for new gatekeeper sessions */
  openingInteraction?: OpeningInteraction | null
  onOutcome?: (
    outcome: SessionOutcome,
    meta: {
      scores: ScoreBreakdown
      secret?: string
      profile?: Profile
      applicant?: ApplicantIdentity
    },
  ) => void
  applicant?: ApplicantIdentity | null
  collectApplicant?: boolean
  renderHeader?: () => ReactNode
  renderFooter?: () => ReactNode
  className?: string
  transcriptLabel?: string
}

type ChatLine = { id: string; role: "user" | "assistant"; content: string }

export function Gatekeeper({
  sessionId: sessionIdProp,
  onSessionId,
  personaId,
  openingMessage,
  openingInteraction,
  onOutcome,
  applicant: applicantProp,
  collectApplicant = true,
  renderHeader,
  renderFooter,
  className,
  transcriptLabel,
}: GatekeeperProps) {
  const client = useGroucho()
  const [internalId, setInternalId] = useState<string | null>(null)

  useEffect(() => {
    if (sessionIdProp) return
    if (typeof window === "undefined") return
    const key = STORAGE_PREFIX + window.location.pathname
    let id = sessionStorage.getItem(key)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(key, id)
    }
    setInternalId(id)
  }, [sessionIdProp])

  const sessionId = sessionIdProp ?? internalId ?? ""

  useEffect(() => {
    if (sessionId) onSessionId?.(sessionId)
  }, [sessionId, onSessionId])

  const [draft, setDraft] = useState("")
  const [applicantEmail, setApplicantEmail] = useState(applicantProp?.email ?? "")
  const [submittedApplicant, setSubmittedApplicant] =
    useState<ApplicantIdentity | null>(applicantProp ?? null)
  const [lines, setLines] = useState<ChatLine[]>([])
  const [loading, setLoading] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<SessionOutcome>("active")
  const bootstrappedSessionRef = useRef<string | null>(null)
  const bootstrapInFlightRef = useRef(false)

  const terminal =
    outcome === "passed" ||
    outcome === "redirected" ||
    outcome === "rejected"

  const activeApplicant = applicantProp ?? submittedApplicant
  const needsApplicant = collectApplicant && !activeApplicant

  const submitApplicant = useCallback(() => {
    const email = applicantEmail.trim().toLowerCase()
    if (!email) {
      setError("Email is required to start this application.")
      return
    }
    if (!EMAIL_RE.test(email)) {
      setError("Enter a valid email address.")
      return
    }
    setError(null)
    setSubmittedApplicant({ email })
  }, [applicantEmail])

  useEffect(() => {
    if (!sessionId || needsApplicant || terminal) return
    if (bootstrappedSessionRef.current === sessionId) return
    if (bootstrapInFlightRef.current) return

    bootstrapInFlightRef.current = true
    setBootstrapping(true)
    setError(null)

    void client
      .startSession(sessionId, {
        personaId: personaId ?? null,
        applicant: activeApplicant,
        ...(openingMessage ? { openingMessage } : {}),
        ...(openingInteraction ? { openingInteraction } : {}),
      })
      .then((res) => {
        bootstrappedSessionRef.current = sessionId
        setLines([
          {
            id: `a_bootstrap_${sessionId}`,
            role: "assistant",
            content: res.message,
          },
        ])
      })
      .catch((e) => {
        if (e instanceof GrouchoApiError && e.status === 409) {
          setOutcome("active")
          setLines([])
          bootstrappedSessionRef.current = null
          if (typeof window !== "undefined") {
            const key = STORAGE_PREFIX + window.location.pathname
            if (!sessionIdProp) {
              const newId = crypto.randomUUID()
              sessionStorage.setItem(key, newId)
              setInternalId(newId)
              setError("This session has ended — starting a new one.")
            } else {
              setError("This session has ended. Start a new session id from your host.")
            }
          }
          return
        }
        setError(e instanceof Error ? e.message : "Something went wrong.")
      })
      .finally(() => {
        bootstrapInFlightRef.current = false
        setBootstrapping(false)
      })
  }, [
    sessionId,
    needsApplicant,
    terminal,
    client,
    personaId,
    activeApplicant,
    sessionIdProp,
    openingMessage,
    openingInteraction,
  ])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || !sessionId || loading || terminal || needsApplicant) return

    setError(null)
    setLoading(true)
    setDraft("")
    const userLine: ChatLine = {
      id: `u_${Date.now()}`,
      role: "user",
      content: text,
    }
    setLines((prev) => [...prev, userLine])

    try {
      const res = await client.sendMessage(sessionId, {
        message: text,
        personaId: personaId ?? null,
        applicant: activeApplicant,
      })
      const assistantLine: ChatLine = {
        id: `a_${Date.now()}`,
        role: "assistant",
        content: res.message,
      }
      setLines((prev) => [...prev, assistantLine])
      setOutcome(res.status)
      if (res.status !== "active") {
        onOutcome?.(res.status, {
          scores: res.scores,
          ...(res.secret !== undefined ? { secret: res.secret } : {}),
          ...(res.profile !== undefined ? { profile: res.profile } : {}),
          ...(activeApplicant ? { applicant: activeApplicant } : {}),
        })
      }
    } catch (e) {
      if (e instanceof GrouchoApiError && e.status === 409) {
        setOutcome("active")
        setLines([])
        if (typeof window !== "undefined") {
          const key = STORAGE_PREFIX + window.location.pathname
          if (!sessionIdProp) {
            const newId = crypto.randomUUID()
            sessionStorage.setItem(key, newId)
            setInternalId(newId)
            setError("This session has ended — starting a new one.")
          } else {
            setError("This session has ended. Start a new session id from your host.")
          }
        }
        return
      }
      setError(e instanceof Error ? e.message : "Something went wrong.")
      setDraft(text)
    } finally {
      setLoading(false)
    }
  }, [
    client,
    draft,
    loading,
    onOutcome,
    personaId,
    sessionId,
    sessionIdProp,
    activeApplicant,
    needsApplicant,
    terminal,
  ])

  const transcriptLines: TranscriptLine[] = useMemo(
    () => lines.map((l) => ({ ...l })),
    [lines],
  )

  if (!sessionId) {
    return (
      <div className={`groucho-root groucho-gatekeeper groucho-gatekeeper--loading${className ? ` ${className}` : ""}`}>
        <p className="groucho-muted">Loading…</p>
      </div>
    )
  }

  return (
    <div
      className={`groucho-root groucho-gatekeeper${className ? ` ${className}` : ""}`}
    >
      {renderHeader?.()}
      <OutcomeBanner status={outcome} />
      {error ? (
        <p className="groucho-error" role="alert">
          {error}
        </p>
      ) : null}
      {needsApplicant ? (
        <form
          className="groucho-applicant-form"
          onSubmit={(e) => {
            e.preventDefault()
            submitApplicant()
          }}
        >
          <label className="groucho-field">
            <span className="groucho-field__label">Email</span>
            <input
              className="groucho-field__input"
              type="email"
              value={applicantEmail}
              onChange={(e) => setApplicantEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <button type="submit" className="groucho-composer__send">
            Start
          </button>
        </form>
      ) : (
        <>
          <Transcript lines={transcriptLines} label={transcriptLabel} />
          <ThinkingIndicator visible={loading || bootstrapping} />
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={() => void send()}
            disabled={loading || bootstrapping || terminal}
            inputLabel={transcriptLabel ? `${transcriptLabel} input` : "Your message"}
          />
        </>
      )}
      {renderFooter?.()}
    </div>
  )
}
