"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type {
  ApplicantIdentity,
  GrouchoInteractionUi,
  OpeningInteraction,
  Profile,
  ReviewerReport,
  ScoreBreakdown,
  SessionOutcome,
} from "../client.js"
import { GrouchoApiError } from "../errors.js"
import { useGroucho } from "./context.js"
import {
  DEFAULT_DECISION_DURATION_MS,
  DEFAULT_EVALUATING_DURATION_MS,
  DEFAULT_EVALUATING_LABEL,
  type DecisionPhase,
  isTerminalOutcome,
  presenceForDecisionPhase,
  shouldShowEvaluatingLabel,
  shouldShowInteractionInput,
  shouldShowQuestion,
} from "./decision-moment.js"
import { DotMatrixPresence } from "./DotMatrixPresence.js"
import {
  DEFAULT_GATEKEEPER_UI,
  turnFromStartResponse,
} from "./gatekeeper-turn.js"
import { InteractionInput } from "./InteractionInput.js"
import { OutcomeBanner } from "./OutcomeBanner.js"

const STORAGE_PREFIX = "groucho.session:"
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type TurnState = {
  message: string
  ui: GrouchoInteractionUi
}

export type GatekeeperV2Props = {
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
  /** Show terminal outcome banner (default: hidden in V2) */
  showOutcome?: boolean
  /** Pause before revealing terminal copy (default: false) */
  decisionMoment?: boolean
  evaluatingDurationMs?: number
  decisionDurationMs?: number
  evaluatingLabel?: string
  renderHeader?: () => ReactNode
  renderFooter?: () => ReactNode
  className?: string
}

