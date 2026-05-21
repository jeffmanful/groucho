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

function createDoorcheckSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  const realtimeKey = process.env.NEXT_PUBLIC_SUPABASE_REALTIME_KEY?.trim()
  if (!url || !anon) return null
  return createClient(url, anon, {
    realtime: {
      params: { apikey: realtimeKey || anon },
    },
  })
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
}

const INITIAL_MESSAGES: Message[] = [
  { id: "initial-hi", role: "bot", content: "Hi." },
]

const SESSION_KEY = "pe_session_id"
const SECRET_KEY = "pe_session_secret"
const PROJECT_KEY = "pe_project_id"

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

export default function DoorCheck() {
  const supabase = useMemo(() => createDoorcheckSupabase(), [])
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [concluded, setConcluded] = useState(false)
  const [sessionId, setSessionId] = useState("")
  const [personas, setPersonas] = useState<PersonaOption[]>([])
  const [selectedPersonaId, setSelectedPersonaId] = useState("")
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [signingOut, setSigningOut] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const typingChannelRef = useRef<ReturnType<SupabaseClient["channel"]> | null>(
    null,
  )
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Bot reply is committed after the thinking row exits so layout doesn’t stack two tails */
  const assistantHandoffRef = useRef<Message | null>(null)
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
  }, [messages, loading, scrollToBottom])

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
        const pick =
          (saved && data.some((p) => p.id === saved) ? saved : null) ??
          data[0]?.id ??
          ""
        if (pick) setSelectedProjectId(pick)
      })
      .catch(() => {})
  }, [])

  function applyProjectSelection(projectId: string) {
    setSelectedProjectId(projectId)
    localStorage.setItem(PROJECT_KEY, projectId)
    const newId = resetSession()
    setSessionId(newId)
    assistantHandoffRef.current = null
    setMessages(INITIAL_MESSAGES)
    setInput("")
    setConcluded(false)
  }

  useEffect(() => {
    if (!sessionId || !supabase) return
    const ch = supabase.channel("pe-typing")
    ch.subscribe()
    typingChannelRef.current = ch
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      supabase.removeChannel(ch)
      typingChannelRef.current = null
    }
  }, [sessionId, supabase])

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

  async function submit() {
    const text = input.trim()
    if (!text || loading || concluded || !sessionId) return

    broadcastTyping(false)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)

    const userId = crypto.randomUUID()
    setMessages((prev) => [...prev, { id: userId, role: "user", content: text }])
    setInput("")
    setLoading(true)

    try {
      const personaId = selectedPersonaId || undefined
      const projectId = selectedProjectId || undefined
      let res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message: text, sessionId, personaId, projectId }),
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
          }),
        })
      }

      if (!res.ok) throw new Error(`${res.status}`)

      const data = await res.json()
      assistantHandoffRef.current = {
        id: crypto.randomUUID(),
        role: "bot",
        content: data.message,
      }

      if (data.status === "passed") {
        setConcluded(true)
        if (data.secret) localStorage.setItem(SECRET_KEY, data.secret)
        setTimeout(
          () => router.push(`/doorcheck/access?sid=${sessionId}`),
          1400,
        )
      } else if (data.status === "redirected" || data.status === "rejected") {
        setConcluded(true)
      }
    } catch {
      assistantHandoffRef.current = {
        id: crypto.randomUUID(),
        role: "bot",
        content: "Something went wrong.",
      }
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      submit()
    }
  }

  function restart() {
    const newId = resetSession()
    localStorage.removeItem(SECRET_KEY)
    assistantHandoffRef.current = null
    setSessionId(newId)
    setMessages(INITIAL_MESSAGES)
    setInput("")
    setConcluded(false)
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
          aria-busy={loading}
          aria-live="polite"
        >
          <div className="mt-auto flex flex-col gap-5 pb-6">
            {messages.map((msg) => (
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
            ))}

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

            <div ref={bottomRef} className="h-8 w-full shrink-0" aria-hidden />
          </div>
        </div>

        {concluded && (
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

        {!concluded && (
          <motion.div
            className="mx-auto w-[80%] max-w-[1040px] shrink-0 pt-4 pb-20"
            animate={{ opacity: loading ? 0.72 : 1 }}
            transition={{ duration: 0.22 }}
          >
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                autoFocus
                disabled={loading}
                placeholder="Type your message"
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
    </MotionConfig>
  )
}
