"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AdminFormAlert,
  useAdminFeedback,
} from "@/components/admin/AdminFeedback"
import {
  validateWizardStep1,
  validateWizardStep2,
} from "@/lib/admin-project-wizard-validation"
import {
  PROJECT_USE_CASES,
  buildProjectSettingsPayload,
  formStateFromProject,
  type ProjectSetupFormState,
  type ProjectUseCaseId,
} from "@/lib/admin-project-setup"
import {
  DEFAULT_APPLICATION_OPENING_MESSAGE,
  DEFAULT_ONBOARDING_EXPERIENCE,
  defaultOnboardingSteps,
  type OnboardingFlowStep,
  type ProjectType,
} from "@/lib/project-settings"
import { OnboardingExperienceToggles } from "@/components/admin/OnboardingExperienceToggles"
import { OnboardingFlowEditor } from "@/components/admin/OnboardingFlowEditor"
import { PersonaSetupNote } from "@/components/admin/PersonaSetupNote"
import {
  COLORS_PROFILE_EXTRACTOR_HINT,
  COLORS_PROFILE_SCHEMA,
} from "@/lib/onboarding-persona-template"
import {
  isValidProjectSlug,
  setupBtn,
  setupInput,
  setupLabel,
  slugify,
} from "@/components/admin/project-setup-ui"

type Persona = {
  id: string
  name: string
  slug: string
  is_active: boolean
  is_default: boolean
}

type ProjectRow = {
  id: string
  name: string
  slug: string
  settings?: Record<string, unknown>
}

const sectionHeading: React.CSSProperties = {
  ...setupLabel,
  fontSize: "0.8rem",
  opacity: 0.55,
  marginBottom: "1rem",
  marginTop: "2rem",
  paddingTop: "1.5rem",
  borderTop: "1px solid rgba(255,255,255,0.08)",
}

