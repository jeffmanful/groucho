"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
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
  messages: Message[]
}

const STATUS_COLOR: Record<string, string> = {
  active: "rgba(255,255,255,0.4)",
  passed: "#4ade80",
  redirected: "#fb923c",
  rejected: "#f87171",
  failed: "rgba(255,255,255,0.2)",
}

const FILTERS = ["all", "active", "passed", "redirected", "rejected", "failed"] as const

function parseMetadata(raw: unknown): Message["metadata"] {
  if (!raw) return null
  if (typeof raw === "string") {
    try { return JSON.parse(raw) } catch { return null }
  }
  return raw as Message["metadata"]
}

export default function LiveConversations() {
  const supabase = useMemo(() => tryCreateSupabaseBrowserClient(), [])

  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [filter, setFilter] = useState<string>("all")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [typingSessions, setTypingSessions] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    if (!supabase) {
      setSessions([])
      return
    }
    const { data: convs } = await supabase
      .from("sessions")
      .select("id, session_id, status, created_at, updated_at")
      .order("created_at", { ascending: false })

    if (!convs?.length) {
      setSessions([])
      return
    }

    const { data: msgs } = await supabase
      .from("messages")
      .select("id, session_id, role, content, sent_at, metadata")
      .in(
        "session_id",
        convs.map((c) => c.id)
      )
      .order("sent_at", { ascending: true })

    const bySession = (msgs ?? []).reduce<Record<string, Message[]>>((acc, m) => {
      ;(acc[m.session_id] ??= []).push(m)
      return acc
    }, {})

    setSessions(
      convs.map((c) => ({ ...c, messages: bySession[c.id] ?? [] }))
    )
  }, [supabase])

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
    if (!supabase) return

    load()

    const adminChannel = supabase
      .channel("admin-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sessions" },
        load
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sessions" },
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
                ? { ...c, messages: [...c.messages, newMsg] }
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
      supabase.removeChannel(adminChannel)
      supabase.removeChannel(typingChannel)
    }
  }, [load, supabase])

  const stats = useMemo(() => {
    const total = sessions.length
    const passed = sessions.filter((c) => c.status === "passed").length
    const concluded = sessions.filter((c) =>
      ["passed", "redirected", "rejected"].includes(c.status)
    ).length
    const passRate =
      concluded > 0 ? Math.round((passed / concluded) * 100) : null

    const allOverall = sessions.flatMap((c) =>
      c.messages
        .filter((m) => m.metadata?.scores)
        .map((m) => m.metadata!.scores!.overall)
    )
    const avgScore =
      allOverall.length > 0
        ? (allOverall.reduce((a, b) => a + b, 0) / allOverall.length).toFixed(
            2
          )
        : null

    return { total, passRate, avgScore }
  }, [sessions])

  const visible = useMemo(
    () =>
      sessions.filter((c) => {
        if (filter !== "all" && c.status !== filter) return false
        if (search && !c.session_id.toLowerCase().includes(search.toLowerCase()))
          return false
        return true
      }),
    [sessions, filter, search]
  )

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function exportCSV() {
    const header = [
      "session_id",
      "status",
      "created_at",
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
      return [c.session_id, c.status, c.created_at, c.messages.length, avg]
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

  return (
    <div
      style={{
        padding: "2rem",
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: "0.875rem",
      }}
    >
      {!supabase ? (
        <p
          style={{
            marginBottom: "1.5rem",
            padding: "0.75rem 1rem",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "rgba(255,255,255,0.65)",
            fontSize: "0.8rem",
          }}
        >
          Supabase is not configured (missing{" "}
          <code style={{ opacity: 0.9 }}>NEXT_PUBLIC_SUPABASE_URL</code> or{" "}
          <code style={{ opacity: 0.9 }}>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>). Live
          sessions and realtime updates are disabled until env is set.
        </p>
      ) : null}

      {/* Stats */}
      <div
        style={{
          display: "flex",
          gap: "3rem",
          marginBottom: "2rem",
          opacity: 0.4,
          fontSize: "0.8rem",
          fontFamily: "monospace",
        }}
      >
        <span>sessions: {stats.total}</span>
        <span>pass rate: {stats.passRate !== null ? `${stats.passRate}%` : "—"}</span>
        <span>avg score: {stats.avgScore ?? "—"}</span>
      </div>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1.5rem",
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
              padding: "0.2rem 0.65rem",
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
          placeholder="search session id"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            background: "transparent",
            border: "none",
            borderBottom: "1px solid rgba(255,255,255,0.15)",
            color: "#fff",
            outline: "none",
            padding: "0.2rem 0",
            fontSize: "0.7rem",
            fontFamily: "monospace",
            width: "220px",
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
            padding: "0.2rem 0.65rem",
            cursor: "pointer",
            fontSize: "0.7rem",
            letterSpacing: "0.06em",
            fontFamily: "inherit",
          }}
        >
          export csv
        </button>
      </div>

      {/* List */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {visible.length === 0 && (
          <div style={{ opacity: 0.2, fontSize: "0.8rem" }}>
            No sessions.
          </div>
        )}

        {visible.map((conv) => {
          const isOpen = expanded.has(conv.id)
          const isTyping = conv.session_id in typingSessions
          return (
            <div
              key={conv.id}
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            >
              {/* Row */}
              <div
                onClick={() => toggle(conv.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "1.25rem",
                  padding: "0.65rem 0",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: "0.75rem",
                    opacity: 0.5,
                    userSelect: "none",
                  }}
                >
                  {conv.session_id.slice(0, 8)}
                </span>

                <span
                  style={{
                    fontSize: "0.7rem",
                    letterSpacing: "0.05em",
                    color: STATUS_COLOR[conv.status] ?? "#fff",
                  }}
                >
                  {conv.status}
                </span>

                {isTyping && (
                  <span
                    style={{
                      fontSize: "0.65rem",
                      fontFamily: "monospace",
                      opacity: 0.4,
                      letterSpacing: "0.08em",
                    }}
                  >
                    typing...
                  </span>
                )}

                <span
                  style={{
                    marginLeft: "auto",
                    opacity: 0.25,
                    fontSize: "0.7rem",
                    fontFamily: "monospace",
                  }}
                >
                  {new Date(conv.created_at).toLocaleString()}
                </span>

                <span
                  style={{
                    opacity: 0.2,
                    fontSize: "0.7rem",
                    fontFamily: "monospace",
                    width: "4ch",
                    textAlign: "right",
                  }}
                >
                  {conv.messages.length}m
                </span>

                <span style={{ opacity: 0.2, fontSize: "0.7rem", width: "1ch" }}>
                  {isOpen ? "↑" : "↓"}
                </span>
              </div>

              {/* Messages */}
              {isOpen && (
                <div
                  style={{
                    paddingBottom: "1.25rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.8rem",
                  }}
                >
                  {conv.messages.length === 0 && (
                    <div style={{ opacity: 0.2, fontSize: "0.75rem", paddingLeft: "5rem" }}>
                      no messages
                    </div>
                  )}
                  {conv.messages.map((msg) => (
                    <div
                      key={msg.id}
                      style={{
                        display: "flex",
                        gap: "1.5rem",
                        alignItems: "flex-start",
                        paddingLeft: "1rem",
                      }}
                    >
                      <span
                        style={{
                          opacity: 0.3,
                          fontSize: "0.7rem",
                          fontFamily: "monospace",
                          width: "3.5rem",
                          flexShrink: 0,
                          paddingTop: "0.1rem",
                        }}
                      >
                        {msg.role === "assistant" ? "lou" : "user"}
                      </span>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            opacity: msg.role === "assistant" ? 0.55 : 1,
                            lineHeight: 1.5,
                          }}
                        >
                          {msg.content}
                        </div>

                        {msg.metadata?.scores && (
                          <div
                            style={{
                              marginTop: "0.35rem",
                              display: "flex",
                              gap: "1.5rem",
                              opacity: 0.35,
                              fontSize: "0.68rem",
                              fontFamily: "monospace",
                            }}
                          >
                            <span>
                              spec {msg.metadata.scores.specificity.toFixed(2)}
                            </span>
                            <span>
                              auth {msg.metadata.scores.authenticity.toFixed(2)}
                            </span>
                            <span>
                              depth{" "}
                              {msg.metadata.scores.cultural_depth.toFixed(2)}
                            </span>
                            <span style={{ opacity: 2 }}>
                              overall {msg.metadata.scores.overall.toFixed(2)}
                            </span>
                          </div>
                        )}
                      </div>

                      <span
                        style={{
                          opacity: 0.18,
                          fontSize: "0.68rem",
                          fontFamily: "monospace",
                          flexShrink: 0,
                        }}
                      >
                        {new Date(msg.sent_at).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}

                  {isTyping && (
                    <div
                      style={{
                        display: "flex",
                        gap: "1.5rem",
                        alignItems: "flex-start",
                        paddingLeft: "1rem",
                      }}
                    >
                      <span
                        style={{
                          opacity: 0.3,
                          fontSize: "0.7rem",
                          fontFamily: "monospace",
                          width: "3.5rem",
                          flexShrink: 0,
                        }}
                      >
                        user
                      </span>
                      <span
                        style={{
                          opacity: 0.3,
                          fontSize: "0.75rem",
                          fontFamily: "monospace",
                          letterSpacing: "0.1em",
                        }}
                      >
                        ···
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
