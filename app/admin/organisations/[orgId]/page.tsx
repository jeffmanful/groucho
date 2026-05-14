"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"

type Project = {
  id: string
  name: string
  slug: string
  created_at: string
  expose_to_anon_read: boolean
  settings?: Record<string, unknown>
}

type OrgDetail = {
  id: string
  name: string
  slug: string
  created_at: string
  projects: Project[]
}

type ApiKeyRow = {
  id: string
  key_prefix: string
  label: string | null
  last_used_at: string | null
  created_at: string
  revoked_at: string | null
}

type WebhookRow = {
  id: string
  label: string | null
  url: string
  events: string[]
  active: boolean
  created_at: string
}

type MemberRow = {
  id: string
  user_id: string
  role: string
  invited_at: string | null
  accepted_at: string | null
  email: string | null
}

type SessionRow = {
  id: string
  session_id: string
  status: string
  created_at: string
  updated_at: string
  persona_id?: string | null
}

type InvitationRow = {
  id: string
  email: string
  role: string
  expires_at: string
  accepted_at: string | null
}

type TranscriptMessage = {
  id: string
  role: string
  content: string
  sent_at: string
  metadata: unknown
}

type ProfilePayload = {
  schema_version: number
  core: {
    summary: string
    sentiment: string
    engagement: string
    language: string
    intent_tags: string[]
    interests: string[]
    risk_flags: string[]
    qa: { question: string; answer: string }[]
    confidence: number
  } | null
  custom: Record<string, unknown> | null
  extraction:
    | { model: string; status: "ok" }
    | { model: string; status: "failed"; reason?: string }
}

type SessionProfileListRow = {
  session: SessionRow
  profile: ProfilePayload
  personaSchema: unknown
  verdictCreatedAt: string
}

function isProfilePayload(raw: unknown): raw is ProfilePayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false
  const o = raw as Record<string, unknown>
  const ext = o.extraction
  if (!ext || typeof ext !== "object" || Array.isArray(ext)) return false
  const st = (ext as Record<string, unknown>).status
  return typeof o.schema_version === "number" && (st === "ok" || st === "failed")
}

function slugify(str: string) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
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
  maxWidth: "24rem",
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

function btn(p: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: p
      ? "1px solid rgba(255,255,255,0.4)"
      : "1px solid rgba(255,255,255,0.15)",
    color: p ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)",
    padding: "0.3rem 0.65rem",
    cursor: "pointer",
    fontSize: "0.68rem",
    letterSpacing: "0.06em",
    fontFamily: "inherit",
  }
}

function isPii(personaSchema: unknown, key: string): boolean {
  if (!personaSchema || typeof personaSchema !== "object") return false
  const props = (personaSchema as { properties?: unknown }).properties
  if (!props || typeof props !== "object") return false
  const def = (props as Record<string, unknown>)[key]
  if (!def || typeof def !== "object") return false
  return (def as Record<string, unknown>)["x-pii"] === true
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.5rem",
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "999px",
        fontSize: "0.68rem",
        marginRight: "0.35rem",
        marginBottom: "0.25rem",
      }}
    >
      {children}
    </span>
  )
}

