"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { OnboardingFlowStep } from "@/lib/project-settings"
import {
  normalizeSimpleQuestions,
  questionsFromSteps,
  stepsFromQuestionLines,
  syncQuestionTextsToSteps,
} from "@/lib/onboarding-flow-helpers"
import { ONBOARDING_FLOW_PRESETS } from "@/lib/onboarding-flow-presets"
import { setupBtn, setupInput, setupLabel } from "@/components/admin/project-setup-ui"

type EditorMode = "simple" | "advanced"

const SYNC_DEBOUNCE_MS = 400

type Props = {
  steps: OnboardingFlowStep[]
  onChange: (steps: OnboardingFlowStep[]) => void
  welcomeMessage: string
  onWelcomeMessageChange: (value: string) => void
  /** When this changes, re-hydrate local drafts from `steps` (initial load / save). */
  editorKey?: string
  /** Register flush — returns latest steps after applying pending edits (call before save). */
  registerFlush?: (flush: () => OnboardingFlowStep[]) => void
}

export function OnboardingFlowEditor({
  steps,
  onChange,
  welcomeMessage,
  onWelcomeMessageChange,
  editorKey,
  registerFlush,
}: Props) {
  const [mode, setMode] = useState<EditorMode>("simple")
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState("")
  const [draftQuestions, setDraftQuestions] = useState<string[]>([])
  const stepsRef = useRef(steps)
  const onChangeRef = useRef(onChange)
  const draftRef = useRef<string[]>([])
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastEditorKeyRef = useRef<string | undefined>(undefined)

  stepsRef.current = steps
  onChangeRef.current = onChange
  draftRef.current = draftQuestions

  useEffect(() => {
    if (editorKey === lastEditorKeyRef.current) return
    lastEditorKeyRef.current = editorKey
    setDraftQuestions(questionsFromSteps(steps))
  }, [editorKey, steps])

  const flushSimpleDraft = useCallback((questions: string[], normalize: boolean) => {
    const prev = stepsRef.current
    const next = normalize
      ? normalizeSimpleQuestions(questions, prev)
      : syncQuestionTextsToSteps(questions, prev)
    onChangeRef.current(next)
    if (normalize) {
      setDraftQuestions(questionsFromSteps(next))
    }
  }, [])

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!registerFlush) return
    registerFlush(() => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current)
        syncTimerRef.current = null
      }
      const prev = stepsRef.current
      const next = normalizeSimpleQuestions(draftRef.current, prev)
      onChangeRef.current(next)
      setDraftQuestions(questionsFromSteps(next))
      return next
    })
  }, [registerFlush, flushSimpleDraft])

  function updateFlowStep(index: number, patch: Partial<OnboardingFlowStep>) {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function setSimpleQuestion(index: number, value: string) {
    setDraftQuestions((prev) => {
      const next = [...prev]
      while (next.length <= index) next.push("")
      next[index] = value
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncTimerRef.current = setTimeout(() => {
        flushSimpleDraft(next, false)
      }, SYNC_DEBOUNCE_MS)
      return next
    })
  }

  function handleSimpleBlur() {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }
    flushSimpleDraft(draftRef.current, true)
  }

  function addSimpleQuestion() {
    if (steps.length >= 12) return
    const nextQuestions = [...draftQuestions, ""]
    setDraftQuestions(nextQuestions)
    const nextSteps = [
      ...steps,
      {
        id: `step_${steps.length + 1}`,
        title: `Step ${steps.length + 1}`,
        question: "",
        profile_key: `field_${steps.length + 1}`,
        required: true,
      },
    ]
    onChange(nextSteps)
  }

  function removeStep(index: number) {
    if (steps.length <= 1) return
    const nextQuestions = draftQuestions.filter((_, i) => i !== index)
    setDraftQuestions(nextQuestions)
    onChange(steps.filter((_, i) => i !== index))
  }

  function applyPaste() {
    const parsed = stepsFromQuestionLines(pasteText)
    if (parsed.length === 0) return
    const sliced = parsed.slice(0, 12)
    setDraftQuestions(questionsFromSteps(sliced))
    onChange(sliced)
    setPasteText("")
    setPasteOpen(false)
  }

  function loadPreset(presetId: string) {
    const preset = ONBOARDING_FLOW_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const next = preset.steps.map((s) => ({ ...s }))
    setDraftQuestions(questionsFromSteps(next))
    onChange(next)
    if (preset.welcome_message) onWelcomeMessageChange(preset.welcome_message)
  }

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <span style={{ ...setupLabel, marginBottom: 0 }}>Questions</span>
        <button
          type="button"
          style={{
            ...setupBtn(mode === "simple"),
            fontSize: "0.62rem",
          }}
          onClick={() => setMode("simple")}
        >
          Simple
        </button>
        <button
          type="button"
          style={{
            ...setupBtn(mode === "advanced"),
            fontSize: "0.62rem",
          }}
          onClick={() => setMode("advanced")}
        >
          Advanced
        </button>
      </div>

      <p style={{ fontSize: "0.72rem", opacity: 0.35, marginBottom: "0.85rem", lineHeight: 1.45 }}>
        {mode === "simple" ? (
          <>
            Type freely — changes sync when you pause typing or leave a field. IDs update when
            you finish editing a question. Tone lives on the{" "}
            <strong style={{ fontWeight: 400, opacity: 0.7 }}>persona</strong> above.
            Recommend 5–7 steps for onboarding (max 12).
          </>
        ) : (
          <>
            Full control over step id, title, question, and profile key (for integrations).
            Recommend 5–7 steps (max 12).
          </>
        )}
      </p>

      <div style={{ marginBottom: "1rem" }}>
        <label style={setupLabel}>Welcome message (shown before first question)</label>
        <textarea
          value={welcomeMessage}
          onChange={(e) => onWelcomeMessageChange(e.target.value)}
          rows={2}
          placeholder="Thanks for being here. A few short questions will help us understand how you want to participate."
          style={{
            ...setupInput,
            maxWidth: "100%",
            minHeight: "2.5rem",
            resize: "vertical",
            border: "1px solid rgba(255,255,255,0.1)",
            padding: "0.45rem 0",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "1rem",
        }}
      >
        {ONBOARDING_FLOW_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.description}
            style={{ ...setupBtn(false), fontSize: "0.62rem" }}
            onClick={() => loadPreset(p.id)}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          style={{ ...setupBtn(false), fontSize: "0.62rem" }}
          onClick={() => setPasteOpen((o) => !o)}
        >
          {pasteOpen ? "Hide paste" : "Paste multiple"}
        </button>
      </div>

      {pasteOpen && (
        <div style={{ marginBottom: "1rem" }}>
          <label style={setupLabel}>One question per line</label>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            placeholder={"What draws you to join?\nWhat do you want to contribute?\n…"}
            style={{
              ...setupInput,
              maxWidth: "100%",
              minHeight: "6rem",
              resize: "vertical",
              border: "1px solid rgba(255,255,255,0.12)",
              padding: "0.5rem",
            }}
          />
          <button
            type="button"
            style={{ ...setupBtn(true), marginTop: "0.5rem" }}
            onClick={applyPaste}
          >
            Add questions from paste
          </button>
        </div>
      )}

      {mode === "simple" ? (
        <div>
          {draftQuestions.map((q, index) => (
            <div key={`question-${index}`} style={{ marginBottom: "0.85rem" }}>
              <label style={setupLabel}>
                Question {index + 1}
                {steps[index] ? (
                  <span style={{ opacity: 0.35, marginLeft: "0.5rem" }}>
                    id: {steps[index].id}
                  </span>
                ) : null}
              </label>
              <textarea
                value={q}
                onChange={(e) => setSimpleQuestion(index, e.target.value)}
                onBlur={handleSimpleBlur}
                rows={2}
                style={{
                  ...setupInput,
                  maxWidth: "100%",
                  minHeight: "2.5rem",
                  resize: "vertical",
                  border: "1px solid rgba(255,255,255,0.1)",
                  padding: "0.45rem 0",
                }}
              />
              {draftQuestions.length > 1 && (
                <button
                  type="button"
                  style={{ ...setupBtn(false), fontSize: "0.62rem", marginTop: "0.35rem" }}
                  onClick={() => removeStep(index)}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            style={setupBtn(false)}
            disabled={steps.length >= 12}
            onClick={addSimpleQuestion}
          >
            Add question
          </button>
        </div>
      ) : (
        <div>
          {steps.map((flowStep, index) => (
            <div
              key={`step-${index}`}
              style={{
                marginBottom: "1rem",
                paddingBottom: "1rem",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ marginBottom: "0.5rem" }}>
                <label style={setupLabel}>Step id</label>
                <input
                  style={setupInput}
                  value={flowStep.id}
                  onChange={(e) => updateFlowStep(index, { id: e.target.value })}
                />
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <label style={setupLabel}>Title (internal label)</label>
                <input
                  style={setupInput}
                  value={flowStep.title}
                  onChange={(e) => updateFlowStep(index, { title: e.target.value })}
                />
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <label style={setupLabel}>Question (shown to user)</label>
                <textarea
                  value={flowStep.question}
                  onChange={(e) => updateFlowStep(index, { question: e.target.value })}
                  rows={2}
                  style={{
                    ...setupInput,
                    maxWidth: "100%",
                    resize: "vertical",
                  }}
                />
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <label style={setupLabel}>Profile key</label>
                <input
                  style={setupInput}
                  value={flowStep.profile_key}
                  onChange={(e) =>
                    updateFlowStep(index, { profile_key: e.target.value })
                  }
                />
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <label style={setupLabel}>Intro (optional, before question)</label>
                <input
                  style={setupInput}
                  value={flowStep.intro ?? ""}
                  onChange={(e) => updateFlowStep(index, { intro: e.target.value })}
                />
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <label style={setupLabel}>Input hint (host UI only)</label>
                <input
                  style={setupInput}
                  value={flowStep.hint ?? ""}
                  onChange={(e) => updateFlowStep(index, { hint: e.target.value })}
                />
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <label style={setupLabel}>Follow-up prompt (optional)</label>
                <input
                  style={setupInput}
                  value={flowStep.followup_prompt ?? ""}
                  onChange={(e) =>
                    updateFlowStep(index, { followup_prompt: e.target.value })
                  }
                />
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <label style={setupLabel}>Min answer chars (follow-up trigger)</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  style={{ ...setupInput, maxWidth: "6rem" }}
                  value={flowStep.min_answer_chars ?? ""}
                  onChange={(e) => {
                    const v = e.target.value
                    updateFlowStep(index, {
                      min_answer_chars: v === "" ? undefined : Number(v),
                    })
                  }}
                />
              </div>
              {steps.length > 1 && (
                <button
                  type="button"
                  style={{ ...setupBtn(false), fontSize: "0.65rem" }}
                  onClick={() => removeStep(index)}
                >
                  Remove step
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            style={setupBtn(false)}
            disabled={steps.length >= 12}
            onClick={addSimpleQuestion}
          >
            Add step
          </button>
        </div>
      )}
    </div>
  )
}
