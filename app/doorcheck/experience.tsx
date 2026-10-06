"use client"

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useId,
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
import { MediaChoiceInput } from "@/components/doorcheck/MediaChoiceInput"
import { cn } from "@/lib/utils"
import { DEFAULT_APPLICATION_OPENING_MESSAGE } from "@/lib/project-settings"
import { useBrowserDictation } from "@/lib/use-browser-dictation"
import {
  normaliseMediaChoiceInteraction,
  type MediaChoiceAnswer,
  type MediaChoiceInteraction,
  type MediaChoiceMode,
} from "@/lib/gatekeeper-interaction-spec"

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
    mediaChoice?: MediaChoiceInteraction
  }
}

type GrouchoInputType =
  | "text"
  | "voice"
  | "singleSelect"
  | "multiSelect"
  | "ranking"
  | "mediaChoice"

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
  mediaChoice?: MediaChoiceInteraction
}

type DecisionPhase = "none" | "evaluating" | "decision" | "revealed"

type ColorsInteractionPhase = "ready" | "reading" | "revealing"

type ColorsHandoff = {
  message: Message
  interactionUi: GrouchoInteractionUi
  decisionPhase: DecisionPhase
  concluded: boolean
}

type DoorcheckStartResponse = {
  message: string
  currentStep?: OnboardingCurrentStep
  ui?: unknown
  stepHint?: string
  resumed?: boolean
}

type OpeningInputType = "text" | "singleSelect" | "multiSelect" | "mediaChoice"

type OpeningInteraction = {
  inputType: OpeningInputType
  options?: string[]
  mediaChoice?: MediaChoiceInteraction
}

type ColorsMediaTestResponse = {
  message: string
  interaction: MediaChoiceInteraction
}

const SLOW_RESPONSE_DELAY_MS = 6000

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
    preceding_question?: string
    interaction?: {
      type: "mediaChoice"
      question_id: string
      mode: "select" | "remove" | "rank"
      selected_options: Array<{
        id: string
        label: string
        position?: number
      }>
      rationale: string
    }
  }>
  weak_or_missing_signals: string[]
  safety_or_integrity_flags: string[]
  reviewer_focus: string
  detailed_opinion?: {
    snapshot?: {
      applicant_summary: string
      evidence_reference_ids: string[]
      tags: Array<{
        value: string
        evidence_reference_ids: string[]
      }>
    }
    advisory_reason?: string
    advisory_evidence_reference_ids?: string[]
    overall_assessment: string
    decisive_reasons: string[]
    claim_assessments: Array<{
      claim: string
      evidence_reference_ids: string[]
      interpretation: string
      assessment: "strength" | "concern" | "context"
    }>
    likely_contribution: string
    reservations: Array<{ text: string; evidence_reference_ids: string[] }>
    reviewer_questions: string[]
    curatorial_approach?: {
      present: boolean
      summary: string
      evidence_reference_ids: string[]
      observed_dimensions: string[]
    }
    suggested_human_action:
      | "approve"
      | "discuss"
      | "request_clarification"
      | "decline"
  }
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
const COLORS_DEMO_SESSION_KEY = "colors_demo_session_id"
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
  position: string
}

const COLORS_VISUALS: ColorsVisual[] = [
  {
    id: "latin-mafia",
    src: "/doorcheck/colors/latin-mafia.jpg",
    position: "50% 32%",
  },
  {
    id: "fireboy-dml",
    src: "/doorcheck/colors/fireboy-dml.jpg",
    position: "50% 36%",
  },
  {
    id: "violin-portrait",
    src: "/doorcheck/colors/violin-portrait.jpg",
    position: "50% 50%",
  },
  {
    id: "ho99o9",
    src: "/doorcheck/colors/ho99o9.jpg",
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

function TypewriterQuestion({
  messageId,
  text,
  alreadyRevealed = false,
  onComplete,
}: {
  messageId: string
  text: string
  alreadyRevealed?: boolean
  onComplete: (messageId: string) => void
}) {
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const skipAnimation = reduceMotion || alreadyRevealed
  const [visibleText, setVisibleText] = useState(skipAnimation ? text : "")
  const [complete, setComplete] = useState(skipAnimation)
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    if (skipAnimation) {
      const timer = window.setTimeout(() => onCompleteRef.current(messageId), 0)
      return () => window.clearTimeout(timer)
    }

    let index = 0
    let timer = 0
    const baseDelay = Math.max(9, Math.min(24, 1180 / Math.max(text.length, 1)))

    const typeNextCharacter = () => {
      index += 1
      setVisibleText(text.slice(0, index))
      if (index >= text.length) {
        setComplete(true)
        onCompleteRef.current(messageId)
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
  }, [messageId, skipAnimation, text])

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
    data.inputType === "mediaChoice" ||
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
  const mediaChoice = normaliseMediaChoiceInteraction(data.mediaChoice)
  return {
    intent: typeof data.intent === "string" ? data.intent : undefined,
    inputType,
    emotionalState:
      typeof data.emotionalState === "string" ? data.emotionalState : undefined,
    visualState,
    ...(options && options.length > 0 ? { options } : {}),
    ...(mediaChoice ? { mediaChoice } : {}),
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
  if (inputType === "mediaChoice") return { inputType: "text" }
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
        const interactionValue =
          value.interaction &&
          typeof value.interaction === "object" &&
          !Array.isArray(value.interaction)
            ? value.interaction as Record<string, unknown>
            : null
        const mode = interactionValue?.mode
        const interactionMode: "select" | "remove" | "rank" | null =
          mode === "select" || mode === "remove" || mode === "rank"
            ? mode
            : null
        const selectedOptions = interactionValue && Array.isArray(interactionValue.selected_options)
          ? interactionValue.selected_options.flatMap((option) => {
              if (!option || typeof option !== "object" || Array.isArray(option)) return []
              const optionValue = option as Record<string, unknown>
              return typeof optionValue.id === "string" && typeof optionValue.label === "string"
                ? [{
                    id: optionValue.id,
                    label: optionValue.label,
                    ...(typeof optionValue.position === "number"
                      ? { position: optionValue.position }
                      : {}),
                  }]
                : []
            })
          : []
        const interaction =
          interactionValue?.type === "mediaChoice" &&
          typeof interactionValue.question_id === "string" &&
          interactionMode &&
          selectedOptions.length > 0 &&
          typeof interactionValue.rationale === "string"
            ? {
                type: "mediaChoice" as const,
                question_id: interactionValue.question_id,
                mode: interactionMode,
                selected_options: selectedOptions,
                rationale: interactionValue.rationale,
              }
            : null
        return typeof value.signal_key === "string" &&
          typeof value.signal_label === "string" &&
          typeof value.source_message_id === "string" &&
          typeof value.excerpt === "string"
          ? [{
              signal_key: value.signal_key,
              signal_label: value.signal_label,
              source_message_id: value.source_message_id,
              excerpt: value.excerpt,
              ...(typeof value.preceding_question === "string"
                ? { preceding_question: value.preceding_question }
                : {}),
              ...(interaction ? { interaction } : {}),
            }]
          : []
      })
    : []
  const detailedData =
    data.detailed_opinion &&
    typeof data.detailed_opinion === "object" &&
    !Array.isArray(data.detailed_opinion)
      ? (data.detailed_opinion as Record<string, unknown>)
      : null
  const claimAssessments = detailedData && Array.isArray(detailedData.claim_assessments)
    ? detailedData.claim_assessments.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return []
        const value = item as Record<string, unknown>
        const assessment = value.assessment
        const evidenceReferenceIds = textItems(value.evidence_reference_ids)
        return typeof value.claim === "string" &&
          typeof value.interpretation === "string" &&
          evidenceReferenceIds.length > 0 &&
          (assessment === "strength" || assessment === "concern" || assessment === "context")
          ? [{
              claim: value.claim,
              evidence_reference_ids: evidenceReferenceIds,
              interpretation: value.interpretation,
              assessment: assessment as "strength" | "concern" | "context",
            }]
          : []
      })
    : []
  const evidenceIds = new Set(evidenceReferences.map((reference) => reference.source_message_id))
  const reservations = detailedData && Array.isArray(detailedData.reservations)
    ? detailedData.reservations.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return []
        const value = item as Record<string, unknown>
        const ids = textItems(value.evidence_reference_ids).filter((id) => evidenceIds.has(id))
        return typeof value.text === "string" && value.text.trim() && ids.length > 0
          ? [{ text: value.text, evidence_reference_ids: ids }]
          : []
      })
    : []
  const humanAction = detailedData?.suggested_human_action
  const snapshotData =
    detailedData?.snapshot &&
    typeof detailedData.snapshot === "object" &&
    !Array.isArray(detailedData.snapshot)
      ? detailedData.snapshot as Record<string, unknown>
      : null
  const snapshot = snapshotData && typeof snapshotData.applicant_summary === "string"
    ? {
        applicant_summary: snapshotData.applicant_summary,
        evidence_reference_ids: textItems(snapshotData.evidence_reference_ids),
        tags: Array.isArray(snapshotData.tags)
          ? snapshotData.tags.flatMap((item) => {
              if (!item || typeof item !== "object" || Array.isArray(item)) return []
              const tag = item as Record<string, unknown>
              return typeof tag.value === "string" &&
                textItems(tag.evidence_reference_ids).length > 0
                ? [{
                    value: tag.value,
                    evidence_reference_ids: textItems(tag.evidence_reference_ids),
                  }]
                : []
            })
          : [],
      }
    : null
  const curatorialData =
    detailedData?.curatorial_approach &&
    typeof detailedData.curatorial_approach === "object" &&
    !Array.isArray(detailedData.curatorial_approach)
      ? detailedData.curatorial_approach as Record<string, unknown>
      : null
  const curatorialApproach = curatorialData
    ? {
        present: curatorialData.present === true,
        summary: typeof curatorialData.summary === "string"
          ? curatorialData.summary
          : "",
        evidence_reference_ids: textItems(curatorialData.evidence_reference_ids),
        observed_dimensions: textItems(curatorialData.observed_dimensions),
      }
    : null
  const detailedOpinion =
    detailedData &&
    typeof detailedData.overall_assessment === "string" &&
    typeof detailedData.likely_contribution === "string" &&
    claimAssessments.length > 0 &&
    (humanAction === "approve" ||
      humanAction === "discuss" ||
      humanAction === "request_clarification" ||
      humanAction === "decline")
      ? {
          ...(snapshot ? { snapshot } : {}),
          ...(typeof detailedData.advisory_reason === "string" && detailedData.advisory_reason.trim()
            ? {
                advisory_reason: detailedData.advisory_reason,
                advisory_evidence_reference_ids: textItems(detailedData.advisory_evidence_reference_ids)
                  .filter((id) => evidenceIds.has(id)),
              }
            : {}),
          overall_assessment: detailedData.overall_assessment,
          decisive_reasons: textItems(detailedData.decisive_reasons),
          claim_assessments: claimAssessments,
          likely_contribution: detailedData.likely_contribution,
          reservations,
          reviewer_questions: textItems(detailedData.reviewer_questions),
          ...(curatorialApproach
            ? { curatorial_approach: curatorialApproach }
            : {}),
          suggested_human_action: humanAction as
            | "approve"
            | "discuss"
            | "request_clarification"
            | "decline",
        }
      : null
  return {
    applicant_bio: data.applicant_bio,
    advisory_recommendation: recommendation,
    confidence_score: Math.max(0, Math.min(1, data.confidence_score)),
    evidence_summary: textItems(data.evidence_summary),
    evidence_references: evidenceReferences,
    weak_or_missing_signals: textItems(data.weak_or_missing_signals),
    safety_or_integrity_flags: textItems(data.safety_or_integrity_flags),
    reviewer_focus: data.reviewer_focus,
    ...(detailedOpinion ? { detailed_opinion: detailedOpinion } : {}),
  }
}

