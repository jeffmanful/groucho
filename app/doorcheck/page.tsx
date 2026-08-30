"use client"

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
} from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { MessageScroller } from "@shadcn/react/message-scroller"
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
  evidence_references: Array<{
    signal_key: string
    signal_label: string
    source_message_id: string
    excerpt: string
  }>
  weak_or_missing_signals: string[]
  safety_or_integrity_flags: string[]
  reviewer_focus: string
}

const FORUM_APPLICATION_OPENING_QUESTION =
  "Why do you want to be an early applicant for the Forum?"

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

type DoorcheckScene = {
  id: "threshold" | "signal" | "studio" | "gathering" | "reflection" | "afterglow"
  eyebrow: string
  caption: string
}

type ColorsVisual = {
  id: "latin-mafia" | "fireboy-dml" | "violin-portrait" | "ho99o9"
  src: string
  layout: "full" | "right" | "corner"
  position: string
}

const COLORS_VISUALS: ColorsVisual[] = [
  {
    id: "latin-mafia",
    src: "/doorcheck/colors/latin-mafia.jpg",
    layout: "corner",
    position: "50% 32%",
  },
  {
    id: "fireboy-dml",
    src: "/doorcheck/colors/fireboy-dml.jpg",
    layout: "full",
    position: "50% 36%",
  },
  {
    id: "violin-portrait",
    src: "/doorcheck/colors/violin-portrait.jpg",
    layout: "right",
    position: "50% 50%",
  },
  {
    id: "ho99o9",
    src: "/doorcheck/colors/ho99o9.jpg",
    layout: "right",
    position: "50% 44%",
  },
]

function colorsVisualForQuestion(question: string): ColorsVisual {
  const copy = question.toLowerCase()
  if (/artist|music|song|sound|album|listen/.test(copy)) return COLORS_VISUALS[3]
  if (/make|work|build|create|process|practice|project/.test(copy)) return COLORS_VISUALS[2]
  if (/people|community|forum|together|room|belong/.test(copy)) return COLORS_VISUALS[0]
  if (/honest|feel|think|why|learn|change|matter/.test(copy)) return COLORS_VISUALS[1]

  const hash = Array.from(question).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  )
  return COLORS_VISUALS[hash % COLORS_VISUALS.length]
}

function sceneForQuestion(
  question: string,
  presenceState: GrouchoVisualState,
  concluded: boolean,
): DoorcheckScene {
  if (concluded || presenceState === "decision" || presenceState === "evaluating") {
    return { id: "afterglow", eyebrow: "The last word", caption: "A view is forming" }
  }

  const copy = question.toLowerCase()
  if (/music|song|sound|listen|album|artist/.test(copy)) {
    return { id: "signal", eyebrow: "On your wavelength", caption: "Signal / noise" }
  }
  if (/make|work|build|create|process|practice|project/.test(copy)) {
    return { id: "studio", eyebrow: "Inside the work", caption: "Work in progress" }
  }
  if (/people|community|forum|together|room|belong/.test(copy)) {
    return { id: "gathering", eyebrow: "The room around us", caption: "People make the place" }
  }
  if (/honest|feel|think|why|learn|change|matter/.test(copy)) {
    return { id: "reflection", eyebrow: "A little closer", caption: "No stock answers" }
  }
  return { id: "threshold", eyebrow: "At the door", caption: "Come as you are" }
}

