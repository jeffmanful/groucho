"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  AnimatePresence,
  motion,
  MotionConfig,
} from "motion/react"
import { TextShimmer } from "@/components/doorcheck/TextShimmer"
import { cn } from "@/lib/utils"
import { DEFAULT_APPLICATION_OPENING_MESSAGE } from "@/lib/project-settings"

function createDoorcheckSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!url || !anon) return null
  return createClient(url, anon)
}

type Message = {
  id: string
  role: "bot" | "user"
  content: string
}

type PersonaOption = {
  id: string
  name: string
  is_active: boolean
  is_default: boolean
}

type ProjectOption = {
  id: string
  name: string
  slug: string
  organisationId: string
  organisationName: string
  projectType: "gatekeeper" | "onboarding"
  environment: "test" | "live" | null
  sessionMode: "live" | "dry-run" | null
  applicationOpeningMessage: string
  welcomeMessage: string | null
}

type OnboardingCurrentStep = {
  id: string
  title: string
  index: number
  total: number
  interaction?: {
    inputType: OpeningInputType
    options?: string[]
  }
}

type GrouchoInputType = "text" | "voice" | "singleSelect" | "multiSelect" | "ranking"

type GrouchoVisualState =
  | "idle"
  | "listening"
  | "thinking"
  | "curious"
  | "interested"
  | "evaluating"
  | "decision"

type GrouchoInteractionUi = {
  intent?: string
  inputType: GrouchoInputType
  emotionalState?: string
  visualState: GrouchoVisualState
  options?: string[]
}

type DecisionPhase = "none" | "evaluating" | "decision" | "revealed"

type OpeningInputType = "text" | "singleSelect" | "multiSelect"

type OpeningInteraction = {
  inputType: OpeningInputType
  options?: string[]
}

type ReviewerReport = {
  applicant_bio: string
  advisory_recommendation: "recommend" | "human_review" | "decline"
  confidence_score: number
  evidence_summary: string[]
  weak_or_missing_signals: string[]
  safety_or_integrity_flags: string[]
  reviewer_focus: string
}

const FORUM_APPLICATION_OPENING_QUESTION =
  "What brought you here?"

const FORUM_APPLICATION_OPENING_OPTIONS = [
  "Discover",
  "Community",
  "Share Work",
].join("\n")

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const APPLICANT_EMAIL_QUESTION = "What's the best email for your application?"

function doorcheckOpeningQuestion(project?: ProjectOption): string {
  const configured = project?.applicationOpeningMessage?.trim()
  if (configured && configured !== DEFAULT_APPLICATION_OPENING_MESSAGE) {
    return configured
  }
  return FORUM_APPLICATION_OPENING_QUESTION
}

const INITIAL_MESSAGES: Message[] = [
  {
    id: "initial-question",
    role: "bot",
    content: FORUM_APPLICATION_OPENING_QUESTION,
  },
]

const EMAIL_CAPTURE_MESSAGES: Message[] = [
  {
    id: "applicant-email",
    role: "bot",
    content: APPLICANT_EMAIL_QUESTION,
  },
]

const DEFAULT_GATEKEEPER_UI: GrouchoInteractionUi = {
  intent: "probe",
  inputType: "text",
  emotionalState: "neutral",
  visualState: "idle",
}

const SESSION_KEY = "pe_session_id"
const SECRET_KEY = "pe_session_secret"
const PROJECT_KEY = "pe_project_id"
const PROFILE_KEY = "pe_session_profile"
const REVIEWER_REPORT_KEY = "pe_session_reviewer_report"

const pickerSelectStyle: React.CSSProperties = {
  display: "block",
  marginTop: "0.5rem",
  background: "transparent",
  border: "none",
  color: "rgba(255,255,255,0.3)",
  outline: "none",
  fontSize: "0.7rem",
  fontFamily: "inherit",
  letterSpacing: "0.06em",
  cursor: "pointer",
  padding: 0,
  maxWidth: "100%",
}

/** Easings for handoff: thinking exit → reply enter */
const EASE_OUT = [0.33, 1, 0.68, 1] as const

/** One smooth thinking entrance: soft container + tight line stagger (no long dead air) */
const thinkingContainerVariants = {
  hidden: { opacity: 0, y: 8, filter: "blur(6px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      duration: 0.5,
      ease: EASE_OUT,
      staggerChildren: 0.07,
      delayChildren: 0.04,
    },
  },
  exit: {
    opacity: 0,
    y: -6,
    filter: "blur(3px)",
    transition: {
      duration: 0.32,
      ease: EASE_OUT,
    },
  },
} as const

const thinkingLineVariants = {
  hidden: { opacity: 0, y: 4 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.36, ease: EASE_OUT },
  },
} as const

/** Softer spring for reflow when new messages push older ones up */
const LAYOUT_SPRING = {
  type: "spring" as const,
  stiffness: 210,
  damping: 28,
  mass: 0.92,
}

