"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type {
  ApplicantIdentity,
  OpeningInteraction,
  Profile,
  ReviewerReport,
  ScoreBreakdown,
  SessionOutcome,
  StartSessionResponse,
} from "../client.js"
import { GrouchoApiError } from "../errors.js"
import { useGroucho } from "./context.js"
import { Composer } from "./Composer.js"
import { OutcomeBanner } from "./OutcomeBanner.js"
import { ResumeSessionPrompt } from "./ResumeSessionPrompt.js"
import { ThinkingIndicator } from "./ThinkingIndicator.js"
import { Transcript, type TranscriptLine } from "./Transcript.js"

const STORAGE_PREFIX = "groucho.session:"
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SLOW_RESPONSE_DELAY_MS = 6000

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
      reviewerReport?: ReviewerReport
      applicant?: ApplicantIdentity
    },
  ) => void
  applicant?: ApplicantIdentity | null
  collectApplicant?: boolean
  renderHeader?: () => ReactNode
  renderFooter?: () => ReactNode
  className?: string
  transcriptLabel?: string
  /** Ask before restoring an existing active session (default: true) */
  confirmResume?: boolean
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
  confirmResume = true,
}: GatekeeperProps) {
  const client = useGroucho()
  const [internalId, setInternalId] = useState<string | null>(null)
  const [replacementSession, setReplacementSession] = useState<{
    id: string
    sourceSessionId?: string
  } | null>(null)

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

  const replacementId =
    replacementSession && replacementSession.sourceSessionId === sessionIdProp
      ? replacementSession.id
      : null
  const sessionId = replacementId ?? sessionIdProp ?? internalId ?? ""

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
  const [failedAnswer, setFailedAnswer] = useState<string | null>(null)
  const [showSlowResponse, setShowSlowResponse] = useState(false)
  const [outcome, setOutcome] = useState<SessionOutcome>("active")
  const [pendingResume, setPendingResume] =
    useState<StartSessionResponse | null>(null)
  const bootstrappedSessionRef = useRef<string | null>(null)
  const bootstrapInFlightRef = useRef(false)
  const slowResponseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (slowResponseTimerRef.current) {
        clearTimeout(slowResponseTimerRef.current)
      }
    },
    [],
  )

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

  const applyStartResponse = useCallback(
    (res: StartSessionResponse, activeSessionId: string) => {
      setLines([
        {
          id: `a_bootstrap_${activeSessionId}`,
          role: "assistant",
          content: res.message,
        },
      ])
    },
    [],
  )

  const startOver = useCallback(() => {
    const newId = crypto.randomUUID()
    if (typeof window !== "undefined" && !sessionIdProp) {
      sessionStorage.setItem(STORAGE_PREFIX + window.location.pathname, newId)
    }
    bootstrappedSessionRef.current = null
    setPendingResume(null)
    setReplacementSession({ id: newId, sourceSessionId: sessionIdProp })
    setLines([])
    setDraft("")
    setError(null)
    setFailedAnswer(null)
    setShowSlowResponse(false)
    setOutcome("active")
  }, [sessionIdProp])

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
        if (confirmResume && res.resumed === true) {
          setPendingResume(res)
          return
        }
        applyStartResponse(res, sessionId)
      })
      .catch((e) => {
        if (e instanceof GrouchoApiError && e.status === 409) {
          setPendingResume(null)
          setOutcome("active")
          setLines([])
          bootstrappedSessionRef.current = null
          if (typeof window !== "undefined") {
            const key = STORAGE_PREFIX + window.location.pathname
            if (!sessionIdProp) {
              const newId = crypto.randomUUID()
              sessionStorage.setItem(key, newId)
              setReplacementSession({ id: newId })
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
    confirmResume,
    applyStartResponse,
  ])

  const send = useCallback(async (messageOverride?: string, isRetry = false) => {
    const text = (messageOverride ?? draft).trim()
    if (!text || !sessionId || loading || terminal || needsApplicant) return

    setError(null)
    setFailedAnswer(null)
    setShowSlowResponse(false)
    setLoading(true)
    setDraft("")
    if (!isRetry) {
      const userLine: ChatLine = {
        id: `u_${Date.now()}`,
        role: "user",
        content: text,
      }
      setLines((prev) => [...prev, userLine])
    }
    slowResponseTimerRef.current = setTimeout(
      () => setShowSlowResponse(true),
      SLOW_RESPONSE_DELAY_MS,
    )

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
          ...(res.reviewerReport !== undefined
            ? { reviewerReport: res.reviewerReport }
            : {}),
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
            setReplacementSession({ id: newId })
            setError("This session has ended — starting a new one.")
          } else {
            setError("This session has ended. Start a new session id from your host.")
          }
        }
        return
      }
      setError(e instanceof Error ? e.message : "Something went wrong.")
      setFailedAnswer(text)
      setDraft(text)
    } finally {
      if (slowResponseTimerRef.current) {
        clearTimeout(slowResponseTimerRef.current)
        slowResponseTimerRef.current = null
      }
      setShowSlowResponse(false)
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
        <div className="groucho-error-panel" role="alert">
          <p className="groucho-error">{error}</p>
          {failedAnswer ? (
            <button
              type="button"
              className="groucho-retry"
              onClick={() => void send(failedAnswer, true)}
              disabled={loading}
            >
              Retry answer
            </button>
          ) : null}
        </div>
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
      ) : pendingResume ? (
        <ResumeSessionPrompt
          onContinue={() => {
            applyStartResponse(pendingResume, sessionId)
            setPendingResume(null)
          }}
          onStartOver={startOver}
        />
      ) : (
        <>
          <Transcript lines={transcriptLines} label={transcriptLabel} />
          <ThinkingIndicator visible={loading || bootstrapping} />
          {loading ? (
            <p className="groucho-muted groucho-wait-message" aria-live="polite">
              {showSlowResponse
                ? "Still with you — thoughtful answers can take a little longer."
                : "Considering your answer…"}
            </p>
          ) : null}
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
