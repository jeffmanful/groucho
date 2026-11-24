import type { ProjectConversationSignal } from "@/lib/project-conversation-config"
import { SIGNAL_EVIDENCE_LABELS, type SignalEvidenceMap } from "@/lib/project-conversation-evidence"
import { MAX_SIGNAL_FOLLOW_UPS, type SignalTurn } from "@/lib/project-conversation-progress"
import styles from "./conversation-project-wizard.module.css"

export function ConversationSignalEvidence({ signals, evidence, anchorPrefix = "preview", turns = [], completed = false }: {
  signals: ProjectConversationSignal[]
  evidence?: SignalEvidenceMap
  anchorPrefix?: string
  turns?: readonly (SignalTurn | undefined)[]
  completed?: boolean
}) {
  if (!signals.length) return null
  return <section className={styles.evidence} aria-labelledby={`${anchorPrefix}-signal-evidence-heading`}>
    <h3 id={`${anchorPrefix}-signal-evidence-heading`}>Signal coverage</h3>
    <p>These are accounts shared in this conversation, not verified facts or acceptance decisions.</p>
    {signals.map(signal => {
      const item = evidence?.[signal.id]
      const attempts = turns.filter(turn => turn?.questionSignalId === signal.id && turn.followUp).length
      const open = !item || item.status === "not_explored" || item.status === "partly_understood"
      return <article key={signal.id} className={styles.evidenceItem}>
        <header><h4>{signal.name}</h4><span>{SIGNAL_EVIDENCE_LABELS[item?.status ?? "not_explored"]}</span></header>
        {item?.summary && <p>{item.summary}</p>}
        {!!item?.sources.length && <div>
          <h5>Applicant’s words</h5>
          {item.sources.map((source, index) => <blockquote key={`${source.turn}-${index}`}><p>{source.quote}</p><a href={`#${anchorPrefix}-answer-${source.turn}`}>Answer {source.turn}</a></blockquote>)}
        </div>}
        {item?.reason && <div><h5>Why it is relevant</h5><p>{item.reason}</p></div>}
        {(!item || item.status === "not_explored") && <p>This signal remains unknown. Do not treat missing evidence as a negative judgment.</p>}
        {item?.status === "partly_understood" && <p>There is some context here. Other details remain unclear.</p>}
        {item?.status === "declined" && <p>The applicant chose not to share more. That choice is respected.</p>}
        {open && (!signal.explore ? <p>Listens for volunteered evidence.</p>
          : attempts >= MAX_SIGNAL_FOLLOW_UPS ? <p>Left open after two follow-ups.</p>
          : <p>{completed ? "Left open at the end of the conversation." : "Open for exploration."}</p>)}
      </article>
    })}
  </section>
}

export function ConversationSignalTurn({ turn, signals, hasQuestion }: { turn?: SignalTurn; signals: ProjectConversationSignal[]; hasQuestion: boolean }) {
  if (!turn) return null
  const target = signals.find(signal => signal.id === turn.questionSignalId)
  if (!target && !turn.changes.length && !hasQuestion) return null
  return <div className={styles.turnSignals}>
    {target ? <p><strong>{turn.followUp ? "Following up on" : "Exploring"}</strong> {target.name}</p>
      : hasQuestion && <p>No signal targeted.</p>}
    {turn.changes.map(change => {
      const signal = signals.find(signal => signal.id === change.signalId)
      return signal && <p key={signal.id}><strong>{signal.name}</strong> · {SIGNAL_EVIDENCE_LABELS[change.status]}{change.summary && ` · ${change.summary}`}</p>
    })}
  </div>
}