const PRESENCE_GRID_SIZE = 9
const PRESENCE_CENTER = (PRESENCE_GRID_SIZE - 1) / 2
const PRESENCE_RADIUS = PRESENCE_CENTER + 0.15
const DOTS = Array.from(
  { length: PRESENCE_GRID_SIZE * PRESENCE_GRID_SIZE },
  (_, index) => {
    const row = Math.floor(index / PRESENCE_GRID_SIZE)
    const col = index % PRESENCE_GRID_SIZE
    return {
      id: index,
      row,
      col,
      visible:
        Math.hypot(row - PRESENCE_CENTER, col - PRESENCE_CENTER) <=
        PRESENCE_RADIUS,
    }
  },
)

function parseInteractionUi(raw: unknown): GrouchoInteractionUi {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_GATEKEEPER_UI
  }
  const data = raw as Record<string, unknown>
  const inputType =
    data.inputType === "singleSelect" ||
    data.inputType === "multiSelect" ||
    data.inputType === "ranking" ||
    data.inputType === "voice"
      ? data.inputType
      : "text"
  const visualState =
    data.visualState === "listening" ||
    data.visualState === "thinking" ||
    data.visualState === "curious" ||
    data.visualState === "interested" ||
    data.visualState === "evaluating" ||
    data.visualState === "decision"
      ? data.visualState
      : "idle"
  const options = Array.isArray(data.options)
    ? data.options.filter((item): item is string => typeof item === "string")
    : undefined
  return {
    intent: typeof data.intent === "string" ? data.intent : undefined,
    inputType,
    emotionalState:
      typeof data.emotionalState === "string" ? data.emotionalState : undefined,
    visualState,
    ...(options && options.length > 0 ? { options } : {}),
  }
}

function interactionUiForStep(step: OnboardingCurrentStep | null): GrouchoInteractionUi {
  return step?.interaction
    ? parseInteractionUi({
        ...step.interaction,
        visualState:
          step.interaction.inputType === "text" ? "idle" : "curious",
      })
    : DEFAULT_GATEKEEPER_UI
}

function serialiseInteractionSelection(
  inputType: GrouchoInputType,
  value: string | string[],
): string {
  if (inputType === "multiSelect" && Array.isArray(value)) {
    return value.length > 0 ? `Selected: ${value.join(", ")}` : ""
  }
  return Array.isArray(value) ? value.join(", ") : value.trim()
}

function parseOptionLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12)
}

function buildOpeningInteraction(
  inputType: OpeningInputType,
  optionsText: string,
): OpeningInteraction {
  if (inputType === "text") return { inputType: "text" }
  return {
    inputType,
    options: parseOptionLines(optionsText),
  }
}

function parseReviewerReport(raw: unknown): ReviewerReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  const recommendation = data.advisory_recommendation
  if (
    recommendation !== "recommend" &&
    recommendation !== "human_review" &&
    recommendation !== "decline"
  ) {
    return null
  }
  if (
    typeof data.applicant_bio !== "string" ||
    typeof data.confidence_score !== "number" ||
    typeof data.reviewer_focus !== "string"
  ) {
    return null
  }
  const textItems = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : []
  return {
    applicant_bio: data.applicant_bio,
    advisory_recommendation: recommendation,
    confidence_score: Math.max(0, Math.min(1, data.confidence_score)),
    evidence_summary: textItems(data.evidence_summary),
    weak_or_missing_signals: textItems(data.weak_or_missing_signals),
    safety_or_integrity_flags: textItems(data.safety_or_integrity_flags),
    reviewer_focus: data.reviewer_focus,
  }
}

function getOrCreateSession(): string {
  const existing = localStorage.getItem(SESSION_KEY)
  if (existing) return existing
  return resetSession()
}

function resetSession(): string {
  const id = crypto.randomUUID()
  localStorage.setItem(SESSION_KEY, id)
  return id
}