function ProfilePanel({
  profile,
  personaSchema,
  canReveal,
  revealedKeys,
  onToggleReveal,
}: {
  profile: ProfilePayload
  personaSchema: unknown
  canReveal: boolean
  revealedKeys: Set<string>
  onToggleReveal: (key: string) => void
}) {
  const core = profile.core
  const custom = profile.custom ?? {}
  return (
    <div
      style={{
        marginTop: "1.5rem",
        padding: "1rem",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div style={{ ...label, marginBottom: "0.75rem" }}>
        PROFILE (v{profile.schema_version}){" "}
        <span
          style={{
            marginLeft: "0.5rem",
            opacity: 0.5,
            fontFamily: "monospace",
            textTransform: "none",
            letterSpacing: 0,
          }}
        >
          {profile.extraction.status}
          {profile.extraction.status === "failed" && profile.extraction.reason
            ? ` · ${profile.extraction.reason}`
            : ""}
        </span>
      </div>

      {core ? (
        <>
          <p style={{ fontSize: "0.85rem", margin: 0, marginBottom: "0.75rem" }}>
            {core.summary || <span style={{ opacity: 0.35 }}>No summary.</span>}
          </p>
          <div style={{ marginBottom: "0.5rem" }}>
            <Chip>sentiment: {core.sentiment}</Chip>
            <Chip>engagement: {core.engagement}</Chip>
            <Chip>language: {core.language}</Chip>
            <Chip>confidence: {core.confidence.toFixed(2)}</Chip>
          </div>
          {core.intent_tags.length > 0 && (
            <div style={{ marginTop: "0.5rem" }}>
              <span style={{ opacity: 0.4, fontSize: "0.7rem", marginRight: "0.5rem" }}>
                intent
              </span>
              {core.intent_tags.map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          )}
          {core.interests.length > 0 && (
            <div style={{ marginTop: "0.35rem" }}>
              <span style={{ opacity: 0.4, fontSize: "0.7rem", marginRight: "0.5rem" }}>
                interests
              </span>
              {core.interests.map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          )}
          {core.risk_flags.length > 0 && (
            <div style={{ marginTop: "0.35rem" }}>
              <span style={{ opacity: 0.4, fontSize: "0.7rem", marginRight: "0.5rem" }}>
                risks
              </span>
              {core.risk_flags.map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          )}
          {core.qa.length > 0 && (
            <details style={{ marginTop: "0.75rem" }}>
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: "0.7rem",
                  opacity: 0.55,
                  letterSpacing: "0.06em",
                }}
              >
                {core.qa.length} Q/A pair{core.qa.length === 1 ? "" : "s"}
              </summary>
              <ul style={{ listStyle: "none", padding: "0.5rem 0 0", margin: 0 }}>
                {core.qa.map((qa, i) => (
                  <li
                    key={i}
                    style={{
                      padding: "0.35rem 0",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      fontSize: "0.78rem",
                    }}
                  >
                    <div style={{ opacity: 0.5 }}>{qa.question}</div>
                    <div style={{ opacity: 0.85, marginTop: "0.15rem" }}>{qa.answer}</div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p style={{ opacity: 0.35, fontSize: "0.78rem", margin: 0 }}>No core profile.</p>
      )}

      {custom && Object.keys(custom).length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ ...label, marginBottom: "0.5rem" }}>CUSTOM</div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {Object.entries(custom).map(([k, v]) => {
              const pii = isPii(personaSchema, k)
              const revealed = revealedKeys.has(k)
              const display =
                pii && !revealed ? "••••••" : typeof v === "string" ? v : JSON.stringify(v)
              return (
                <li
                  key={k}
                  style={{
                    fontSize: "0.78rem",
                    padding: "0.35rem 0",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    display: "flex",
                    gap: "0.75rem",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "monospace",
                      opacity: 0.55,
                      minWidth: "8rem",
                    }}
                  >
                    {k}
                    {pii ? (
                      <span style={{ marginLeft: "0.3rem", color: "#f59e0b", fontSize: "0.62rem" }}>
                        PII
                      </span>
                    ) : null}
                  </span>
                  <span style={{ opacity: 0.9, wordBreak: "break-word" }}>{display}</span>
                  {pii && canReveal && (
                    <button
                      type="button"
                      style={{ ...btn(false), marginLeft: "auto" }}
                      onClick={() => onToggleReveal(k)}
                    >
                      {revealed ? "hide" : "reveal"}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function OrganisationDetailPage() {
  const params = useParams()
  const orgId = params.orgId as string

  const [org, setOrg] = useState<OrgDetail | null>(null)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [members, setMembers] = useState<MemberRow[]>([])
  const [projName, setProjName] = useState("")
  const [projSlug, setProjSlug] = useState("")
  const [projSlugManual, setProjSlugManual] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([])
  const [whUrl, setWhUrl] = useState("")
  const [whLabel, setWhLabel] = useState("")
  const [revealedWebhookSecret, setRevealedWebhookSecret] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [sessionTotal, setSessionTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [deleteSlug, setDeleteSlug] = useState("")
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [invites, setInvites] = useState<InvitationRow[]>([])
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState("member")
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([])
  const [profile, setProfile] = useState<ProfilePayload | null>(null)
  const [personaSchema, setPersonaSchema] = useState<unknown>(null)
  const [revealedCustomKeys, setRevealedCustomKeys] = useState<Set<string>>(new Set())
  const [sessionProfileRows, setSessionProfileRows] = useState<SessionProfileListRow[]>([])
  const [loadingSessionProfiles, setLoadingSessionProfiles] = useState(false)
  const [profilesExpandedSessionId, setProfilesExpandedSessionId] = useState<string | null>(null)
  const [profilesRevealedKeys, setProfilesRevealedKeys] = useState<Set<string>>(new Set())
  const [projSettingsSessionMode, setProjSettingsSessionMode] = useState<"live" | "dry-run">("live")
  const [projSettingsPassThreshold, setProjSettingsPassThreshold] = useState(0.65)
  const [projSettingsRejectThreshold, setProjSettingsRejectThreshold] = useState(0.25)
  const [projSettingsExtract, setProjSettingsExtract] = useState<
    "default" | "off" | "passed_only"
  >("default")
  const [savingProjectSettings, setSavingProjectSettings] = useState(false)
  /** `platform` = allowlisted operator; otherwise org membership role. */
  const [accessRole, setAccessRole] = useState<"platform" | "owner" | "admin" | "member" | null>(
    null,
  )

  const loadAccess = useCallback(async () => {
    const res = await fetch(`/api/admin/organisations/${orgId}/access`)
    if (!res.ok) {
      setAccessRole(null)
      return
    }
    const j: { role: string } = await res.json()
    const r = j.role
    if (r === "platform" || r === "owner" || r === "admin" || r === "member") {
      setAccessRole(r)
    } else setAccessRole(null)
  }, [orgId])

  const canOrgAdmin =
    accessRole === "platform" || accessRole === "owner" || accessRole === "admin"
  const canOrgOwner = accessRole === "platform" || accessRole === "owner"

  const loadOrg = useCallback(async () => {
    const res = await fetch(`/api/admin/organisations/${orgId}`)
    if (!res.ok) {
      setOrg(null)
      setLoading(false)
      return
    }
    const data: OrgDetail = await res.json()
    setOrg(data)
    setName(data.name)
    setSlug(data.slug)
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    if (!org?.projects?.length) return
    setSelectedProjectId((prev) => {
      if (prev && org.projects.some((p) => p.id === prev)) return prev
      return org.projects[0].id
    })
  }, [org])

  const loadMembers = useCallback(async () => {
    const res = await fetch(`/api/admin/organisations/${orgId}/members`)
    if (res.ok) setMembers(await res.json())
  }, [orgId])

  const loadInvites = useCallback(async () => {
    const res = await fetch(`/api/admin/organisations/${orgId}/invitations`)
    if (res.ok) setInvites(await res.json())
  }, [orgId])

  const loadTranscript = useCallback(async () => {
    if (!selectedProjectId || !selectedSessionId) {
      setTranscript([])
      setProfile(null)
      setPersonaSchema(null)
      setRevealedCustomKeys(new Set())
      return
    }
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${selectedProjectId}/sessions/${selectedSessionId}/messages`,
    )
    if (res.ok) {
      const j = await res.json()
      setTranscript(j.messages ?? [])
      setProfile((j.profile as ProfilePayload | null) ?? null)
      setPersonaSchema(j.personaSchema ?? null)
      setRevealedCustomKeys(new Set())
    } else {
      setTranscript([])
      setProfile(null)
      setPersonaSchema(null)
      setRevealedCustomKeys(new Set())
    }
  }, [orgId, selectedProjectId, selectedSessionId])

  const loadKeys = useCallback(async () => {
    if (!selectedProjectId) {
      setKeys([])
      return
    }
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${selectedProjectId}/api-keys`,
    )
    if (res.ok) setKeys(await res.json())
  }, [orgId, selectedProjectId])

  const loadWebhooks = useCallback(async () => {
    if (!selectedProjectId) {
      setWebhooks([])
      return
    }
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${selectedProjectId}/webhooks`,
    )
    if (res.ok) setWebhooks(await res.json())
  }, [orgId, selectedProjectId])

  const loadSessions = useCallback(async () => {
    if (!selectedProjectId) {
      setSessions([])
      setSessionTotal(0)
      return
    }
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${selectedProjectId}/sessions`,
    )
    if (res.ok) {
      const j = await res.json()
      setSessions(j.sessions ?? [])
      setSessionTotal(j.total ?? 0)
    }
  }, [orgId, selectedProjectId])

  const loadSessionProfiles = useCallback(async () => {
    if (!selectedProjectId) {
      setSessionProfileRows([])
      setLoadingSessionProfiles(false)
      return
    }
    setLoadingSessionProfiles(true)
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${selectedProjectId}/session-profiles`,
    )
    if (res.ok) {
      const j: {
        rows?: {
          session: SessionRow | null
          profile: unknown
          verdictCreatedAt: string
          personaSchema: unknown
        }[]
      } = await res.json()
      const out: SessionProfileListRow[] = []
      for (const r of j.rows ?? []) {
        if (!r.session?.id) continue
        if (!isProfilePayload(r.profile)) continue
        out.push({
          session: r.session,
          profile: r.profile,
          personaSchema: r.personaSchema ?? null,
          verdictCreatedAt: r.verdictCreatedAt,
        })
      }
      setSessionProfileRows(out)
    } else {
      setSessionProfileRows([])
    }
    setLoadingSessionProfiles(false)
  }, [orgId, selectedProjectId])

  useEffect(() => {
    setLoading(true)
    void loadAccess()
    void loadOrg()
    void loadMembers()
    void loadInvites()
  }, [loadAccess, loadOrg, loadMembers, loadInvites])

  useEffect(() => {
    void loadKeys()
    void loadWebhooks()
    void loadSessions()
    void loadSessionProfiles()
  }, [loadKeys, loadWebhooks, loadSessions, loadSessionProfiles])

  useEffect(() => {
    setSelectedSessionId(null)
    setTranscript([])
    setProfilesExpandedSessionId(null)
    setProfilesRevealedKeys(new Set())
  }, [selectedProjectId])

  useEffect(() => {
    setProfilesRevealedKeys(new Set())
  }, [profilesExpandedSessionId])

  useEffect(() => {
    if (!org?.projects?.length || !selectedProjectId) return
    const p = org.projects.find((x) => x.id === selectedProjectId)
    if (!p) return
    const s = (p.settings ?? {}) as Record<string, unknown>
    setProjSettingsSessionMode(s.session_mode === "dry-run" ? "dry-run" : "live")
    const pt = s.pass_threshold
    const rt = s.reject_threshold
    setProjSettingsPassThreshold(
      typeof pt === "number" && Number.isFinite(pt) ? Math.min(1, Math.max(0, pt)) : 0.65,
    )
    setProjSettingsRejectThreshold(
      typeof rt === "number" && Number.isFinite(rt) ? Math.min(1, Math.max(0, rt)) : 0.25,
    )
    const pe = s.profile_extract_on
    if (pe === false || pe === null) setProjSettingsExtract("off")
    else if (Array.isArray(pe) && pe.length === 1 && pe[0] === "passed")
      setProjSettingsExtract("passed_only")
    else setProjSettingsExtract("default")
  }, [org, selectedProjectId])

  useEffect(() => {
    void loadTranscript()
  }, [loadTranscript])

  useEffect(() => {
    if (!projSlugManual) setProjSlug(slugify(projName))
  }, [projName, projSlugManual])

  useEffect(() => {
    if (accessRole === "admin" && inviteRole === "owner") setInviteRole("member")
  }, [accessRole, inviteRole])

  async function saveOrg(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setMsg(null)
    const res = await fetch(`/api/admin/organisations/${orgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, slug }),
    })
    const b = await res.json().catch(() => ({}))
    if (!res.ok) {
      setErr(b.error ?? "Update failed")
      return
    }
    setMsg("Organisation saved.")
    await loadOrg()
  }

  async function deleteOrg() {
    if (!org) return
    setErr(null)
    setMsg(null)
    const res = await fetch(`/api/admin/organisations/${orgId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmSlug: deleteSlug.trim() }),
    })
    const b = await res.json().catch(() => ({}))
    if (!res.ok) {
      setErr(b.error ?? "Delete failed")
      return
    }
    window.location.href = "/admin/organisations"
  }

  async function addProject(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setMsg(null)
    const res = await fetch(`/api/admin/organisations/${orgId}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: projName, slug: projSlug }),
    })
    const b = await res.json().catch(() => ({}))
    if (!res.ok) {
      setErr(b.error ?? "Could not create project")
      return
    }
    setProjName("")
    setProjSlug("")
    setProjSlugManual(false)
    setMsg("Project created.")
    await loadOrg()
    setSelectedProjectId(b.id)
  }

  async function toggleAnonRead(p: Project, next: boolean) {
    setErr(null)
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${p.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expose_to_anon_read: next }),
      },
    )
    const b = await res.json().catch(() => ({}))
    if (!res.ok) {
      setErr(b.error ?? "Update failed")
      return
    }
    setMsg(
      next
        ? "This project is now the anon admin / Realtime scope (others cleared)."
        : "Anon read scope cleared for this project.",
    )
    await loadOrg()
  }

  async function saveProjectSettings(e: React.FormEvent) {
    e.preventDefault()
    if (!canOrgAdmin || !selectedProjectId || !org) return
    const p = org.projects.find((x) => x.id === selectedProjectId)
    if (!p) return
    setSavingProjectSettings(true)
    setErr(null)
    setMsg(null)
    const merged: Record<string, unknown> = {
      ...((p.settings ?? {}) as Record<string, unknown>),
    }
    merged.session_mode = projSettingsSessionMode
    merged.pass_threshold = projSettingsPassThreshold
    merged.reject_threshold = projSettingsRejectThreshold
    if (projSettingsExtract === "off") merged.profile_extract_on = false
    else if (projSettingsExtract === "passed_only") merged.profile_extract_on = ["passed"]
    else delete merged.profile_extract_on

    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${selectedProjectId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: merged }),
      },
    )
    const b = await res.json().catch(() => ({}))
    setSavingProjectSettings(false)
    if (!res.ok) {
      setErr(b.error ?? "Could not save project settings")
      return
    }
    setMsg("Project settings saved.")
    await loadOrg()
  }

  async function deleteProject(p: Project) {
    if (!window.confirm(`Delete project “${p.name}” and its keys/sessions?`)) return
    setErr(null)
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${p.id}`,
      { method: "DELETE" },
    )
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setErr(b.error ?? "Delete failed")
      return
    }
    if (selectedProjectId === p.id) setSelectedProjectId(null)
    setMsg("Project deleted.")
    await loadOrg()
  }

  async function createKey() {
    if (!selectedProjectId) return
    setErr(null)
    setRevealedSecret(null)
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${selectedProjectId}/api-keys`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    )
    const b = await res.json().catch(() => ({}))
    if (!res.ok) {
      setErr(b.error ?? "Could not create key")
      return
    }
    if (b.secret) setRevealedSecret(b.secret)
    await loadKeys()
  }

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedProjectId) return
    setErr(null)
    setRevealedWebhookSecret(null)
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${selectedProjectId}/webhooks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: whUrl.trim(),
          label: whLabel.trim() || undefined,
        }),
      },
    )
    const b = await res.json().catch(() => ({}))
    if (!res.ok) {
      setErr(b.error ?? "Could not create webhook")
      return
    }
    if (typeof b.signing_secret === "string") setRevealedWebhookSecret(b.signing_secret)
    setWhUrl("")
    setWhLabel("")
    await loadWebhooks()
  }

  async function toggleWebhook(w: WebhookRow, next: boolean) {
    if (!selectedProjectId) return
    setErr(null)
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${selectedProjectId}/webhooks/${w.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      },
    )
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setErr(b.error ?? "Update failed")
      return
    }
    await loadWebhooks()
  }

  async function rotateWebhookSecret(id: string) {
    if (!selectedProjectId) return
    if (!window.confirm("Rotate signing secret? The old secret stops working immediately.")) return
    setErr(null)
    setRevealedWebhookSecret(null)
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${selectedProjectId}/webhooks/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotate_secret: true }),
      },
    )
    const b = await res.json().catch(() => ({}))
    if (!res.ok) {
      setErr(b.error ?? "Rotate failed")
      return
    }
    if (typeof b.signing_secret === "string") setRevealedWebhookSecret(b.signing_secret)
  }

  async function testWebhook(id: string) {
    if (!selectedProjectId) return
    setErr(null)
    setMsg(null)
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${selectedProjectId}/webhooks/${id}/test`,
      { method: "POST" },
    )
    const b = await res.json().catch(() => ({}))
    if (!res.ok) {
      setErr(b.error ?? "Test failed")
      return
    }
    setMsg(
      b.ok
        ? `Ping delivered (${b.http_status}).`
        : `Endpoint returned HTTP ${b.http_status}.`,
    )
  }

  async function deleteWebhook(id: string) {
    if (!selectedProjectId) return
    if (!window.confirm("Delete this webhook?")) return
    setErr(null)
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${selectedProjectId}/webhooks/${id}`,
      { method: "DELETE" },
    )
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setErr(b.error ?? "Delete failed")
      return
    }
    await loadWebhooks()
  }

  async function revokeKey(id: string) {
    if (!selectedProjectId) return
    if (!window.confirm("Revoke this API key?")) return
    setErr(null)
    const res = await fetch(
      `/api/admin/organisations/${orgId}/projects/${selectedProjectId}/api-keys/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revoked: true }),
      },
    )
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setErr(b.error ?? "Revoke failed")
      return
    }
    await loadKeys()
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setMsg(null)
    setLastInviteUrl(null)
    const res = await fetch(`/api/admin/organisations/${orgId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    })
    const b = await res.json().catch(() => ({}))
    if (!res.ok) {
      setErr(b.error ?? "Could not create invitation")
      return
    }
    const url =
      typeof window !== "undefined" && b.token
        ? `${window.location.origin}/invite/${b.token}`
        : null
    setLastInviteUrl(url)
    setInviteEmail("")
    setMsg("Invitation created. Copy the link below — the token is not shown again in the list.")
    await loadInvites()
  }

  async function deleteInvite(id: string) {
    if (!window.confirm("Delete this pending invitation?")) return
    setErr(null)
    const res = await fetch(
      `/api/admin/organisations/${orgId}/invitations/${id}`,
      { method: "DELETE" },
    )
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setErr(b.error ?? "Delete failed")
      return
    }
    await loadInvites()
  }

  if (loading && !org) {
    return (
      <div style={{ padding: "2rem", opacity: 0.4 }}>
        Loading…
      </div>
    )
  }

  if (!org) {
    return (
      <div style={{ padding: "2rem" }}>
        <p>Organisation not found.</p>
        <Link href="/admin/organisations" style={{ color: "rgba(255,255,255,0.5)" }}>
          ← Back
        </Link>
      </div>
    )
  }

  const selected =
    org.projects.find((p) => p.id === selectedProjectId) ?? org.projects[0]

  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "52rem" }}>
      <Link
        href="/admin/organisations"
        style={{ fontSize: "0.7rem", opacity: 0.35, color: "#fff", textDecoration: "none" }}
      >
        ← organisations
      </Link>

      <h1
        style={{
          fontSize: "0.75rem",
          letterSpacing: "0.14em",
          fontWeight: 400,
          opacity: 0.45,
          margin: "1.5rem 0 1rem",
        }}
      >
        {org.name}
      </h1>

      {(msg || err) && (
        <p style={{ color: err ? "#f87171" : "rgba(255,255,255,0.5)", fontSize: "0.8rem" }}>
          {err ?? msg}
        </p>
      )}

      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ ...label, marginBottom: "0.75rem" }}>SETTINGS</h2>
        {canOrgAdmin ? (
          <form onSubmit={saveOrg}>
            <div style={{ marginBottom: "1rem" }}>
              <label style={label}>NAME</label>
              <input style={input} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <label style={label}>SLUG</label>
              <input style={input} value={slug} onChange={(e) => setSlug(e.target.value)} />
            </div>
            <button type="submit" style={btn(true)}>
              Save
            </button>
          </form>
        ) : (
          <p style={{ fontSize: "0.85rem", opacity: 0.45 }}>
            {org.name} · <span style={{ fontFamily: "monospace" }}>{org.slug}</span>
            <span style={{ display: "block", marginTop: "0.5rem", fontSize: "0.72rem" }}>
              Read-only · org admins can edit name and slug.
            </span>
          </p>
        )}
      </section>

      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ ...label, marginBottom: "0.75rem" }}>INVITATIONS</h2>
        <p style={{ opacity: 0.35, fontSize: "0.75rem", marginBottom: "1rem" }}>
          Invitees use Supabase Auth at the accept link (one-time email code). Link is only shown
          once when you create the invite.
        </p>
        {canOrgAdmin && (
          <form onSubmit={createInvite} style={{ marginBottom: "1.25rem" }}>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={label}>EMAIL</label>
                <input
                  style={input}
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                />
              </div>
              <div>
                <label style={label}>ROLE</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  style={{
                    ...input,
                    border: "1px solid rgba(255,255,255,0.15)",
                    padding: "0.35rem 0.5rem",
                  }}
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                  {(accessRole === "platform" || accessRole === "owner") && (
                    <option value="owner">owner</option>
                  )}
                </select>
              </div>
              <button type="submit" style={btn(true)}>
                Create invite
              </button>
            </div>
          </form>
        )}
        {lastInviteUrl && (
          <div
            style={{
              marginBottom: "1.25rem",
              padding: "0.75rem 1rem",
              background: "rgba(255,255,255,0.04)",
              fontFamily: "monospace",
              fontSize: "0.72rem",
              wordBreak: "break-all",
            }}
          >
            <div style={{ opacity: 0.45, marginBottom: "0.35rem" }}>Accept URL (copy now)</div>
            {lastInviteUrl}
            <button
              type="button"
              style={{ ...btn(false), marginTop: "0.5rem" }}
              onClick={() => void navigator.clipboard.writeText(lastInviteUrl)}
            >
              Copy link
            </button>
          </div>
        )}
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {invites.map((inv) => (
            <li
              key={inv.id}
              style={{
                fontSize: "0.78rem",
                padding: "0.45rem 0",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                gap: "1rem",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span>{inv.email}</span>
              <span style={{ opacity: 0.4 }}>{inv.role}</span>
              <span style={{ opacity: 0.25 }}>
                {inv.accepted_at
                  ? `accepted ${new Date(inv.accepted_at).toLocaleDateString()}`
                  : `expires ${new Date(inv.expires_at).toLocaleDateString()}`}
              </span>
              {canOrgAdmin && !inv.accepted_at && (
                <button
                  type="button"
                  style={{ ...btn(false), marginLeft: "auto" }}
                  onClick={() => void deleteInvite(inv.id)}
                >
                  delete
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ ...label, marginBottom: "0.75rem" }}>MEMBERS (SUPABASE AUTH)</h2>
        {members.length === 0 ? (
          <p style={{ opacity: 0.35, fontSize: "0.8rem" }}>
            No members yet. Pending invitations are listed above; accepted invites appear here
            after the user completes Supabase sign-in at the accept link.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {members.map((m) => (
              <li
                key={m.id}
                style={{
                  fontSize: "0.8rem",
                  padding: "0.4rem 0",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  display: "flex",
                  gap: "1rem",
                }}
              >
                <span style={{ opacity: 0.5 }}>{m.role}</span>
                <span>{m.email ?? m.user_id}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: "2.5rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "0.75rem",
          }}
        >
          <h2 style={{ ...label, marginBottom: 0 }}>PROJECTS</h2>
          {canOrgAdmin && (
            <Link
              href={`/admin/organisations/${orgId}/projects/new`}
              style={{
                fontSize: "0.68rem",
                letterSpacing: "0.06em",
                opacity: 0.45,
                color: "#fff",
                textDecoration: "none",
              }}
            >
              Guided setup →
            </Link>
          )}
        </div>
        {canOrgAdmin && (
          <form onSubmit={addProject} style={{ marginBottom: "1.25rem" }}>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={label}>NAME</label>
                <input style={input} value={projName} onChange={(e) => setProjName(e.target.value)} />
              </div>
              <div>
                <label style={label}>SLUG</label>
                <input
                  style={input}
                  value={projSlug}
                  onChange={(e) => {
                    setProjSlugManual(true)
                    setProjSlug(e.target.value)
                  }}
                />
              </div>
              <button type="submit" style={btn(true)}>
                Add project
              </button>
            </div>
          </form>
        )}

        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {org.projects.map((p) => (
            <li
              key={p.id}
              style={{
                padding: "0.75rem 0",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setSelectedProjectId(p.id)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color:
                      selectedProjectId === p.id ? "#fff" : "rgba(255,255,255,0.45)",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    textAlign: "left",
                  }}
                >
                  {p.name}
                </button>
                <span style={{ fontFamily: "monospace", fontSize: "0.72rem", opacity: 0.35 }}>
                  {p.slug}
                </span>
                {canOrgAdmin && (
                  <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.72rem", opacity: 0.55 }}>
                    <input
                      type="checkbox"
                      checked={p.expose_to_anon_read}
                      onChange={(e) => void toggleAnonRead(p, e.target.checked)}
                    />
                    anon admin scope
                  </label>
                )}
                {canOrgAdmin && (
                  <button type="button" style={{ ...btn(false), marginLeft: "auto" }} onClick={() => void deleteProject(p)}>
                    delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {selected && (
        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ ...label, marginBottom: "0.75rem" }}>PROJECT SETTINGS — {selected.name}</h2>
          <p style={{ opacity: 0.35, fontSize: "0.75rem", marginBottom: "1rem", lineHeight: 1.45 }}>
            Session mode, scoring thresholds, and profile extraction. Other keys in{" "}
            <span style={{ fontFamily: "monospace" }}>settings</span> (use case, persona, webhooks
            from the wizard) are preserved when you save.
          </p>
          {!canOrgAdmin ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "0.78rem", opacity: 0.5 }}>
              <li>
                session_mode:{" "}
                {String((selected.settings as Record<string, unknown> | undefined)?.session_mode ?? "live")}
              </li>
              <li>
                pass_threshold:{" "}
                {String((selected.settings as Record<string, unknown> | undefined)?.pass_threshold ?? "—")}
              </li>
              <li>
                reject_threshold:{" "}
                {String((selected.settings as Record<string, unknown> | undefined)?.reject_threshold ?? "—")}
              </li>
              <li>
                profile_extract_on:{" "}
                {JSON.stringify((selected.settings as Record<string, unknown> | undefined)?.profile_extract_on ?? "default (unset)")}
              </li>
            </ul>
          ) : (
            <form onSubmit={(e) => void saveProjectSettings(e)}>
              <div style={{ marginBottom: "1rem" }}>
                <span style={{ ...label, display: "block" }}>SESSION MODE</span>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem", opacity: 0.75, marginBottom: "0.35rem" }}>
                  <input
                    type="radio"
                    name="sessionMode"
                    checked={projSettingsSessionMode === "live"}
                    onChange={() => setProjSettingsSessionMode("live")}
                  />
                  Live — verdicts and profile extraction run
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem", opacity: 0.75 }}>
                  <input
                    type="radio"
                    name="sessionMode"
                    checked={projSettingsSessionMode === "dry-run"}
                    onChange={() => setProjSettingsSessionMode("dry-run")}
                  />
                  Dry-run — no verdict / extraction (testing)
                </label>
              </div>
              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                <div>
                  <label style={label}>PASS THRESHOLD (0–1)</label>
                  <input
                    style={{ ...input, maxWidth: "8rem" }}
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={projSettingsPassThreshold}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setProjSettingsPassThreshold(
                        Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.65,
                      )
                    }}
                  />
                </div>
                <div>
                  <label style={label}>REJECT THRESHOLD (0–1)</label>
                  <input
                    style={{ ...input, maxWidth: "8rem" }}
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={projSettingsRejectThreshold}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setProjSettingsRejectThreshold(
                        Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.25,
                      )
                    }}
                  />
                </div>
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <span style={{ ...label, display: "block" }}>PROFILE EXTRACTION</span>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem", opacity: 0.75, marginBottom: "0.35rem" }}>
                  <input
                    type="radio"
                    name="profileExtract"
                    checked={projSettingsExtract === "default"}
                    onChange={() => setProjSettingsExtract("default")}
                  />
                  Default — passed, redirected, rejected
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem", opacity: 0.75, marginBottom: "0.35rem" }}>
                  <input
                    type="radio"
                    name="profileExtract"
                    checked={projSettingsExtract === "passed_only"}
                    onChange={() => setProjSettingsExtract("passed_only")}
                  />
                  Passed sessions only
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem", opacity: 0.75 }}>
                  <input
                    type="radio"
                    name="profileExtract"
                    checked={projSettingsExtract === "off"}
                    onChange={() => setProjSettingsExtract("off")}
                  />
                  Off
                </label>
              </div>
              <button type="submit" style={btn(true)} disabled={savingProjectSettings}>
                {savingProjectSettings ? "Saving…" : "Save project settings"}
              </button>
            </form>
          )}
        </section>
      )}

      {selected && (
        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ ...label, marginBottom: "0.75rem" }}>
            API KEYS — {selected.name}
          </h2>
          {canOrgAdmin && (
            <button type="button" style={{ ...btn(true), marginBottom: "1rem" }} onClick={() => void createKey()}>
              Create key
            </button>
          )}
          {revealedSecret && (
            <div
              style={{
                padding: "1rem",
                marginBottom: "1rem",
                background: "rgba(255,255,255,0.04)",
                fontFamily: "monospace",
                fontSize: "0.75rem",
                wordBreak: "break-all",
              }}
            >
              <div style={{ opacity: 0.45, marginBottom: "0.5rem" }}>Copy now — not shown again</div>
              {revealedSecret}
              <button
                type="button"
                style={{ ...btn(false), marginTop: "0.75rem" }}
                onClick={() => {
                  void navigator.clipboard.writeText(revealedSecret)
                }}
              >
                Copy
              </button>
              <button
                type="button"
                style={{ ...btn(false), marginTop: "0.75rem", marginLeft: "0.5rem" }}
                onClick={() => setRevealedSecret(null)}
              >
                Dismiss
              </button>
            </div>
          )}
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {keys.map((k) => (
              <li
                key={k.id}
                style={{
                  fontSize: "0.78rem",
                  padding: "0.45rem 0",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  display: "flex",
                  gap: "1rem",
                  alignItems: "center",
                }}
              >
                <span style={{ fontFamily: "monospace", opacity: 0.5 }}>{k.key_prefix}…</span>
                <span style={{ opacity: 0.35 }}>{k.label ?? "—"}</span>
                <span style={{ opacity: 0.25, marginLeft: "auto" }}>
                  {k.revoked_at ? "revoked" : k.last_used_at ? "used" : "unused"}
                </span>
                {canOrgAdmin && !k.revoked_at && (
                  <button type="button" style={btn(false)} onClick={() => void revokeKey(k.id)}>
                    revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {selected && (
        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ ...label, marginBottom: "0.75rem" }}>
            WEBHOOKS — {selected.name}
          </h2>
          <p style={{ opacity: 0.35, fontSize: "0.75rem", marginBottom: "1rem" }}>
            HTTPS endpoints that receive signed JSON when a session completes (event{" "}
            <span style={{ fontFamily: "monospace" }}>session.completed</span>). Configure{" "}
            <span style={{ fontFamily: "monospace" }}>CRON_SECRET</span> and call{" "}
            <span style={{ fontFamily: "monospace" }}>GET /api/cron/webhook-deliveries</span>{" "}
            on a schedule for retries.
          </p>
          {canOrgAdmin && (
            <form onSubmit={createWebhook} style={{ marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: "1 1 12rem" }}>
                  <label style={label}>HTTPS URL</label>
                  <input
                    style={input}
                    type="url"
                    value={whUrl}
                    onChange={(e) => setWhUrl(e.target.value)}
                    placeholder="https://example.com/groucho-hook"
                    required
                  />
                </div>
                <div style={{ flex: "1 1 8rem" }}>
                  <label style={label}>LABEL (OPTIONAL)</label>
                  <input
                    style={input}
                    value={whLabel}
                    onChange={(e) => setWhLabel(e.target.value)}
                    placeholder="Production"
                  />
                </div>
                <button type="submit" style={btn(true)}>
                  Add webhook
                </button>
              </div>
            </form>
          )}
          {revealedWebhookSecret && (
            <div
              style={{
                padding: "1rem",
                marginBottom: "1rem",
                background: "rgba(255,255,255,0.04)",
                fontFamily: "monospace",
                fontSize: "0.75rem",
                wordBreak: "break-all",
              }}
            >
              <div style={{ opacity: 0.45, marginBottom: "0.5rem" }}>
                Signing secret — copy now (create or rotate)
              </div>
              {revealedWebhookSecret}
              <button
                type="button"
                style={{ ...btn(false), marginTop: "0.75rem" }}
                onClick={() => void navigator.clipboard.writeText(revealedWebhookSecret)}
              >
                Copy
              </button>
              <button
                type="button"
                style={{ ...btn(false), marginTop: "0.75rem", marginLeft: "0.5rem" }}
                onClick={() => setRevealedWebhookSecret(null)}
              >
                Dismiss
              </button>
            </div>
          )}
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {webhooks.map((w) => (
              <li
                key={w.id}
                style={{
                  fontSize: "0.78rem",
                  padding: "0.45rem 0",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  display: "flex",
                  gap: "0.75rem",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ opacity: w.active ? 0.85 : 0.35 }}>{w.label ?? "—"}</span>
                <span style={{ fontFamily: "monospace", opacity: 0.4, wordBreak: "break-all" }}>
                  {w.url}
                </span>
                {canOrgAdmin && (
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.72rem", opacity: 0.5 }}>
                    <input
                      type="checkbox"
                      checked={w.active}
                      onChange={(e) => void toggleWebhook(w, e.target.checked)}
                    />
                    active
                  </label>
                )}
                {canOrgAdmin && (
                  <>
                    <button type="button" style={{ ...btn(false), marginLeft: "auto" }} onClick={() => void testWebhook(w.id)}>
                      test ping
                    </button>
                    <button type="button" style={btn(false)} onClick={() => void rotateWebhookSecret(w.id)}>
                      rotate secret
                    </button>
                    <button type="button" style={btn(false)} onClick={() => void deleteWebhook(w.id)}>
                      delete
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {selected && (
        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ ...label, marginBottom: "0.75rem" }}>
            SESSIONS — {selected.name} ({sessionTotal})
          </h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedSessionId((prev) => (prev === s.id ? null : s.id))
                  }
                  style={{
                    width: "100%",
                    fontSize: "0.75rem",
                    padding: "0.4rem 0",
                    border: "none",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    display: "flex",
                    gap: "1rem",
                    fontFamily: "monospace",
                    background:
                      selectedSessionId === s.id
                        ? "rgba(255,255,255,0.06)"
                        : "transparent",
                    color: "inherit",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ opacity: 0.45 }}>{s.session_id.slice(0, 12)}…</span>
                  <span style={{ opacity: 0.35 }}>{s.status}</span>
                  <span style={{ opacity: 0.25, marginLeft: "auto" }}>
                    {new Date(s.created_at).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selectedSessionId && (
            <div
              style={{
                marginTop: "1rem",
                padding: "1rem",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ ...label, marginBottom: "0.75rem" }}>TRANSCRIPT</div>
              {transcript.length === 0 ? (
                <p style={{ opacity: 0.35, fontSize: "0.78rem" }}>No messages or loading…</p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {transcript.map((m) => {
                    const scores =
                      m.metadata &&
                      typeof m.metadata === "object" &&
                      m.metadata !== null &&
                      "scores" in m.metadata
                        ? (m.metadata as { scores: unknown }).scores
                        : null
                    return (
                      <li
                        key={m.id}
                        style={{
                          fontSize: "0.78rem",
                          padding: "0.5rem 0",
                          borderBottom: "1px solid rgba(255,255,255,0.05)",
                        }}
                      >
                        <span style={{ opacity: 0.35, marginRight: "0.75rem" }}>{m.role}</span>
                        <span style={{ opacity: 0.9 }}>{m.content}</span>
                        {scores != null && (
                          <div
                            style={{
                              marginTop: "0.25rem",
                              opacity: 0.35,
                              fontFamily: "monospace",
                              fontSize: "0.68rem",
                            }}
                          >
                            {JSON.stringify(scores)}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {profile && (
                <ProfilePanel
                  profile={profile}
                  personaSchema={personaSchema}
                  canReveal={canOrgAdmin}
                  revealedKeys={revealedCustomKeys}
                  onToggleReveal={(k) =>
                    setRevealedCustomKeys((prev) => {
                      const next = new Set(prev)
                      if (next.has(k)) next.delete(k)
                      else next.add(k)
                      return next
                    })
                  }
                />
              )}
            </div>
          )}
        </section>
      )}

      {selected && (
        <section style={{ marginBottom: "2.5rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "1rem",
              flexWrap: "wrap",
              marginBottom: "0.5rem",
            }}
          >
            <h2 style={{ ...label, marginBottom: 0 }}>
              EXTRACTED PROFILES — {selected.name}
            </h2>
            <button
              type="button"
              style={{ ...btn(false), fontSize: "0.62rem" }}
              onClick={() => void loadSessionProfiles()}
            >
              refresh
            </button>
          </div>
          <p style={{ fontSize: "0.75rem", opacity: 0.4, marginBottom: "1rem", lineHeight: 1.45 }}>
            Structured profiles from completed sessions (verdict payload). Open a row for full core,
            custom fields, and PII reveal. Use{" "}
            <span style={{ fontFamily: "monospace", opacity: 0.7 }}>Open transcript</span> to jump
            to the same session below.
          </p>
          {loadingSessionProfiles ? (
            <p style={{ opacity: 0.35, fontSize: "0.78rem" }}>Loading profiles…</p>
          ) : sessionProfileRows.length === 0 ? (
            <p style={{ opacity: 0.35, fontSize: "0.78rem" }}>
              No extracted profiles yet. Profiles appear after a session ends and extraction runs
              (see project settings and persona <span style={{ fontFamily: "monospace" }}>profile_schema</span>
              ).
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {sessionProfileRows.map((row) => {
                const ext = row.profile.extraction
                const preview =
                  row.profile.core?.summary?.trim() ||
                  (ext.status === "failed"
                    ? `Extraction failed${"reason" in ext && ext.reason ? `: ${ext.reason}` : ""}`
                    : "No summary.")
                const expanded = profilesExpandedSessionId === row.session.id
                return (
                  <li
                    key={row.session.id}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      paddingBottom: "0.5rem",
                      marginBottom: "0.5rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: "0.75rem",
                        fontSize: "0.75rem",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setProfilesExpandedSessionId((prev) =>
                            prev === row.session.id ? null : row.session.id,
                          )
                        }
                        style={{
                          ...btn(expanded),
                          fontFamily: "monospace",
                          fontSize: "0.68rem",
                        }}
                      >
                        {row.session.session_id.slice(0, 14)}…
                      </button>
                      <Chip>{row.session.status}</Chip>
                      <Chip>
                        profile: {ext.status}
                      </Chip>
                      <span style={{ opacity: 0.3, fontSize: "0.68rem", marginLeft: "auto" }}>
                        {new Date(row.verdictCreatedAt).toLocaleString()}
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: "0.72rem",
                        opacity: 0.45,
                        margin: "0.35rem 0 0.5rem",
                        lineHeight: 1.35,
                        maxWidth: "42rem",
                      }}
                    >
                      {preview.length > 220 ? `${preview.slice(0, 220)}…` : preview}
                    </p>
                    <button
                      type="button"
                      style={{ ...btn(false), fontSize: "0.62rem", marginRight: "0.5rem" }}
                      onClick={() => {
                        setSelectedSessionId(row.session.id)
                        setProfilesExpandedSessionId(null)
                      }}
                    >
                      Open transcript
                    </button>
                    {expanded && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <ProfilePanel
                          profile={row.profile}
                          personaSchema={row.personaSchema}
                          canReveal={canOrgAdmin}
                          revealedKeys={profilesRevealedKeys}
                          onToggleReveal={(k) =>
                            setProfilesRevealedKeys((prev) => {
                              const next = new Set(prev)
                              if (next.has(k)) next.delete(k)
                              else next.add(k)
                              return next
                            })
                          }
                        />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {canOrgOwner && (
        <section style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "2rem" }}>
          <h2 style={{ ...label, marginBottom: "0.75rem", color: "#f87171" }}>DANGER</h2>
          <p style={{ fontSize: "0.78rem", opacity: 0.45, marginBottom: "1rem" }}>
            Deletes the organisation and all projects, keys, and sessions (cascade). Owners (or
            platform operators) only.
          </p>
          <input
            style={input}
            placeholder={`Type slug “${org.slug}” to confirm`}
            value={deleteSlug}
            onChange={(e) => setDeleteSlug(e.target.value)}
          />
          <button
            type="button"
            style={{ ...btn(false), marginTop: "0.75rem", borderColor: "rgba(248,113,113,0.5)", color: "#f87171" }}
            onClick={() => void deleteOrg()}
          >
            Delete organisation
          </button>
        </section>
      )}
    </div>
  )
}