export default function EditProjectPage() {
  const params = useParams()
  const router = useRouter()
  const orgId = params.orgId as string
  const projectId = params.projectId as string

  const [orgName, setOrgName] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [saving, setSaving] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const { alert, showError, showSuccess, showInfo, clearAlert } = useAdminFeedback()
  const formTopRef = useRef<HTMLDivElement>(null)
  const [slugManual, setSlugManual] = useState(true)
  const [existingSettings, setExistingSettings] = useState<Record<string, unknown>>({})
  const [advOpen, setAdvOpen] = useState(false)
  const [flowEditorKey, setFlowEditorKey] = useState("")
  const flowFlushRef = useRef<(() => OnboardingFlowStep[]) | null>(null)

  const [form, setForm] = useState<ProjectSetupFormState>({
    name: "",
    slug: "",
    useCase: "community_gate",
    projectType: "gatekeeper",
    environment: "test",
    sessionMode: "live",
    personaId: "",
    applicationOpeningMessage: DEFAULT_APPLICATION_OPENING_MESSAGE,
    flowSteps: [],
    welcomeMessage: "",
    onboardingExperience: { ...DEFAULT_ONBOARDING_EXPERIENCE },
    webhookUrl: "",
    webhookEvents: [],
    passThreshold: 0.65,
    rejectThreshold: 0.25,
  })
  const [applyingTemplate, setApplyingTemplate] = useState(false)

  const patchForm = useCallback((patch: Partial<ProjectSetupFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])

  const handleFlowStepsChange = useCallback((flowSteps: ProjectSetupFormState["flowSteps"]) => {
    setForm((prev) => ({ ...prev, flowSteps }))
  }, [])

  const registerFlowFlush = useCallback(
    (flush: () => ProjectSetupFormState["flowSteps"]) => {
      flowFlushRef.current = flush
    },
    [],
  )

  useEffect(() => {
    if (!slugManual) patchForm({ slug: slugify(form.name) })
  }, [form.name, slugManual, patchForm])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)
      clearAlert()

      const [orgRes, personaRes, projectRes] = await Promise.all([
        fetch(`/api/admin/organisations/${orgId}`, { credentials: "same-origin" }),
        fetch("/api/admin/personas", { credentials: "same-origin" }),
        fetch(
          `/api/admin/organisations/${orgId}/projects/${projectId}`,
          { credentials: "same-origin" },
        ),
      ])

      if (cancelled) return

      if (orgRes.ok) {
        const o = await orgRes.json()
        setOrgName(o.name ?? "")
      }

      if (personaRes.ok) {
        const raw: unknown = await personaRes.json()
        const list = Array.isArray(raw) ? (raw as Persona[]) : []
        const active = list.filter((p) => p.is_active)
        setPersonas(active.length ? active : list)
      }

      const body = await projectRes.json().catch(() => ({}))
      if (!projectRes.ok) {
        const msg = body.error ?? "Could not load project"
        setLoadError(msg)
        showError(msg)
        setLoading(false)
        setHydrated(false)
        return
      }

      const row = body as ProjectRow
      const settings =
        row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
          ? row.settings
          : {}

      const nextForm = formStateFromProject(row)
      setExistingSettings(settings)
      setForm(nextForm)
      setSlugManual(true)
      setFlowEditorKey(
        `${row.id}-${nextForm.flowSteps.map((s) => s.id).join(",")}`,
      )
      setHydrated(true)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
    // Load once per org/project — do not depend on toast/alert callbacks (they reset the form).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, projectId])

  useEffect(() => {
    if (!hydrated || !personas.length || form.personaId) return
    const def =
      personas.find((p) => p.is_default && p.is_active) ??
      personas.find((p) => p.is_default) ??
      personas[0]
    if (def) patchForm({ personaId: def.id })
  }, [hydrated, personas, form.personaId, patchForm])

  const step1Valid = useMemo(() => {
    const n = form.name.trim()
    return n.length >= 2 && n.length <= 64 && isValidProjectSlug(form.slug)
  }, [form.name, form.slug])

  const step2Valid = useMemo(() => {
    if (!form.personaId) return false
    if (form.projectType === "gatekeeper") return true
    return form.flowSteps.every(
      (s) =>
        s.id.trim() &&
        s.title.trim() &&
        s.question.trim() &&
        s.profile_key.trim(),
    )
  }, [form.personaId, form.projectType, form.flowSteps])

  const eventToggle = (id: string) => {
    patchForm({
      webhookEvents: form.webhookEvents.includes(id)
        ? form.webhookEvents.filter((x) => x !== id)
        : [...form.webhookEvents, id],
    })
  }

  async function save() {
    const flushedSteps = flowFlushRef.current?.()
    const formForSave: ProjectSetupFormState = flushedSteps
      ? { ...form, flowSteps: flushedSteps }
      : form

    const problem1 = validateWizardStep1(formForSave.name, formForSave.slug)
    if (problem1) {
      showError(problem1)
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      return
    }
    const problem2 = validateWizardStep2(formForSave)
    if (problem2) {
      showError(problem2)
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      return
    }

    if (formForSave.webhookUrl.trim()) {
      try {
        const u = new URL(formForSave.webhookUrl.trim())
        if (u.protocol !== "https:") {
          showError("Webhook URL must use https://")
          return
        }
      } catch {
        showError("Invalid webhook URL.")
        return
      }
    }

    setSaving(true)
    clearAlert()
    showInfo("Saving project…")

    const settings = buildProjectSettingsPayload(existingSettings, formForSave)
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${projectId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name: formForSave.name.trim(),
          slug: formForSave.slug,
          settings,
        }),
      },
    )
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      showError(body.error ?? "Could not save project")
      return
    }
    setExistingSettings(
      body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
        ? (body.settings as Record<string, unknown>)
        : settings,
    )
    const savedForm = formStateFromProject({
      name: formForSave.name,
      slug: formForSave.slug,
      settings: body.settings ?? settings,
    })
    setForm(savedForm)
    setFlowEditorKey(
      `${projectId}-${savedForm.flowSteps.map((s) => s.id).join(",")}`,
    )
    showSuccess("Project saved. Returning to organisation…")
    window.setTimeout(() => {
      router.push(`/admin/organisations/${orgId}?project=${projectId}`)
    }, 1200)
  }

  if (loading) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", opacity: 0.45 }}>
        Loading project…
      </div>
    )
  }

  if (loadError && !hydrated) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <AdminFormAlert
          alert={{ type: "error", message: loadError }}
          onDismiss={() => setLoadError(null)}
        />
        <Link href={`/admin/organisations/${orgId}`} style={{ color: "rgba(255,255,255,0.5)" }}>
          Back to organisation
        </Link>
      </div>
    )
  }

  return (
    <div
      ref={formTopRef}
      style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "40rem" }}
    >
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "0.7rem" }}>
        <Link href="/admin" style={{ opacity: 0.35, color: "#fff", textDecoration: "none" }}>
          Overview
        </Link>
        <span style={{ opacity: 0.2 }}>/</span>
        <Link
          href={`/admin/organisations/${orgId}`}
          style={{ opacity: 0.35, color: "#fff", textDecoration: "none" }}
        >
          {orgName || "organisation"}
        </Link>
        <span style={{ opacity: 0.2 }}>/</span>
        <span style={{ opacity: 0.45 }}>Edit {form.name || "project"}</span>
      </div>

      <h1
        style={{
          fontSize: "0.75rem",
          letterSpacing: "0.14em",
          fontWeight: 400,
          opacity: 0.45,
          margin: "1.5rem 0 0.25rem",
        }}
      >
        EDIT PROJECT
      </h1>
      <p style={{ fontSize: "0.72rem", opacity: 0.3, marginBottom: "1.25rem" }}>
        All settings on one page · changes apply to new sessions
        {form.projectType === "onboarding" && form.flowSteps.length > 0
          ? ` · ${form.flowSteps.length} onboarding question${form.flowSteps.length === 1 ? "" : "s"}`
          : ""}
      </p>

      <AdminFormAlert alert={alert} onDismiss={clearAlert} />

      <section>
        <h2 style={{ ...sectionHeading, marginTop: 0, paddingTop: 0, borderTop: "none" }}>
          Basics
        </h2>
        <div style={{ marginBottom: "1rem" }}>
          <label style={setupLabel}>Display name (2–64 characters)</label>
          <input
            style={setupInput}
            value={form.name}
            onChange={(e) => patchForm({ name: e.target.value })}
          />
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label style={setupLabel}>URL slug</label>
          <input
            style={setupInput}
            value={form.slug}
            onChange={(e) => {
              setSlugManual(true)
              patchForm({ slug: e.target.value })
            }}
          />
          {!isValidProjectSlug(form.slug) && form.slug.length > 0 && (
            <p style={{ fontSize: "0.7rem", opacity: 0.35, marginTop: "0.35rem" }}>
              Use letters, numbers, hyphens; start with a letter or digit.
            </p>
          )}
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label style={setupLabel}>Primary use case</label>
          <select
            value={form.useCase}
            onChange={(e) =>
              patchForm({ useCase: e.target.value as ProjectUseCaseId })
            }
            style={{
              ...setupInput,
              border: "1px solid rgba(255,255,255,0.15)",
              padding: "0.35rem 0.5rem",
            }}
          >
            {PROJECT_USE_CASES.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: "0.5rem" }}>
          <label style={setupLabel}>Conversation type</label>
          <div style={{ display: "flex", gap: "1.25rem", fontSize: "0.82rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <input
                type="radio"
                checked={form.projectType === "gatekeeper"}
                onChange={() => patchForm({ projectType: "gatekeeper" as ProjectType })}
              />
              Gatekeeper
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <input
                type="radio"
                checked={form.projectType === "onboarding"}
                onChange={() =>
                  patchForm({
                    projectType: "onboarding",
                    flowSteps:
                      form.flowSteps.length > 0
                        ? form.flowSteps
                        : defaultOnboardingSteps(),
                  })
                }
              />
              Onboarding
            </label>
          </div>
        </div>
      </section>

      <section>
        <h2 style={sectionHeading}>
          {form.projectType === "onboarding" ? "Onboarding flow" : "Behaviour & persona"}
        </h2>
        <div style={{ marginBottom: "1rem" }}>
          <label style={setupLabel}>Environment</label>
          <div style={{ display: "flex", gap: "1.25rem", fontSize: "0.82rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <input
                type="radio"
                checked={form.environment === "test"}
                onChange={() => patchForm({ environment: "test" })}
              />
              test
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <input
                type="radio"
                checked={form.environment === "live"}
                onChange={() => patchForm({ environment: "live" })}
              />
              live
            </label>
          </div>
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label style={setupLabel}>Default session mode</label>
          <div style={{ display: "flex", gap: "1.25rem", fontSize: "0.82rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <input
                type="radio"
                checked={form.sessionMode === "dry-run"}
                onChange={() => patchForm({ sessionMode: "dry-run" })}
              />
              dry-run
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <input
                type="radio"
                checked={form.sessionMode === "live"}
                onChange={() => patchForm({ sessionMode: "live" })}
              />
              live
            </label>
          </div>
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label style={setupLabel}>Persona</label>
          <select
            value={form.personaId}
            onChange={(e) => patchForm({ personaId: e.target.value })}
            style={{
              ...setupInput,
              border: "1px solid rgba(255,255,255,0.15)",
              padding: "0.35rem 0.5rem",
            }}
          >
            {!form.personaId && (
              <option value="">Select persona…</option>
            )}
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.slug})
              </option>
            ))}
          </select>
        </div>

        <PersonaSetupNote
          projectType={form.projectType}
          personaId={form.personaId}
          personas={personas}
        />

        {form.projectType === "gatekeeper" && (
          <div style={{ marginBottom: "1rem" }}>
            <label style={setupLabel}>Opening message</label>
            <textarea
              value={form.applicationOpeningMessage}
              onChange={(e) =>
                patchForm({ applicationOpeningMessage: e.target.value })
              }
              rows={3}
              placeholder={DEFAULT_APPLICATION_OPENING_MESSAGE}
              style={{
                ...setupInput,
                maxWidth: "100%",
                minHeight: "4rem",
                resize: "vertical",
                border: "1px solid rgba(255,255,255,0.1)",
                padding: "0.45rem 0",
              }}
            />
            <p style={{ fontSize: "0.72rem", opacity: 0.35, lineHeight: 1.45 }}>
              Shown as the first assistant message before the applicant replies.
              Tone and decision logic still live in the persona.
            </p>
          </div>
        )}

        {form.projectType === "onboarding" && hydrated && (
          <>
            <OnboardingExperienceToggles
              value={form.onboardingExperience}
              onChange={(onboardingExperience) => patchForm({ onboardingExperience })}
            />
            <button
              type="button"
              disabled={!form.personaId || applyingTemplate}
              style={{
                ...setupBtn(false),
                fontSize: "0.65rem",
                marginBottom: "1rem",
                opacity: !form.personaId ? 0.4 : 1,
              }}
              onClick={async () => {
                if (!form.personaId) return
                setApplyingTemplate(true)
                try {
                  const listRes = await fetch("/api/admin/personas", {
                    credentials: "same-origin",
                  })
                  const list = (await listRes.json()) as Array<{
                    id: string
                    name: string
                    slug: string
                    prompt: string
                    is_active: boolean
                    is_default: boolean
                    pass_threshold: number
                    reject_threshold: number
                    profile_schema?: unknown
                    profile_extractor_hint?: string | null
                  }>
                  const persona = list.find((p) => p.id === form.personaId)
                  if (!persona) {
                    showError("Persona not found")
                    return
                  }
                  const putRes = await fetch(`/api/admin/personas/${persona.id}`, {
                    method: "PUT",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      ...persona,
                      profile_schema: COLORS_PROFILE_SCHEMA,
                      profile_extractor_hint: COLORS_PROFILE_EXTRACTOR_HINT,
                    }),
                  })
                  if (!putRes.ok) {
                    const err = await putRes.json().catch(() => ({}))
                    showError(
                      typeof err.error === "string"
                        ? err.error
                        : "Failed to apply COLORS template",
                    )
                    return
                  }
                  showSuccess("COLORS profile schema and extractor hint applied to persona")
                } catch {
                  showError("Failed to apply COLORS template")
                } finally {
                  setApplyingTemplate(false)
                }
              }}
            >
              {applyingTemplate ? "Applying…" : "Apply COLORS persona template"}
            </button>
            <OnboardingFlowEditor
              editorKey={flowEditorKey}
              steps={form.flowSteps}
              welcomeMessage={form.welcomeMessage}
              onWelcomeMessageChange={(welcomeMessage) => patchForm({ welcomeMessage })}
              onChange={handleFlowStepsChange}
              registerFlush={registerFlowFlush}
            />
          </>
        )}

        <div style={{ marginTop: "1rem" }}>
          <button
            type="button"
            onClick={() => setAdvOpen((o) => !o)}
            style={{ ...setupBtn(false), fontSize: "0.65rem", opacity: 0.5 }}
          >
            {advOpen ? "▼" : "▶"} Advanced thresholds
          </button>
          {advOpen && (
            <div style={{ marginTop: "1rem", opacity: 0.85 }}>
              <label style={setupLabel}>Pass threshold (0–1)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={form.passThreshold}
                onChange={(e) =>
                  patchForm({ passThreshold: Number(e.target.value) })
                }
                style={{ ...setupInput, maxWidth: "8rem" }}
              />
              <label style={{ ...setupLabel, marginTop: "0.75rem" }}>
                Reject threshold (0–1)
              </label>
              <input
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={form.rejectThreshold}
                onChange={(e) =>
                  patchForm({ rejectThreshold: Number(e.target.value) })
                }
                style={{ ...setupInput, maxWidth: "8rem" }}
              />
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 style={sectionHeading}>Webhooks</h2>
        <div style={{ marginBottom: "1rem" }}>
          <label style={setupLabel}>Webhook URL (https only, optional)</label>
          <input
            style={setupInput}
            value={form.webhookUrl}
            onChange={(e) => patchForm({ webhookUrl: e.target.value })}
            placeholder="https://…"
          />
        </div>
        <div style={{ marginBottom: "1.5rem" }}>
          <label style={setupLabel}>Events</label>
          {(["session.completed", "verdict.created"] as const).map((id) => (
            <label
              key={id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                fontSize: "0.78rem",
                opacity: 0.55,
                marginBottom: "0.35rem",
              }}
            >
              <input
                type="checkbox"
                checked={form.webhookEvents.includes(id)}
                onChange={() => eventToggle(id)}
              />
              {id}
            </label>
          ))}
        </div>
        <p style={{ fontSize: "0.75rem", opacity: 0.4, marginBottom: "1.25rem" }}>
          API keys and session history are managed on the organisation page.
        </p>
      </section>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          style={{
            ...setupBtn(true),
            opacity: step1Valid && step2Valid ? 1 : 0.55,
          }}
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save project"}
        </button>
        <Link
          href={`/admin/organisations/${orgId}?project=${projectId}`}
          style={{ ...setupBtn(false), display: "inline-block", textDecoration: "none" }}
        >
          Cancel
        </Link>
      </div>
    </div>
  )
}