function TypewriterQuestion({ text }: { text: string }) {
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const [visibleText, setVisibleText] = useState(reduceMotion ? text : "")
  const [complete, setComplete] = useState(reduceMotion)

  useEffect(() => {
    if (reduceMotion) return

    let index = 0
    let timer = 0
    const baseDelay = Math.max(9, Math.min(24, 1180 / Math.max(text.length, 1)))

    const typeNextCharacter = () => {
      index += 1
      setVisibleText(text.slice(0, index))
      if (index >= text.length) {
        setComplete(true)
        return
      }
      const character = text[index - 1]
      const punctuationPause = /[.!?]/.test(character) ? 85 : /[,;:]/.test(character) ? 42 : 0
      timer = window.setTimeout(typeNextCharacter, baseDelay + punctuationPause)
    }

    timer = window.setTimeout(() => {
      setVisibleText("")
      setComplete(false)
      timer = window.setTimeout(typeNextCharacter, 120)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [reduceMotion, text])

  return (
    <p className="doorcheck-question-text" aria-label={text}>
      <span aria-hidden="true">{visibleText}</span>
      <span
        className={cn("doorcheck-type-cursor", complete && "doorcheck-type-cursor--resting")}
        aria-hidden="true"
      />
    </p>
  )
}

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
  const evidenceReferences = Array.isArray(data.evidence_references)
    ? data.evidence_references.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return []
        const value = item as Record<string, unknown>
        return typeof value.signal_key === "string" &&
          typeof value.signal_label === "string" &&
          typeof value.source_message_id === "string" &&
          typeof value.excerpt === "string"
          ? [{
              signal_key: value.signal_key,
              signal_label: value.signal_label,
              source_message_id: value.source_message_id,
              excerpt: value.excerpt,
            }]
          : []
      })
    : []
  return {
    applicant_bio: data.applicant_bio,
    advisory_recommendation: recommendation,
    confidence_score: Math.max(0, Math.min(1, data.confidence_score)),
    evidence_summary: textItems(data.evidence_summary),
    evidence_references: evidenceReferences,
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
      {report.evidence_references.length > 0 ? (
        <div className="mt-4">
          <p className="mb-1 text-[0.62rem] uppercase tracking-[0.14em] text-white/32">
            source-linked evidence
          </p>
          <ul className="space-y-2 text-sm leading-relaxed text-white/58">
            {report.evidence_references.map((reference) => (
              <li key={`${reference.signal_key}-${reference.source_message_id}`}>
                <span className="text-white/72">{reference.signal_label}:</span>{" "}
                {reference.excerpt}{" "}
                <span className="font-mono text-[0.65rem] text-white/28">
                  [{reference.source_message_id.slice(0, 8)}]
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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
  const openingInputType: OpeningInputType = "text"
  const openingOptionsText = ""
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [isSpeaking, setIsSpeaking] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const typingChannelRef = useRef<ReturnType<SupabaseClient["channel"]> | null>(
    null,
  )
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Bot reply is committed after the thinking row exits so layout doesn’t stack two tails */
  const assistantHandoffRef = useRef<Message | null>(null)
  const bootstrapInFlightRef = useRef(false)
  const router = useRouter()

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "0px"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  }, [])

  useLayoutEffect(() => {
    resizeTextarea()
  }, [input, applicantEmail, loading, interactionUi.inputType, resizeTextarea])

  useEffect(() => {
    window.addEventListener("resize", resizeTextarea)
    return () => window.removeEventListener("resize", resizeTextarea)
  }, [resizeTextarea])

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

  function handleInputChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
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
          setMessages([nextMessage])
          setInteractionUi(nextUi)
          setDecisionPhase("revealed")
        } else {
          assistantHandoffRef.current = nextMessage
        }
      } else if (data.status === "redirected" || data.status === "rejected") {
        setConcluded(true)
        if (isGatekeeperPreview) {
          setMessages([nextMessage])
          setInteractionUi(nextUi)
          setDecisionPhase("revealed")
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

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
  const isColorsProject =
    isGatekeeperPreview &&
    selectedProject?.organisationName.trim().toLowerCase() === "colors"
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
  const doorcheckScene = sceneForQuestion(
    currentBotMessage?.content ?? "",
    presenceState,
    concluded,
  )
  const colorsVisual = colorsVisualForQuestion(currentBotMessage?.content ?? "")
  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window

  useEffect(() => {
    window.speechSynthesis?.cancel()
    const frame = window.requestAnimationFrame(() => setIsSpeaking(false))
    return () => {
      window.cancelAnimationFrame(frame)
      window.speechSynthesis?.cancel()
    }
  }, [currentBotMessage?.id])

  function toggleQuestionAudio() {
    if (!speechSupported || !currentBotMessage) return
    if (isSpeaking) {
      window.speechSynthesis.cancel()
      setIsSpeaking(false)
      return
    }

    const utterance = new SpeechSynthesisUtterance(currentBotMessage.content)
    utterance.rate = 0.92
    utterance.pitch = 0.96
    utterance.onend = () => setIsSpeaking(false)
    utterance.onerror = () => setIsSpeaking(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    setIsSpeaking(true)
  }

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
      <div
        className={cn(
          "relative flex h-[100dvh] min-h-0 flex-col overflow-hidden",
          isGatekeeperPreview && "doorcheck-stage",
          isColorsProject && "colors-doorcheck",
        )}
        data-scene={isGatekeeperPreview ? doorcheckScene.id : undefined}
      >
        {isGatekeeperPreview ? (
          <div className="doorcheck-backdrop" aria-hidden="true">
            {isColorsProject ? (
              <div
                className="colors-doorcheck-media"
                data-media-slot="conversation-scene"
                data-layout={colorsVisual.layout}
              >
                {COLORS_VISUALS.map((visual) => (
                  <div
                    key={visual.id}
                    className="colors-doorcheck-media__visual"
                    data-active={visual.id === colorsVisual.id}
                    data-layout={visual.layout}
                  >
                    <Image
                      src={visual.src}
                      alt=""
                      fill
                      unoptimized
                      sizes={visual.layout === "full" ? "100vw" : "60vw"}
                      priority={visual.id === colorsVisual.id}
                      style={{ objectPosition: visual.position }}
                    />
                  </div>
                ))}
                <div className="colors-doorcheck-media__veil" />
              </div>
            ) : (
              <>
                <div className="doorcheck-media" data-media-slot="conversation-scene">
                  <div className="doorcheck-media__shape doorcheck-media__shape--one" />
                  <div className="doorcheck-media__shape doorcheck-media__shape--two" />
                  <div className="doorcheck-media__grain" />
                  <p className="doorcheck-media__caption">
                    <span>{doorcheckScene.caption}</span>
                    <span>Groucho / door check</span>
                  </p>
                </div>
                <div className="doorcheck-colour-field" />
              </>
            )}
          </div>
        ) : null}
        <header
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center px-4 pt-4 md:px-8",
            isGatekeeperPreview ? "justify-between" : "justify-end",
          )}
        >
          {isGatekeeperPreview ? (
            <div className="pointer-events-auto flex items-center gap-3 text-[0.66rem] uppercase tracking-[0.18em] text-white/72">
              {isColorsProject ? (
                <span className="colors-doorcheck-wordmark">COLORS*STUDIOS</span>
              ) : (
                <>
                  <span className="doorcheck-brand-mark" aria-hidden="true" />
                  <span>Groucho / Door check</span>
                </>
              )}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            {isColorsProject ? (
              <span className="colors-doorcheck-project-label">
                {selectedProject?.name ?? "Forum application"}
              </span>
            ) : null}
            {isGatekeeperPreview ? (
              <button
                type="button"
                onClick={toggleQuestionAudio}
                disabled={!speechSupported || !currentBotMessage}
                aria-pressed={isSpeaking}
                aria-label={isSpeaking ? "Stop reading the question" : "Listen to the question"}
                className="doorcheck-utility-button pointer-events-auto"
              >
                <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
                  {isSpeaking ? (
                    <path d="M8 8h8v8H8z" fill="currentColor" />
                  ) : (
                    <>
                      <path d="M5 10v4h3l4 3V7L8 10H5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                      <path d="M15 9.5c.8.65 1.2 1.48 1.2 2.5s-.4 1.85-1.2 2.5M17.5 7c1.55 1.3 2.32 2.97 2.32 5s-.77 3.7-2.32 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </>
                  )}
                </svg>
                <span className="hidden sm:inline">{isSpeaking ? "Stop" : "Listen"}</span>
              </button>
            ) : null}
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className={cn(
              "pointer-events-auto rounded-md border border-white/15 bg-zinc-950/80 px-3 py-1.5 text-[0.68rem] font-normal uppercase tracking-[0.12em] text-white/50 backdrop-blur-sm transition-colors hover:border-white/25 hover:text-white/75 disabled:cursor-wait disabled:opacity-50",
              isGatekeeperPreview && "doorcheck-utility-button",
            )}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
          </div>
        </header>
        <MessageScroller.Provider
          autoScroll
          defaultScrollPosition="end"
          scrollPreviousItemPeek={64}
          scrollMargin={16}
        >
          <MessageScroller.Root
            className="relative min-h-0 flex-1"
            aria-busy={loading || bootstrapping}
          >
            <MessageScroller.Viewport
              className={cn(
                "scrollbar-hidden h-full overflow-y-auto overscroll-contain px-4 pt-14 pb-4 sm:px-6",
                isGatekeeperPreview &&
                  (isColorsProject
                    ? "doorcheck-viewport colors-doorcheck-viewport"
                    : "doorcheck-viewport lg:pl-[44vw]"),
              )}
            >
              <MessageScroller.Content
                className={cn(
                  "mx-auto flex min-h-full w-full max-w-[900px] flex-col gap-5",
                  isGatekeeperPreview &&
                    (isColorsProject
                      ? "doorcheck-content colors-doorcheck-content justify-center"
                      : "doorcheck-content max-w-[780px] justify-center"),
                )}
                spacerClassName="shrink-0"
              >
                <MessageScroller.Item className={cn("h-0 shrink-0", !isGatekeeperPreview && "mt-auto")} />
                {currentStep && !concluded && !isGatekeeperPreview && (
                  <MessageScroller.Item messageId={`step-${currentStep.id}`}>
                    <p
                      className="text-[0.68rem] tracking-widest text-white/35"
                      aria-live="polite"
                    >
                      {currentStep.title} · {currentStep.index + 1} of {currentStep.total}
                    </p>
                  </MessageScroller.Item>
                )}
            {isGatekeeperPreview ? (
              <MessageScroller.Item messageId="gatekeeper-preview">
                <motion.div
                  key={`doorcheck-question-${currentBotMessage?.id ?? "loading"}`}
                  layout
                  initial={{ opacity: 0, y: 14, filter: "blur(5px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.46, ease: EASE_OUT }}
                  className="doorcheck-question-stage mx-auto w-full"
                >
                  <div
                    className={cn(
                      "mb-5 flex items-center gap-3 text-[0.68rem] uppercase tracking-[0.17em] text-white/48",
                      isColorsProject && "sr-only",
                    )}
                  >
                    <span>{personaName}</span>
                    <span className="h-px w-5 bg-white/25" aria-hidden="true" />
                    <span>{doorcheckScene.eyebrow}</span>
                  </div>

                  {decisionPhase === "evaluating" ? (
                    <p className="doorcheck-question-text">Let me sit with that for a moment.</p>
                  ) : currentBotMessage && decisionPhase !== "decision" ? (
                    <TypewriterQuestion text={currentBotMessage.content} />
                  ) : bootstrapping ? (
                    <p className="doorcheck-question-text">Opening the door…</p>
                  ) : null}

                  <AnimatePresence initial={false}>
                    {loading ? (
                      <motion.div
                        key="doorcheck-reading"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -3 }}
                        className="mt-6 flex items-center gap-3 text-sm text-white/48"
                        role="status"
                      >
                        <span className="doorcheck-reading-mark" aria-hidden="true" />
                        Reading your answer…
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </motion.div>
              </MessageScroller.Item>
            ) : (
              messages.map((msg) => (
                <MessageScroller.Item
                  key={msg.id}
                  messageId={msg.id}
                  scrollAnchor={msg.role === "user"}
                  className={cn(
                    "flex w-full scroll-mt-4",
                    msg.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <motion.div
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      layout: LAYOUT_SPRING,
                      opacity: { duration: 0.28, ease: EASE_OUT },
                      y: { duration: 0.28, ease: EASE_OUT },
                    }}
                    className={cn(
                      "min-w-0 max-w-[88%] text-pretty sm:max-w-[72%]",
                      msg.role === "user"
                        ? "rounded-2xl rounded-br-md bg-white/10 px-4 py-3 text-white/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                        : "text-white/72",
                    )}
                  >
                    {msg.role === "bot" ? (
                      <div className="mb-1 font-sans text-sm text-white/38">
                        {personaName}
                      </div>
                    ) : null}
                    <div className="whitespace-pre-wrap break-words font-sans text-lg leading-[1.5] sm:text-xl md:text-2xl">
                      {msg.content}
                    </div>
                  </motion.div>
                </MessageScroller.Item>
              ))
            )}

            {!isGatekeeperPreview && (
              <MessageScroller.Item
                messageId="assistant-status"
                className="min-h-16 w-full sm:min-h-20"
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
                      className="w-full max-w-[88%] text-white/72 sm:max-w-[72%]"
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
              </MessageScroller.Item>
            )}

            {showReviewerReport && reviewerReport ? (
              <MessageScroller.Item messageId="reviewer-report">
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
              </MessageScroller.Item>
            ) : null}
                <MessageScroller.Item className="h-2 shrink-0" />
              </MessageScroller.Content>
            </MessageScroller.Viewport>
            <MessageScroller.Button
              aria-label="Jump to latest message"
              className="pointer-events-none absolute bottom-3 left-1/2 z-10 grid size-11 -translate-x-1/2 translate-y-2 place-items-center rounded-full border border-white/12 bg-zinc-950/90 text-white/65 opacity-0 shadow-[0_8px_30px_rgba(0,0,0,0.32)] backdrop-blur-md transition-[opacity,translate,border-color] duration-200 data-[active=true]:pointer-events-auto data-[active=true]:translate-y-0 data-[active=true]:opacity-100 hover:border-white/25 hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
                <path
                  d="m6 9 6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </MessageScroller.Button>
          </MessageScroller.Root>
        </MessageScroller.Provider>

        {showConclusionActions && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className={cn(
              "mx-auto w-full max-w-[900px] shrink-0 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6",
              isGatekeeperPreview &&
                (isColorsProject
                  ? "doorcheck-answer-shell colors-doorcheck-answer-shell"
                  : "doorcheck-answer-shell lg:ml-[44vw] lg:max-w-none lg:pr-8 lg:pl-8"),
            )}
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
            layout
            className={cn(
              "mx-auto w-full max-w-[900px] shrink-0 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6",
              isGatekeeperPreview &&
                (isColorsProject
                  ? "doorcheck-answer-shell colors-doorcheck-answer-shell"
                  : "doorcheck-answer-shell lg:ml-[44vw] lg:max-w-none lg:pr-8 lg:pl-8"),
            )}
            animate={{ opacity: 1 }}
            transition={{ layout: LAYOUT_SPRING, opacity: { duration: 0.22 } }}
          >
            {showStructuredOptions ? (
              <motion.div
                layout
                className={
                  isGatekeeperPreview
                    ? "doorcheck-options relative w-full px-0 py-3"
                    : "relative w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-md"
                }
              >
                <div
                  className={cn(
                    "flex flex-wrap items-center gap-2",
                    isGatekeeperPreview ? "justify-start gap-2.5" : "justify-center",
                  )}
                >
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
                          "min-h-11 rounded-full border px-4 py-2 text-sm transition-[border-color,background-color,color,scale] active:scale-[0.96]",
                          isGatekeeperPreview
                            ? active
                              ? "doorcheck-choice doorcheck-choice--active"
                              : "doorcheck-choice"
                            : active
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
                    className={cn(
                      "mx-auto mt-3 block min-h-11 rounded-full border border-white/15 bg-transparent px-4 py-2 text-[0.7rem] tracking-[0.08em] text-white/50 transition-[border-color,color,scale] hover:border-white/25 hover:text-white/75 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-35",
                      isGatekeeperPreview && "doorcheck-choice ml-0",
                    )}
                  >
                    continue
                  </button>
                ) : null}
              </motion.div>
            ) : (
              <motion.form
                layout
                onSubmit={(event) => {
                  event.preventDefault()
                  if (applicantEmail) void submit()
                  else submitApplicantEmail()
                }}
                className={
                  isGatekeeperPreview
                    ? "doorcheck-input relative flex min-h-14 items-end gap-2 border-b p-0 pb-2"
                    : "relative flex min-h-14 items-end gap-2 rounded-2xl border border-white/10 bg-zinc-950/70 p-2 pl-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-md transition-[border-color,box-shadow,background-color,opacity] duration-200 focus-within:border-white/18 focus-within:bg-zinc-950/85 focus-within:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_0_0_1px_rgba(255,255,255,0.06),0_0_0_3px_rgba(255,255,255,0.05)]"
                }
              >
                {applicantEmail ? (
                  <textarea
                    ref={textareaRef}
                    value={input}
                    rows={1}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    disabled={loading}
                    placeholder={
                      loading
                        ? `${personaName} is replying…`
                        : stepHint?.trim() ||
                          (selectedProject?.projectType === "onboarding"
                            ? "Your answer"
                            : "Type your message")
                    }
                    aria-label="Message"
                    aria-disabled={loading}
                    className="field-sizing-content max-h-40 min-h-10 flex-1 resize-none overflow-y-auto bg-transparent py-2 pr-1 font-inherit text-base leading-6 font-normal text-white/95 outline-none placeholder:text-white/38 selection:bg-white/20 selection:text-white disabled:cursor-wait disabled:opacity-55 sm:text-lg"
                  />
                ) : (
                  <input
                    type="email"
                    value={input}
                    onChange={(event) => {
                      setApplicantEmailError(null)
                      handleInputChange(event)
                    }}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    placeholder="you@example.com"
                    autoComplete="email"
                    aria-label="Email address"
                    className="min-h-10 flex-1 bg-transparent py-2 pr-1 font-inherit text-base font-normal text-white/95 outline-none placeholder:text-white/38 selection:bg-white/20 selection:text-white sm:text-lg"
                  />
                )}
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  aria-label={applicantEmail ? "Send message" : "Continue"}
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-xl bg-white text-black transition-[opacity,scale,background-color] duration-150 hover:bg-white/90 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-25",
                    isGatekeeperPreview && "doorcheck-send rounded-full",
                  )}
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden>
                    <path
                      d="m12 19V5m0 0-5 5m5-5 5 5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <AnimatePresence initial={false}>
                {loading && (
                  <motion.div
                    key="input-bar"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="pointer-events-none absolute bottom-0 left-4 right-4 h-px overflow-hidden rounded-full bg-white/12"
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
              </motion.form>
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
        {isColorsProject ? (
          <p className="colors-doorcheck-credit">Powered by Groucho</p>
        ) : null}
      </div>
      <style jsx global>{`
        .doorcheck-stage {
          --scene-ink: #15132b;
          --scene-deep: #211943;
          --scene-glow: #9a5cf2;
          --scene-light: #f6c85f;
          background: var(--scene-deep);
          color: white;
          isolation: isolate;
          transition: background-color 700ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .doorcheck-stage[data-scene="signal"] {
          --scene-ink: #101c2b;
          --scene-deep: #17384a;
          --scene-glow: #28b9ad;
          --scene-light: #ffcd58;
        }
        .doorcheck-stage[data-scene="studio"] {
          --scene-ink: #291717;
          --scene-deep: #62332e;
          --scene-glow: #e0724f;
          --scene-light: #f9cf72;
        }
        .doorcheck-stage[data-scene="gathering"] {
          --scene-ink: #12251f;
          --scene-deep: #245b49;
          --scene-glow: #8bcf8a;
          --scene-light: #ffd15c;
        }
        .doorcheck-stage[data-scene="reflection"] {
          --scene-ink: #181b38;
          --scene-deep: #263f77;
          --scene-glow: #798bed;
          --scene-light: #ffc857;
        }
        .doorcheck-stage[data-scene="afterglow"] {
          --scene-ink: #25151e;
          --scene-deep: #593044;
          --scene-glow: #d36e8d;
          --scene-light: #ffc965;
        }
        .doorcheck-backdrop {
          position: absolute;
          inset: 0;
          z-index: -1;
          overflow: hidden;
          background: var(--scene-ink);
        }
        .colors-doorcheck {
          --scene-light: #f4f1ea;
          background: #1d1d1d;
        }
        .colors-doorcheck .doorcheck-backdrop {
          background: #1d1d1d;
        }
        .colors-doorcheck-media {
          position: absolute;
          inset: 0;
          overflow: hidden;
          background: #1d1d1d;
        }
        .colors-doorcheck-media__visual {
          position: absolute;
          overflow: hidden;
          opacity: 0;
          transform: scale(1.015);
          transition:
            opacity 650ms cubic-bezier(0.22, 1, 0.36, 1),
            transform 1100ms cubic-bezier(0.22, 1, 0.36, 1);
          will-change: opacity, transform;
        }
        .colors-doorcheck-media__visual[data-layout="full"] {
          inset: 0;
        }
        .colors-doorcheck-media__visual[data-layout="right"] {
          inset-block: 0;
          right: 0;
          left: 40.8%;
        }
        .colors-doorcheck-media__visual[data-layout="corner"] {
          right: 58%;
          bottom: 0;
          left: 0;
          height: 31%;
        }
        .colors-doorcheck-media__visual img {
          object-fit: cover;
          filter: saturate(0.82) contrast(1.04);
          outline: 1px solid oklch(1 0 0 / 0.1);
          outline-offset: -1px;
        }
        .colors-doorcheck-media__visual[data-active="true"] {
          z-index: 1;
          opacity: 1;
          transform: scale(1);
        }
        .colors-doorcheck-media__veil {
          position: absolute;
          inset: 0;
          z-index: 2;
          pointer-events: none;
          transition: background 500ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .colors-doorcheck-media[data-layout="full"] .colors-doorcheck-media__veil {
          background:
            radial-gradient(circle at 48% 54%, rgb(0 0 0 / 0.32), rgb(0 0 0 / 0.7) 72%),
            rgb(0 0 0 / 0.22);
        }
        .colors-doorcheck-media[data-layout="right"] .colors-doorcheck-media__veil {
          background:
            linear-gradient(90deg, #171717 0 39%, rgb(23 23 23 / 0.66) 50%, rgb(0 0 0 / 0.15) 76%),
            linear-gradient(180deg, rgb(0 0 0 / 0.12), rgb(0 0 0 / 0.24));
        }
        .colors-doorcheck-media[data-layout="corner"] .colors-doorcheck-media__veil {
          background: linear-gradient(180deg, transparent 55%, rgb(0 0 0 / 0.1));
        }
        .colors-doorcheck-wordmark {
          font-size: 1rem;
          font-weight: 600;
          letter-spacing: 0.2em;
          color: white;
        }
        .colors-doorcheck-project-label {
          max-width: 18rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 0.67rem;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          color: rgb(255 255 255 / 0.62);
        }
        .colors-doorcheck-content {
          width: min(34rem, 48vw);
          max-width: none;
          margin-right: auto;
          margin-left: 33vw;
          padding-block: 0;
        }
        .colors-doorcheck .doorcheck-question-stage {
          display: grid;
          width: 100%;
          height: clamp(16rem, 45vh, 24rem);
          max-width: none;
          grid-template-rows: minmax(0, 1fr) 2.5rem;
          align-items: center;
        }
        .colors-doorcheck .doorcheck-question-text {
          width: 100%;
          max-width: 29ch;
          align-self: center;
          font-size: clamp(1.45rem, 2.05vw, 1.85rem);
          font-weight: 400;
          line-height: 1.32;
          letter-spacing: -0.018em;
          color: rgb(255 255 255 / 0.96);
          text-wrap: pretty;
        }
        .colors-doorcheck .doorcheck-type-cursor {
          width: 0.055em;
          background: rgb(255 255 255 / 0.82);
        }
        .colors-doorcheck .doorcheck-reading-mark {
          background: white;
        }
        .colors-doorcheck-answer-shell {
          width: min(34rem, 48vw);
          height: clamp(8.5rem, 18vh, 10.5rem);
          max-width: none;
          margin-right: auto;
          margin-left: 33vw;
          overflow-y: auto;
          padding: 0 0 1rem;
          scrollbar-width: none;
        }
        .colors-doorcheck-answer-shell::-webkit-scrollbar {
          display: none;
        }
        .colors-doorcheck .doorcheck-input {
          border-bottom-color: rgb(255 255 255 / 0.14);
        }
        .colors-doorcheck .doorcheck-input:focus-within {
          border-bottom-color: rgb(255 255 255 / 0.48);
        }
        .colors-doorcheck .doorcheck-input textarea,
        .colors-doorcheck .doorcheck-input input {
          font-size: clamp(1.15rem, 1.8vw, 1.55rem);
        }
        .colors-doorcheck .doorcheck-send,
        .colors-doorcheck .doorcheck-choice {
          background: #f4f1ea;
          color: #151515;
        }
        .colors-doorcheck-credit {
          position: absolute;
          right: 2rem;
          bottom: 1.35rem;
          z-index: 4;
          margin: 0;
          font-size: 0.56rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: rgb(255 255 255 / 0.7);
          pointer-events: none;
        }
        .doorcheck-media,
        .doorcheck-colour-field {
          position: absolute;
          inset-block: 0;
          transition: background-color 700ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .doorcheck-media {
          left: 0;
          width: 44%;
          overflow: hidden;
          background:
            linear-gradient(155deg, color-mix(in srgb, var(--scene-glow) 72%, white 8%), transparent 65%),
            radial-gradient(circle at 25% 75%, var(--scene-light), transparent 44%),
            var(--scene-ink);
        }
        .doorcheck-colour-field {
          right: 0;
          width: 56%;
          background:
            radial-gradient(circle at 78% 18%, color-mix(in srgb, var(--scene-glow) 24%, transparent), transparent 34%),
            var(--scene-deep);
        }
        .doorcheck-media::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent 65%, color-mix(in srgb, var(--scene-deep) 22%, transparent));
        }
        .doorcheck-media__shape {
          position: absolute;
          border-radius: 48% 52% 62% 38% / 45% 42% 58% 55%;
          filter: blur(4px);
          will-change: transform;
          animation: doorcheck-drift 16s ease-in-out infinite alternate;
        }
        .doorcheck-media__shape--one {
          top: -18%;
          left: 18%;
          width: 58%;
          height: 76%;
          rotate: 24deg;
          background: color-mix(in srgb, var(--scene-deep) 75%, black 12%);
          box-shadow: 0 0 90px color-mix(in srgb, var(--scene-glow) 55%, transparent);
        }
        .doorcheck-media__shape--two {
          right: -12%;
          bottom: -12%;
          width: 70%;
          height: 50%;
          rotate: -18deg;
          background: color-mix(in srgb, var(--scene-glow) 52%, transparent);
          animation-delay: -7s;
        }
        .doorcheck-media__grain {
          position: absolute;
          inset: 0;
          opacity: 0.18;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.25'/%3E%3C/svg%3E");
          mix-blend-mode: soft-light;
        }
        .doorcheck-media__caption {
          position: absolute;
          z-index: 1;
          right: 2rem;
          bottom: 1.75rem;
          left: 2rem;
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          font-size: 0.62rem;
          line-height: 1.4;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgb(255 255 255 / 0.6);
        }
        .doorcheck-brand-mark {
          width: 0.55rem;
          height: 0.55rem;
          border-radius: 999px;
          background: var(--scene-light);
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--scene-light) 16%, transparent);
          transition: background-color 500ms ease, box-shadow 500ms ease;
        }
        .doorcheck-utility-button {
          display: inline-flex;
          min-height: 2.75rem;
          align-items: center;
          gap: 0.5rem;
          border: 1px solid rgb(255 255 255 / 0.15);
          border-radius: 999px;
          background: rgb(5 6 12 / 0.2);
          padding-inline: 0.8rem;
          color: rgb(255 255 255 / 0.68);
          backdrop-filter: blur(14px);
          transition: color 160ms ease, border-color 160ms ease, background-color 160ms ease, transform 160ms ease;
        }
        .doorcheck-utility-button:hover {
          border-color: rgb(255 255 255 / 0.32);
          background: rgb(5 6 12 / 0.32);
          color: white;
        }
        .doorcheck-utility-button:active { transform: scale(0.97); }
        .doorcheck-utility-button:disabled { cursor: not-allowed; opacity: 0.35; }
        .doorcheck-content { padding-block: clamp(5rem, 12vh, 8rem) 1.25rem; }
        .doorcheck-question-stage { max-width: 42rem; text-wrap: balance; }
        .doorcheck-question-text {
          max-width: 18ch;
          white-space: pre-wrap;
          font-family: var(--font-sans), sans-serif;
          font-size: clamp(2.3rem, 4.2vw, 4.85rem);
          font-weight: 430;
          line-height: 1.03;
          letter-spacing: -0.045em;
          color: rgb(255 255 255 / 0.9);
          text-wrap: balance;
        }
        .doorcheck-type-cursor {
          display: inline-block;
          width: 0.08em;
          height: 0.85em;
          margin-left: 0.08em;
          translate: 0 0.08em;
          border-radius: 999px;
          background: var(--scene-light);
        }
        .doorcheck-type-cursor--resting { animation: doorcheck-cursor 1s steps(1, end) infinite; }
        .doorcheck-reading-mark {
          width: 0.55rem;
          height: 0.55rem;
          border-radius: 50%;
          background: var(--scene-light);
          animation: doorcheck-reading 1.1s ease-in-out infinite;
        }
        .doorcheck-answer-shell { position: relative; z-index: 2; }
        .doorcheck-options { animation: doorcheck-options-in 380ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        .doorcheck-choice {
          border-color: color-mix(in srgb, var(--scene-light) 75%, white 10%);
          background: var(--scene-light);
          color: #15110a;
          box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
          font-weight: 550;
        }
        .doorcheck-choice:hover { border-color: white; background: color-mix(in srgb, var(--scene-light) 86%, white); color: #090705; }
        .doorcheck-choice--active { box-shadow: inset 0 0 0 2px #15110a, 0 8px 24px rgb(0 0 0 / 0.15); }
        .doorcheck-input { border-bottom-color: rgb(255 255 255 / 0.28); }
        .doorcheck-input:focus-within { border-bottom-color: var(--scene-light); }
        .doorcheck-input textarea,
        .doorcheck-input input { font-size: clamp(1.1rem, 2vw, 1.45rem); }
        .doorcheck-send { background: var(--scene-light); color: #15110a; }
        .doorcheck-send:hover { background: color-mix(in srgb, var(--scene-light) 86%, white); }
        @keyframes doorcheck-drift {
          from { transform: translate3d(-2%, -1%, 0) scale(1); }
          to { transform: translate3d(5%, 4%, 0) scale(1.08); }
        }
        @keyframes doorcheck-cursor { 0%, 52% { opacity: 1; } 53%, 100% { opacity: 0; } }
        @keyframes doorcheck-reading { 0%, 100% { opacity: 0.3; transform: scale(0.78); } 50% { opacity: 1; transform: scale(1); } }
        @keyframes doorcheck-options-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 1023px) {
          .doorcheck-media { width: 100%; opacity: 0.58; }
          .doorcheck-colour-field { width: 100%; background: linear-gradient(180deg, color-mix(in srgb, var(--scene-deep) 50%, transparent), var(--scene-deep) 74%); }
          .doorcheck-media__caption { display: none; }
          .doorcheck-viewport { background: rgb(3 5 12 / 0.14); }
          .doorcheck-question-stage { max-width: 38rem; }
          .colors-doorcheck-viewport { background: transparent; }
          .colors-doorcheck-content,
          .colors-doorcheck-answer-shell {
            width: min(36rem, calc(100vw - 3rem));
            margin-right: auto;
            margin-left: auto;
          }
          .colors-doorcheck-media__visual[data-layout="right"] {
            left: 26%;
          }
          .colors-doorcheck-media__visual[data-layout="corner"] {
            right: 42%;
            height: 38%;
          }
          .colors-doorcheck-media[data-layout="right"] .colors-doorcheck-media__veil {
            background: linear-gradient(90deg, rgb(20 20 20 / 0.82), rgb(0 0 0 / 0.38));
          }
        }
        @media (max-width: 639px) {
          .doorcheck-question-text { font-size: clamp(2rem, 10vw, 3.25rem); line-height: 1.06; }
          .doorcheck-content { padding-top: 5.25rem; padding-bottom: 0.5rem; }
          .doorcheck-question-stage { text-wrap: pretty; }
          .colors-doorcheck-content {
            width: calc(100vw - 2rem);
            padding-top: 4.25rem;
            padding-bottom: 0;
          }
          .colors-doorcheck-answer-shell {
            width: calc(100vw - 2rem);
            height: 9.25rem;
            padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
          }
          .colors-doorcheck .doorcheck-question-stage {
            height: clamp(15rem, 45vh, 21rem);
          }
          .colors-doorcheck .doorcheck-question-text {
            font-size: clamp(1.35rem, 6.4vw, 1.75rem);
            line-height: 1.3;
          }
          .colors-doorcheck-media__visual[data-layout="right"],
          .colors-doorcheck-media__visual[data-layout="corner"] {
            inset: 0;
            height: auto;
          }
          .colors-doorcheck-media__veil,
          .colors-doorcheck-media[data-layout="right"] .colors-doorcheck-media__veil,
          .colors-doorcheck-media[data-layout="corner"] .colors-doorcheck-media__veil {
            background: rgb(0 0 0 / 0.58);
          }
          .colors-doorcheck-project-label { display: none; }
          .colors-doorcheck-wordmark { font-size: 0.76rem; }
          .colors-doorcheck-credit { right: 1rem; bottom: 0.65rem; }
        }
        @media (prefers-reduced-motion: reduce) {
          .doorcheck-media__shape,
          .doorcheck-type-cursor--resting,
          .doorcheck-reading-mark,
          .doorcheck-options { animation: none; }
          .colors-doorcheck-media__visual { transition: none; }
        }
      `}</style>
    </MotionConfig>
  )
}