export function GatekeeperV2({
  sessionId: sessionIdProp,
  onSessionId,
  personaId,
  openingMessage,
  openingInteraction,
  onOutcome,
  applicant: applicantProp,
  collectApplicant = true,
  showOutcome = false,
  decisionMoment = false,
  evaluatingDurationMs = DEFAULT_EVALUATING_DURATION_MS,
  decisionDurationMs = DEFAULT_DECISION_DURATION_MS,
  evaluatingLabel = DEFAULT_EVALUATING_LABEL,
  renderHeader,
  renderFooter,
  className,
}: GatekeeperV2Props) {
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

  const [applicantEmail, setApplicantEmail] = useState(applicantProp?.email ?? "")
  const [submittedApplicant, setSubmittedApplicant] =
    useState<ApplicantIdentity | null>(applicantProp ?? null)
  const [turn, setTurn] = useState<TurnState | null>(null)
  const [decisionPhase, setDecisionPhase] = useState<DecisionPhase>("none")
  const [loading, setLoading] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<SessionOutcome>("active")
  const bootstrappedSessionRef = useRef<string | null>(null)
  const bootstrapInFlightRef = useRef(false)
  const pendingTerminalTurnRef = useRef<TurnState | null>(null)

  const terminal = isTerminalOutcome(outcome)

  const activeApplicant = applicantProp ?? submittedApplicant
  const needsApplicant = collectApplicant && !activeApplicant

  const presenceState = presenceForDecisionPhase({
    loading,
    bootstrapping,
    decisionPhase,
    turnVisualState: turn?.ui.visualState ?? DEFAULT_GATEKEEPER_UI.visualState,
  })

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
    if (decisionPhase !== "evaluating") return
    const id = window.setTimeout(() => setDecisionPhase("decision"), evaluatingDurationMs)
    return () => window.clearTimeout(id)
  }, [decisionPhase, evaluatingDurationMs])

  useEffect(() => {
    if (decisionPhase !== "decision") return
    const id = window.setTimeout(() => {
      setDecisionPhase("revealed")
      if (pendingTerminalTurnRef.current) {
        setTurn(pendingTerminalTurnRef.current)
        pendingTerminalTurnRef.current = null
      }
    }, decisionDurationMs)
    return () => window.clearTimeout(id)
  }, [decisionPhase, decisionDurationMs])

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
        setDecisionPhase("none")
        setTurn(turnFromStartResponse(res))
      })
      .catch((e) => {
        if (e instanceof GrouchoApiError && e.status === 409) {
          setOutcome("active")
          setTurn(null)
          setDecisionPhase("none")
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

  const beginTerminalReveal = useCallback(
    (nextTurn: TurnState) => {
      if (!decisionMoment) {
        setTurn(nextTurn)
        setDecisionPhase("revealed")
        return
      }
      pendingTerminalTurnRef.current = nextTurn
      setTurn(null)
      setDecisionPhase("evaluating")
    },
    [decisionMoment],
  )

  const send = useCallback(
    async (message: string) => {
      const text = message.trim()
      if (!text || !sessionId || loading || terminal || needsApplicant) return
      if (decisionPhase === "evaluating" || decisionPhase === "decision") return

      setError(null)
      setLoading(true)

      try {
        const res = await client.sendMessage(sessionId, {
          message: text,
          personaId: personaId ?? null,
          applicant: activeApplicant,
        })

        const nextTurn: TurnState = {
          message: res.message,
          ui: res.ui ?? DEFAULT_GATEKEEPER_UI,
        }

        setOutcome(res.status)

        if (isTerminalOutcome(res.status)) {
          beginTerminalReveal(nextTurn)
          onOutcome?.(res.status, {
            scores: res.scores,
            ...(res.secret !== undefined ? { secret: res.secret } : {}),
            ...(res.profile !== undefined ? { profile: res.profile } : {}),
            ...(res.reviewerReport !== undefined
              ? { reviewerReport: res.reviewerReport }
              : {}),
            ...(activeApplicant ? { applicant: activeApplicant } : {}),
          })
        } else {
          setDecisionPhase("none")
          setTurn(nextTurn)
        }
      } catch (e) {
        if (e instanceof GrouchoApiError && e.status === 409) {
          setOutcome("active")
          setTurn(null)
          setDecisionPhase("none")
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
      } finally {
        setLoading(false)
      }
    },
    [
      client,
      loading,
      onOutcome,
      personaId,
      sessionId,
      sessionIdProp,
      activeApplicant,
      needsApplicant,
      terminal,
      decisionPhase,
      beginTerminalReveal,
    ],
  )

  const showQuestion = shouldShowQuestion({
    decisionPhase,
    terminal,
    hasTurn: turn !== null,
  })

  const showEvaluatingLabel = shouldShowEvaluatingLabel(decisionPhase)

  const showInput = shouldShowInteractionInput({
    terminal,
    bootstrapping,
    loading,
    decisionPhase,
    hasTurn: turn !== null,
  })

  if (!sessionId) {
    return (
      <div
        className={`groucho-root groucho-gatekeeper-v2 groucho-gatekeeper-v2--loading${className ? ` ${className}` : ""}`}
      >
        <p className="groucho-muted">Loading…</p>
      </div>
    )
  }

  return (
    <div
      className={`groucho-root groucho-gatekeeper-v2${className ? ` ${className}` : ""}`}
    >
      {renderHeader?.()}
      {showOutcome ? <OutcomeBanner status={outcome} /> : null}
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
        <div className="groucho-v2">
          <DotMatrixPresence visualState={presenceState} />
          {showEvaluatingLabel ? (
            <p className="groucho-muted groucho-v2__status" aria-live="polite">
              {evaluatingLabel}
            </p>
          ) : null}
          {showQuestion && turn ? (
            <p className="groucho-v2__question">{turn.message}</p>
          ) : bootstrapping ? (
            <p className="groucho-muted groucho-v2__status">Connecting…</p>
          ) : null}
          {showInput && turn ? (
            <InteractionInput
              ui={turn.ui}
              disabled={loading}
              onSubmit={(message) => void send(message)}
            />
          ) : null}
        </div>
      )}
      {renderFooter?.()}
    </div>
  )
}
