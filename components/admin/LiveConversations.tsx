"use client"

import { useEffect, useState, useMemo, useCallback, useRef } from "react"
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase-browser"

type Score = {
  specificity: number
  authenticity: number
  cultural_depth: number
  overall: number
}

type Message = {
  id: string
  /** FK to `sessions.id` (internal row id). */
  session_id: string
  role: "user" | "assistant"
  content: string
  sent_at: string
  metadata: { scores?: Score } | null
}

type LiveSession = {
  id: string
  /** Client opaque key (`sessions.session_id`). */
  session_id: string
  status: "active" | "passed" | "failed" | "redirected" | "rejected"
  created_at: string
  updated_at: string
  applicant_email: string | null
  applicant_name: string | null
  messages: Message[]
  messagesLoaded: boolean
}

type ProjectOption = {
  id: string
  organisationId: string
  name: string
  organisationName: string
  activeSessions: number
}

type OverviewResponse = {
  organisations?: Array<{
    id: string
    name: string
    projects?: Array<{
      id: string
      name: string
      organisationId: string
      activeSessions: number
    }>
  }>
}

const STATUS_COLOR: Record<string, string> = {
  active: "#86efac",
  passed: "#4ade80",
  redirected: "#fb923c",
  rejected: "#f87171",
  failed: "rgba(255,255,255,0.2)",
}

const FILTERS = ["all", "active", "passed", "redirected", "rejected", "failed"] as const
const PROJECT_STORAGE_KEY = "groucho_admin_sessions_project"

function parseMetadata(raw: unknown): Message["metadata"] {
  if (!raw) return null
  if (typeof raw === "string") {
    try { return JSON.parse(raw) } catch { return null }
  }
  return raw as Message["metadata"]
}

