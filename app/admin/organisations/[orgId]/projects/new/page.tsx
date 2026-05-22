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
  buildProjectSettingsPayload,
  type ProjectSetupFormState,
} from "@/lib/admin-project-setup"
import {
  DEFAULT_APPLICATION_OPENING_MESSAGE,
  defaultOnboardingSteps,
  DEFAULT_ONBOARDING_EXPERIENCE,
  type OnboardingFlowStep,
} from "@/lib/project-settings"
import { OnboardingExperienceToggles } from "@/components/admin/OnboardingExperienceToggles"
import { OnboardingFlowEditor } from "@/components/admin/OnboardingFlowEditor"
import { PersonaSetupNote } from "@/components/admin/PersonaSetupNote"

type Persona = {
  id: string
  name: string
  slug: string
  is_active: boolean
  is_default: boolean
}

const USE_CASES = [
  { id: "community_gate", label: "Community gate" },
  { id: "b2b_trial", label: "B2B trial" },
  { id: "event_access", label: "Event access" },
  { id: "other", label: "Other" },
] as const

type UseCaseId = (typeof USE_CASES)[number]["id"]
type ProjectType = "gatekeeper" | "onboarding"

function slugify(str: string) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Wizard slug: `^[a-z0-9][a-z0-9-]{1,30}$` (2–31 chars). */
function isValidProjectSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,30}$/.test(s)
}

const label: React.CSSProperties = {
  display: "block",
  fontSize: "0.65rem",
  letterSpacing: "0.1em",
  opacity: 0.4,
  marginBottom: "0.35rem",
}

const input: React.CSSProperties = {
  width: "100%",
  maxWidth: "26rem",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid rgba(255,255,255,0.15)",
  color: "#fff",
  outline: "none",
  padding: "0.45rem 0",
  fontFamily: "inherit",
  fontSize: "0.85rem",
  boxSizing: "border-box",
}

function btn(primary: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: primary
      ? "1px solid rgba(255,255,255,0.45)"
      : "1px solid rgba(255,255,255,0.15)",
    color: primary ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)",
    padding: "0.4rem 0.85rem",
    cursor: "pointer",
    fontSize: "0.72rem",
    letterSpacing: "0.06em",
    fontFamily: "inherit",
  }
}

