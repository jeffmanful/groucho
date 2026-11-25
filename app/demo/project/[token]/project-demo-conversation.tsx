"use client"

import { useRef, useState } from "react"
import { COLORS_THIN_STREAM_CONTENT_TYPE, readColorsThinStream } from "@/lib/colors-thin-stream"
import type { GrouchoInteractionSpec } from "@/lib/gatekeeper-interaction-spec"
import styles from "@/app/demos/demos.module.css"
import conversationStyles from "./project-demo.module.css"

type Message = { role: "user" | "assistant"; content: string }
type Run = { run: string; status: "active" | "completed"; ui?: GrouchoInteractionSpec; message: string; completion?: string }

export function ProjectDemoConversation({ token, title, host }: {
  token: string; title: string; host: string
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [run, setRun] = useState<Run | null>(null)
  const [answer, setAnswer] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [pending, setPending] = useState<{ answer: string; reply: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const inFlight = useRef(false)
  const answerField = useRef<HTMLTextAreaElement>(null)

  async function request(message?: string) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError("")
    const display = selected.length && message === JSON.stringify(selected) ? selected.join(", ") : message
    if (display) setPending({ answer: display, reply: "" })
    try {
      const response = await fetch("/api/demo/project", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: `${COLORS_THIN_STREAM_CONTENT_TYPE}, application/json`,
          "x-groucho-project-demo": token,
        },
        body: JSON.stringify(message ? { action: "message", run: run?.run, message } : { action: "start" }),
      })
      const result = response.headers.get("content-type")?.includes(COLORS_THIN_STREAM_CONTENT_TYPE)
        ? await readColorsThinStream(response, reply => setPending(current => current && { ...current, reply }))
        : { status: response.status, body: await response.json() }
      const body = result.body as Run & { error?: string }
      if (result.status >= 400) throw new Error(body.error ?? "Demo is unavailable. Please retry.")
      setRun(body)
      setMessages(previous => [
        ...(display ? [...previous, { role: "user" as const, content: display }] : []),
        { role: "assistant", content: body.message },
      ])
      setAnswer("")
      setSelected([])
      if (body.status === "active") requestAnimationFrame(() => answerField.current?.focus())
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Demo is unavailable. Please retry.")
    } finally {
      setBusy(false)
      setPending(null)
      inFlight.current = false
    }
  }

  return <main className={`${styles.page} ${conversationStyles.page}`}>
    <h1>{title}</h1>
    {messages.length > 0 && <div className={conversationStyles.transcript} role="log" aria-label="Demo conversation">
      {messages.map((message, index) => <article key={index}>
        <strong>{message.role === "assistant" ? host : "You"}</strong>
        <p>{message.content}</p>
      </article>)}
      {pending && <>
        <article><strong>You</strong><p>{pending.answer}</p></article>
        {pending.reply && <article aria-busy="true"><strong>{host}</strong><p>{pending.reply}</p></article>}
      </>}
    </div>}
    {error && <p role="alert">{error}</p>}
    {busy && !pending?.reply && <p role="status">Preparing response…</p>}
    {run?.status === "active" && <form onSubmit={event => {
      event.preventDefault()
      if (answer.trim() || selected.length) void request(answer.trim() || JSON.stringify(selected))
    }}>
      <fieldset disabled={busy} className={conversationStyles.fields}>
        {run.ui?.options?.length ? <div className={conversationStyles.choices} role="group" aria-label="Answer choices">
          {run.ui.options.map(option => run.ui?.inputType === "multiSelect"
            ? <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={event => {
              const checked = event.target.checked
              setSelected(current => checked ? [...current, option] : current.filter(item => item !== option))
            }} /> {option}</label>
            : <button key={option} type="button" className={styles.button} onClick={() => void request(option)}>{option}</button>)}
        </div> : null}
        <label htmlFor="demo-answer">Your answer</label>
        <textarea ref={answerField} id="demo-answer" value={answer} onChange={event => setAnswer(event.target.value)} rows={3} maxLength={4000} />
        <button className={styles.button} type="submit" disabled={!answer.trim() && !selected.length}>Send answer</button>
      </fieldset>
    </form>}
    {run?.status === "completed" && <p role="status">{run.completion ?? "Demo complete."}</p>}
    <button className={styles.button} type="button" disabled={busy} onClick={() => void request()}>
      {run ? "Start over" : "Start demo"}
    </button>
  </main>
}
