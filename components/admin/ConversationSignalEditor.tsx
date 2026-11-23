"use client"

import { signalQuestion, type ProjectConversationSignal } from "@/lib/project-conversation-config"
import styles from "./conversation-project-wizard.module.css"

type Props = {
  signals: ProjectConversationSignal[]
  onChange: (signals: ProjectConversationSignal[]) => void
}
export function ConversationSignalEditor({ signals, onChange }: Props) {
  function update(id: string, patch: Partial<ProjectConversationSignal>) {
    onChange(signals.map(signal => signal.id === id ? { ...signal, ...patch } : signal))
  }
  return (
    <section aria-labelledby="signals-heading">
      <h3 id="signals-heading">What do you want to understand?</h3>
      <p>Define signals and examples of informative answers. Groucho follows the applicant’s story and asks a follow-up only when something is unclear. You can leave this empty for an open conversation guided by your intent.</p>
      {signals.map((signal, index) => (
        <section key={signal.id} className={styles.signal} aria-label={`Signal ${index + 1}`}>
          <label>Signal name<input value={signal.name} maxLength={100} placeholder="Community participation" onChange={e => update(signal.id, { name: e.target.value })} /></label>
          <label>What do you want to understand?<textarea value={signal.understanding} maxLength={1000} rows={3} placeholder="How they show up, contribute or build relationships in a community." onChange={e => update(signal.id, { understanding: e.target.value })} /></label>
          <label>What makes an answer informative? (optional)<textarea value={signal.evidence} maxLength={2000} rows={3} placeholder="What they do, where or with whom, and why it matters to them. Other forms of contribution are welcome." onChange={e => update(signal.id, { evidence: e.target.value })} /></label>
          <h4>Example answers (optional)</h4>
          <p>Examples are illustrations, not requirements. Include different valid experiences, such as informal support or online communities. Naming a place adds detail, not independent verification.</p>
          {signal.examples.map((example, exampleIndex) => (
            <div className={styles.example} key={exampleIndex}>
              <label>Example {exampleIndex + 1}<textarea value={example} maxLength={1000} rows={3} placeholder={exampleIndex === 0 ? "I go to the listening night at Cedar Hall most Thursdays. I enjoy welcoming people who are new to the area." : "I help an online group welcome new members. I check in with people who seem unsure about joining in."} onChange={e => update(signal.id, { examples: signal.examples.map((item, i) => i === exampleIndex ? e.target.value : item) })} /></label>
              <button type="button" onClick={() => update(signal.id, { examples: signal.examples.filter((_, i) => i !== exampleIndex) })}>Remove example {exampleIndex + 1}</button>
            </div>
          ))}
          <button type="button" disabled={signal.examples.length >= 6} onClick={() => update(signal.id, { examples: [...signal.examples, ""] })}>Add example</button>
          <details className={styles.optionalControls}>
            <summary>Question &amp; answer controls (optional)</summary>
            <p>Use these when wording or format matters. Groucho can skip the question if the applicant already shared the information.</p>
            <label>Exact question (optional)<textarea value={signal.question} maxLength={500} rows={2} placeholder="Leave blank for Groucho to choose the wording." onChange={e => update(signal.id, { question: e.target.value })} /></label>
            <label>Answer type (optional)<select value={signal.answerType} onChange={e => update(signal.id, { answerType: e.target.value as ProjectConversationSignal["answerType"] })}>
              <option value="auto">Let Groucho choose</option><option value="text">Open text</option><option value="singleSelect">Choose one</option><option value="multiSelect">Choose several</option>
            </select></label>
            {(signal.answerType === "singleSelect" || signal.answerType === "multiSelect") && <>
              <label>Options (one per line)<textarea value={signal.options.join("\n")} rows={4} placeholder={"Organising\nTaking part\nSupporting behind the scenes"} onChange={e => update(signal.id, { options: e.target.value.split("\n") })} /></label>
              <p>Question shown with these options: {signalQuestion(signal)}</p>
            </>}
            {signal.answerType === "auto" && <p>Groucho chooses natural wording and follow-ups. Supply a choice list if you want applicants to see answer buttons.</p>}
          </details>
          <label className={styles.check}><input type="checkbox" checked={signal.explore} onChange={e => update(signal.id, { explore: e.target.checked })} />Aim to explore before wrapping up</label>
          <p>Applicants can decline or be unsure. Missing evidence stays unknown; it does not mean they lack the signal.</p>
          <button type="button" onClick={() => onChange(signals.filter(item => item.id !== signal.id))}>Remove signal {index + 1}</button>
        </section>
      ))}
      <button type="button" disabled={signals.length >= 12} onClick={() => onChange([...signals, { id: `s_${crypto.randomUUID().replaceAll("-", "")}`, name: "", understanding: "", evidence: "", examples: [], explore: true, question: "", answerType: "auto", options: [] }])}>Add signal</button>
    </section>
  )
}