function getOrCreateSession(storageKey = SESSION_KEY): string {
  const existing = localStorage.getItem(storageKey)
  if (existing) return existing
  return resetSession(storageKey)
}

function resetSession(storageKey = SESSION_KEY): string {
  const id = crypto.randomUUID()
  localStorage.setItem(storageKey, id)
  return id
}

function ReviewerReportPanel({
  report,
  sample,
}: {
  report: ReviewerReport
  sample: boolean
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsId = useId()
  const recommendation = report.advisory_recommendation === "human_review"
    ? "needs discussion"
    : report.advisory_recommendation
  const detailed = report.detailed_opinion
  const snapshot = detailed?.snapshot
  const primaryStrength = detailed?.claim_assessments.find(
    (claim) => claim.assessment === "strength",
  )?.claim ?? detailed?.decisive_reasons[0]
  const openQuestion = detailed?.reviewer_questions[0]
  const evidenceById = new Map(
    report.evidence_references.map((reference) => [
      reference.source_message_id,
      reference,
    ]),
  )
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
      {sample ? (
        <div className="mb-5 rounded-lg border border-amber-200/20 bg-amber-100/[0.06] px-4 py-3">
          <p className="text-[0.66rem] uppercase tracking-[0.16em] text-amber-100/75">
            Sample reviewer report
          </p>
          <p className="mt-1 text-sm leading-relaxed text-white/62">
            This report is shown only for this demo. In a real application,
            applicants would not see it. It is intended for the COLORS review team.
          </p>
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[0.62rem] uppercase tracking-[0.16em] text-white/32">
            {sample ? "Groucho’s opinion" : "internal reviewer report"}
          </p>
          <p className="mt-1 text-sm text-white/45">
            Advisory only. Final decision stays with the client.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[0.68rem] uppercase tracking-[0.12em] text-white/42">
          <span>{recommendation}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums text-white/70">
            {`${detailed ? "Evidence sufficiency" : "Report score"} ${Math.round(report.confidence_score * 100)}/100`}
          </span>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-white/72">
        {snapshot?.applicant_summary ?? report.applicant_bio}
      </p>
      {detailed?.advisory_reason ? (
        <p className="mt-2 text-xs leading-relaxed text-white/48">
          Why: {detailed.advisory_reason}
        </p>
      ) : null}
      {snapshot?.tags.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Applicant evidence tags">
          {snapshot.tags.map((tag) => (
            <span
              key={tag.value}
              className="rounded-full border border-white/12 bg-white/[0.035] px-2.5 py-1 text-[0.62rem] uppercase tracking-[0.1em] text-white/48"
            >
              {tag.value.replaceAll("_", " ")}
            </span>
          ))}
        </div>
      ) : null}
      {detailed ? (
        <div className="mt-4 grid gap-3 border-y border-white/8 py-4 sm:grid-cols-3">
          {primaryStrength ? (
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.13em] text-white/30">
                primary strength
              </p>
              <p className="mt-1 text-sm leading-relaxed text-white/62">{primaryStrength}</p>
            </div>
          ) : null}
          {openQuestion ? (
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.13em] text-white/30">
                open question
              </p>
              <p className="mt-1 text-sm leading-relaxed text-white/62">{openQuestion}</p>
            </div>
          ) : null}
          <div>
            <p className="text-[0.6rem] uppercase tracking-[0.13em] text-white/30">
              suggested action
            </p>
            <p className="mt-1 text-sm capitalize leading-relaxed text-white/68">
              {detailed.suggested_human_action.replace("_", " ")}
            </p>
          </div>
        </div>
      ) : null}
      {detailed ? (
        <button
          type="button"
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          className="mt-4 flex w-full items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-left text-[0.68rem] uppercase tracking-[0.12em] text-white/52 transition-colors hover:border-white/20 hover:text-white/72"
        >
          <span>{detailsOpen ? "Hide full assessment" : "View full assessment"}</span>
          <span aria-hidden="true">{detailsOpen ? "−" : "+"}</span>
        </button>
      ) : null}
      {detailed && detailsOpen ? (
        <div id={detailsId} className="mt-5 space-y-5">
          <div>
            <p className="mb-1 text-[0.62rem] uppercase tracking-[0.14em] text-white/32">
              overall assessment
            </p>
            <p className="text-sm leading-relaxed text-white/68">
              {detailed.overall_assessment}
            </p>
          </div>
          {detailed.curatorial_approach?.present ? (
            <div>
              <p className="mb-2 text-[0.62rem] uppercase tracking-[0.14em] text-white/32">
                curatorial approach
              </p>
              <p className="text-sm leading-relaxed text-white/68">
                {detailed.curatorial_approach.summary}
              </p>
              {detailed.curatorial_approach.observed_dimensions.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detailed.curatorial_approach.observed_dimensions.map((dimension) => (
                    <span
                      key={dimension}
                      className="rounded-full border border-white/10 px-2 py-1 text-[0.62rem] uppercase tracking-[0.1em] text-white/42"
                    >
                      {dimension.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 space-y-3">
                {detailed.curatorial_approach.evidence_reference_ids.flatMap((id) => {
                  const reference = evidenceById.get(id)
                  if (!reference?.interaction) return []
                  const choice = reference.interaction
                  const choiceLabel = choice.mode === "remove"
                    ? "Removed"
                    : choice.mode === "rank"
                      ? "Ranked"
                      : "Selected"
                  return [(
                    <div
                      key={`curatorial-${id}`}
                      className="rounded-lg border border-white/8 bg-white/[0.025] p-3"
                    >
                      {reference.preceding_question ? (
                        <p className="mb-2 text-xs leading-relaxed text-white/35">
                          Asked: {reference.preceding_question}
                        </p>
                      ) : null}
                      <p className="text-[0.62rem] uppercase tracking-[0.12em] text-white/35">
                        {choiceLabel}
                      </p>
                      <ol className="mt-1 space-y-1 text-sm text-white/62">
                        {choice.selected_options.map((option) => (
                          <li key={option.id}>
                            {choice.mode === "rank" && option.position
                              ? `${option.position}. `
                              : ""}
                            {option.label}
                          </li>
                        ))}
                      </ol>
                      {choice.rationale ? (
                        <blockquote className="mt-2 border-l border-white/15 pl-3 text-sm leading-relaxed text-white/48">
                          “{choice.rationale}”
                        </blockquote>
                      ) : null}
                      <p className="mt-2 text-xs leading-relaxed text-white/32">
                        Hypothetical exercise; the reasoning is evidence, not the artist choice itself.
                      </p>
                    </div>
                  )]
                })}
              </div>
            </div>
          ) : null}
          {listSection("decisive reasons", detailed.decisive_reasons)}
          <div>
            <p className="mb-2 text-[0.62rem] uppercase tracking-[0.14em] text-white/32">
              claim → evidence → interpretation
            </p>
            <div className="space-y-3">
              {detailed.claim_assessments.map((claim, index) => {
                const references = claim.evidence_reference_ids.flatMap((id) => {
                  const reference = evidenceById.get(id)
                  return reference ? [reference] : []
                })
                return (
                  <div
                    key={`${claim.claim}-${index}`}
                    className="rounded-lg border border-white/8 bg-white/[0.025] p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm leading-relaxed text-white/76">{claim.claim}</p>
                      <span className="text-[0.6rem] uppercase tracking-[0.12em] text-white/35">
                        {claim.assessment}
                      </span>
                    </div>
                    {references.map((reference) => (
                      <div key={`${reference.source_message_id}-${reference.signal_key}`} className="mt-2">
                        {reference.preceding_question ? (
                          <p className="mb-1 text-xs text-white/35">Asked: {reference.preceding_question}</p>
                        ) : null}
                        <blockquote className="border-l border-white/15 pl-3 text-sm leading-relaxed text-white/48">
                          “{reference.excerpt}”
                        </blockquote>
                      </div>
                    ))}
                    <p className="mt-2 text-sm leading-relaxed text-white/58">
                      {claim.interpretation}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1 text-[0.62rem] uppercase tracking-[0.14em] text-white/32">
                likely contribution
              </p>
              <p className="text-sm leading-relaxed text-white/58">
                {detailed.likely_contribution}
              </p>
            </div>
            {detailed.reservations.length ? (
              <div>
                <p className="mb-1 text-[0.62rem] uppercase tracking-[0.14em] text-white/32">
                  reservations
                </p>
                <div className="space-y-3">
                  {detailed.reservations.map((reservation, index) => (
                    <div key={`${reservation.text}-${index}`}>
                      <p className="text-sm leading-relaxed text-white/58">{reservation.text}</p>
                      {reservation.evidence_reference_ids.flatMap((id) => {
                        const reference = evidenceById.get(id)
                        return reference ? [(
                          <blockquote key={id} className="mt-1 border-l border-white/15 pl-3 text-xs leading-relaxed text-white/42">
                            “{reference.excerpt}”
                          </blockquote>
                        )] : []
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {listSection("questions for a human reviewer", detailed.reviewer_questions)}
            <div>
              <p className="mb-1 text-[0.62rem] uppercase tracking-[0.14em] text-white/32">
                suggested human action
              </p>
              <p className="text-sm capitalize leading-relaxed text-white/68">
                {detailed.suggested_human_action.replace("_", " ")}
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {!detailed && report.evidence_references.length > 0 ? (
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
      {!detailed || detailsOpen ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {!detailed ? listSection("evidence", report.evidence_summary) : null}
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
      ) : null}
    </motion.section>
  )
}

function StructuredOptionGrid({
  options,
  selectedOptions,
  isColorsProject,
  isGatekeeperPreview,
  disabled,
  onChoose,
}: {
  options: string[]
  selectedOptions: string[]
  isColorsProject: boolean
  isGatekeeperPreview: boolean
  disabled: boolean
  onChoose: (option: string) => void
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        isGatekeeperPreview ? "justify-start gap-2.5" : "justify-center",
        isColorsProject && "colors-chat-option-grid",
      )}
      role="group"
      aria-label="Answer options"
    >
      {options.map((option, optionIndex) => {
        const active = selectedOptions.includes(option)
        const visual = COLORS_VISUALS[optionIndex % COLORS_VISUALS.length]
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChoose(option)}
            className={cn(
              "min-h-11 rounded-full border px-4 py-2 text-sm transition-[border-color,background-color,color,scale] active:scale-[0.96]",
              isColorsProject && "colors-chat-option-card",
              isGatekeeperPreview
                ? active
                  ? "doorcheck-choice doorcheck-choice--active"
                  : "doorcheck-choice"
                : active
                  ? "border-white/45 bg-white/10 text-white/85"
                  : "border-white/12 bg-zinc-950/70 text-white/55 hover:border-white/25 hover:text-white/80",
            )}
          >
            {isColorsProject ? (
              <>
                <Image
                  src={visual.src}
                  alt=""
                  fill
                  unoptimized
                  sizes="(max-width: 640px) 50vw, 13rem"
                  style={{
                    objectFit: "cover",
                    objectPosition: visual.position,
                  }}
                />
                <span className="colors-chat-option-shade" aria-hidden="true" />
                <span className="colors-chat-option-label">{option}</span>
                <span className="colors-chat-option-check" aria-hidden="true">
                  <svg viewBox="0 0 20 20" fill="none">
                    <path
                      d="m5 10 3 3 7-7"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </>
            ) : (
              option
            )}
          </button>
        )
      })}
    </div>
  )
}

function ColorsTranscript({
  applicantEmail,
  colorsInteractionPhase,
  commitHandoff,
  messages,
  showSlowResponse,
}: {
  applicantEmail: string
  colorsInteractionPhase: ColorsInteractionPhase
  commitHandoff: () => void
  messages: Message[]
  showSlowResponse: boolean
}) {
  const firstApplicationMessageId = applicantEmail
    ? messages.find((message) => message.role === "bot")?.id
    : null

  return (
    <>
      {messages.map((message) => {
        const isUser = message.role === "user"
        const isIntroduction = message.id === firstApplicationMessageId

        return (
          <MessageScroller.Item
            key={message.id}
            messageId={message.id}
            scrollAnchor={isUser}
            className={cn(
              "colors-chat-turn flex w-full scroll-mt-4",
              isUser ? "justify-end" : "justify-start",
            )}
          >
            <motion.div
              layout
              initial={{ opacity: 0, y: 8, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{
                layout: LAYOUT_SPRING,
                opacity: { duration: 0.25, ease: EASE_OUT },
                y: { duration: 0.25, ease: EASE_OUT },
                filter: { duration: 0.25, ease: EASE_OUT },
              }}
              className={cn(
                "min-w-0 text-pretty",
                isUser ? "colors-chat-user-message" : "colors-chat-agent-message",
              )}
            >
              {isIntroduction ? (
                <div className="colors-chat-intro-media">
                  <Image
                    src="/doorcheck/colors/latin-mafia.jpg"
                    alt="Members of the COLORS community"
                    fill
                    unoptimized
                    sizes="(max-width: 640px) calc(100vw - 3rem), 26rem"
                    style={{ objectFit: "cover", objectPosition: "50% 35%" }}
                  />
                </div>
              ) : null}
              {isIntroduction ? (
                <div className="colors-chat-intro-copy">
                  <p>
                    The COLORS Forum is a place for our community to discuss,
                    discover and share. We are a network of musicians, curators
                    and music enthusiasts.
                  </p>
                  <p>
                    We are building a collective community that brings people
                    together to guide, understand and shape the culture.
                  </p>
                </div>
              ) : null}
              <p
                className={cn(
                  "colors-chat-message-copy",
                  isIntroduction && "colors-chat-opening-question",
                )}
              >
                {message.content}
              </p>
            </motion.div>
          </MessageScroller.Item>
        )
      })}

      <MessageScroller.Item
        messageId="colors-assistant-status"
        className="colors-chat-status-row"
      >
        <AnimatePresence
          initial={false}
          mode="wait"
          onExitComplete={commitHandoff}
        >
          {colorsInteractionPhase === "reading" ? (
            <motion.div
              key={showSlowResponse ? "slow" : "considering"}
              className="colors-chat-status"
              initial={{ opacity: 0, y: 4, filter: "blur(2px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -3, filter: "blur(2px)" }}
              transition={{ duration: 0.16, ease: EASE_OUT }}
              role="status"
              aria-live="polite"
            >
              <span className="colors-chat-status-mark" aria-hidden="true" />
              <span>
                {showSlowResponse
                  ? "Still considering — thoughtful answers can take a little longer."
                  : "Considering your answer…"}
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </MessageScroller.Item>
    </>
  )
}

export function DoorCheckExperience({
  demoMode,
}: {
  demoMode?: "colors"
}) {
  const isColorsDemo = demoMode === "colors"
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
  const [demoReportState, setDemoReportState] = useState<"idle" | "loading" | "failed">("idle")
  const [demoReportError, setDemoReportError] = useState<string | null>(null)
  const [decisionPhase, setDecisionPhase] = useState<DecisionPhase>("none")
  const [openingMessage, setOpeningMessage] = useState(
    FORUM_APPLICATION_OPENING_QUESTION,
  )
  const openingInputType: OpeningInputType = "text"
  const openingOptionsText = ""
  const [mediaTestMode, setMediaTestMode] =
    useState<MediaChoiceMode>("remove")
  const [mediaTestLoading, setMediaTestLoading] = useState(false)
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [mediaChoiceSelected, setMediaChoiceSelected] = useState<string[]>([])
  const [mediaChoiceRationale, setMediaChoiceRationale] = useState("")
  const [revealedQuestionId, setRevealedQuestionId] = useState<string | null>(null)
  const [colorsInteractionPhase, setColorsInteractionPhase] =
    useState<ColorsInteractionPhase>("ready")
  const [requestError, setRequestError] = useState<string | null>(null)
  const [failedAnswer, setFailedAnswer] = useState<string | null>(null)
  const [failedInteractionAnswer, setFailedInteractionAnswer] =
    useState<MediaChoiceAnswer | null>(null)
  const [showSlowResponse, setShowSlowResponse] = useState(false)
  const [questionDismissed, setQuestionDismissed] = useState(false)
  const [pendingResume, setPendingResume] =
    useState<DoorcheckStartResponse | null>(null)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const settingsTriggerRef = useRef<HTMLButtonElement>(null)
  const resumeTitleRef = useRef<HTMLHeadingElement>(null)
  const settingsPanelId = useId()
  const dictationStatusId = useId()
  const typingChannelRef = useRef<ReturnType<SupabaseClient["channel"]> | null>(
    null,
  )
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const slowResponseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Bot reply is committed after the thinking row exits so layout doesn’t stack two tails */
  const assistantHandoffRef = useRef<Message | null>(null)
  const colorsHandoffRef = useRef<ColorsHandoff | null>(null)
  const bootstrapInFlightRef = useRef(false)
  const router = useRouter()

  const commitColorsHandoff = useCallback(() => {
    const next = colorsHandoffRef.current
    if (!next) return
    colorsHandoffRef.current = null
    setRevealedQuestionId(null)
    setMessages((previous) => [...previous, next.message])
    setQuestionDismissed(false)
    setMediaChoiceSelected([])
    setMediaChoiceRationale("")
    setInteractionUi(next.interactionUi)
    setDecisionPhase(next.decisionPhase)
    setConcluded(next.concluded)
    setColorsInteractionPhase("ready")
    setInput("")
    if (!next.concluded) {
      window.requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [])

  const commitBootstrapResponse = useCallback((data: DoorcheckStartResponse) => {
    setQuestionDismissed(false)
    setRevealedQuestionId(null)
    setMessages([
      {
        id: crypto.randomUUID(),
        role: "bot",
        content: data.message,
      },
    ])
    const step = data.currentStep ?? null
    setMediaChoiceSelected([])
    setMediaChoiceRationale("")
    setInteractionUi(step ? interactionUiForStep(step) : parseInteractionUi(data.ui))
    setDecisionPhase("none")
    setSelectedOptions([])
    setCurrentStep(step)
    setStepHint(typeof data.stepHint === "string" ? data.stepHint : null)
  }, [])

  useEffect(() => {
    if (!pendingResume) return
    window.requestAnimationFrame(() => resumeTitleRef.current?.focus())
  }, [pendingResume])

  const closeSettings = useCallback((restoreFocus = false) => {
    setSettingsOpen(false)
    if (restoreFocus) {
      window.requestAnimationFrame(() => settingsTriggerRef.current?.focus())
    }
  }, [])

  useEffect(() => {
    if (!settingsOpen) return
    function handlePointerDown(event: PointerEvent) {
      if (!settingsRef.current?.contains(event.target as Node)) {
        closeSettings()
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeSettings(true)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [closeSettings, settingsOpen])

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

  useEffect(
    () => () => {
      if (slowResponseTimerRef.current) {
        clearTimeout(slowResponseTimerRef.current)
      }
    },
    [],
  )

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
    const frame = window.requestAnimationFrame(() => {
      const sid = getOrCreateSession(isColorsDemo ? COLORS_DEMO_SESSION_KEY : SESSION_KEY)
      if (!isColorsDemo) {
        setSessionId(sid)
        return
      }
      void fetch(`/api/demo/colors/state?sessionId=${encodeURIComponent(sid)}`, {
        credentials: "same-origin",
      }).then(async (response) => {
        if (!response.ok) return
        const state = await response.json()
        if (typeof state.applicantEmail === "string") setApplicantEmail(state.applicantEmail)
        if (["passed", "redirected", "rejected"].includes(state.status)) {
          setMessages([{
            id: crypto.randomUUID(), role: "bot",
            content: typeof state.message === "string" ? state.message : "Thank you for taking part.",
          }])
          setConcluded(true)
          setDecisionPhase("revealed")
          setInteractionUi(parseInteractionUi(state.ui))
        } else if (state.status === "active") {
          setMessages([])
        }
      }).catch(() => {}).finally(() => setSessionId(sid))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isColorsDemo])

  useEffect(() => {
    if (isColorsDemo) return
    fetch("/api/admin/personas")
      .then((r) => r.json())
      .then((data: PersonaOption[]) => {
        const active = data.filter((p) => p.is_active)
        setPersonas(active)
        const def = active.find((p) => p.is_default)
        if (def) setSelectedPersonaId(def.id)
      })
      .catch(() => {})
  }, [isColorsDemo])

  useEffect(() => {
    fetch(isColorsDemo ? "/api/demo/colors/project" : "/api/doorcheck/projects")
      .then((r) => r.json())
      .then((raw: ProjectOption[] | { project: ProjectOption }) => {
        const data = isColorsDemo && !Array.isArray(raw) ? [raw.project] : raw
        if (!Array.isArray(data)) return
        setProjects(data)
        const saved = localStorage.getItem(PROJECT_KEY)?.trim()
        const savedProject = saved ? data.find((p) => p.id === saved) : null
        const preferredForumProject =
          data.find((p) => p.slug === "forum-application") ??
          data.find((p) => p.name.toLowerCase() === "forum application") ??
          null
        const pick =
          (isColorsDemo ? preferredForumProject?.id ?? "" : null) ??
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
  }, [isColorsDemo])

  const requestDemoReport = useCallback(async (sid: string, generate = true) => {
    setDemoReportState("loading")
    setDemoReportError(null)
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await fetch(
          generate && attempt === 0
            ? "/api/demo/colors/report"
            : `/api/demo/colors/report?sessionId=${encodeURIComponent(sid)}`,
          generate && attempt === 0
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ sessionId: sid }),
              }
            : { credentials: "same-origin" },
        )
        const data = await response.json().catch(() => ({}))
        if (localStorage.getItem(COLORS_DEMO_SESSION_KEY) !== sid) return
        const parsed = parseReviewerReport(data.report)
        if (data.status === "ready" && parsed?.detailed_opinion) {
          setReviewerReport(parsed)
          setDemoReportState("idle")
          return
        }
        if (data.status === "pending" && response.ok) {
          await new Promise((resolve) => window.setTimeout(resolve, 2500))
          continue
        }
        throw new Error(typeof data.error === "string" ? data.error : "The sample report could not be generated.")
      }
      throw new Error("The sample report is taking longer than expected. Please retry.")
    } catch (error) {
      if (localStorage.getItem(COLORS_DEMO_SESSION_KEY) !== sid) return
      setDemoReportState("failed")
      setDemoReportError(error instanceof Error ? error.message : "The sample report could not be generated.")
    }
  }, [])

  useEffect(() => {
    if (!isColorsDemo || !concluded || !sessionId || reviewerReport?.detailed_opinion) return
    const timer = window.setTimeout(() => { void requestDemoReport(sessionId) }, 0)
    return () => window.clearTimeout(timer)
  }, [isColorsDemo, concluded, sessionId, reviewerReport, requestDemoReport])

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
        const res = await fetch(isColorsDemo ? "/api/demo/colors/start" : "/api/onboarding/start", {
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
        const rawData = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >
        if (!res.ok) {
          const err =
            typeof rawData.error === "string"
              ? rawData.error
              : `Request failed (${res.status})`
          const detail =
            typeof rawData.detail === "string" ? ` — ${rawData.detail}` : ""
          throw new Error(`${err}${detail}`)
        }
        if (typeof rawData.message !== "string") {
          throw new Error("Invalid start response")
        }
        const data: DoorcheckStartResponse = {
          message: rawData.message,
          ...(rawData.currentStep
            ? { currentStep: rawData.currentStep as OnboardingCurrentStep }
            : {}),
          ...(rawData.ui !== undefined ? { ui: rawData.ui } : {}),
          ...(typeof rawData.stepHint === "string"
            ? { stepHint: rawData.stepHint }
            : {}),
          ...(typeof rawData.resumed === "boolean"
            ? { resumed: rawData.resumed }
            : {}),
        }
        if (data.resumed === true) {
          setPendingResume(data)
          setMessages([])
          setCurrentStep(null)
          setStepHint(null)
          return
        }
        commitBootstrapResponse(data)
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
        setMediaChoiceSelected([])
        setMediaChoiceRationale("")
        setInteractionUi(DEFAULT_GATEKEEPER_UI)
        setDecisionPhase("none")
        setCurrentStep(null)
        setStepHint(null)
      } finally {
        bootstrapInFlightRef.current = false
        setBootstrapping(false)
      }
    },
    [commitBootstrapResponse, isColorsDemo],
  )

  function applyProjectSelection(projectId: string) {
    setSelectedProjectId(projectId)
    localStorage.setItem(PROJECT_KEY, projectId)
    localStorage.removeItem(REVIEWER_REPORT_KEY)
    const newId = resetSession(isColorsDemo ? COLORS_DEMO_SESSION_KEY : SESSION_KEY)
    setSessionId(newId)
    assistantHandoffRef.current = null
    colorsHandoffRef.current = null
    setInput("")
    setColorsInteractionPhase("ready")
    setRequestError(null)
    setFailedAnswer(null)
    setFailedInteractionAnswer(null)
    setShowSlowResponse(false)
    setQuestionDismissed(false)
    setPendingResume(null)
    setConcluded(false)
    setDecisionPhase("none")
    setMediaChoiceSelected([])
    setMediaChoiceRationale("")
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

  async function startColorsMediaTest() {
    if (!selectedProjectId || !applicantEmail || mediaTestLoading) return
    setMediaTestLoading(true)
    setRequestError(null)
    try {
      const response = await fetch(
        `/api/doorcheck/colors-media?mode=${encodeURIComponent(mediaTestMode)}`,
        { credentials: "same-origin" },
      )
      const raw = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >
      if (!response.ok) {
        throw new Error(
          typeof raw.error === "string"
            ? raw.error
            : "The COLORS media test could not be loaded.",
        )
      }
      const mediaChoice = normaliseMediaChoiceInteraction(raw.interaction)
      if (!mediaChoice || typeof raw.message !== "string") {
        throw new Error("The COLORS media test returned an invalid question.")
      }
      const data: ColorsMediaTestResponse = {
        message: raw.message,
        interaction: mediaChoice,
      }

      const newId = resetSession(isColorsDemo ? COLORS_DEMO_SESSION_KEY : SESSION_KEY)
      setSessionId(newId)
      assistantHandoffRef.current = null
      colorsHandoffRef.current = null
      setMessages([])
      setInput("")
      setColorsInteractionPhase("ready")
      setFailedAnswer(null)
      setFailedInteractionAnswer(null)
      setShowSlowResponse(false)
      setQuestionDismissed(false)
      setPendingResume(null)
      setConcluded(false)
      setDecisionPhase("none")
      setMediaChoiceSelected([])
      setMediaChoiceRationale("")
      setInteractionUi(DEFAULT_GATEKEEPER_UI)
      setSelectedOptions([])
      setCurrentStep(null)
      setStepHint(null)
      setReviewerReport(null)
      setOpeningMessage(data.message)
      closeSettings(true)

      await bootstrapSession(
        newId,
        selectedProjectId,
        applicantEmail,
        selectedPersonaId || undefined,
        data.message,
        { inputType: "mediaChoice", mediaChoice: data.interaction },
      )
    } catch (error) {
      setRequestError(
        error instanceof Error
          ? error.message
          : "The COLORS media test could not be loaded.",
      )
    } finally {
      setMediaTestLoading(false)
    }
  }

  useEffect(() => {
    if (
      !sessionId ||
      !selectedProjectId ||
      !applicantEmail ||
      bootstrapping ||
      pendingResume
    ) return
    if (messages.length !== 0) return
    const frame = window.requestAnimationFrame(() => {
      void bootstrapSession(
        sessionId,
        selectedProjectId,
        applicantEmail,
        selectedPersonaId || undefined,
        openingMessage,
        buildOpeningInteraction(openingInputType, openingOptionsText),
      )
    })
    return () => window.cancelAnimationFrame(frame)
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
    pendingResume,
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

  async function submit(
    messageOverride?: string,
    isRetry = false,
    interactionAnswer?: MediaChoiceAnswer,
  ) {
    const text = (messageOverride ?? input).trim()
    if (!text || !applicantEmail || loading || concluded || !sessionId) return

    voiceInput.cancel()
    broadcastTyping(false)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)

    const isGatekeeperPreview = selectedProject?.projectType === "gatekeeper"
    const isColorsSubmission = Boolean(
      isGatekeeperPreview &&
        selectedProject?.organisationName.trim().toLowerCase() === "colors",
    )
    if ((!isGatekeeperPreview || isColorsSubmission) && !isRetry) {
      const userId = crypto.randomUUID()
      setMessages((prev) => [...prev, { id: userId, role: "user", content: text }])
    }
    setRequestError(null)
    setFailedAnswer(null)
    setFailedInteractionAnswer(null)
    setShowSlowResponse(false)
    setQuestionDismissed(isGatekeeperPreview)
    if (isColorsSubmission) {
      if (interactionUi.inputType === "singleSelect") {
        setSelectedOptions([text])
      }
      setColorsInteractionPhase("reading")
    }
    setInput("")
    setLoading(true)
    slowResponseTimerRef.current = setTimeout(
      () => setShowSlowResponse(true),
      SLOW_RESPONSE_DELAY_MS,
    )

    try {
      const personaId = selectedPersonaId || undefined
      const projectId = selectedProjectId || undefined
      let res = await fetch(isColorsDemo ? "/api/demo/colors/message" : "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          message: text,
          sessionId,
          personaId,
          projectId,
          applicant: { email: applicantEmail },
          ...(interactionAnswer ? { interactionAnswer } : {}),
        }),
      })

      if (!isColorsDemo && res.status === 409 && !interactionAnswer) {
        const freshId = resetSession(SESSION_KEY)
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
            ...(interactionAnswer ? { interactionAnswer } : {}),
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

      if (!isColorsSubmission) setQuestionDismissed(false)

      if (data.currentStep) {
        setCurrentStep(nextStep)
      } else if (data.status === "passed") {
        setCurrentStep(null)
      }
      if (!isColorsSubmission) setSelectedOptions([])
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
        if (isColorsSubmission) {
          colorsHandoffRef.current = {
            message: nextMessage,
            interactionUi: nextUi,
            decisionPhase: "revealed",
            concluded: true,
          }
          setColorsInteractionPhase("revealing")
        } else if (!isOnboarding) {
          setConcluded(true)
          setMessages([nextMessage])
          setMediaChoiceSelected([])
          setMediaChoiceRationale("")
          setInteractionUi(nextUi)
          setDecisionPhase("revealed")
        } else {
          setConcluded(true)
          assistantHandoffRef.current = nextMessage
        }
      } else if (data.status === "redirected" || data.status === "rejected") {
        if (isColorsSubmission) {
          colorsHandoffRef.current = {
            message: nextMessage,
            interactionUi: nextUi,
            decisionPhase: "revealed",
            concluded: true,
          }
          setColorsInteractionPhase("revealing")
        } else if (isGatekeeperPreview) {
          setConcluded(true)
          setMessages([nextMessage])
          setMediaChoiceSelected([])
          setMediaChoiceRationale("")
          setInteractionUi(nextUi)
          setDecisionPhase("revealed")
        } else {
          setConcluded(true)
          assistantHandoffRef.current = nextMessage
        }
      } else if (isColorsSubmission) {
        colorsHandoffRef.current = {
          message: nextMessage,
          interactionUi: nextUi,
          decisionPhase: "none",
          concluded: false,
        }
        setColorsInteractionPhase("revealing")
      } else if (isGatekeeperPreview) {
        setMediaChoiceSelected([])
        setMediaChoiceRationale("")
        setInteractionUi(nextUi)
        setDecisionPhase("none")
        setMessages([nextMessage])
      } else {
        assistantHandoffRef.current = nextMessage
      }
    } catch (err) {
      if (isColorsDemo && sessionId) {
        try {
          const stateResponse = await fetch(
            `/api/demo/colors/state?sessionId=${encodeURIComponent(sessionId)}`,
            { credentials: "same-origin" },
          )
          if (stateResponse.ok) {
            const state = await stateResponse.json()
            if (["passed", "redirected", "rejected"].includes(state.status)) {
              setMessages([{
                id: crypto.randomUUID(),
                role: "bot",
                content: typeof state.message === "string"
                  ? state.message
                  : "Thank you for taking part.",
              }])
              setConcluded(true)
              setDecisionPhase("revealed")
              setInteractionUi(parseInteractionUi(state.ui))
              setFailedAnswer(null)
              setFailedInteractionAnswer(null)
              setRequestError(null)
              setInput("")
              return
            }
          }
        } catch {
          // Preserve the original error and the answer for a later retry.
        }
      }
      const detail = err instanceof Error ? err.message : "Something went wrong."
      const errorMessage =
        detail === "AI service unavailable"
          ? "AI service unavailable. Turn on local test mode or check the model provider credits."
          : detail
      setFailedAnswer(text)
      setFailedInteractionAnswer(interactionAnswer ?? null)
      setRequestError(errorMessage)
      setQuestionDismissed(false)
      if (
        interactionUi.inputType === "text" ||
        interactionUi.inputType === "voice"
      ) {
        setInput(text)
      }
      if (isColorsSubmission) {
        setColorsInteractionPhase("ready")
      }
    } finally {
      if (slowResponseTimerRef.current) {
        clearTimeout(slowResponseTimerRef.current)
        slowResponseTimerRef.current = null
      }
      setShowSlowResponse(false)
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

    const newId = resetSession(isColorsDemo ? COLORS_DEMO_SESSION_KEY : SESSION_KEY)
    localStorage.removeItem(REVIEWER_REPORT_KEY)
    setSessionId(newId)
    setApplicantEmail(email)
    setApplicantEmailError(null)
    setReviewerReport(null)
    setRevealedQuestionId(null)
    setColorsInteractionPhase("ready")
    setRequestError(null)
    setFailedAnswer(null)
    setQuestionDismissed(false)
    setInput("")
    setMessages([])
  }

  function restart() {
    const newId = resetSession(isColorsDemo ? COLORS_DEMO_SESSION_KEY : SESSION_KEY)
    localStorage.removeItem(SECRET_KEY)
    localStorage.removeItem(PROFILE_KEY)
    localStorage.removeItem(REVIEWER_REPORT_KEY)
    assistantHandoffRef.current = null
    colorsHandoffRef.current = null
    setSessionId(newId)
    setInput("")
    setApplicantEmail("")
    setApplicantEmailError(null)
    setRevealedQuestionId(null)
    setColorsInteractionPhase("ready")
    setRequestError(null)
    setFailedAnswer(null)
    setShowSlowResponse(false)
    setQuestionDismissed(false)
    setPendingResume(null)
    setSettingsOpen(false)
    setMessages(EMAIL_CAPTURE_MESSAGES)
    setConcluded(false)
    setDecisionPhase("none")
    setMediaChoiceSelected([])
    setMediaChoiceRationale("")
    setInteractionUi(DEFAULT_GATEKEEPER_UI)
    setSelectedOptions([])
    setCurrentStep(null)
    setStepHint(null)
    setReviewerReport(null)
    const def = personas.find((p) => p.is_default)
    if (def) setSelectedPersonaId(def.id)
    if (selectedProjectId) localStorage.setItem(PROJECT_KEY, selectedProjectId)
  }

  function startOverFromResume() {
    const newId = resetSession(isColorsDemo ? COLORS_DEMO_SESSION_KEY : SESSION_KEY)
    localStorage.removeItem(SECRET_KEY)
    localStorage.removeItem(PROFILE_KEY)
    localStorage.removeItem(REVIEWER_REPORT_KEY)
    assistantHandoffRef.current = null
    colorsHandoffRef.current = null
    setSessionId(newId)
    setPendingResume(null)
    setMessages([])
    setInput("")
    setSelectedOptions([])
    setRevealedQuestionId(null)
    setColorsInteractionPhase("ready")
    setRequestError(null)
    setFailedAnswer(null)
    setShowSlowResponse(false)
    setQuestionDismissed(false)
    setConcluded(false)
    setDecisionPhase("none")
    setMediaChoiceSelected([])
    setMediaChoiceRationale("")
    setInteractionUi(DEFAULT_GATEKEEPER_UI)
    setCurrentStep(null)
    setStepHint(null)
    setReviewerReport(null)
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
  const isGatekeeperPreview =
    isColorsDemo || selectedProject?.projectType === "gatekeeper"
  const isColorsProject =
    isColorsDemo ||
    (isGatekeeperPreview &&
      selectedProject?.organisationName.trim().toLowerCase() === "colors")
  const showConclusionActions =
    concluded && (!isGatekeeperPreview || decisionPhase === "revealed")
  const showReviewerReport = Boolean(showConclusionActions && reviewerReport)
  const currentBotMessage = [...messages].reverse().find((msg) => msg.role === "bot")
  const questionNeedsRationale = Boolean(
    currentBotMessage &&
      /\b(why|reason|explain)\b/i.test(currentBotMessage.content),
  )
  const awaitingResumeChoice = pendingResume !== null
  const questionReady = Boolean(
    currentBotMessage &&
      (isColorsProject || revealedQuestionId === currentBotMessage.id),
  )
  const colorsInteractionBusy =
    isColorsProject && colorsInteractionPhase !== "ready"
  const interactionBusy = loading || colorsInteractionBusy
  const presenceState: GrouchoVisualState = interactionBusy || bootstrapping
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
    (!isGatekeeperPreview || questionReady) &&
    (!isColorsProject || colorsInteractionPhase !== "revealing") &&
    (interactionUi.inputType === "singleSelect" ||
      interactionUi.inputType === "multiSelect") &&
    interactionUi.options?.length,
  )
  const showMediaChoice = Boolean(
    applicantEmail &&
    !concluded &&
    !loading &&
    !bootstrapping &&
    decisionPhase === "none" &&
    (!isGatekeeperPreview || questionReady) &&
    (!isColorsProject || colorsInteractionPhase !== "revealing") &&
    interactionUi.inputType === "mediaChoice" &&
    interactionUi.mediaChoice,
  )
  const showAnswerArea =
    !concluded &&
    !awaitingResumeChoice &&
    !bootstrapping &&
    Boolean(currentBotMessage) &&
    (!isGatekeeperPreview || questionReady) &&
    (!isColorsProject || colorsInteractionPhase !== "revealing") &&
    (!isGatekeeperPreview || decisionPhase === "none")
  const structuredOptionsNeedDock = Boolean(
    showStructuredOptions &&
      (interactionUi.inputType === "multiSelect" ||
        (isColorsProject && interactionUi.inputType === "singleSelect")),
  )
  const showDockedAnswerArea = Boolean(
    showAnswerArea && (!showStructuredOptions || structuredOptionsNeedDock),
  )
  const renderAnswerArea =
    showDockedAnswerArea ||
    (isGatekeeperPreview &&
      !concluded &&
      !awaitingResumeChoice)
  const doorcheckScene = sceneForQuestion(
    currentBotMessage?.content ?? "",
    presenceState,
    concluded,
  )
  const colorsVisual = colorsVisualForQuestion(currentBotMessage?.content ?? "")
  const speechSupported =
    typeof window !== "undefined" && "speechSynthesis" in window
  const acceptsDictation =
    interactionUi.inputType === "text" || interactionUi.inputType === "voice"
  const voiceInput = useBrowserDictation({
    value: input,
    onChange: (nextValue) => {
      setInput(nextValue)
      broadcastTyping(Boolean(nextValue))
    },
    disabled:
      interactionBusy ||
      concluded ||
      !applicantEmail ||
      !acceptsDictation ||
      !showAnswerArea,
    onStart: () => {
      window.speechSynthesis?.cancel()
      setIsSpeaking(false)
    },
  })

  const handleQuestionComplete = useCallback((messageId: string) => {
    setRevealedQuestionId(messageId)
    if (isColorsProject && colorsInteractionPhase === "revealing") {
      setColorsInteractionPhase("ready")
      setInput("")
      setSelectedOptions([])
      window.requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [colorsInteractionPhase, isColorsProject])

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
              >
                {COLORS_VISUALS.map((visual) => (
                  <div
                    key={visual.id}
                    className="colors-doorcheck-media__visual"
                    data-active={visual.id === colorsVisual.id}
                  >
                    <Image
                      src={visual.src}
                      alt=""
                      fill
                      unoptimized
                      sizes="100vw"
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
                <span className="colors-doorcheck-wordmark">COLORS + STUDIOS</span>
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
              <span className="colors-doorcheck-context">
                {isColorsDemo ? "Forum demo" : "Forum application"}
              </span>
            ) : null}
            {isGatekeeperPreview && !isColorsProject ? (
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
            {isColorsProject && !isColorsDemo ? (
              <div ref={settingsRef} className="pointer-events-auto relative">
                <button
                  ref={settingsTriggerRef}
                  type="button"
                  onClick={() => setSettingsOpen((open) => !open)}
                  aria-label="Settings"
                  aria-expanded={settingsOpen}
                  aria-haspopup="dialog"
                  aria-controls={settingsPanelId}
                  className="doorcheck-utility-button"
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
                    <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span className="hidden sm:inline">Settings</span>
                </button>
                <AnimatePresence initial={false}>
                  {settingsOpen ? (
                    <motion.div
                      id={settingsPanelId}
                      role="dialog"
                      aria-label="Experience settings"
                      variants={{
                        closed: {
                          opacity: 0,
                          y: -2,
                          scale: 0.99,
                          transition: { duration: 0.15, ease: [0.22, 1, 0.36, 1] },
                        },
                        open: {
                          opacity: 1,
                          y: 0,
                          scale: 1,
                          transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] },
                        },
                      }}
                      initial={{ opacity: 0, y: -4, scale: 0.97 }}
                      animate="open"
                      exit="closed"
                      className="colors-settings-panel"
                    >
                      <label className="colors-settings-field">
                        <span>Project</span>
                        <select
                          value={selectedProjectId}
                          onChange={(event) => {
                            applyProjectSelection(event.target.value)
                            closeSettings(true)
                          }}
                        >
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {projectLabel(project)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="colors-settings-field">
                        <span>Persona</span>
                        <select
                          value={selectedPersonaId}
                          onChange={(event) => {
                            setSelectedPersonaId(event.target.value)
                            closeSettings(true)
                          }}
                        >
                          {personas.map((persona) => (
                            <option key={persona.id} value={persona.id}>
                              {persona.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="colors-settings-media-test">
                        <label className="colors-settings-field">
                          <span>Media question</span>
                          <select
                            value={mediaTestMode}
                            onChange={(event) =>
                              setMediaTestMode(event.target.value as MediaChoiceMode)
                            }
                          >
                            <option value="remove">Remove one</option>
                            <option value="select">Select top three</option>
                            <option value="rank">Rank top three</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => void startColorsMediaTest()}
                          disabled={!applicantEmail || mediaTestLoading}
                          className="colors-settings-action"
                        >
                          {mediaTestLoading ? "Loading shows…" : "Start media test"}
                        </button>
                        <p>Latest full shows from the official COLORS playlist.</p>
                      </div>
                      <dl className="colors-settings-meta">
                        <div><dt>Environment</dt><dd>{selectedProject?.environment ?? "Not set"}</dd></div>
                        <div><dt>Session</dt><dd>{selectedProject?.sessionMode ?? "Not set"}</dd></div>
                      </dl>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
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
        <main
          className={cn(
            "contents",
            isColorsProject && "colors-conversation-shell",
          )}
          aria-label={isColorsProject ? "COLORS Forum application" : undefined}
        >
          {isColorsProject ? (
            <div className="colors-chat-panel-label" aria-hidden="true">
              COLORS Forum application
            </div>
          ) : null}
          <MessageScroller.Provider
            autoScroll
            defaultScrollPosition={isColorsProject ? "last-anchor" : "end"}
            scrollPreviousItemPeek={64}
            scrollMargin={16}
          >
          <MessageScroller.Root
            className={cn(
              "relative min-h-0 flex-1",
              isColorsProject && "colors-chat-scroller",
            )}
            aria-busy={interactionBusy || bootstrapping}
          >
            <MessageScroller.Viewport
              className={cn(
                "scrollbar-hidden h-full overflow-y-auto overscroll-contain px-4 pt-14 pb-4 sm:px-6",
                isGatekeeperPreview &&
                  (isColorsProject
                    ? "doorcheck-viewport colors-doorcheck-viewport colors-chat-viewport"
                    : "doorcheck-viewport lg:pl-[44vw]"),
              )}
            >
              <MessageScroller.Content
                className={cn(
                  "mx-auto flex min-h-full w-full max-w-[900px] flex-col gap-5",
                  isGatekeeperPreview &&
                    (isColorsProject
                      ? "doorcheck-content colors-doorcheck-content colors-chat-content"
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
            {pendingResume ? (
              <MessageScroller.Item messageId="resume-session">
                <motion.section
                  initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.28, ease: EASE_OUT }}
                  className="mx-auto w-full max-w-lg rounded-2xl border border-white/12 bg-black/45 p-5 shadow-[0_18px_55px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md sm:p-6"
                  aria-labelledby="doorcheck-resume-title"
                >
                  <p className="text-[0.66rem] uppercase tracking-[0.16em] text-white/45">
                    Welcome back
                  </p>
                  <h1
                    ref={resumeTitleRef}
                    id="doorcheck-resume-title"
                    tabIndex={-1}
                    className="mt-2 text-balance text-2xl font-normal text-white outline-none sm:text-3xl"
                  >
                    Continue your conversation?
                  </h1>
                  <p className="mt-3 max-w-md text-pretty text-sm leading-relaxed text-white/58 sm:text-base">
                    We found an unfinished conversation. Pick up from the last
                    question, or begin again with a fresh conversation.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        commitBootstrapResponse(pendingResume)
                        setPendingResume(null)
                      }}
                      className="min-h-11 rounded-lg bg-white px-5 py-2.5 text-sm text-black transition-[opacity,transform] duration-150 ease-out hover:opacity-90 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    >
                      Continue
                    </button>
                    <button
                      type="button"
                      onClick={startOverFromResume}
                      className="min-h-11 rounded-lg border border-white/15 bg-transparent px-5 py-2.5 text-sm text-white/78 transition-[border-color,color,transform] duration-150 ease-out hover:border-white/30 hover:text-white active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    >
                      Start over
                    </button>
                  </div>
                </motion.section>
              </MessageScroller.Item>
            ) : isColorsProject ? (
              <ColorsTranscript
                applicantEmail={applicantEmail}
                colorsInteractionPhase={colorsInteractionPhase}
                commitHandoff={commitColorsHandoff}
                messages={messages}
                showSlowResponse={showSlowResponse}
              />
            ) : isGatekeeperPreview ? (
              <MessageScroller.Item messageId="gatekeeper-preview">
                <div className="doorcheck-question-stage mx-auto w-full">
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

                  <div className="doorcheck-question-slot">
                    <AnimatePresence mode="wait" initial={false}>
                      {decisionPhase === "evaluating" ? (
                        <motion.div
                          key="question-evaluating"
                          className="doorcheck-question-copy"
                          initial={{ opacity: 0, y: 4, filter: "blur(2px)" }}
                          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                          exit={{ opacity: 0, y: -4, filter: "blur(2px)" }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                        >
                          <p className="doorcheck-question-text">Let me sit with that for a moment.</p>
                        </motion.div>
                      ) : currentBotMessage &&
                        decisionPhase !== "decision" &&
                        !questionDismissed ? (
                        <motion.div
                          key={currentBotMessage.id}
                          className="doorcheck-question-copy"
                          initial={{ opacity: 0, y: 4, filter: "blur(2px)" }}
                          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                          exit={{ opacity: 0, y: -4, filter: "blur(2px)" }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                        >
                          <TypewriterQuestion
                            messageId={currentBotMessage.id}
                            text={currentBotMessage.content}
                            alreadyRevealed={
                              revealedQuestionId === currentBotMessage.id
                            }
                            onComplete={handleQuestionComplete}
                          />
                        </motion.div>
                      ) : bootstrapping ? (
                        <motion.div
                          key="question-opening"
                          className="doorcheck-question-copy"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15, ease: "easeInOut" }}
                        >
                          <p className="doorcheck-question-text">Opening the door…</p>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>

                  <div className="doorcheck-status-slot">
                    <AnimatePresence
                      initial={false}
                      onExitComplete={isColorsProject ? commitColorsHandoff : undefined}
                    >
                      {(isColorsProject
                        ? colorsInteractionPhase === "reading"
                        : loading) ? (
                        <motion.div
                          key="doorcheck-reading"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -3 }}
                          transition={{ duration: 0.15, ease: "easeInOut" }}
                          className={cn(
                            "flex items-center gap-3 text-sm text-white/48",
                            isColorsProject && "colors-reading-status",
                          )}
                          role="status"
                          aria-live="polite"
                        >
                          <span className="doorcheck-reading-mark" aria-hidden="true" />
                          <AnimatePresence mode="wait" initial={false}>
                            <motion.span
                              key={showSlowResponse ? "slow" : "reading"}
                              initial={{ opacity: 0, y: 4, filter: "blur(2px)" }}
                              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                              exit={{ opacity: 0, y: -4, filter: "blur(2px)" }}
                              transition={{ duration: 0.15, ease: "easeInOut" }}
                            >
                              {showSlowResponse
                                ? "Still with you — thoughtful answers can take a little longer."
                                : isColorsProject
                                  ? "Groucho is reading…"
                                  : "Reading your answer…"}
                            </motion.span>
                          </AnimatePresence>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                </div>
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

            {showStructuredOptions && interactionUi.options?.length ? (
              <MessageScroller.Item
                messageId={`options-${currentBotMessage?.id ?? "current"}`}
                scrollAnchor
                className="w-full"
              >
                <motion.div
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  className={cn(
                    "w-full py-2",
                    !isGatekeeperPreview &&
                      "rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3",
                  )}
                >
                  <StructuredOptionGrid
                    options={interactionUi.options}
                    selectedOptions={selectedOptions}
                    isColorsProject={isColorsProject}
                    isGatekeeperPreview={isGatekeeperPreview}
                    disabled={interactionBusy}
                    onChoose={(option) => {
                      if (interactionUi.inputType === "singleSelect") {
                        if (isColorsProject) {
                          setSelectedOptions([option])
                          return
                        }
                        void submit(option)
                        return
                      }
                      setSelectedOptions((previous) =>
                        previous.includes(option)
                          ? previous.filter((item) => item !== option)
                          : [...previous, option],
                      )
                    }}
                  />
                </motion.div>
              </MessageScroller.Item>
            ) : null}

            {showMediaChoice && interactionUi.mediaChoice ? (
              <MessageScroller.Item
                messageId={`media-options-${interactionUi.mediaChoice.id}`}
                scrollAnchor
                className="w-full"
              >
                <motion.div
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  className="w-full py-2"
                >
                  <MediaChoiceInput
                    key={`${interactionUi.mediaChoice.id}-options`}
                    section="options"
                    interaction={interactionUi.mediaChoice}
                    selected={mediaChoiceSelected}
                    rationale={mediaChoiceRationale}
                    onSelectedChange={setMediaChoiceSelected}
                    onRationaleChange={setMediaChoiceRationale}
                    disabled={interactionBusy}
                  />
                </motion.div>
              </MessageScroller.Item>
            ) : null}

            {!isGatekeeperPreview && !isColorsProject && (
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
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.span
                            key={showSlowResponse ? "slow" : "reading"}
                            initial={{ opacity: 0, y: 4, filter: "blur(2px)" }}
                            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                            exit={{ opacity: 0, y: -4, filter: "blur(2px)" }}
                            transition={{ duration: 0.15, ease: "easeInOut" }}
                            aria-live="polite"
                          >
                            {showSlowResponse ? (
                              "Still with you — thoughtful answers can take a little longer."
                            ) : (
                              <TextShimmer className="italic">Reading you.</TextShimmer>
                            )}
                          </motion.span>
                        </AnimatePresence>
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
                  <ReviewerReportPanel report={reviewerReport} sample={isColorsDemo} />
                </motion.div>
              </MessageScroller.Item>
            ) : null}
            {isColorsDemo && showConclusionActions && !reviewerReport ? (
              <MessageScroller.Item messageId="reviewer-report-status">
                <div className="mx-auto mb-5 w-full max-w-[720px] rounded-xl border border-amber-200/20 bg-amber-100/[0.06] p-4 text-sm leading-relaxed text-white/65">
                  <p className="font-medium text-amber-100/85">Sample reviewer report</p>
                  <p className="mt-1">This report is for the demo only. Applicants would not see it.</p>
                  {demoReportState === "failed" ? (
                    <>
                      <p className="mt-3 text-white/70">{demoReportError ?? "The report could not be generated."}</p>
                      <button
                        type="button"
                        onClick={() => void requestDemoReport(sessionId)}
                        className="mt-3 rounded-md border border-white/25 px-3 py-1.5 text-white hover:bg-white/10"
                      >
                        Retry report only
                      </button>
                    </>
                  ) : (
                    <p className="mt-3 text-white/70">Groucho is preparing the evidence-based opinion…</p>
                  )}
                </div>
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
                  ? "doorcheck-answer-shell colors-doorcheck-answer-shell colors-chat-conclusion"
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

        {renderAnswerArea && (
          <motion.div
            aria-hidden={!showDockedAnswerArea}
            inert={showDockedAnswerArea ? undefined : true}
            className={cn(
              "mx-auto w-full max-w-[900px] shrink-0 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6",
              isGatekeeperPreview &&
                (isColorsProject
                  ? "doorcheck-answer-shell colors-doorcheck-answer-shell colors-chat-composer-shell"
                  : "doorcheck-answer-shell lg:ml-[44vw] lg:max-w-none lg:pr-8 lg:pl-8"),
              !showDockedAnswerArea && "pointer-events-none",
            )}
            initial={false}
            animate={{ opacity: showDockedAnswerArea ? 1 : 0 }}
            transition={{ opacity: { duration: 0.18 } }}
          >
            {showMediaChoice && interactionUi.mediaChoice ? (
              <motion.div
                layout
                className={cn(
                  "relative w-full rounded-2xl border border-white/10 bg-zinc-950/85 px-4 py-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-md sm:px-5",
                  isColorsProject && "colors-chat-composer",
                )}
              >
                <MediaChoiceInput
                  key={`${interactionUi.mediaChoice.id}-composer`}
                  section="composer"
                  interaction={interactionUi.mediaChoice}
                  selected={mediaChoiceSelected}
                  rationale={mediaChoiceRationale}
                  onSelectedChange={setMediaChoiceSelected}
                  onRationaleChange={setMediaChoiceRationale}
                  disabled={interactionBusy}
                  onSubmit={(message, answer) =>
                    void submit(message, false, answer)
                  }
                />
              </motion.div>
            ) : showStructuredOptions ? (
              <motion.div
                layout
                className={cn(
                  "relative w-full",
                  isColorsProject && "colors-chat-choice-followup",
                )}
              >
                {isColorsProject &&
                interactionUi.inputType === "singleSelect" ? (
                  <div className="contents">
                    {questionNeedsRationale ? (
                      <textarea
                        value={input}
                        rows={1}
                        onChange={handleInputChange}
                        onKeyDown={(event) => {
                          if (
                            event.key === "Enter" &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing &&
                            selectedOptions[0] &&
                            input.trim()
                          ) {
                            event.preventDefault()
                            void submit(`${selectedOptions[0]} — ${input.trim()}`)
                          }
                        }}
                        disabled={interactionBusy}
                        placeholder="Tell us why…"
                        aria-label="Explain your choice"
                        className="colors-chat-choice-input"
                      />
                    ) : null}
                    <button
                      type="button"
                      disabled={
                        interactionBusy ||
                        !selectedOptions[0] ||
                        (questionNeedsRationale && !input.trim())
                      }
                      onClick={() =>
                        void submit(
                          questionNeedsRationale
                            ? `${selectedOptions[0]} — ${input.trim()}`
                            : selectedOptions[0],
                        )
                      }
                      className="colors-chat-choice-submit"
                    >
                      <span>{questionNeedsRationale ? "Send answer" : "Continue"}</span>
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="m12 19V5m0 0-5 5m5-5 5 5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                ) : interactionUi.inputType === "multiSelect" ? (
                  <button
                    type="button"
                    disabled={interactionBusy || selectedOptions.length === 0}
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
                className={cn(
                  isGatekeeperPreview
                    ? "doorcheck-input relative flex min-h-14 items-end gap-2 border-b p-0 pb-2"
                    : "relative flex min-h-14 items-end gap-2 rounded-2xl border border-white/10 bg-zinc-950/70 p-2 pl-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-md transition-[border-color,box-shadow,background-color,opacity] duration-200 focus-within:border-white/18 focus-within:bg-zinc-950/85 focus-within:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_0_0_1px_rgba(255,255,255,0.06),0_0_0_3px_rgba(255,255,255,0.05)]",
                  isColorsProject && "colors-chat-composer",
                )}
              >
                {applicantEmail ? (
                  <textarea
                    ref={textareaRef}
                    value={input}
                    rows={1}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    disabled={interactionBusy}
                    readOnly={voiceInput.listening}
                    placeholder={
                      voiceInput.listening
                        ? "Listening…"
                        : loading && !isColorsProject
                          ? `${personaName} is replying…`
                          : (isColorsProject ? "Write something…" : stepHint?.trim()) ||
                            (selectedProject?.projectType === "onboarding"
                              ? "Your answer"
                              : "Type your message")
                    }
                    aria-label="Message"
                    aria-disabled={interactionBusy}
                    aria-describedby={
                      voiceInput.listening || voiceInput.error
                        ? dictationStatusId
                        : undefined
                    }
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
                {applicantEmail && acceptsDictation ? (
                  <button
                    type="button"
                    onClick={voiceInput.toggle}
                    disabled={interactionBusy || !voiceInput.supported}
                    aria-label={
                      voiceInput.supported
                        ? voiceInput.listening
                          ? "Stop voice input"
                          : "Start voice input"
                        : "Voice input is unavailable in this browser"
                    }
                    aria-pressed={voiceInput.listening}
                    title={
                      voiceInput.supported
                        ? voiceInput.listening
                          ? "Stop listening"
                          : "Answer with your voice"
                        : "Voice input is unavailable in this browser"
                    }
                    data-listening={voiceInput.listening}
                    className="doorcheck-dictation grid size-11 shrink-0 place-items-center rounded-full transition-[color,background-color,scale,opacity] duration-150 active:scale-[0.96] disabled:cursor-not-allowed"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-[1.1rem]"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M12 4.25a3 3 0 0 0-3 3v4.5a3 3 0 0 0 6 0v-4.5a3 3 0 0 0-3-3Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <path
                        d="M6.75 11.5v.25a5.25 5.25 0 0 0 10.5 0v-.25M12 17v3M9.5 20h5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="doorcheck-dictation-dot" aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={interactionBusy || !input.trim()}
                  aria-label={
                    colorsInteractionPhase === "reading"
                      ? "Groucho is reading your answer"
                      : applicantEmail
                        ? "Send message"
                        : "Continue"
                  }
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-xl bg-white text-black transition-[opacity,scale,background-color] duration-150 hover:bg-white/90 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-25",
                    isGatekeeperPreview && "doorcheck-send rounded-full",
                    isColorsProject &&
                      colorsInteractionPhase === "reading" &&
                      "doorcheck-send--reading",
                  )}
                >
                  <span
                    className="t-icon-swap"
                    data-state={colorsInteractionPhase === "reading" ? "b" : "a"}
                    aria-hidden="true"
                  >
                    <span className="t-icon" data-icon="a">
                      <svg viewBox="0 0 24 24" className="size-4" fill="none">
                        <path
                          d="m12 19V5m0 0-5 5m5-5 5 5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <span className="t-icon" data-icon="b">
                      <span className="doorcheck-reading-mark" />
                    </span>
                  </span>
                </button>
                <AnimatePresence initial={false}>
                {loading && !isColorsProject && (
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
            {applicantEmail &&
            acceptsDictation &&
            (voiceInput.listening || voiceInput.error) ? (
              <p
                id={dictationStatusId}
                className="doorcheck-dictation-status"
                aria-live="polite"
              >
                {voiceInput.error ??
                  "Listening… speak naturally, then review your answer."}
              </p>
            ) : null}
            {applicantEmailError ? (
              <p className="mt-2 text-sm text-red-300" role="alert">
                {applicantEmailError}
              </p>
            ) : null}
            {requestError ? (
              <div
                className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300/15 bg-red-300/[0.04] px-3 py-2.5"
                role="alert"
              >
                <p className="text-pretty text-sm text-red-200/85">
                  {requestError}
                </p>
                {failedAnswer ? (
                  <button
                    type="button"
                    onClick={() =>
                      void submit(
                        failedAnswer,
                        true,
                        failedInteractionAnswer ?? undefined,
                      )
                    }
                    disabled={loading}
                    className="min-h-11 rounded-lg border border-red-200/20 px-4 py-2 text-sm text-red-100 transition-[border-color,color,transform,opacity] duration-150 ease-out hover:border-red-100/40 hover:text-white active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-100 disabled:cursor-wait disabled:opacity-40"
                  >
                    Retry answer
                  </button>
                ) : null}
              </div>
            ) : null}
            {!isColorsProject && messages.length === 1 && projects.length >= 1 && (
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
            {!isColorsProject && messages.length === 1 && personas.length >= 1 && (
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
            {!isColorsProject && messages.length === 1 && selectedProject && (
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
        </main>
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
          --groucho-active: #e4a16f;
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
          inset: 0;
          overflow: hidden;
          opacity: 0;
          transform: scale(1.015);
          transition:
            opacity 650ms cubic-bezier(0.22, 1, 0.36, 1),
            transform 1100ms cubic-bezier(0.22, 1, 0.36, 1);
          will-change: opacity, transform;
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
        .colors-doorcheck-media__veil {
          background:
            radial-gradient(circle at 48% 54%, rgb(0 0 0 / 0.32), rgb(0 0 0 / 0.7) 72%),
            rgb(0 0 0 / 0.22);
        }
        .colors-doorcheck-wordmark {
          font-size: 1rem;
          font-weight: 600;
          letter-spacing: 0.2em;
          color: white;
        }
        .colors-settings-panel {
          position: absolute;
          top: calc(100% + 0.6rem);
          right: 0;
          width: min(22rem, calc(100vw - 2rem));
          transform-origin: top right;
          border: 1px solid rgb(255 255 255 / 0.14);
          border-radius: 1rem;
          background: rgb(18 18 18 / 0.96);
          padding: 1rem;
          color: white;
          box-shadow: 0 18px 55px rgb(0 0 0 / 0.42);
          backdrop-filter: blur(18px);
        }
        .colors-settings-field {
          display: grid;
          gap: 0.4rem;
          margin-bottom: 0.85rem;
          font-size: 0.62rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgb(255 255 255 / 0.48);
        }
        .colors-settings-field select {
          width: 100%;
          min-height: 2.75rem;
          border: 1px solid rgb(255 255 255 / 0.14);
          border-radius: 0.65rem;
          background: rgb(255 255 255 / 0.05);
          padding: 0 0.75rem;
          font-size: 0.82rem;
          letter-spacing: 0;
          text-transform: none;
          color: white;
          outline: none;
        }
        .colors-settings-field select:focus-visible {
          border-color: rgb(255 255 255 / 0.5);
          box-shadow: 0 0 0 3px rgb(255 255 255 / 0.1);
        }
        .colors-settings-media-test {
          margin-top: 1rem;
          padding-top: 1rem;
          border-top: 1px solid rgb(255 255 255 / 0.1);
        }
        .colors-settings-action {
          width: 100%;
          min-height: 2.75rem;
          border: 1px solid rgb(255 255 255 / 0.22);
          border-radius: 0.65rem;
          background: white;
          color: #111;
          font-size: 0.75rem;
          letter-spacing: 0.04em;
          cursor: pointer;
          transition: opacity 150ms ease-out, transform 150ms ease-out;
        }
        .colors-settings-action:hover { opacity: 0.88; }
        .colors-settings-action:active { transform: scale(0.98); }
        .colors-settings-action:focus-visible {
          outline: 2px solid white;
          outline-offset: 3px;
        }
        .colors-settings-action:disabled {
          cursor: not-allowed;
          opacity: 0.38;
        }
        .colors-settings-media-test > p {
          margin: 0.55rem 0 0;
          font-size: 0.65rem;
          line-height: 1.45;
          color: rgb(255 255 255 / 0.38);
        }
        .colors-settings-meta {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
          margin-top: 1rem;
          padding-top: 0.85rem;
          border-top: 1px solid rgb(255 255 255 / 0.1);
        }
        .colors-settings-meta div { min-width: 0; }
        .colors-settings-meta dt {
          margin-bottom: 0.2rem;
          font-size: 0.58rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgb(255 255 255 / 0.34);
        }
        .colors-settings-meta dd {
          overflow: hidden;
          margin: 0;
          font-size: 0.78rem;
          color: rgb(255 255 255 / 0.72);
          text-overflow: ellipsis;
          white-space: nowrap;
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
          grid-template-rows: auto minmax(0, 1fr) 2.5rem;
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
        .doorcheck-question-copy {
          min-width: 0;
          align-self: center;
        }
        .colors-doorcheck .doorcheck-type-cursor {
          width: 0.055em;
          background: rgb(255 255 255 / 0.82);
        }
        .colors-doorcheck .doorcheck-reading-mark {
          background: var(--groucho-active);
        }
        .colors-reading-status {
          color: color-mix(in srgb, var(--groucho-active) 78%, white);
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
        .colors-doorcheck .doorcheck-send--reading,
        .colors-doorcheck .doorcheck-send--reading:disabled {
          background: color-mix(in srgb, var(--groucho-active) 74%, transparent);
          color: #27170e;
          opacity: 1;
        }
        .doorcheck-send .t-icon,
        .doorcheck-send .t-icon-swap {
          display: grid;
          place-items: center;
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
        .colors-doorcheck-context,
        .colors-chat-panel-label,
        .colors-chat-status {
          font-family: var(--font-geist-pixel), monospace;
        }
        .colors-doorcheck-context {
          margin-right: 0.25rem;
          font-size: 0.7rem;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: rgb(255 255 255 / 0.62);
        }
        .colors-doorcheck {
          font-family: var(--font-geist), sans-serif;
        }
        .colors-doorcheck-media__visual img {
          filter: grayscale(1) saturate(0) contrast(1.14) brightness(0.72);
        }
        .colors-doorcheck-media__veil {
          background:
            radial-gradient(circle at 50% 46%, rgb(0 0 0 / 0.24), rgb(0 0 0 / 0.78) 76%),
            linear-gradient(90deg, rgb(0 0 0 / 0.4), rgb(0 0 0 / 0.12) 50%, rgb(0 0 0 / 0.45));
        }
        .colors-doorcheck .doorcheck-utility-button {
          min-width: 2.75rem;
          justify-content: center;
          border-color: transparent;
          background: transparent;
          padding-inline: 0.65rem;
          color: rgb(255 255 255 / 0.42);
          backdrop-filter: none;
        }
        .colors-doorcheck .doorcheck-utility-button:hover {
          border-color: rgb(255 255 255 / 0.12);
          background: rgb(0 0 0 / 0.25);
          color: white;
        }
        .colors-conversation-shell {
          position: relative;
          z-index: 5;
          display: flex;
          width: min(28.25rem, calc(100vw - 2rem));
          height: min(41rem, calc(100dvh - 10rem));
          min-height: 31rem;
          flex: none;
          flex-direction: column;
          align-self: center;
          margin: auto;
          overflow: hidden;
          border: 1px solid rgb(255 255 255 / 0.24);
          border-radius: 0.55rem;
          background: rgb(10 10 10 / 0.76);
          box-shadow:
            0 32px 90px rgb(0 0 0 / 0.38),
            inset 0 1px 0 rgb(255 255 255 / 0.035);
          backdrop-filter: blur(18px) saturate(0.7);
        }
        .colors-chat-panel-label {
          display: flex;
          min-height: 2.75rem;
          flex: 0 0 auto;
          align-items: center;
          padding: 0 1.6rem;
          font-size: 0.62rem;
          letter-spacing: 0.025em;
          text-transform: uppercase;
          color: rgb(255 255 255 / 0.43);
        }
        .colors-chat-scroller {
          flex: 1 1 auto;
        }
        .colors-chat-viewport {
          padding: 0 1.6rem 0.5rem;
          scroll-padding-block: 1rem;
        }
        .colors-chat-content {
          width: 100%;
          min-height: 100%;
          margin: 0;
          padding: 0.25rem 0 0.75rem;
          gap: 1.35rem;
          justify-content: flex-start;
        }
        .colors-chat-turn {
          flex: 0 0 auto;
        }
        .colors-chat-agent-message {
          width: 100%;
          color: rgb(255 255 255 / 0.91);
        }
        .colors-chat-user-message {
          width: min(18rem, 82%);
          border-radius: 0.55rem;
          background: rgb(255 255 255 / 0.105);
          padding: 0.8rem 0.9rem;
          color: rgb(255 255 255 / 0.9);
          box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.035);
        }
        .colors-chat-message-copy {
          margin: 0;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          font-size: 0.9rem;
          line-height: 1.42;
          text-wrap: pretty;
        }
        .colors-chat-intro-media {
          position: relative;
          width: 100%;
          aspect-ratio: 1.62;
          margin-bottom: 1.1rem;
          overflow: hidden;
          border-radius: 0.55rem;
          outline: 1px solid oklch(1 0 0 / 0.1);
          outline-offset: -1px;
        }
        .colors-chat-intro-copy {
          display: grid;
          gap: 1rem;
          margin-bottom: 1.4rem;
          color: rgb(255 255 255 / 0.78);
        }
        .colors-chat-intro-copy p {
          margin: 0;
          font-size: 0.85rem;
          line-height: 1.46;
          text-wrap: pretty;
        }
        .colors-chat-opening-question {
          font-weight: 520;
          color: rgb(255 255 255 / 0.96);
        }
        .colors-chat-status-row {
          min-height: 2rem;
          flex: 0 0 auto;
        }
        .colors-chat-status {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          font-size: 0.66rem;
          line-height: 1.35;
          color: rgb(255 255 255 / 0.56);
        }
        .colors-chat-status-mark {
          width: 0.34rem;
          height: 0.34rem;
          flex: 0 0 auto;
          border-radius: 999px;
          background: currentColor;
          animation: doorcheck-reading 1.1s ease-in-out infinite;
        }
        .colors-chat-composer-shell {
          width: auto;
          height: auto;
          max-height: none;
          flex: 0 0 auto;
          margin: 0;
          overflow: visible;
          padding: 0.45rem 1.6rem 1rem;
        }
        .colors-doorcheck-answer-shell.colors-chat-composer-shell {
          height: auto;
          min-height: 0;
          margin-top: auto;
          padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
        }
        .colors-chat-conclusion {
          width: auto;
          height: auto;
          max-height: 46%;
          flex: 0 0 auto;
          margin: 0;
          overflow-y: auto;
          padding: 0.55rem 1.6rem 1.25rem;
        }
        .colors-chat-composer-shell::before {
          content: "";
          position: sticky;
          z-index: 1;
          top: -0.45rem;
          display: block;
          height: 1px;
          margin-bottom: 0.6rem;
          background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.09) 12%, rgb(255 255 255 / 0.09) 88%, transparent);
        }
        .colors-chat-composer {
          min-height: 3.5rem;
          align-items: flex-end;
          border: 1px solid rgb(255 255 255 / 0.08);
          border-radius: 0.55rem;
          background: rgb(255 255 255 / 0.07);
          padding: 0.4rem 0.4rem 0.35rem 0.75rem;
          transition-property: border-color, background-color, box-shadow;
          transition-duration: 160ms;
          transition-timing-function: ease-out;
        }
        .colors-chat-composer:focus-within {
          border-color: rgb(255 255 255 / 0.2);
          background: rgb(255 255 255 / 0.09);
          box-shadow: 0 0 0 3px rgb(255 255 255 / 0.045);
        }
        .colors-doorcheck .colors-chat-composer textarea,
        .colors-doorcheck .colors-chat-composer input {
          min-height: 2.75rem;
          padding-block: 0.25rem;
          font-size: 0.86rem;
          line-height: 1.45;
        }
        .colors-chat-composer .doorcheck-dictation {
          width: 2.5rem;
          height: 2.5rem;
        }
        .colors-chat-composer .doorcheck-send {
          position: relative;
          width: 2.25rem;
          height: 2.25rem;
        }
        .colors-chat-composer .doorcheck-send::after {
          content: "";
          position: absolute;
          inset: -0.25rem;
        }
        .colors-chat-options {
          padding: 0;
          animation: none;
        }
        .colors-chat-option-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.5rem;
        }
        .colors-doorcheck .colors-chat-option-card {
          position: relative;
          display: block;
          min-height: 7rem;
          overflow: hidden;
          border: 1px solid transparent;
          border-radius: 0.55rem;
          background: #181818;
          padding: 0;
          color: white;
          box-shadow: none;
          isolation: isolate;
          text-align: left;
          transition-property: border-color, opacity, scale;
          transition-duration: 150ms;
          transition-timing-function: ease-out;
        }
        .colors-doorcheck .colors-chat-option-card:hover {
          border-color: rgb(255 255 255 / 0.55);
          background: #181818;
          color: white;
        }
        .colors-doorcheck .colors-chat-option-card:focus-visible {
          outline: 2px solid white;
          outline-offset: 2px;
        }
        .colors-doorcheck .colors-chat-option-card[aria-pressed="true"] {
          border-color: white;
          box-shadow: inset 0 0 0 1px white;
        }
        .colors-chat-option-shade {
          position: absolute;
          inset: 0;
          z-index: 1;
          background: linear-gradient(180deg, transparent 35%, rgb(0 0 0 / 0.82));
        }
        .colors-chat-option-label {
          position: absolute;
          z-index: 2;
          right: 0.6rem;
          bottom: 0.55rem;
          left: 0.6rem;
          overflow: hidden;
          font-size: 0.65rem;
          line-height: 1.25;
          letter-spacing: 0.035em;
          text-overflow: ellipsis;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .colors-chat-option-check {
          position: absolute;
          z-index: 2;
          top: 0.55rem;
          right: 0.55rem;
          display: grid;
          width: 1.5rem;
          height: 1.5rem;
          place-items: center;
          border: 1px solid rgb(255 255 255 / 0.42);
          border-radius: 999px;
          background: rgb(0 0 0 / 0.36);
          opacity: 0;
          scale: 0.25;
          filter: blur(4px);
          transition-property: opacity, scale, filter;
          transition-duration: 180ms;
          transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
        }
        .colors-chat-option-check svg {
          width: 0.95rem;
          height: 0.95rem;
        }
        .colors-chat-option-card[aria-pressed="true"] .colors-chat-option-check {
          opacity: 1;
          scale: 1;
          filter: blur(0);
        }
        .colors-chat-choice-followup {
          display: flex;
          align-items: flex-end;
          gap: 0.55rem;
          margin-top: 0.75rem;
          border: 1px solid rgb(255 255 255 / 0.09);
          border-radius: 0.55rem;
          background: rgb(255 255 255 / 0.07);
          padding: 0.55rem;
        }
        .colors-chat-choice-input {
          min-height: 2.75rem;
          max-height: 6rem;
          flex: 1;
          resize: vertical;
          border: 0;
          background: transparent;
          padding: 0.6rem;
          color: white;
          font: inherit;
          font-size: 0.82rem;
          line-height: 1.4;
          outline: 0;
        }
        .colors-chat-choice-input::placeholder {
          color: rgb(255 255 255 / 0.36);
        }
        .colors-chat-choice-submit {
          display: inline-flex;
          min-height: 2.75rem;
          flex: 0 0 auto;
          align-items: center;
          gap: 0.45rem;
          border: 0;
          border-radius: 0.45rem;
          background: white;
          padding: 0 0.8rem;
          color: #111;
          font: inherit;
          font-size: 0.7rem;
          cursor: pointer;
          transition-property: opacity, scale;
          transition-duration: 150ms;
          transition-timing-function: ease-out;
        }
        .colors-chat-choice-submit svg {
          width: 0.9rem;
          height: 0.9rem;
        }
        .colors-chat-choice-submit:active {
          scale: 0.96;
        }
        .colors-chat-choice-submit:disabled {
          cursor: not-allowed;
          opacity: 0.28;
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
        .doorcheck-question-stage {
          display: grid;
          height: clamp(18rem, 46vh, 28rem);
          max-width: 42rem;
          grid-template-rows: auto minmax(0, 1fr) 2.5rem;
          align-items: center;
          text-wrap: balance;
        }
        .doorcheck-question-slot {
          display: grid;
          min-width: 0;
          min-height: 0;
          align-items: center;
          overflow-y: auto;
          scrollbar-gutter: stable;
          scrollbar-width: none;
        }
        .doorcheck-question-slot::-webkit-scrollbar { display: none; }
        .doorcheck-status-slot {
          display: flex;
          min-width: 0;
          min-height: 2.5rem;
          align-items: center;
        }
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
        .doorcheck-answer-shell {
          position: relative;
          z-index: 2;
          height: clamp(8.5rem, 18vh, 10.5rem);
          overflow-y: auto;
          scrollbar-gutter: stable;
          scrollbar-width: none;
        }
        .doorcheck-answer-shell::-webkit-scrollbar { display: none; }
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
        .doorcheck-dictation {
          position: relative;
          border: 1px solid rgb(255 255 255 / 0.12);
          background: rgb(255 255 255 / 0.04);
          color: rgb(255 255 255 / 0.55);
        }
        .doorcheck-dictation:hover:not(:disabled) {
          border-color: rgb(255 255 255 / 0.28);
          background: rgb(255 255 255 / 0.08);
          color: white;
        }
        .doorcheck-dictation:focus-visible {
          outline: 2px solid var(--scene-light);
          outline-offset: 2px;
        }
        .doorcheck-dictation:disabled { opacity: 0.28; }
        .doorcheck-dictation[data-listening="true"] {
          border-color: color-mix(in srgb, var(--scene-light) 68%, white);
          background: color-mix(in srgb, var(--scene-light) 14%, transparent);
          color: var(--scene-light);
          opacity: 1;
        }
        .doorcheck-dictation-dot {
          position: absolute;
          top: 0.42rem;
          right: 0.42rem;
          width: 0.38rem;
          height: 0.38rem;
          border-radius: 999px;
          background: #ff6b6b;
          opacity: 0;
        }
        .doorcheck-dictation[data-listening="true"] .doorcheck-dictation-dot {
          opacity: 1;
          animation: doorcheck-dictation-pulse 1.2s ease-in-out infinite;
        }
        .doorcheck-dictation-status {
          margin: 0.55rem 0 0;
          color: rgb(255 255 255 / 0.52);
          font-size: 0.72rem;
          line-height: 1.4;
          text-wrap: pretty;
        }
        .doorcheck-send { background: var(--scene-light); color: #15110a; }
        .doorcheck-send:hover { background: color-mix(in srgb, var(--scene-light) 86%, white); }
        @keyframes doorcheck-drift {
          from { transform: translate3d(-2%, -1%, 0) scale(1); }
          to { transform: translate3d(5%, 4%, 0) scale(1.08); }
        }
        @keyframes doorcheck-cursor { 0%, 52% { opacity: 1; } 53%, 100% { opacity: 0; } }
        @keyframes doorcheck-reading { 0%, 100% { opacity: 0.3; transform: scale(0.78); } 50% { opacity: 1; transform: scale(1); } }
        @keyframes doorcheck-dictation-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
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
          .colors-conversation-shell {
            width: min(28.25rem, calc(100vw - 2rem));
          }
          .colors-chat-content,
          .colors-chat-composer-shell,
          .colors-chat-conclusion {
            width: 100%;
            margin: 0;
          }
        }
        @media (max-width: 639px) {
          .colors-settings-panel {
            position: fixed;
            top: 4.5rem;
            right: 1rem;
            left: 1rem;
            width: auto;
          }
          .doorcheck-question-text { font-size: clamp(2rem, 10vw, 3.25rem); line-height: 1.06; }
          .doorcheck-content { padding-top: 5.25rem; padding-bottom: 0.5rem; }
          .doorcheck-question-stage {
            height: clamp(17rem, 45vh, 23rem);
            text-wrap: pretty;
          }
          .doorcheck-answer-shell { height: 9.25rem; }
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
          .colors-doorcheck-media__veil {
            background: rgb(0 0 0 / 0.58);
          }
          .colors-doorcheck-wordmark { font-size: 0.76rem; }
          .colors-doorcheck-credit { right: 1rem; bottom: 0.65rem; }
          .colors-doorcheck-context {
            display: none;
          }
          .colors-conversation-shell {
            width: calc(100vw - 1rem);
            height: calc(100dvh - 7.25rem);
            min-height: 0;
            margin-top: 4.5rem;
            margin-bottom: 2.25rem;
            border-radius: 0.65rem;
          }
          .colors-chat-panel-label {
            min-height: 2.5rem;
            padding-inline: 1rem;
          }
          .colors-chat-viewport {
            padding-inline: 1rem;
          }
          .colors-chat-content {
            width: 100%;
            padding-top: 0.1rem;
          }
          .colors-chat-composer-shell,
          .colors-chat-conclusion {
            width: 100%;
            height: auto;
            margin: 0;
            padding: 0.45rem 1rem max(0.8rem, env(safe-area-inset-bottom));
          }
          .colors-chat-composer .doorcheck-dictation {
            width: 2.75rem;
            height: 2.75rem;
          }
          .colors-chat-option-card {
            min-height: 6.25rem;
          }
          .colors-chat-choice-submit span {
            display: none;
          }
          .colors-chat-choice-submit {
            width: 2.75rem;
            padding: 0;
            justify-content: center;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .doorcheck-media__shape,
          .doorcheck-type-cursor--resting,
          .doorcheck-reading-mark,
          .doorcheck-dictation-dot,
          .doorcheck-options { animation: none; }
          .colors-doorcheck-media__visual { transition: none; }
          .colors-chat-status-mark { animation: none; }
        }
      `}</style>
    </MotionConfig>
  )
}