export default function NewProjectWizardPage() {
  const params = useParams()
  const router = useRouter()
  const orgId = params.orgId as string

  const [orgName, setOrgName] = useState("")
  const [step, setStep] = useState(1)
  const [personas, setPersonas] = useState<Persona[]>([])
  const { alert, showError, showSuccess, showInfo, clearAlert } = useAdminFeedback()
  const formTopRef = useRef<HTMLDivElement>(null)
  const flowFlushRef = useRef<(() => OnboardingFlowStep[]) | null>(null)

  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugManual, setSlugManual] = useState(false)
  const [useCase, setUseCase] = useState<UseCaseId>("community_gate")
  const [projectType, setProjectType] = useState<ProjectType>("gatekeeper")
  const [flowSteps, setFlowSteps] = useState<OnboardingFlowStep[]>(() =>
    defaultOnboardingSteps(),
  )
  const [welcomeMessage, setWelcomeMessage] = useState("")
  const [onboardingExperience, setOnboardingExperience] = useState({
    ...DEFAULT_ONBOARDING_EXPERIENCE,
  })

  const [environment, setEnvironment] = useState<"test" | "live">("test")
  const [sessionMode, setSessionMode] = useState<"live" | "dry-run">("dry-run")
  const [personaId, setPersonaId] = useState("")
  const [applicationOpeningMessage, setApplicationOpeningMessage] = useState(
    DEFAULT_APPLICATION_OPENING_MESSAGE,
  )

  const [webhookUrl, setWebhookUrl] = useState("")
  const [webhookEvents, setWebhookEvents] = useState<string[]>([])
  const [advOpen, setAdvOpen] = useState(false)
  const [passThreshold, setPassThreshold] = useState(0.65)
  const [rejectThreshold, setRejectThreshold] = useState(0.25)

  const [ackTraffic, setAckTraffic] = useState(false)
  const [ackPermission, setAckPermission] = useState(false)

  const [creating, setCreating] = useState(false)
  const [keySecret, setKeySecret] = useState<string | null>(null)
  const [keyAck, setKeyAck] = useState(false)
  /** Set after project row exists; prevents duplicate POST if key issuance fails. */
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null)

  useEffect(() => {
    if (!slugManual) setSlug(slugify(name))
  }, [name, slugManual])

  const loadMeta = useCallback(async () => {
    const res = await fetch(`/api/admin/organisations/${orgId}`)
    if (res.ok) {
      const o = await res.json()
      setOrgName(o.name ?? "")
    }
  }, [orgId])

  const loadPersonas = useCallback(async () => {
    const res = await fetch("/api/admin/personas")
    if (res.ok) {
      const raw: unknown = await res.json()
      const list = Array.isArray(raw) ? (raw as Persona[]) : []
      const active = list.filter((p) => p.is_active)
      setPersonas(active.length ? active : list)
      const def =
        list.find((p) => p.is_default && p.is_active) ??
        list.find((p) => p.is_default) ??
        list[0]
      if (def) setPersonaId(def.id)
    }
  }, [])

  useEffect(() => {
    void loadMeta()
    void loadPersonas()
  }, [loadMeta, loadPersonas])

  const step1Valid = useMemo(() => {
    const n = name.trim()
    return n.length >= 2 && n.length <= 64 && isValidProjectSlug(slug)
  }, [name, slug])

  const step2Valid = useMemo(() => {
    if (!personaId) return false
    if (projectType === "gatekeeper") return true
    return flowSteps.every(
      (s) =>
        s.id.trim() &&
        s.title.trim() &&
        s.question.trim() &&
        s.profile_key.trim(),
    )
  }, [personaId, projectType, flowSteps])

  const eventToggle = (id: string) => {
    setWebhookEvents((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const stepTitles: Record<number, string> = {
    1: "What are you protecting?",
    2: "Configuration",
    3: "Webhooks",
    4: "Review and create",
  }

  function scrollToFormTop() {
    formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  function tryNext(fromStep: number) {
    if (fromStep === 1) {
      const problem = validateWizardStep1(name, slug)
      if (problem) {
        showError(problem)
        return
      }
      clearAlert()
      setStep(2)
      showSuccess(`Step 2 — ${projectType === "onboarding" ? "Onboarding flow" : "Behaviour"}`)
      scrollToFormTop()
      return
    }
    if (fromStep === 2) {
      const problem = validateWizardStep2({
        name,
        slug,
        useCase,
        projectType,
        environment,
        sessionMode,
        personaId,
      applicationOpeningMessage,
        flowSteps,
        welcomeMessage,
        onboardingExperience,
        webhookUrl,
        webhookEvents,
        passThreshold,
        rejectThreshold,
      })
      if (problem) {
        showError(problem)
        return
      }
      clearAlert()
      setStep(3)
      showSuccess(`Step 3 — ${stepTitles[3]}`)
      scrollToFormTop()
      return
    }
    if (fromStep === 3) {
      clearAlert()
      setStep(4)
      showSuccess(`Step 4 — ${stepTitles[4]}`)
      scrollToFormTop()
    }
  }

  function back() {
    clearAlert()
    setStep((s) => {
      const next = Math.max(1, s - 1)
      if (next !== s) {
        showInfo(`Step ${next}`)
        scrollToFormTop()
      }
      return next
    })
  }

  async function issueKeyForCreatedProject() {
    if (!createdProjectId) return
    setCreating(true)
    clearAlert()
    const keyRes = await fetch(
      `/api/admin/organisations/${orgId}/projects/${createdProjectId}/api-keys`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: `Wizard · ${environment}` }),
      },
    )
    const keyBody = await keyRes.json().catch(() => ({}))
    if (!keyRes.ok || !keyBody.secret) {
      showError(keyBody.error ?? "Could not issue API key.")
      setKeySecret(null)
      setCreating(false)
      return
    }
    clearAlert()
    showSuccess("API key issued.")
    setKeySecret(keyBody.secret)
    setCreating(false)
  }

  const registerFlowFlush = useCallback((flush: () => OnboardingFlowStep[]) => {
    flowFlushRef.current = flush
  }, [])

  async function createProjectAndKey() {
    if (!ackTraffic || !ackPermission) return
    if (createdProjectId) {
      await issueKeyForCreatedProject()
      return
    }
    const stepsForSave =
      projectType === "onboarding"
        ? (flowFlushRef.current?.() ?? flowSteps)
        : flowSteps

    setCreating(true)
    clearAlert()
    showInfo("Creating project…")
    const formForSettings: ProjectSetupFormState = {
      name,
      slug,
      useCase,
      projectType,
      environment,
      sessionMode,
      personaId,
      applicationOpeningMessage,
      flowSteps: stepsForSave,
      welcomeMessage,
      onboardingExperience,
      webhookUrl,
      webhookEvents,
      passThreshold,
      rejectThreshold,
    }
    const settings = buildProjectSettingsPayload(undefined, formForSettings)
    if (webhookUrl.trim()) {
      try {
        const u = new URL(webhookUrl.trim())
        if (u.protocol !== "https:") {
          showError("Webhook URL must use https://")
          setCreating(false)
          return
        }
        settings.webhook_url = webhookUrl.trim()
        settings.webhook_events = webhookEvents
      } catch {
        showError("Invalid webhook URL.")
        setCreating(false)
        return
      }
    }

    const res = await fetch(`/api/admin/organisations/${orgId}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        slug,
        settings,
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      showError(body.error ?? "Could not create project")
      setCreating(false)
      return
    }
    showSuccess("Project created. Issuing API key…")
    setCreatedProjectId(body.id)

    const keyRes = await fetch(
      `/api/admin/organisations/${orgId}/projects/${body.id}/api-keys`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: `Wizard · ${environment}` }),
      },
    )
    const keyBody = await keyRes.json().catch(() => ({}))
    if (!keyRes.ok || !keyBody.secret) {
      showError(
        keyBody.error ??
          "Project was created but the API key could not be issued. Retry below or add a key from the organisation page.",
      )
      setKeySecret(null)
      setCreating(false)
      return
    }
    clearAlert()
    showSuccess("Project and API key ready.")
    setKeySecret(keyBody.secret)
    setCreating(false)
  }

  function finish() {
    if (!keyAck && keySecret) return
    router.push(`/admin/organisations/${orgId}`)
  }

  return (
    <div
      ref={formTopRef}
      style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "40rem" }}
    >
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "0.7rem" }}>
        <Link
          href="/admin"
          style={{ opacity: 0.35, color: "#fff", textDecoration: "none" }}
        >
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
        <span style={{ opacity: 0.45 }}>New project</span>
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
        NEW PROJECT
      </h1>
      <p style={{ fontSize: "0.72rem", opacity: 0.3, marginBottom: "2rem" }}>
        Step {step} of 4 · intentional setup (see docs/platform-project-wizard.md)
      </p>

      <AdminFormAlert alert={alert} onDismiss={clearAlert} />

      {step === 1 && (
        <section>
          <h2 style={{ ...label, fontSize: "0.8rem", opacity: 0.55, marginBottom: "1rem" }}>
            1 — What are you protecting?
          </h2>
          <div style={{ marginBottom: "1rem" }}>
            <label style={label}>Display name (2–64 characters)</label>
            <input style={input} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={label}>URL slug (used in logs; 2–31 chars, lowercase)</label>
            <input
              style={input}
              value={slug}
              onChange={(e) => {
                setSlugManual(true)
                setSlug(e.target.value)
              }}
            />
            {!isValidProjectSlug(slug) && slug.length > 0 && (
              <p style={{ fontSize: "0.7rem", opacity: 0.35, marginTop: "0.35rem" }}>
                Use letters, numbers, hyphens; start with a letter or digit.
              </p>
            )}
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={label}>Primary use case</label>
            <select
              value={useCase}
              onChange={(e) => setUseCase(e.target.value as UseCaseId)}
              style={{
                ...input,
                border: "1px solid rgba(255,255,255,0.15)",
                padding: "0.35rem 0.5rem",
              }}
            >
              {USE_CASES.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: "1.5rem" }}>
            <label style={label}>Conversation type</label>
            <div style={{ display: "flex", gap: "1.25rem", fontSize: "0.82rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <input
                  type="radio"
                  checked={projectType === "gatekeeper"}
                  onChange={() => setProjectType("gatekeeper")}
                />
                Gatekeeper (qualify)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <input
                  type="radio"
                  checked={projectType === "onboarding"}
                  onChange={() => setProjectType("onboarding")}
                />
                Onboarding (guided steps)
              </label>
            </div>
          </div>
          <button
            type="button"
            style={{ ...btn(true), opacity: step1Valid ? 1 : 0.55 }}
            onClick={() => tryNext(1)}
          >
            Continue
          </button>
        </section>
      )}

      {step === 2 && (
        <section>
          <h2 style={{ ...label, fontSize: "0.8rem", opacity: 0.55, marginBottom: "1rem" }}>
            2 — {projectType === "onboarding" ? "Onboarding flow" : "How should the door behave?"}
          </h2>
          <div style={{ marginBottom: "1rem" }}>
            <label style={label}>Environment</label>
            <div style={{ display: "flex", gap: "1.25rem", fontSize: "0.82rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <input
                  type="radio"
                  checked={environment === "test"}
                  onChange={() => setEnvironment("test")}
                />
                test
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <input
                  type="radio"
                  checked={environment === "live"}
                  onChange={() => setEnvironment("live")}
                />
                live
              </label>
            </div>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={label}>Default session mode</label>
            <div style={{ display: "flex", gap: "1.25rem", fontSize: "0.82rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <input
                  type="radio"
                  checked={sessionMode === "dry-run"}
                  onChange={() => setSessionMode("dry-run")}
                />
                dry-run
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <input
                  type="radio"
                  checked={sessionMode === "live"}
                  onChange={() => setSessionMode("live")}
                />
                live
              </label>
            </div>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={label}>Persona (tone + profile extraction)</label>
            <select
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              style={{
                ...input,
                border: "1px solid rgba(255,255,255,0.15)",
                padding: "0.35rem 0.5rem",
              }}
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.slug})
                </option>
              ))}
            </select>
          </div>

          <PersonaSetupNote
            projectType={projectType}
            personaId={personaId}
            personas={personas}
          />

          {projectType === "gatekeeper" && (
            <div style={{ marginBottom: "1rem" }}>
              <label style={label}>Opening message</label>
              <textarea
                value={applicationOpeningMessage}
                onChange={(e) => setApplicationOpeningMessage(e.target.value)}
                rows={3}
                placeholder={DEFAULT_APPLICATION_OPENING_MESSAGE}
                style={{
                  ...input,
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

          {projectType === "onboarding" && (
            <>
              <OnboardingExperienceToggles
                value={onboardingExperience}
                onChange={setOnboardingExperience}
              />
              <OnboardingFlowEditor
                steps={flowSteps}
                welcomeMessage={welcomeMessage}
                onWelcomeMessageChange={setWelcomeMessage}
                onChange={setFlowSteps}
                registerFlush={registerFlowFlush}
              />
            </>
          )}

          <button type="button" style={btn(false)} onClick={back}>
            Back
          </button>
          <button
            type="button"
            style={{ ...btn(true), marginLeft: "0.75rem", opacity: step2Valid ? 1 : 0.55 }}
            onClick={() => tryNext(2)}
          >
            Continue
          </button>

          <div style={{ marginTop: "1.75rem" }}>
            <button
              type="button"
              onClick={() => setAdvOpen((o) => !o)}
              style={{
                ...btn(false),
                fontSize: "0.65rem",
                opacity: 0.5,
              }}
            >
              {advOpen ? "▼" : "▶"} Advanced — misconfiguration can block real users
            </button>
            {advOpen && projectType === "gatekeeper" && (
              <div style={{ marginTop: "1rem", opacity: 0.85 }}>
                <label style={label}>Pass threshold (0–1)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  value={passThreshold}
                  onChange={(e) => setPassThreshold(Number(e.target.value))}
                  style={{ ...input, maxWidth: "8rem" }}
                />
                <label style={{ ...label, marginTop: "0.75rem" }}>Reject threshold (0–1)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  value={rejectThreshold}
                  onChange={(e) => setRejectThreshold(Number(e.target.value))}
                  style={{ ...input, maxWidth: "8rem" }}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <h2 style={{ ...label, fontSize: "0.8rem", opacity: 0.55, marginBottom: "1rem" }}>
            3 — Where should outcomes go? (optional)
          </h2>
          <p style={{ fontSize: "0.78rem", opacity: 0.4, marginBottom: "1rem" }}>
            Stored in project settings for when webhooks ship. Skip if unsure.
          </p>
          <div style={{ marginBottom: "1rem" }}>
            <label style={label}>Webhook URL (https only)</label>
            <input
              style={input}
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div style={{ marginBottom: "1.5rem" }}>
            <label style={label}>Events</label>
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
                  checked={webhookEvents.includes(id)}
                  onChange={() => eventToggle(id)}
                />
                {id}
              </label>
            ))}
          </div>
          <button type="button" style={btn(false)} onClick={back}>
            Back
          </button>
          <button
            type="button"
            style={{ ...btn(true), marginLeft: "0.75rem" }}
            onClick={() => tryNext(3)}
          >
            Continue
          </button>
        </section>
      )}

      {step === 4 && createdProjectId && creating && !keySecret && (
        <section>
          <p style={{ fontSize: "0.85rem", opacity: 0.55 }}>Issuing API key…</p>
        </section>
      )}

      {step === 4 && createdProjectId && !keySecret && !creating && alert?.type === "error" && (
        <section>
          <h2 style={{ ...label, fontSize: "0.8rem", opacity: 0.55, marginBottom: "1rem" }}>
            Project created
          </h2>
          <AdminFormAlert alert={alert} onDismiss={clearAlert} />
          <button
            type="button"
            style={{ ...btn(true), marginRight: "0.75rem" }}
            onClick={() => void issueKeyForCreatedProject()}
          >
            Retry issue API key
          </button>
          <Link href={`/admin/organisations/${orgId}`} style={{ ...btn(false), display: "inline-block" }}>
            Organisation →
          </Link>
        </section>
      )}

      {step === 4 && !createdProjectId && !keySecret && (
        <section>
          <h2 style={{ ...label, fontSize: "0.8rem", opacity: 0.55, marginBottom: "1rem" }}>
            4 — Review and create
          </h2>
          <dl style={{ fontSize: "0.8rem", opacity: 0.55, marginBottom: "1.25rem" }}>
            <dt style={{ opacity: 0.35 }}>Name</dt>
            <dd style={{ margin: "0 0 0.5rem 0" }}>{name.trim()}</dd>
            <dt style={{ opacity: 0.35 }}>Slug</dt>
            <dd style={{ margin: "0 0 0.5rem 0", fontFamily: "monospace" }}>{slug}</dd>
            <dt style={{ opacity: 0.35 }}>Use case</dt>
            <dd style={{ margin: "0 0 0.5rem 0" }}>{useCase}</dd>
            <dt style={{ opacity: 0.35 }}>Conversation type</dt>
            <dd style={{ margin: "0 0 0.5rem 0" }}>{projectType}</dd>
            {projectType === "onboarding" && (
              <>
                <dt style={{ opacity: 0.35 }}>Onboarding steps</dt>
                <dd style={{ margin: "0 0 0.5rem 0" }}>{flowSteps.length}</dd>
              </>
            )}
            <dt style={{ opacity: 0.35 }}>Environment / mode</dt>
            <dd style={{ margin: "0 0 0.5rem 0" }}>
              {environment} · sessions {sessionMode}
            </dd>
            <dt style={{ opacity: 0.35 }}>Webhook</dt>
            <dd style={{ margin: 0, wordBreak: "break-all" }}>
              {webhookUrl.trim() || "—"}
            </dd>
          </dl>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.5rem",
              fontSize: "0.78rem",
              opacity: 0.55,
              marginBottom: "0.65rem",
            }}
          >
            <input
              type="checkbox"
              checked={ackTraffic}
              onChange={(e) => setAckTraffic(e.target.checked)}
            />
            I understand this project will accept API traffic in <strong>{environment}</strong>.
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.5rem",
              fontSize: "0.78rem",
              opacity: 0.55,
              marginBottom: "1.25rem",
            }}
          >
            <input
              type="checkbox"
              checked={ackPermission}
              onChange={(e) => setAckPermission(e.target.checked)}
            />
            I have permission to run this gate on behalf of <strong>{orgName || "this organisation"}</strong>.
          </label>
          <button type="button" style={btn(false)} onClick={back}>
            Back
          </button>
          <button
            type="button"
            style={{ ...btn(true), marginLeft: "0.75rem" }}
            disabled={!ackTraffic || !ackPermission || creating}
            onClick={() => void createProjectAndKey()}
          >
            {creating ? "Creating…" : "Create project & issue key"}
          </button>
        </section>
      )}

      {keySecret && (
        <section
          style={{
            marginTop: "2rem",
            padding: "1.25rem",
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <h2 style={{ ...label, fontSize: "0.8rem", opacity: 0.55, marginBottom: "0.75rem" }}>
            API key
          </h2>
          <p style={{ fontSize: "0.75rem", opacity: 0.45, marginBottom: "0.75rem" }}>
            This is the only time we show the full key.
          </p>
          <pre
            style={{
              fontSize: "0.75rem",
              wordBreak: "break-all",
              whiteSpace: "pre-wrap",
              opacity: 0.9,
              marginBottom: "0.75rem",
            }}
          >
            {keySecret}
          </pre>
          <button
            type="button"
            style={{ ...btn(false), marginBottom: "1rem" }}
            onClick={() => void navigator.clipboard.writeText(keySecret)}
          >
            Copy
          </button>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              fontSize: "0.75rem",
              opacity: 0.5,
              marginBottom: "1rem",
            }}
          >
            <input type="checkbox" checked={keyAck} onChange={(e) => setKeyAck(e.target.checked)} />
            I have copied the key to a secure location.
          </label>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button type="button" style={btn(true)} disabled={!keyAck} onClick={finish}>
              Go to organisation
            </button>
            <Link
              href="/admin"
              style={{ ...btn(false), display: "inline-block", textDecoration: "none" }}
            >
              View dashboard
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
