"use client"

import { useEffect, useState } from "react"
import type { ProjectConversationConfig, ProjectReplyStyle } from "@/lib/project-conversation-config"
import type { SignalEvidenceMap } from "@/lib/project-conversation-evidence"
import type { SignalTurn } from "@/lib/project-conversation-progress"
import { ConversationSignalEvidence, ConversationSignalTurn } from "./ConversationSignalEvidence"
import styles from "./conversation-project-wizard.module.css"

type PreviewSummary = {
  id: string
  created_at: string
  status: "active" | "completed"
  answer_count: number
}

type SavedPreview = PreviewSummary & {
  config: ProjectConversationConfig
  reply_style: ProjectReplyStyle | null
  transcript: { role: "user" | "assistant"; content: string; signalTurn?: SignalTurn }[]
  signal_evidence: SignalEvidenceMap | null
  settings_conflict: string | null
}

async function getSavedPreviews(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "Could not load saved previews.")
  return data
}

function previewDate(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp))
}

export function SavedConversationPreviews({ orgId, projectId, revision }: { orgId: string; projectId: string; revision: number }) {
  const url = `/api/admin/organisations/${orgId}/conversation-preview?projectId=${projectId}`
  const [previews, setPreviews] = useState<PreviewSummary[] | null>(null)
  const [selected, setSelected] = useState<SavedPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [page, setPage] = useState(0)
  const [hasOlder, setHasOlder] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    getSavedPreviews(`${url}&page=${page}`, controller.signal).then(
      data => { setPreviews(data.savedPreviews); setHasOlder(data.hasOlder); setError("") },
      error => { if (!controller.signal.aborted) setError(error.message) },
    )
    return () => controller.abort()
  }, [url, revision, page])

  function changePage(next: number) {
    setPreviews(null)
    setError("")
    setPage(next)
  }

  async function openPreview(id: string) {
    if (loading) return
    setLoading(true)
    setError("")
    try {
      const data = await getSavedPreviews(`${url}&previewId=${id}`)
      setSelected(data.savedPreview)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not open the saved preview.")
    } finally {
      setLoading(false)
    }
  }

  return <section aria-labelledby="saved-previews-heading">
    <h3 id="saved-previews-heading">Saved previews</h3>
    {error && <p role="alert">{error}</p>}
    {!previews && !error && <p>Loading saved previews…</p>}
    {previews?.length === 0 && <p>{page ? "No previews on this page." : "No saved previews yet."}</p>}
    {!!previews?.length && <ul>{previews.map(preview => <li key={preview.id}>
      <button type="button" disabled={loading} aria-pressed={selected?.id === preview.id} onClick={() => void openPreview(preview.id)}>
        {previewDate(preview.created_at)} · {preview.answer_count} {preview.answer_count === 1 ? "answer" : "answers"} · {preview.status === "completed" ? "Completed" : "In progress when saved"}
      </button>
    </li>)}</ul>}
    {page > 0 && <button type="button" disabled={!previews && !error} onClick={() => changePage(page - 1)}>Newer previews</button>}
    {hasOlder && <button type="button" disabled={!previews} onClick={() => changePage(page + 1)}>Older previews</button>}
    {loading && <p role="status">Opening saved preview…</p>}
    {selected && <section aria-labelledby="saved-preview-heading">
      <h4 id="saved-preview-heading">Preview from {previewDate(selected.created_at)}</h4>
      <p>{selected.reply_style === "direct" ? "Go straight to one question" : selected.reply_style === "acknowledge" ? "Acknowledge answers" : "Follow persona instructions"}</p>
      {selected.settings_conflict && <p>Possible settings conflict. {selected.settings_conflict}</p>}
      <details>
        <summary>Tested configuration</summary>
        <dl className={styles.summary}>
          <div><dt>Objective</dt><dd>{selected.config.intent}</dd></div>
          <div><dt>Persona</dt><dd>{selected.config.persona.name}<p>{selected.config.persona.instructions}</p></dd></div>
          {selected.config.version === 2 && <>
            <div><dt>Project context</dt><dd>{selected.config.projectContext || "None"}</dd></div>
            <div><dt>Conversation guidance</dt><dd>{selected.config.conversationGuidance || "None"}</dd></div>
            <div><dt>Closing</dt><dd>{selected.config.closingGuidance}<p>{selected.config.closingMessage}</p></dd></div>
          </>}
          <div><dt>Answer limit</dt><dd>{selected.config.maxAnswers}</dd></div>
        </dl>
        {selected.config.version === 2 && selected.config.signals.map(signal => <details key={signal.id}>
          <summary>{signal.name}</summary>
          <p>{signal.understanding}</p>
          <p>{signal.evidence}</p>
          <p>{signal.explore ? "Explore during the conversation" : "Listen for volunteered evidence"}</p>
          {signal.question && <p>{signal.question}</p>}
          {!!signal.options.length && <p>{signal.options.join(", ")}</p>}
          {!!signal.examples.length && <ul>{signal.examples.map((example, index) => <li key={index}>{example}</li>)}</ul>}
        </details>)}
      </details>
      <div className={styles.transcript} aria-label="Saved transcript">
        {selected.transcript.map((entry, index) => <article key={index} id={entry.role === "user" ? `saved-preview-answer-${selected.transcript.slice(0, index + 1).filter(item => item.role === "user").length}` : undefined}>
          <strong>{entry.role === "assistant" ? selected.config.persona.name : "Tester"}</strong><p>{entry.content}</p>
          {selected.config.version === 2 && <ConversationSignalTurn turn={entry.signalTurn} signals={selected.config.signals} hasQuestion={/[?？]/.test(entry.content)} />}
        </article>)}
      </div>
      {selected.config.version === 2 && <ConversationSignalEvidence signals={selected.config.signals} evidence={selected.signal_evidence ?? undefined} anchorPrefix="saved-preview" turns={selected.transcript.map(entry => entry.signalTurn)} completed={selected.status === "completed"} />}
    </section>}
  </section>
}