function ReviewerReportPanel({ report }: { report: ReviewerReport }) {
  const confidence = `${Math.round(report.confidence_score * 100)}%`
  const recommendation = report.advisory_recommendation.replace("_", " ")
  const listSection = (label: string, items: string[]) =>
    items.length ? (
      <div>
        <p className="mb-1 text-[0.62rem] uppercase tracking-[0.14em] text-white/32">
          {label}
        </p>
        <ul className="space-y-1.5 text-sm leading-relaxed text-white/58">
          {items.map((item, index) => (
            <li key={`${label}-${index}`}>{item}</li>
          ))}
        </ul>
      </div>
    ) : null

  return (
    <motion.section
      initial={{ opacity: 0, y: 10, filter: "blur(5px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
      className="mb-5 rounded-xl border border-white/10 bg-zinc-950/70 p-4 text-left shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-md"
      aria-label="Internal reviewer report"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[0.62rem] uppercase tracking-[0.16em] text-white/32">
            internal reviewer report
          </p>
          <p className="mt-1 text-sm text-white/45">
            Advisory only. Final decision stays with the client.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.12em] text-white/42">
          <span>{recommendation}</span>
          <span className="tabular-nums text-white/70">{confidence}</span>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-white/68">{report.applicant_bio}</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {listSection("evidence", report.evidence_summary)}
        {listSection("weak signals", report.weak_or_missing_signals)}
        {listSection("flags", report.safety_or_integrity_flags)}
        <div>
          <p className="mb-1 text-[0.62rem] uppercase tracking-[0.14em] text-white/32">
            reviewer focus
          </p>
          <p className="text-sm leading-relaxed text-white/58">
            {report.reviewer_focus}
          </p>
        </div>
      </div>
    </motion.section>
  )
}

export default function DoorCheck() {
  const supabase = useMemo(() => createDoorcheckSupabase(), [])
  const [messages, setMessages] = useState<Message[]>(EMAIL_CAPTURE_MESSAGES)
  const [input, setInput] = useState("")
  const [applicantEmail, setApplicantEmail] = useState("")
  const [applicantEmailError, setApplicantEmailError] = useState<string | null>(
    null,
  )
  const [loading, setLoading] = useState(false)
  const [concluded, setConcluded] = useState(false)
  const [sessionId, setSessionId] = useState("")
  const [personas, setPersonas] = useState<PersonaOption[]>([])
  const [selectedPersonaId, setSelectedPersonaId] = useState("")
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [signingOut, setSigningOut] = useState(false)
  const [currentStep, setCurrentStep] = useState<OnboardingCurrentStep | null>(
    null,
  )
  const [stepHint, setStepHint] = useState<string | null>(null)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [interactionUi, setInteractionUi] = useState<GrouchoInteractionUi>(
    DEFAULT_GATEKEEPER_UI,
  )
  const [reviewerReport, setReviewerReport] = useState<ReviewerReport | null>(
    null,
  )
  const [decisionPhase, setDecisionPhase] = useState<DecisionPhase>("none")
  const [openingMessage, setOpeningMessage] = useState(
    FORUM_APPLICATION_OPENING_QUESTION,
  )
  const openingInputType: OpeningInputType = "singleSelect"
  const openingOptionsText = FORUM_APPLICATION_OPENING_OPTIONS
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const typingChannelRef = useRef<ReturnType<SupabaseClient["channel"]> | null>(
    null,
  )
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Bot reply is committed after the thinking row exits so layout doesn’t stack two tails */
  const assistantHandoffRef = useRef<Message | null>(null)
  const pendingDecisionMessageRef = useRef<Message | null>(null)
  const bootstrapInFlightRef = useRef(false)
  const router = useRouter()

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    })
  }, [])

  /** Let layout animations start before scrolling so prior bubbles ease up smoothly */
  useEffect(() => {
    const id = window.setTimeout(() => scrollToBottom(), 72)
    return () => clearTimeout(id)
  }, [messages, loading, concluded, decisionPhase, reviewerReport, scrollToBottom])

  /**
   * If thinking unmounts without firing onExitComplete (very fast response),
   * still commit the assistant message after a short window.
   */
  useEffect(() => {
    if (loading) return
    const next = assistantHandoffRef.current
    if (!next) return
    const t = window.setTimeout(() => {
      if (assistantHandoffRef.current !== next) return
      assistantHandoffRef.current = null
      setMessages((prev) => [...prev, next])
    }, 520)
    return () => clearTimeout(t)
  }, [loading])

  useEffect(() => {
    setSessionId(getOrCreateSession())
  }, [])

  useEffect(() => {
    fetch("/api/admin/personas")
      .then((r) => r.json())
      .then((data: PersonaOption[]) => {
        const active = data.filter((p) => p.is_active)
        setPersonas(active)
        const def = active.find((p) => p.is_default)
        if (def) setSelectedPersonaId(def.id)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch("/api/doorcheck/projects")
      .then((r) => r.json())
      .then((data: ProjectOption[]) => {
        if (!Array.isArray(data)) return
        setProjects(data)
        const saved = localStorage.getItem(PROJECT_KEY)?.trim()
        const savedProject = saved ? data.find((p) => p.id === saved) : null
        const preferredForumProject =
          data.find((p) => p.slug === "forum-application") ??
          data.find((p) => p.name.toLowerCase() === "forum application") ??
          null
        const pick =
          (savedProject && savedProject.slug !== "default"
            ? savedProject.id
            : null) ??
          preferredForumProject?.id ??
          savedProject?.id ??
          data[0]?.id ??
          ""
        if (pick) {
          setSelectedProjectId(pick)
          const pickedProject = data.find((p) => p.id === pick)
          setOpeningMessage(doorcheckOpeningQuestion(pickedProject))
        }
      })
      .catch(() => {})
  }, [])

  const bootstrapSession = useCallback(
    async (
      sid: string,
      projectId: string,
      email: string,
      persona?: string,
      opener?: string,
      openingInteraction?: OpeningInteraction,
    ) => {
      if (bootstrapInFlightRef.current) return
      bootstrapInFlightRef.current = true
      setBootstrapping(true)
      try {
        const res = await fetch("/api/onboarding/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            sessionId: sid,
            projectId,
            personaId: persona,
            applicant: { email },
            ...(opener?.trim() ? { openingMessage: opener.trim() } : {}),
            ...(openingInteraction
              ? { openingInteraction }
              : {}),
          }),
        })
        const data = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >
        if (!res.ok) {
          const err =
            typeof data.error === "string"
              ? data.error
              : `Request failed (${res.status})`
          const detail =
            typeof data.detail === "string" ? ` — ${data.detail}` : ""
          throw new Error(`${err}${detail}`)
        }
        if (typeof data.message !== "string") {
          throw new Error("Invalid start response")
        }
        setMessages([
          {
            id: crypto.randomUUID(),
            role: "bot",
            content: data.message,
          },
        ])
        const step = (data.currentStep as OnboardingCurrentStep) ?? null
        setInteractionUi(step ? interactionUiForStep(step) : parseInteractionUi(data.ui))
        setDecisionPhase("none")
        setSelectedOptions([])
        setCurrentStep(step)
        setStepHint(
          typeof data.stepHint === "string" ? data.stepHint : null,
        )
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Something went wrong starting session."
        setMessages([
          {
            id: crypto.randomUUID(),
            role: "bot",
            content: msg.startsWith("Request failed") || msg.includes("Database")
              ? `${msg}. Check you are signed in, the project has onboarding steps, and DB migrations are applied.`
              : msg,
          },
        ])
        setInteractionUi(DEFAULT_GATEKEEPER_UI)
        setDecisionPhase("none")
        setCurrentStep(null)
        setStepHint(null)
      } finally {
        bootstrapInFlightRef.current = false
        setBootstrapping(false)
      }
    },
    [],
  )

  function applyProjectSelection(projectId: string) {
    setSelectedProjectId(projectId)
    localStorage.setItem(PROJECT_KEY, projectId)
    localStorage.removeItem(REVIEWER_REPORT_KEY)
    const newId = resetSession()
    setSessionId(newId)
    assistantHandoffRef.current = null
    setInput("")
    setConcluded(false)
    setDecisionPhase("none")
    setInteractionUi(DEFAULT_GATEKEEPER_UI)
    setSelectedOptions([])
    setCurrentStep(null)
    setStepHint(null)
    setReviewerReport(null)
    setApplicantEmailError(null)
    const proj = projects.find((p) => p.id === projectId)
    const opener = doorcheckOpeningQuestion(proj)
    setOpeningMessage(opener)
    if (proj && applicantEmail) {
      void bootstrapSession(
        newId,
        projectId,
        applicantEmail,
        selectedPersonaId || undefined,
        opener,
        buildOpeningInteraction(openingInputType, openingOptionsText),
      )
    }
  }

  useEffect(() => {
    if (!sessionId || !selectedProjectId || !applicantEmail || bootstrapping) return
    if (messages.length !== 0 && messages[0]?.id !== "initial-question") return
    void bootstrapSession(
      sessionId,
      selectedProjectId,
      applicantEmail,
      selectedPersonaId || undefined,
      openingMessage,
      buildOpeningInteraction(openingInputType, openingOptionsText),
    )
  }, [
    sessionId,
    selectedProjectId,
    applicantEmail,
    projects,
    bootstrapSession,
    selectedPersonaId,
    openingMessage,
    openingInputType,
    openingOptionsText,
    messages,
    bootstrapping,
  ])

  useEffect(() => {
    if (!sessionId || !applicantEmail || !supabase) return
    const ch = supabase.channel("pe-typing")
    ch.subscribe()
    typingChannelRef.current = ch
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      supabase.removeChannel(ch)
      typingChannelRef.current = null
    }
  }, [sessionId, applicantEmail, supabase])

  function broadcastTyping(isTyping: boolean) {
    typingChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { sessionId, isTyping },
    })
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInput(e.target.value)
    if (e.target.value) {
      broadcastTyping(true)
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = setTimeout(() => broadcastTyping(false), 2000)
    } else {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      broadcastTyping(false)
    }
  }

  async function submit(messageOverride?: string) {
    const text = (messageOverride ?? input).trim()
    if (!text || !applicantEmail || loading || concluded || !sessionId) return

    broadcastTyping(false)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)

    const isGatekeeperPreview = selectedProject?.projectType === "gatekeeper"
    if (!isGatekeeperPreview) {
      const userId = crypto.randomUUID()
      setMessages((prev) => [...prev, { id: userId, role: "user", content: text }])
    }
    setSelectedOptions([])
    setInput("")
    setLoading(true)

    try {
      const personaId = selectedPersonaId || undefined
      const projectId = selectedProjectId || undefined
      let res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          message: text,
          sessionId,
          personaId,
          projectId,
          applicant: { email: applicantEmail },
        }),
      })

      if (res.status === 409) {
        const freshId = resetSession()
        setSessionId(freshId)
        res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            message: text,
            sessionId: freshId,
            personaId,
            projectId,
            applicant: { email: applicantEmail },
          }),
        })
      }

      if (!res.ok) {
        let error = `Request failed with status ${res.status}.`
        try {
          const errorBody = await res.json()
          if (typeof errorBody.error === "string") error = errorBody.error
        } catch {
          /* keep fallback error */
        }
        throw new Error(error)
      }

      const data = await res.json()
      const nextMessage: Message = {
        id: crypto.randomUUID(),
        role: "bot",
        content: data.message,
      }
      const nextStep = (data.currentStep as OnboardingCurrentStep) ?? null
      const nextReviewerReport = parseReviewerReport(data.reviewerReport)
      const nextUi = nextStep
        ? interactionUiForStep(nextStep)
        : parseInteractionUi(data.ui)

      if (data.currentStep) {
        setCurrentStep(nextStep)
      } else if (data.status === "passed") {
        setCurrentStep(null)
      }
      setSelectedOptions([])
      setStepHint(
        typeof data.stepHint === "string" ? data.stepHint : null,
      )
      if (nextReviewerReport) {
        setReviewerReport(nextReviewerReport)
        try {
          localStorage.setItem(
            REVIEWER_REPORT_KEY,
            JSON.stringify(nextReviewerReport),
          )
        } catch {
          /* ignore */
        }
      }

      if (data.status === "passed") {
        setConcluded(true)
        if (data.profile) {
          try {
            localStorage.setItem(PROFILE_KEY, JSON.stringify(data.profile))
          } catch {
            /* ignore */
          }
        }
        const isOnboarding =
          selectedProject?.projectType === "onboarding" ||
          data.projectType === "onboarding"
        if (!isOnboarding) {
          pendingDecisionMessageRef.current = nextMessage
          setMessages([])
          setInteractionUi(nextUi)
          setDecisionPhase("evaluating")
          window.setTimeout(() => setDecisionPhase("decision"), 1400)
          window.setTimeout(() => {
            const pending = pendingDecisionMessageRef.current
            pendingDecisionMessageRef.current = null
            if (pending) setMessages([pending])
            setDecisionPhase("revealed")
          }, 2300)
        } else {
          assistantHandoffRef.current = nextMessage
        }
      } else if (data.status === "redirected" || data.status === "rejected") {
        setConcluded(true)
        if (isGatekeeperPreview) {
          pendingDecisionMessageRef.current = nextMessage
          setMessages([])
          setInteractionUi(nextUi)
          setDecisionPhase("evaluating")
          window.setTimeout(() => setDecisionPhase("decision"), 1400)
          window.setTimeout(() => {
            const pending = pendingDecisionMessageRef.current
            pendingDecisionMessageRef.current = null
            if (pending) setMessages([pending])
            setDecisionPhase("revealed")
          }, 2300)
        } else {
          assistantHandoffRef.current = nextMessage
        }
      } else if (isGatekeeperPreview) {
        setInteractionUi(nextUi)
        setDecisionPhase("none")
        setMessages([nextMessage])
      } else {
        assistantHandoffRef.current = nextMessage
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Something went wrong."
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "bot",
        content:
          detail === "AI service unavailable"
            ? "AI service unavailable. Turn on local test mode or check the model provider credits."
            : detail,
      }
      if (isGatekeeperPreview) {
        setMessages([errorMessage])
        setInteractionUi(DEFAULT_GATEKEEPER_UI)
        setDecisionPhase("none")
      } else {
        assistantHandoffRef.current = errorMessage
      }
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      if (applicantEmail) submit()
      else submitApplicantEmail()
    }
  }

  function submitApplicantEmail() {
    const email = input.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) {
      setApplicantEmailError("Enter a valid email address.")
      return
    }

    const newId = resetSession()
    localStorage.removeItem(REVIEWER_REPORT_KEY)
    setSessionId(newId)
    setApplicantEmail(email)
    setApplicantEmailError(null)
    setReviewerReport(null)
    setInput("")
    setMessages(INITIAL_MESSAGES)
  }

  function restart() {
    const newId = resetSession()
    localStorage.removeItem(SECRET_KEY)
    localStorage.removeItem(PROFILE_KEY)
    localStorage.removeItem(REVIEWER_REPORT_KEY)
    assistantHandoffRef.current = null
    pendingDecisionMessageRef.current = null
    setSessionId(newId)
    setInput("")
    setApplicantEmail("")
    setApplicantEmailError(null)
    setMessages(EMAIL_CAPTURE_MESSAGES)
    setConcluded(false)
    setDecisionPhase("none")
    setInteractionUi(DEFAULT_GATEKEEPER_UI)
    setSelectedOptions([])
    setCurrentStep(null)
    setStepHint(null)
    setReviewerReport(null)
    const def = personas.find((p) => p.is_default)
    if (def) setSelectedPersonaId(def.id)
    if (selectedProjectId) localStorage.setItem(PROJECT_KEY, selectedProjectId)
  }

  async function signOut() {
    setSigningOut(true)
    try {
      if (supabase) {
        await supabase.auth.signOut()
      }
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
    } catch {
      /* still send user to login */
    } finally {
      restart()
      setSigningOut(false)
      router.push("/login")
    }
  }

  const personaName =
    personas.find((item) => item.id === selectedPersonaId)?.name ?? "Lou"

  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  const isGatekeeperPreview = selectedProject?.projectType === "gatekeeper"
  const showConclusionActions =
    concluded && (!isGatekeeperPreview || decisionPhase === "revealed")
  const showReviewerReport = Boolean(showConclusionActions && reviewerReport)
  const currentBotMessage = [...messages].reverse().find((msg) => msg.role === "bot")
  const presenceState: GrouchoVisualState = loading || bootstrapping
    ? "thinking"
    : decisionPhase === "evaluating"
      ? "evaluating"
      : decisionPhase === "decision"
        ? "decision"
        : interactionUi.visualState
  const showStructuredOptions = Boolean(
    applicantEmail &&
    !concluded &&
    !loading &&
    !bootstrapping &&
    decisionPhase === "none" &&
    (interactionUi.inputType === "singleSelect" ||
      interactionUi.inputType === "multiSelect") &&
    interactionUi.options?.length,
  )
  const showAnswerArea =
    !concluded &&
    !bootstrapping &&
    (!isGatekeeperPreview || decisionPhase === "none")

  function projectLabel(p: ProjectOption): string {
    const bits = [p.name]
    if (p.organisationName) bits.push(p.organisationName)
    if (p.projectType === "onboarding") bits.push("onboarding")
    if (p.environment) bits.push(p.environment)
    return bits.join(" · ")
  }

  return (
    <MotionConfig
      reducedMotion="user"
      transition={{
        type: "spring",
        stiffness: 320,
        damping: 30,
      }}
    >
      <div className="relative flex h-screen min-h-0 flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-end px-4 pt-4 md:px-8">
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className="pointer-events-auto rounded-md border border-white/15 bg-zinc-950/80 px-3 py-1.5 text-[0.68rem] font-normal uppercase tracking-[0.12em] text-white/50 backdrop-blur-sm transition-colors hover:border-white/25 hover:text-white/75 disabled:cursor-wait disabled:opacity-50"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
        <div
          className="mx-auto flex w-[80%] max-w-[1040px] flex-1 min-h-0 flex-col overflow-y-auto pt-12 pb-4 scrollbar-hidden"
          aria-busy={loading || bootstrapping}
          aria-live="polite"
        >
          {currentStep && !concluded && !isGatekeeperPreview && (
            <p
              className="mb-4 shrink-0 text-[0.68rem] tracking-widest text-white/35"
              aria-live="polite"
            >
              {currentStep.title} · {currentStep.index + 1} of {currentStep.total}
            </p>
          )}
          <div className="mt-auto flex flex-col gap-5 pb-6">
            {isGatekeeperPreview ? (
              <motion.div
                key="v2-preview"
                initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.45, ease: EASE_OUT }}
                className="mx-auto grid min-h-68 w-full max-w-[520px] grid-rows-[6rem_minmax(7rem,1fr)] items-start gap-5 text-center md:min-h-76 md:grid-rows-[7rem_minmax(8rem,1fr)]"
              >
                <div
                  className={cn(
                    "mx-auto grid size-20 grid-cols-9 gap-1 rounded-full md:size-24",
                    `groucho-demo-presence--${presenceState}`,
                  )}
                  aria-hidden
                >
                  {DOTS.map((dot) => (
                    <span
                      key={dot.id}
                      className={cn(
                        "m-auto size-1.5 rounded-full bg-white/70 opacity-35 md:size-2",
                        !dot.visible && "invisible",
                      )}
                      style={{
                        animationDelay: `${(dot.col + dot.row) * 0.04}s`,
                      }}
                    />
                  ))}
                </div>

                {decisionPhase === "evaluating" ? (
                  <p className="self-start text-sm tracking-[0.08em] text-white/35">
                    Groucho is considering…
                  </p>
                ) : null}

                {currentBotMessage && decisionPhase !== "evaluating" && decisionPhase !== "decision" ? (
                  <div className="mx-auto flex min-h-28 max-w-120 flex-col justify-start space-y-2 md:min-h-32">
                    <p className="font-sans text-sm text-white/35">{personaName}</p>
                    <p className="whitespace-pre-wrap font-sans text-xl leading-[1.42] text-white/85 md:text-2xl">
                      {currentBotMessage.content}
                    </p>
                  </div>
                ) : bootstrapping ? (
                  <p className="self-start text-sm tracking-[0.08em] text-white/35">
                    Connecting…
                  </p>
                ) : null}
              </motion.div>
            ) : (
              messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  layout
                  initial={{
                    opacity: 0,
                    y: 12,
                    x: msg.role === "user" ? 14 : -14,
                  }}
                  animate={{ opacity: 1, y: 0, x: 0 }}
                  transition={{
                    layout: LAYOUT_SPRING,
                    opacity: { duration: 0.38, ease: EASE_OUT },
                    y: {
                      type: "spring",
                      stiffness: 360,
                      damping: 34,
                      mass: 0.88,
                    },
                    x: {
                      type: "spring",
                      stiffness: 360,
                      damping: 34,
                      mass: 0.88,
                    },
                  }}
                  className={cn(
                    "max-w-[65%] leading-[1.6]",
                    msg.role === "user" ? "self-end" : "self-start",
                    msg.role === "user" ? "opacity-100" : "opacity-70",
                  )}
                >
                  {msg.role === "bot" ? (
                    <div className="font-sans text-md opacity-50">
                      {personaName}
                    </div>
                  ) : null}

                  <div className="font-sans text-lg leading-[1.6] md:text-2xl">
                    {msg.content}
                  </div>
                </motion.div>
              ))
            )}

            {!isGatekeeperPreview && (
              <div
                className={cn(
                  "self-start w-full max-w-[65%]",
                  loading && "min-h-22 scroll-mt-8 md:min-h-26",
                )}
              >
                <AnimatePresence
                  mode="wait"
                  initial={false}
                  onExitComplete={() => {
                    const next = assistantHandoffRef.current
                    assistantHandoffRef.current = null
                    if (next) {
                      setMessages((prev) => [...prev, next])
                    }
                  }}
                >
                  {loading ? (
                    <motion.div
                      key="thinking"
                      layout
                      variants={thinkingContainerVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      transition={{ layout: LAYOUT_SPRING }}
                      className="w-full"
                    >
                      <motion.div
                        variants={thinkingLineVariants}
                        className="font-sans text-md opacity-50"
                      >
                        {personaName}
                      </motion.div>
                      <motion.div
                        variants={thinkingLineVariants}
                        className="font-sans text-lg md:text-xl"
                      >
                        <TextShimmer className="italic">Reading you.</TextShimmer>
                      </motion.div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            )}

            {showReviewerReport && reviewerReport ? (
              <motion.div
                key="reviewer-report-main"
                layout
                initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.35, ease: EASE_OUT }}
                className={cn(
                  "mx-auto w-full",
                  isGatekeeperPreview ? "max-w-[720px]" : "max-w-[85%]",
                )}
              >
                <ReviewerReportPanel report={reviewerReport} />
              </motion.div>
            ) : null}

            <div ref={bottomRef} className="h-8 w-full shrink-0" aria-hidden />
          </div>
        </div>

        {showConclusionActions && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="mx-auto w-[80%] max-w-[1040px] shrink-0 pt-4 pb-20"
          >
            <button
              type="button"
              onClick={restart}
              style={{
                background: "transparent",
                border: "none",
                borderBottom: "1px solid rgba(255,255,255,0.15)",
                color: "rgba(255,255,255,0.25)",
                outline: "none",
                padding: "0.5rem 0",
                fontSize: "0.7rem",
                fontFamily: "inherit",
                letterSpacing: "0.08em",
                cursor: "pointer",
              }}
            >
              start over
            </button>
          </motion.div>
        )}

        {showAnswerArea && (
          <motion.div
            className="mx-auto w-[80%] max-w-[1040px] shrink-0 pt-4 pb-20"
            animate={{ opacity: 1 }}
            transition={{ duration: 0.22 }}
          >
            {loading ? (
              <div
                className="pointer-events-none relative h-13.5 w-full overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.025)] backdrop-blur-md"
                aria-hidden
              >
                <motion.div
                  className="absolute inset-y-0 left-0 w-1/3 bg-linear-to-r from-transparent via-white/8 to-transparent"
                  initial={{ x: "-100%" }}
                  animate={{ x: ["-100%", "320%"] }}
                  transition={{
                    duration: 1.15,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />
              </div>
            ) : showStructuredOptions ? (
              <div className="relative w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-md">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {interactionUi.options?.map((option) => {
                    const active = selectedOptions.includes(option)
                    return (
                      <button
                        key={option}
                        type="button"
                        disabled={loading}
                        aria-pressed={active}
                        onClick={() => {
                          if (interactionUi.inputType === "singleSelect") {
                            void submit(option)
                            return
                          }
                          setSelectedOptions((prev) =>
                            prev.includes(option)
                              ? prev.filter((item) => item !== option)
                              : [...prev, option],
                          )
                        }}
                        className={cn(
                          "rounded-full border px-4 py-2 text-sm transition-colors",
                          active
                            ? "border-white/45 bg-white/10 text-white/85"
                            : "border-white/12 bg-zinc-950/70 text-white/55 hover:border-white/25 hover:text-white/80",
                        )}
                      >
                        {option}
                      </button>
                    )
                  })}
                </div>
                {interactionUi.inputType === "multiSelect" ? (
                  <button
                    type="button"
                    disabled={loading || selectedOptions.length === 0}
                    onClick={() =>
                      void submit(
                        serialiseInteractionSelection(
                          "multiSelect",
                          selectedOptions,
                        ),
                      )
                    }
                    className="mx-auto mt-3 block rounded-md border border-white/15 bg-transparent px-3 py-1.5 text-[0.7rem] tracking-[0.08em] text-white/50 transition-colors hover:border-white/25 hover:text-white/75 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    continue
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="relative">
                <input
                  ref={inputRef}
                  type={applicantEmail ? "text" : "email"}
                  value={input}
                  onChange={(event) => {
                    if (!applicantEmail) setApplicantEmailError(null)
                    handleInputChange(event)
                  }}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  disabled={loading}
                  placeholder={
                    applicantEmail
                      ? stepHint?.trim() ||
                        (selectedProject?.projectType === "onboarding"
                          ? "Your answer"
                          : "Type your message")
                      : "you@example.com"
                  }
                  autoComplete={applicantEmail ? "off" : "email"}
                  aria-disabled={loading}
                  className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 py-3.5 pl-5 pr-5 font-inherit text-lg font-normal text-white/95 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] outline-none backdrop-blur-md transition-[border-color,box-shadow,background-color,opacity] duration-200 placeholder:text-white/38 selection:bg-white/20 selection:text-white focus:border-white/18 focus:bg-zinc-950/85 focus:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_0_0_1px_rgba(255,255,255,0.06)] focus:ring-2 focus:ring-white/10 disabled:cursor-wait disabled:opacity-55"
                />
              <AnimatePresence>
                {loading && (
                  <motion.div
                    key="input-bar"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="pointer-events-none absolute bottom-0 left-5 right-5 h-px overflow-hidden rounded-full bg-white/12"
                  >
                    <motion.div
                      className="absolute top-0 h-full w-[38%] rounded-full bg-white/50"
                      initial={{ left: "-38%" }}
                      animate={{ left: ["-38%", "100%"] }}
                      transition={{
                        duration: 1.05,
                        repeat: Infinity,
                        ease: "linear",
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              </div>
            )}
            {applicantEmailError ? (
              <p className="mt-2 text-sm text-red-300" role="alert">
                {applicantEmailError}
              </p>
            ) : null}
            {messages.length === 1 && projects.length >= 1 && (
              <select
                value={selectedProjectId}
                onChange={(e) => applyProjectSelection(e.target.value)}
                style={pickerSelectStyle}
                aria-label="Project"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id} style={{ background: "#000" }}>
                    {projectLabel(p)}
                  </option>
                ))}
              </select>
            )}
            {messages.length === 1 && personas.length >= 1 && (
              <select
                value={selectedPersonaId}
                onChange={(e) => setSelectedPersonaId(e.target.value)}
                style={pickerSelectStyle}
                aria-label="Persona"
              >
                {personas.map((p) => (
                  <option key={p.id} value={p.id} style={{ background: "#000" }}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            {messages.length === 1 && selectedProject && (
              <p
                style={{
                  marginTop: "0.5rem",
                  fontSize: "0.62rem",
                  opacity: 0.28,
                  letterSpacing: "0.04em",
                }}
              >
                {selectedProject.projectType}
                {selectedProject.sessionMode
                  ? ` · sessions ${selectedProject.sessionMode}`
                  : ""}
              </p>
            )}
          </motion.div>
        )}
      </div>
      <style jsx global>{`
        .groucho-demo-presence--idle span {
          animation: groucho-demo-presence-idle 2.4s ease-in-out infinite;
        }
        .groucho-demo-presence--listening span {
          animation: groucho-demo-presence-listening 1.6s ease-in-out infinite;
        }
        .groucho-demo-presence--thinking span {
          animation: groucho-demo-presence-thinking 1.1s ease-in-out infinite;
        }
        .groucho-demo-presence--curious span {
          animation: groucho-demo-presence-curious 1.8s ease-in-out infinite;
        }
        .groucho-demo-presence--interested span {
          animation: groucho-demo-presence-interested 1.2s ease-in-out infinite;
        }
        .groucho-demo-presence--evaluating span {
          animation: groucho-demo-presence-evaluating 1.35s linear infinite;
        }
        .groucho-demo-presence--decision span {
          animation: groucho-demo-presence-decision 2s ease-in-out infinite;
        }
        @keyframes groucho-demo-presence-idle {
          0%,
          100% {
            opacity: 0.18;
            transform: scale(0.86);
          }
          50% {
            opacity: 0.5;
            transform: scale(1);
          }
        }
        @keyframes groucho-demo-presence-listening {
          0%,
          100% {
            opacity: 0.22;
            transform: scale(0.9);
          }
          50% {
            opacity: 0.82;
            transform: scale(1.08);
          }
        }
        @keyframes groucho-demo-presence-thinking {
          0%,
          100% {
            opacity: 0.14;
            transform: translateY(0);
          }
          50% {
            opacity: 0.7;
            transform: translateY(-1px);
          }
        }
        @keyframes groucho-demo-presence-curious {
          0%,
          100% {
            opacity: 0.3;
            transform: translateX(0);
          }
          50% {
            opacity: 0.75;
            transform: translateX(1px);
          }
        }
        @keyframes groucho-demo-presence-interested {
          0%,
          100% {
            opacity: 0.35;
            transform: scale(0.95);
          }
          50% {
            opacity: 0.95;
            transform: scale(1.05);
          }
        }
        @keyframes groucho-demo-presence-evaluating {
          0%,
          100% {
            opacity: 0.25;
          }
          50% {
            opacity: 0.85;
          }
        }
        @keyframes groucho-demo-presence-decision {
          0%,
          100% {
            opacity: 0.45;
            transform: scale(0.92);
          }
          50% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </MotionConfig>
  )
}
