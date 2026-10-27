"use client"

import { defaultPersonaOption, fetchPersonaOptions, personaUpdateUrl, type PersonaOption } from "@/lib/persona-options"
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
  DEFAULT_APPLICATION_CLOSING_MESSAGE,
  DEFAULT_APPLICATION_OPENING_MESSAGE,
  DEFAULT_ONBOARDING_EXPERIENCE,
  defaultOnboardingSteps,
  type OnboardingFlowStep,
  type ProjectType,
} from "@/lib/project-settings"
import { OnboardingExperienceToggles } from "@/components/admin/OnboardingExperienceToggles"
import { OnboardingFlowEditor } from "@/components/admin/OnboardingFlowEditor"
import { PersonaSetupNote } from "@/components/admin/PersonaSetupNote"
import { ApplicationExperienceFields } from "@/components/admin/ApplicationExperienceFields"
import { DecisionPolicyFields } from "@/components/admin/DecisionPolicyFields"
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

type Persona = PersonaOption

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
    applicationClosingMessage: DEFAULT_APPLICATION_CLOSING_MESSAGE,
    applicationOpeningInputType: "",
    applicationOpeningOptions: "",
    applicationRequiredSignals: "",
    applicationPreferredInputTypes: [],
    applicationMaxTurns: "",
    flowSteps: [],
    welcomeMessage: "",
    onboardingExperience: { ...DEFAULT_ONBOARDING_EXPERIENCE },
    webhookUrl: "",
    webhookEvents: [],
    automaticAcceptanceEnabled: false,
    automaticDeclineEnabled: false,
    acceptanceThreshold: 0.8,
    reviewThreshold: 0.55,
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
        fetchPersonaOptions(orgId),
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

      {
        const active = personaRes.filter((p) => p.is_active)
        setPersonas(active.length ? active : personaRes)
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
    const def = defaultPersonaOption(personas)
    if (def) patchForm({ personaId: def.id })
  }, [hydrated, personas, form.personaId, patchForm])

  const step1Valid = useMemo(() => {
    const n = form.name.trim()
    return n.length >= 2 && n.length <= 64 && isValidProjectSlug(form.slug)
  }, [form.name, form.slug])

  const step2Valid = useMemo(() => {
    if (!form.personaId) return false
    if (form.reviewThreshold >= form.acceptanceThreshold) return false
    if (form.projectType === "gatekeeper") return true
    return form.flowSteps.every(
      (s) =>
        s.id.trim() &&
        s.title.trim() &&
        s.question.trim() &&
        s.profile_key.trim(),
    )
  }, [
    form.personaId,
    form.projectType,
    form.flowSteps,
    form.reviewThreshold,
    form.acceptanceThreshold,
  ])


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
      <div style={{ padding: "2rem", opacity: 0.45 }}>
        Loading project…
      </div>
    )
  }

  if (loadError && !hydrated) {
    return (
      <div style={{ padding: "2rem" }}>
        <AdminFormAlert
          alert={{ type: "error", message: loadError }}
          onDismiss={() => setLoadError(null)}
        />
        <Link href={`/admin/organisations/${orgId}/projects`} style={{ color: "rgba(255,255,255,0.5)" }}>
          Back to organisation
        </Link>
      </div>
    )
  }

  if (form.projectType === "ticket_access") return <div style={{ padding: "2rem" }}><h1>{form.name}</h1><p>Ticket access projects use the isolated synthetic workspace.</p><Link href={`/admin/ticket-access?project=${projectId}&org=${orgId}`}>Open ticket workspace</Link></div>

  return (
    <div
      ref={formTopRef}
      style={{ padding: "2rem", maxWidth: "40rem" }}
    >
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "0.7rem" }}>
        <Link href="/admin" style={{ opacity: 0.35, color: "#fff", textDecoration: "none" }}>
          Overview
        </Link>
        <span style={{ opacity: 0.2 }}>/</span>
        <Link
          href={`/admin/organisations/${orgId}/projects`}
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
      <p style={{ fontSize: "0.72rem", marginBottom: "1.25rem" }}>
        <Link href={`/admin/organisations/${orgId}/projects/${projectId}/cultural-signals`}>
          View cultural signals →
        </Link>
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
            {personas.some((p) => p.kind === "own") && (
              <optgroup label={`${orgName || "Organisation"} personas`}>
                {personas.filter((p) => p.kind === "own").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.updateAvailable ? " (update available)" : ""}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Groucho personas, used as is">
              {personas.filter((p) => p.kind === "groucho").map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        <PersonaSetupNote
          projectType={form.projectType}
          personaId={form.personaId}
          personas={personas}
          orgId={orgId}
        />

        {form.projectType === "gatekeeper" && (
          <ApplicationExperienceFields
            openingMessage={form.applicationOpeningMessage}
            closingMessage={form.applicationClosingMessage}
            openingInputType={form.applicationOpeningInputType}
            openingOptions={form.applicationOpeningOptions}
            requiredSignals={form.applicationRequiredSignals}
            preferredInputTypes={form.applicationPreferredInputTypes}
            maxTurns={form.applicationMaxTurns}
            onChange={(patch) => {
              if (patch.openingMessage !== undefined) {
                patchForm({ applicationOpeningMessage: patch.openingMessage })
              }
              if (patch.closingMessage !== undefined) {
                patchForm({ applicationClosingMessage: patch.closingMessage })
              }
              if (patch.openingInputType !== undefined) {
                patchForm({ applicationOpeningInputType: patch.openingInputType })
              }
              if (patch.openingOptions !== undefined) {
                patchForm({ applicationOpeningOptions: patch.openingOptions })
              }
              if (patch.requiredSignals !== undefined) {
                patchForm({ applicationRequiredSignals: patch.requiredSignals })
              }
              if (patch.preferredInputTypes !== undefined) {
                patchForm({
                  applicationPreferredInputTypes: patch.preferredInputTypes,
                })
              }
              if (patch.maxTurns !== undefined) {
                patchForm({ applicationMaxTurns: patch.maxTurns })
              }
            }}
          />
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
                  const option = personas.find((p) => p.id === form.personaId)
                  const detailRes = option
                    ? await fetch(`/api/admin/organisations/${orgId}/personas/${option.id}`, {
                        credentials: "same-origin",
                      })
                    : null
                  const detail = detailRes?.ok
                    ? ((await detailRes.json()) as { persona?: Record<string, unknown> })
                    : null
                  const persona = detail?.persona
                  if (!option || !persona) {
                    showError("Persona not found")
                    return
                  }
                  const putRes = await fetch(personaUpdateUrl(option, orgId), {
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

        {form.projectType === "gatekeeper" && (
          <div style={{ marginTop: "2rem" }}>
            <h3 style={{ ...setupLabel, fontSize: "0.75rem", opacity: 0.7 }}>
              CLIENT DECISION POLICY
            </h3>
            <DecisionPolicyFields
              value={{
                automaticAcceptanceEnabled: form.automaticAcceptanceEnabled,
                automaticDeclineEnabled: form.automaticDeclineEnabled,
                acceptanceThreshold: form.acceptanceThreshold,
                reviewThreshold: form.reviewThreshold,
              }}
              onChange={(decisionPolicy) => patchForm(decisionPolicy)}
            />
          </div>
        )}
      </section>

      <section>
        <h2 style={sectionHeading}>Webhooks and API keys</h2>
        <p style={{ fontSize: "0.85rem", opacity: 0.6, margin: "0 0 1.5rem" }}>
          Manage them on the project&apos;s{" "}
          <Link href={`/admin/organisations/${orgId}/projects/${projectId}`} style={{ color: "inherit" }}>
            Keys &amp; webhooks
          </Link>{" "}
          page.
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
