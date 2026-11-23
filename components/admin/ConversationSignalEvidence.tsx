import type { ProjectConversationSignal } from "@/lib/project-conversation-config"
import { SIGNAL_EVIDENCE_LABELS, type SignalEvidenceMap } from "@/lib/project-conversation-evidence"
import styles from "./conversation-project-wizard.module.css"

export function ConversationSignalEvidence({ signals, evidence }: { signals: ProjectConversationSignal[]; evidence?: SignalEvidenceMap }) {
  if (!signals.length) return null
  return <section className={styles.evidence} aria-labelledby="signal-evidence-heading">
    <h3 id="signal-evidence-heading">Evidence picked up</h3>
    <p>These are accounts shared in this conversation, not verified facts or acceptance decisions.</p>
    {signals.map(signal => {
      const item = evidence?.[signal.id]
      return <article key={signal.id} className={styles.evidenceItem}>
        <header><h4>{signal.name}</h4><span>{SIGNAL_EVIDENCE_LABELS[item?.status ?? "not_explored"]}</span></header>
        {item?.summary && <p>{item.summary}</p>}
        {!!item?.sources.length && <div>
          <h5>Applicant’s words</h5>
          {item.sources.map((source, index) => <blockquote key={`${source.turn}-${index}`}><p>{source.quote}</p><a href={`#preview-answer-${source.turn}`}>Answer {source.turn}</a></blockquote>)}
        </div>}
        {item?.reason && <div><h5>Why it is relevant</h5><p>{item.reason}</p></div>}
        {(!item || item.status === "not_explored") && <p>This signal remains unknown. Do not treat missing evidence as a negative judgment.</p>}
        {item?.status === "partly_understood" && <p>There is some context here. Other details remain unclear.</p>}
        {item?.status === "declined" && <p>The applicant chose not to share more. That choice is respected.</p>}
      </article>
    })}
  </section>
}