export default function LiveConversations() {
  const supabase = useMemo(() => tryCreateSupabaseBrowserClient(), [])

  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [filter, setFilter] = useState<string>("all")
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [typingSessions, setTypingSessions] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const sessionRequest = useRef(0)

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )

  const loadProjectSessions = useCallback(async (project: ProjectOption) => {
    const requestId = ++sessionRequest.current
    const response = await fetch(
      `/api/admin/organisations/${project.organisationId}/projects/${project.id}/sessions`,
    )
    if (requestId !== sessionRequest.current) return
    if (!response.ok) {
      setSessions([])
      setLoadError("Could not load sessions for this project.")
      setLoading(false)
      return
    }
    const payload = (await response.json()) as {
      sessions?: Omit<LiveSession, "messages" | "messagesLoaded">[]
    }
    if (requestId !== sessionRequest.current) return
    const rows = payload.sessions ?? []
    setSessions((current) =>
      rows.map((row) => ({
        ...row,
        messages: current.find((session) => session.id === row.id)?.messages ?? [],
        messagesLoaded:
          current.find((session) => session.id === row.id)?.messagesLoaded ?? false,
      })),
    )
    setSelectedSessionId((current) => {
      if (current && rows.some((session) => session.id === current)) return current
      return (rows.find((session) => session.status === "active") ?? rows[0])?.id ?? null
    })
    setLoading(false)
  }, [])

  const load = useCallback(async () => {
    if (!selectedProject) {
      setSessions([])
      setLoading(false)
      return
    }
    await loadProjectSessions(selectedProject)
  }, [loadProjectSessions, selectedProject])

  useEffect(() => {
    let cancelled = false
    async function loadProjects() {
      setLoading(true)
      setLoadError(null)
      const response = await fetch("/api/admin/overview")
      if (!response.ok) {
        if (!cancelled) {
          setLoadError("Could not load your projects.")
          setLoading(false)
        }
        return
      }
      const payload = (await response.json()) as OverviewResponse
      const nextProjects = (payload.organisations ?? []).flatMap((organisation) =>
        (organisation.projects ?? []).map((project) => ({
          id: project.id,
          organisationId: project.organisationId || organisation.id,
          name: project.name,
          organisationName: organisation.name,
          activeSessions: project.activeSessions,
        })),
      )
      if (cancelled) return
      setProjects(nextProjects)
      const remembered = window.localStorage.getItem(PROJECT_STORAGE_KEY)
      const initial =
        nextProjects.find((project) => project.id === remembered) ??
        nextProjects.find((project) => project.activeSessions > 0) ??
        nextProjects[0]
      setSelectedProjectId(initial?.id ?? "")
      if (initial) {
        window.localStorage.setItem(PROJECT_STORAGE_KEY, initial.id)
        void loadProjectSessions(initial)
      } else {
        setLoading(false)
      }
    }
    void loadProjects()
    return () => {
      cancelled = true
    }
  }, [loadProjectSessions])

  // Auto-expire typing indicators after 3s of silence
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setTypingSessions((prev) => {
        const stale = Object.keys(prev).filter((sid) => now - prev[sid] > 3000)
        if (!stale.length) return prev
        const next = { ...prev }
        stale.forEach((sid) => delete next[sid])
        return next
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!supabase || !selectedProject) return

    const adminChannel = supabase
      .channel("admin-live")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sessions",
          filter: `project_id=eq.${selectedProject.id}`,
        },
        load
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `project_id=eq.${selectedProject.id}`,
        },
        ({ new: raw }) => {
          const updated = raw as Record<string, unknown>
          setSessions((prev) =>
            prev.map((c) =>
              c.id === updated.id
                ? { ...c, status: updated.status as LiveSession["status"], updated_at: updated.updated_at as string }
                : c
            )
          )
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        ({ new: raw }) => {
          const r = raw as Record<string, unknown>
          const newMsg: Message = {
            id: r.id as string,
            session_id: r.session_id as string,
            role: r.role as Message["role"],
            content: r.content as string,
            sent_at: r.sent_at as string,
            metadata: parseMetadata(r.metadata),
          }
          setSessions((prev) =>
            prev.map((c) =>
              c.id === newMsg.session_id
                ? {
                    ...c,
                    messages: c.messages.some((message) => message.id === newMsg.id)
                      ? c.messages
                      : [...c.messages, newMsg],
                  }
                : c
            )
          )
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        ({ new: raw }) => {
          const r = raw as Record<string, unknown>
          const updatedMsg: Message = {
            id: r.id as string,
            session_id: r.session_id as string,
            role: r.role as Message["role"],
            content: r.content as string,
            sent_at: r.sent_at as string,
            metadata: parseMetadata(r.metadata),
          }
          setSessions((prev) =>
            prev.map((c) =>
              c.id === updatedMsg.session_id
                ? { ...c, messages: c.messages.map((m) => m.id === updatedMsg.id ? updatedMsg : m) }
                : c
            )
          )
        }
      )
      .subscribe((status, err) => {
        if (err) console.error("[admin-live] error:", err)
        else console.log("[admin-live] status:", status)
      })

    const devPoll =
      process.env.NODE_ENV === "development"
        ? window.setInterval(() => {
            void load()
          }, 8000)
        : null

    const typingChannel = supabase
      .channel("pe-typing")
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        setTypingSessions((prev) => {
          if (payload.isTyping) {
            return { ...prev, [payload.sessionId]: Date.now() }
          } else {
            const next = { ...prev }
            delete next[payload.sessionId]
            return next
          }
        })
      })
      .subscribe()

    return () => {
      if (devPoll != null) window.clearInterval(devPoll)
      supabase.removeChannel(adminChannel)
      supabase.removeChannel(typingChannel)
    }
  }, [load, selectedProject, supabase])

  const stats = useMemo(() => {
    const total = sessions.length
    const passed = sessions.filter((c) => c.status === "passed").length
    const concluded = sessions.filter((c) =>
      ["passed", "redirected", "rejected"].includes(c.status)
    ).length
    const passRate =
      concluded > 0 ? Math.round((passed / concluded) * 100) : null

    const active = sessions.filter((session) => session.status === "active").length

    return { total, passRate, active }
  }, [sessions])

  const visible = useMemo(
    () =>
      sessions.filter((c) => {
        if (filter !== "all" && c.status !== filter) return false
        const q = search.toLowerCase()
        const contact = `${c.applicant_email ?? ""} ${c.applicant_name ?? ""}`.toLowerCase()
        if (
          search &&
          !c.session_id.toLowerCase().includes(q) &&
          !contact.includes(q)
        )
          return false
        return true
      }),
    [sessions, filter, search]
  )

  const selectedSession =
    visible.find((session) => session.id === selectedSessionId) ??
    visible.find((session) => session.status === "active") ??
    visible[0] ??
    null
  const transcriptSessionId = selectedSession?.id ?? null

  useEffect(() => {
    if (!selectedProject || !transcriptSessionId) return
    let cancelled = false
    const sessionId = transcriptSessionId
    async function loadTranscript() {
      setTranscriptLoading(true)
      const response = await fetch(
        `/api/admin/organisations/${selectedProject!.organisationId}/projects/${selectedProject!.id}/sessions/${sessionId}/messages`,
      )
      if (!response.ok) {
        if (!cancelled) {
          setLoadError("Could not load this session's transcript.")
          setTranscriptLoading(false)
        }
        return
      }
      const payload = (await response.json()) as { messages?: Omit<Message, "session_id">[] }
      if (cancelled) return
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                messages: (payload.messages ?? []).map((message) => ({
                  ...message,
                  session_id: sessionId,
                  metadata: parseMetadata(message.metadata),
                })),
                messagesLoaded: true,
              }
            : session,
        ),
      )
      setTranscriptLoading(false)
    }
    void loadTranscript()
    return () => {
      cancelled = true
    }
  }, [selectedProject, transcriptSessionId])
  const selectedIsTyping = selectedSession
    ? selectedSession.session_id in typingSessions
    : false
  const latestScores = selectedSession
    ? [...selectedSession.messages]
        .reverse()
        .find((message) => message.metadata?.scores)?.metadata?.scores ?? null
    : null

  function exportCSV() {
    const header = [
      "session_id",
      "status",
      "created_at",
      "applicant_email",
      "applicant_name",
      "message_count",
      "avg_overall_score",
    ]
    const rows = sessions.map((c) => {
      const scores = c.messages
        .filter((m) => m.metadata?.scores)
        .map((m) => m.metadata!.scores!.overall)
      const avg =
        scores.length > 0
          ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)
          : ""
      return [
        c.session_id,
        c.status,
        c.created_at,
        c.applicant_email ?? "",
        c.applicant_name ?? "",
        c.messages.length,
        avg,
      ]
    })
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "pe-sessions.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  function selectProject(projectId: string) {
    const project = projects.find((candidate) => candidate.id === projectId)
    setSelectedProjectId(projectId)
    setSelectedSessionId(null)
    setSessions([])
    setTranscriptLoading(false)
    setLoading(true)
    setLoadError(null)
    if (project) {
      window.localStorage.setItem(PROJECT_STORAGE_KEY, project.id)
      void loadProjectSessions(project)
    } else {
      setLoading(false)
    }
  }

  function refreshSessions() {
    setLoading(true)
    setLoadError(null)
    void load()
  }

  return (
    <div className="live-sessions" style={{ padding: "2rem", fontSize: "0.875rem" }}>
      <div className="project-toolbar">
        <label className="project-picker">
          <span>Project</span>
          <select
            value={selectedProjectId}
            onChange={(event) => selectProject(event.target.value)}
            disabled={projects.length === 0}
          >
            {projects.length === 0 ? <option value="">No accessible projects</option> : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.organisationName} / {project.name}
                {project.activeSessions > 0 ? ` · ${project.activeSessions} active` : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="project-context">
          {selectedProject ? (
            <>
              <span>{selectedProject.organisationName}</span>
              <strong>{selectedProject.name}</strong>
            </>
          ) : (
            <span>Select a project to browse its sessions.</span>
          )}
        </div>
        <button
          type="button"
          className="refresh-button"
          disabled={!selectedProject || loading}
          onClick={refreshSessions}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loadError ? <p className="load-error">{loadError}</p> : null}
      {!supabase ? (
        <p className="realtime-note">Sessions still load normally. Realtime updates are unavailable, so use Refresh to see new activity.</p>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        {[
          ["Sessions", stats.total],
          ["Pass rate", stats.passRate !== null ? `${stats.passRate}%` : "—"],
          ["Active now", stats.active],
        ].map(([label, value]) => (
          <div key={label} style={{ border: "1px solid rgba(255,255,255,0.1)", padding: "0.9rem 1rem" }}>
            <div style={{ opacity: 0.38, fontSize: "0.65rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
            <div style={{ marginTop: "0.35rem", fontFamily: "monospace", fontSize: "1.05rem", fontVariantNumeric: "tabular-nums" }}>{value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              background: "transparent",
              border:
                filter === f
                  ? "1px solid rgba(255,255,255,0.6)"
                  : "1px solid rgba(255,255,255,0.15)",
              color:
                filter === f ? "#fff" : "rgba(255,255,255,0.35)",
              minHeight: "2.5rem",
              padding: "0.45rem 0.7rem",
              cursor: "pointer",
              fontSize: "0.7rem",
              letterSpacing: "0.06em",
              fontFamily: "inherit",
            }}
          >
            {f}
          </button>
        ))}

        <input
          type="text"
          placeholder="search session id or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            background: "transparent",
            border: "none",
            borderBottom: "1px solid rgba(255,255,255,0.15)",
            color: "#fff",
            outline: "none",
            minHeight: "2.5rem",
            padding: "0.3rem 0.6rem",
            fontSize: "0.7rem",
            fontFamily: "monospace",
            width: "min(100%, 250px)",
            marginLeft: "0.5rem",
          }}
        />

        <button
          onClick={exportCSV}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "rgba(255,255,255,0.35)",
            minHeight: "2.5rem",
            padding: "0.45rem 0.7rem",
            cursor: "pointer",
            fontSize: "0.7rem",
            letterSpacing: "0.06em",
            fontFamily: "inherit",
          }}
        >
          export csv
        </button>
      </div>

      <div className="session-workspace">
        <section className="workspace-panel session-list" aria-label="Sessions">
          <div className="panel-heading">
            <span>Sessions</span>
            <span>{visible.length}</span>
          </div>
          <div className="session-list-scroll">
            {loading ? <div className="empty-state">Loading sessions…</div> : null}
            {!loading && visible.length === 0 ? (
              <div className="empty-state">
                {sessions.length === 0
                  ? "No sessions have been recorded for this project."
                  : "No sessions match these filters."}
              </div>
            ) : null}
            {visible.map((session) => {
              const selected = session.id === selectedSession?.id
              const isTyping = session.session_id in typingSessions
              return (
                <button
                  type="button"
                  key={session.id}
                  onClick={() => setSelectedSessionId(session.id)}
                  aria-pressed={selected}
                  className={`session-row${selected ? " selected" : ""}`}
                >
                  <span className="session-row-top">
                    <span className="session-name">{session.applicant_name || session.applicant_email || session.session_id.slice(0, 8)}</span>
                    <span className="session-count">
                      {session.messagesLoaded ? `${session.messages.length} messages` : ""}
                    </span>
                  </span>
                  <span className="session-row-bottom">
                    <span style={{ color: STATUS_COLOR[session.status] ?? "#fff" }}>● {session.status}</span>
                    {isTyping ? <span className="typing">typing…</span> : null}
                    <span>{new Date(session.updated_at).toLocaleDateString()}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="workspace-panel transcript" aria-label="Selected session transcript">
          <div className="panel-heading">
            <span>{selectedSession ? selectedSession.applicant_name || "Conversation" : "Conversation"}</span>
            {selectedSession ? <span>{selectedSession.session_id.slice(0, 8)}</span> : null}
          </div>
          <div className="transcript-scroll">
            {!selectedSession ? <div className="empty-state">Select a session to read it.</div> : null}
            {transcriptLoading ? <div className="empty-state">Loading conversation…</div> : null}
            {!transcriptLoading && selectedSession?.messagesLoaded && selectedSession.messages.length === 0 ? (
              <div className="empty-state">This session has no messages yet.</div>
            ) : null}
            {selectedSession?.messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <div className="message-meta">
                  <span>{message.role === "assistant" ? "Groucho" : "Applicant"}</span>
                  <time>{new Date(message.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                </div>
                <div className="message-content">{message.content}</div>
              </article>
            ))}
            {selectedIsTyping ? <div className="typing-line">Applicant is typing…</div> : null}
          </div>
        </section>

        <aside className="workspace-panel details" aria-label="Session details">
          <div className="panel-heading"><span>Session details</span></div>
          {selectedSession ? (
            <div className="details-content">
              <div className="live-state" style={{ color: STATUS_COLOR[selectedSession.status] }}>
                <span className="live-dot" /> {selectedSession.status}
              </div>
              <dl className="details-list">
                <div><dt>Applicant</dt><dd>{selectedSession.applicant_name || "Not provided"}</dd></div>
                <div><dt>Email</dt><dd>{selectedSession.applicant_email || "Not provided"}</dd></div>
                <div><dt>Started</dt><dd>{new Date(selectedSession.created_at).toLocaleString()}</dd></div>
                <div><dt>Last activity</dt><dd>{new Date(selectedSession.updated_at).toLocaleString()}</dd></div>
                <div><dt>Messages</dt><dd>{selectedSession.messagesLoaded ? selectedSession.messages.length : "Loading…"}</dd></div>
              </dl>
              <div className="score-block">
                <div className="score-heading">Latest signal scores</div>
                {latestScores ? (
                  <dl className="score-grid">
                    <div><dt>Specificity</dt><dd>{latestScores.specificity.toFixed(2)}</dd></div>
                    <div><dt>Authenticity</dt><dd>{latestScores.authenticity.toFixed(2)}</dd></div>
                    <div><dt>Cultural depth</dt><dd>{latestScores.cultural_depth.toFixed(2)}</dd></div>
                    <div><dt>Overall</dt><dd>{latestScores.overall.toFixed(2)}</dd></div>
                  </dl>
                ) : <div className="muted">No scores recorded yet.</div>}
              </div>
            </div>
          ) : <div className="empty-state">No session selected.</div>}
        </aside>
      </div>
      <style jsx>{`
        .live-sessions { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .project-toolbar { display: grid; grid-template-columns: minmax(17rem, .8fr) minmax(14rem, 1fr) auto; align-items: end; gap: 1rem; margin-bottom: 1rem; padding: 1rem; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.025); }
        .project-picker { display: flex; flex-direction: column; gap: .45rem; color: rgba(255,255,255,.42); font-size: .65rem; letter-spacing: .1em; text-transform: uppercase; }
        .project-picker select { width: 100%; min-height: 2.75rem; padding: 0 .75rem; border: 1px solid rgba(255,255,255,.18); border-radius: 0; background: #151515; color: #fff; font: .78rem system-ui, sans-serif; color-scheme: dark; }
        .project-context { display: flex; flex-direction: column; gap: .2rem; padding-bottom: .2rem; color: rgba(255,255,255,.38); font-size: .68rem; }
        .project-context strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255,255,255,.86); font-size: .9rem; font-weight: 500; }
        .refresh-button { min-height: 2.75rem; padding: 0 .9rem; border: 1px solid rgba(255,255,255,.18); background: transparent; color: rgba(255,255,255,.65); cursor: pointer; transition: border-color 120ms ease, color 120ms ease; }
        .refresh-button:hover:not(:disabled) { border-color: rgba(255,255,255,.45); color: #fff; }
        .refresh-button:disabled { cursor: not-allowed; opacity: .35; }
        .load-error, .realtime-note { margin: 0 0 1rem; padding: .75rem 1rem; border: 1px solid rgba(248,113,113,.35); color: #fca5a5; font-size: .75rem; }
        .realtime-note { border-color: rgba(255,255,255,.1); color: rgba(255,255,255,.42); }
        .session-workspace { display: grid; grid-template-columns: minmax(16rem, .78fr) minmax(24rem, 1.5fr) minmax(16rem, .82fr); border: 1px solid rgba(255,255,255,.1); min-height: min(68vh, 50rem); }
        .workspace-panel { min-width: 0; }
        .workspace-panel + .workspace-panel { border-left: 1px solid rgba(255,255,255,.1); }
        .panel-heading { min-height: 3.25rem; padding: 0 1rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,.1); color: rgba(255,255,255,.44); font-size: .67rem; letter-spacing: .1em; text-transform: uppercase; }
        .session-list-scroll, .transcript-scroll { max-height: min(68vh, 50rem); overflow-y: auto; }
        .session-row { width: 100%; min-height: 4.5rem; padding: .85rem 1rem; display: flex; flex-direction: column; gap: .5rem; border: 0; border-bottom: 1px solid rgba(255,255,255,.065); border-left: 2px solid transparent; background: transparent; color: #fff; text-align: left; cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease; }
        .session-row:hover { background: rgba(255,255,255,.035); }
        .session-row.selected { background: rgba(255,255,255,.075); border-left-color: #fff; }
        .session-row-top, .session-row-bottom { display: flex; align-items: center; gap: .65rem; width: 100%; }
        .session-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .78rem; }
        .session-count { margin-left: auto; color: rgba(255,255,255,.34); font: .68rem monospace; }
        .session-row-bottom { color: rgba(255,255,255,.34); font: .64rem monospace; text-transform: uppercase; letter-spacing: .04em; }
        .session-row-bottom > :last-child { margin-left: auto; }
        .typing, .typing-line { color: #86efac; }
        .transcript-scroll { padding: 1rem; }
        .message { margin-bottom: 1.2rem; max-width: 92%; }
        .message.user { margin-left: auto; }
        .message-meta { display: flex; justify-content: space-between; gap: 1rem; margin-bottom: .35rem; color: rgba(255,255,255,.32); font: .63rem monospace; text-transform: uppercase; letter-spacing: .06em; }
        .message-content { padding: .75rem .85rem; border: 1px solid rgba(255,255,255,.08); color: rgba(255,255,255,.7); line-height: 1.55; white-space: pre-wrap; }
        .message.user .message-content { background: rgba(255,255,255,.07); color: #fff; }
        .typing-line { padding: .75rem; font: .7rem monospace; }
        .details-content { padding: 1rem; }
        .live-state { display: flex; align-items: center; gap: .45rem; margin-bottom: 1.25rem; font: .7rem monospace; text-transform: uppercase; letter-spacing: .08em; }
        .live-dot { width: .45rem; height: .45rem; border-radius: 50%; background: currentColor; }
        .details-list, .score-grid { margin: 0; }
        .details-list > div { padding: .7rem 0; border-bottom: 1px solid rgba(255,255,255,.065); }
        dt { color: rgba(255,255,255,.34); font-size: .65rem; text-transform: uppercase; letter-spacing: .07em; }
        dd { margin: .25rem 0 0; overflow-wrap: anywhere; color: rgba(255,255,255,.8); font-size: .75rem; line-height: 1.45; font-variant-numeric: tabular-nums; }
        .score-block { margin-top: 1.5rem; }
        .score-heading { margin-bottom: .75rem; color: rgba(255,255,255,.44); font-size: .67rem; letter-spacing: .1em; text-transform: uppercase; }
        .score-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: .5rem; }
        .score-grid > div { padding: .65rem; background: rgba(255,255,255,.035); }
        .empty-state, .muted { padding: 1.25rem; color: rgba(255,255,255,.3); font-size: .75rem; }
        .muted { padding: 0; }
        @media (max-width: 1100px) { .session-workspace { grid-template-columns: minmax(15rem, .8fr) minmax(22rem, 1.4fr); } .details { grid-column: 1 / -1; border-left: 0 !important; border-top: 1px solid rgba(255,255,255,.1); } .details-content { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 1.25rem; } }
        @media (max-width: 720px) { .live-sessions { padding: 1rem !important; } .project-toolbar { grid-template-columns: 1fr; align-items: stretch; } .session-workspace { display: block; } .workspace-panel + .workspace-panel { border-left: 0; border-top: 1px solid rgba(255,255,255,.1); } .session-list-scroll { max-height: 18rem; } .transcript-scroll { max-height: 34rem; } .details-content { display: block; } }
      `}</style>
    </div>
  )
}
