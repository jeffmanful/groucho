"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { DEFAULT_SIGNAL_CONVERSATION, DEFAULT_PROJECT_CLOSING_MESSAGE, projectOpeningQuestion, upgradeProjectConversation, validateProjectConversation, projectConversationSettings, type ProjectConversationConfig, type SignalProjectConversationConfig } from "@/lib/project-conversation-config"
import { slugify, isValidProjectSlug } from "@/components/admin/project-setup-ui"
import { useOrganisationSummary } from "@/components/admin/dashboard/OrganisationSummaryContext"
import { ConversationSignalEditor } from "./ConversationSignalEditor"
import { ConversationSignalEvidence } from "./ConversationSignalEvidence"
import type { SignalEvidenceMap } from "@/lib/project-conversation-evidence"
import styles from "./conversation-project-wizard.module.css"

type Preview = {
  token: string
  status: "active" | "completed"
  ui?: { inputType?: string; options?: string[] }
  details?: Record<string, string>
  signalEvidence?: SignalEvidenceMap
  completion?: { complete: boolean; message: string }
  settingsConflict?: string
}
type Props = {
  orgId: string
  project?: { id: string; name: string; slug: string; config: ProjectConversationConfig }
  onAdvanced?: () => void
}
async function readResponse(response: Response) {
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please retry.")
  return result
}
export function ConversationProjectWizard({ orgId, project, onAdvanced }: Props) {
  const router = useRouter()
  const { refresh: refreshOrganisation } = useOrganisationSummary()
  const [step, setStep] = useState(0)
  const [name, setName] = useState(project?.name ?? "")
  const [slug, setSlug] = useState(project?.slug ?? "")
  const [manualSlug, setManualSlug] = useState(!!project)
  const [config, setConfig] = useState<SignalProjectConversationConfig>(() => {
    const draft = project ? upgradeProjectConversation(project.config) : DEFAULT_SIGNAL_CONVERSATION
    return { ...draft, openingQuestion: project ? projectOpeningQuestion(draft) : "What brings you here?" }
  })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [testedConfig, setTestedConfig] = useState("")
  const [transcript, setTranscript] = useState<Array<{ role: string; content: string }>>([])
  const [answer, setAnswer] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [savedId, setSavedId] = useState(project?.id ?? "")
  const requestInFlight = useRef(false)
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])
  const validated = validateProjectConversation(config)
  const currentConfig = validated.ok ? JSON.stringify(validated.config) : ""
  const previewConfig: SignalProjectConversationConfig = testedConfig ? JSON.parse(testedConfig) : config
  const stale = !!preview && currentConfig !== testedConfig
  const patch = (value: Partial<SignalProjectConversationConfig>) => { setConfig(previous => ({ ...previous, ...value })); setError("") }
  function next() {
    setError("")
    if (step === 0 && (name.trim().length < 2 || name.trim().length > 64 || !isValidProjectSlug(slug))) {
      setError("Use a project name of 2–64 characters and a slug of 2–31 lowercase letters, numbers or hyphens."); return
    }
    // Validate only controls reached so far; later steps may still contain unfinished drafts.
    const stepValidation = validateProjectConversation({
      ...config,
      ...(step < 1 ? { persona: DEFAULT_SIGNAL_CONVERSATION.persona } : {}),
      ...(step < 2 ? { openingMessage: "", openingQuestion: "", maxAnswers: 8, conversationGuidance: undefined, closingGuidance: undefined, closingMessage: undefined } : {}),
      ...(step < 3 ? { signals: [] } : {}),
    })
    if (!stepValidation.ok) { setError(stepValidation.error); return }
    setStep(previous => previous + 1)
  }
  async function startPreview() {
    if (!validated.ok) { setError(validated.error); return }
    if (requestInFlight.current) return
    requestInFlight.current = true; setBusy(true); setError("")
    const snapshot = validated.config
    try {
      const data = await readResponse(await fetch(`/api/admin/organisations/${orgId}/conversation-preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", config: snapshot }),
      }))
      setPreview(data); setTestedConfig(JSON.stringify(snapshot)); setTranscript([{ role: "assistant", content: data.message }]); setAnswer(""); setSelected([])
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start preview.") }
    finally { requestInFlight.current = false; setBusy(false) }
  }
  async function send(message: string) {
    if (!preview || stale || requestInFlight.current || !message.trim()) return
    requestInFlight.current = true; setBusy(true); setError("")
    try {
      const data = await readResponse(await fetch(`/api/admin/organisations/${orgId}/conversation-preview`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "message", token: preview.token, message }),
      }))
      const display = preview.ui?.inputType === "multiSelect" && selected.length ? selected.join(", ") : message
      setTranscript(previous => [...previous, { role: "user", content: display }, { role: "assistant", content: data.message }])
      setPreview({ ...data, settingsConflict: data.settingsConflict ?? preview.settingsConflict }); setAnswer(""); setSelected([])
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send your answer.") }
    finally { requestInFlight.current = false; setBusy(false) }
  }
  async function save() {
    if (!validated.ok || !preview || stale || requestInFlight.current) return
    setSaving(true); setError("")
    try {
      const response = await fetch(`/api/admin/organisations/${orgId}/projects${savedId ? `/${savedId}` : ""}`, {
        method: savedId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), slug, settings: {
          ...projectConversationSettings(validated.config),
          ...(!savedId ? { environment: "test", session_mode: "dry-run" } : {}),
        } }),
      })
      const data = await readResponse(response)
      setSavedId(data.id)
      refreshOrganisation()
      router.push(`/admin/organisations/${orgId}/projects/${data.id}`)
      router.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the project."); setSaving(false) }
  }
  return (
    <main className={styles.wizard}>
      <Link href={`/admin/organisations/${orgId}/projects`}>Projects</Link>
      <header><h1>{project ? "Configure conversation" : "Create a conversation"}</h1><p>Define its purpose and character, then try the exact flow your visitors will use.</p></header>
      {config.applicationReview && <p>Application reporting and integrations remain enabled for saved conversations. This preview tests the conversation without creating an application or sending webhooks. Changes apply to new conversations; conversations already in progress keep their original configuration.</p>}
      <nav aria-label="Project setup" className={styles.steps}>
        {["Purpose & context", "Persona", "Conversation flow", "Signals & examples", "Test & save"].map((label, index) => <button key={label} type="button" aria-current={step === index ? "step" : undefined} disabled={busy || saving || index > step} onClick={() => { setStep(index); setError("") }}>{label}</button>)}
      </nav>
      {error && <p role="alert" ref={errorRef} tabIndex={-1} className={styles.error}>{error}</p>}
      <fieldset disabled={busy || saving} className={styles.fields}>
        {step === 0 && <section>
          <h2>Purpose &amp; context</h2>
          <label>Project name<input value={name} maxLength={64} onChange={e => { setName(e.target.value); if (!manualSlug) setSlug(slugify(e.target.value)) }} /></label>
          <label>Project slug<input value={slug} maxLength={31} onChange={e => { setManualSlug(true); setSlug(e.target.value) }} /></label>
          <label>Conversation objective<textarea value={config.intent} maxLength={2000} rows={4} placeholder="What should this conversation help someone explore, choose or share?" onChange={e => patch({ intent: e.target.value })} /></label>
          <p>What should someone get from this conversation, and what should you learn?</p>
          <label>Project context<textarea value={config.projectContext ?? ""} maxLength={6000} rows={6} placeholder="Describe the project, who it is for and any facts the host can use to answer questions." onChange={e => patch({ projectContext: e.target.value })} /></label>
          <p>Include approved information such as what the project offers and how it works. The host will say when something is unknown.</p>
        </section>}
        {step === 1 && <section>
          <h2>Persona</h2>
          <p>Define who hosts the conversation. Its purpose and flow belong to this project.</p>
          <label>Persona name<input value={config.persona.name} maxLength={80} onChange={e => patch({ persona: { ...config.persona, name: e.target.value } })} /></label>
          <label>Persona instructions<textarea value={config.persona.instructions} maxLength={6000} rows={6} onChange={e => patch({ persona: { ...config.persona, instructions: e.target.value } })} /></label>
          <p>Set the host’s voice and reply style. Your instructions take precedence over Groucho’s defaults. The preview can flag a possible conflict between your settings.</p>
        </section>}
        {step === 2 && <section>
          <h2>Conversation flow</h2>
          <label>Opening message<textarea value={config.openingMessage} maxLength={500} rows={2} onChange={e => patch({ openingMessage: e.target.value })} /></label>
          <label>Opening question<textarea value={config.openingQuestion} maxLength={500} rows={2} placeholder="What brings you here?" onChange={e => patch({ openingQuestion: e.target.value })} /></label>
          <p>The conversation starts with this message and question. You can start broadly before exploring any signals. Leave the question empty to use the first signal’s question, or “What brings you here?” if there are no signals.</p>
          <label>Conversation guidance<textarea value={config.conversationGuidance ?? ""} maxLength={3000} rows={5} placeholder="Start with what brought them here. Follow their story, explore their interests, then give them room to ask a question before closing." onChange={e => patch({ conversationGuidance: e.target.value })} /></label>
          <p>Describe how the conversation should progress, including topics, useful follow-ups and room for the applicant’s questions. The host can adapt when they share things out of order.</p>
          <label>Maximum applicant answers<input type="number" min={1} max={12} value={config.maxAnswers} onChange={e => patch({ maxAnswers: Number(e.target.value) })} /></label>
          <p>Includes the opening answer and follow-ups. This is a ceiling, not a target. Applicants can stop at any time.</p>
          <label>Closing guidance<textarea value={config.closingGuidance ?? ""} maxLength={2000} rows={3} placeholder="Briefly acknowledge what they shared. If useful, give them room to add something before finishing." onChange={e => patch({ closingGuidance: e.target.value })} /></label>
          <label>Closing message<textarea value={config.closingMessage ?? DEFAULT_PROJECT_CLOSING_MESSAGE} maxLength={500} rows={2} onChange={e => patch({ closingMessage: e.target.value })} /></label>
          <p>The host adds this final statement after a brief acknowledgement. Leave it empty to use the default thank-you. A request to stop ends the conversation immediately, without a final question. The host cannot promise bookings, decisions or messages to others.</p>
        </section>}
        {step === 3 && <section>
          <h2>Signals &amp; examples</h2>
          <p>Signals guide what the host listens for. They do not set the order of the conversation. Unexplored signals remain unknown.</p>
          <ConversationSignalEditor signals={config.signals} onChange={signals => patch({ signals })} />
        </section>}
      </fieldset>
      {step === 4 && <section className={styles.preview}>
        <h2>Test your conversation</h2><p>This preview uses your current configuration and the same engine as the saved project. Preview chats are temporary and do not create applications or send webhooks.</p>
        <dl className={styles.summary}>
          <div><dt>Objective</dt><dd>{config.intent}</dd></div>
          <div><dt>Persona</dt><dd>{config.persona.name}</dd></div>
          <div><dt>Opening question</dt><dd>{projectOpeningQuestion(config)}</dd></div>
          <div><dt>Flow</dt><dd>{config.conversationGuidance || "Follow the applicant’s story and explore relevant signals naturally."}</dd></div>
          <div><dt>Answer limit</dt><dd>{config.maxAnswers}</dd></div>
          <div><dt>Closing</dt><dd>{config.closingGuidance || "Close when the purpose is met or no useful follow-up remains."}<br />{config.closingMessage || DEFAULT_PROJECT_CLOSING_MESSAGE}</dd></div>
          <div><dt>Signals</dt><dd>{config.signals.length ? config.signals.map(signal => signal.name).join(", ") : "Open conversation"}</dd></div>
        </dl>
        <p>As you test, notice whether the opening fits, follow-ups feel useful, corrections are respected and the ending feels natural. Then check what the host learned below.</p>
        <button type="button" disabled={busy || saving} onClick={() => void startPreview()}>{busy ? "Preparing response…" : preview ? "Restart with current configuration" : "Start preview"}</button>
        {stale && <p role="status">Your configuration has changed. Restart the preview to test and save these changes.</p>}
        {preview?.settingsConflict && !stale && <p role="status"><strong>Possible settings conflict.</strong> {preview.settingsConflict}</p>}
        {transcript.length > 0 && <div className={styles.transcript} role="log" aria-label="Preview conversation" aria-live="polite">{transcript.map((entry, index) => <article key={index} id={entry.role === "user" ? `preview-answer-${transcript.slice(0, index + 1).filter(item => item.role === "user").length}` : undefined}><strong>{entry.role === "assistant" ? previewConfig.persona.name : "You"}</strong><p>{entry.content}</p></article>)}</div>}
        {busy && <p role="status">Preparing response…</p>}
        {preview?.status === "active" && !stale && <form onSubmit={e => { e.preventDefault(); void send(answer.trim() || JSON.stringify(selected)) }}>
          <fieldset className={styles.fields} disabled={busy || saving}>
            {preview.ui?.options?.length ? <div className={styles.choices} role="group" aria-label="Answer choices">{preview.ui.options.map(option => preview.ui?.inputType === "multiSelect" ? <label key={option} className={styles.check}><input type="checkbox" checked={selected.includes(option)} onChange={e => setSelected(previous => e.target.checked ? [...previous, option] : previous.filter(item => item !== option))} />{option}</label> : <button key={option} type="button" onClick={() => void send(option)}>{option}</button>)}</div> : null}
            <label>Your answer<textarea rows={3} value={answer} maxLength={4000} onChange={e => setAnswer(e.target.value)} placeholder="You can also ask a question, correct a detail or say stop." /></label>
            <button type="submit" disabled={!answer.trim() && !selected.length}>Send answer</button>
          </fieldset>
        </form>}
        {preview?.status === "completed" && <p role="status">Preview complete.{preview.completion?.complete === false ? " Some signals remain partly understood or unexplored." : ""} Restart to try another conversation.</p>}
        {preview && <ConversationSignalEvidence signals={previewConfig.signals} evidence={preview.signalEvidence} />}
      </section>}
      <footer className={styles.actions}>
        {step > 0 && <button type="button" disabled={busy || saving} onClick={() => { setStep(previous => previous - 1); setError("") }}>Back</button>}
        {step < 4 ? <button type="button" className={styles.primary} disabled={busy || saving} onClick={next}>Continue</button> : <button type="button" className={styles.primary} disabled={!preview || stale || busy || saving || !validated.ok} onClick={() => void save()}>{saving ? "Saving…" : project ? "Save configuration" : "Create project"}</button>}
      </footer>
      {step === 4 && !preview && <p>Start a preview before saving your configuration.</p>}
      {onAdvanced && <button type="button" className={styles.advanced} disabled={busy || saving} onClick={onAdvanced}>Set up a qualification flow, guided onboarding or ticket simulation</button>}
    </main>
  )
}
