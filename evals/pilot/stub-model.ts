/**
 * A deterministic stand-in for the model, used with PILOT_STUB=1 to exercise the harness without
 * paid calls. It asks about each signal in turn and marks the previous one as found. Its output
 * says nothing about Groucho's quality.
 */
type StubRequest = {
  system?: unknown
  tools?: Array<{ name: string; input_schema: { properties?: Record<string, { enum?: string[] }> } }>
  output_config?: { format?: { schema?: { properties?: Record<string, { enum?: string[] }> } } }
  messages: Array<{ role: string; content: unknown }>
}

export function stubMessage(request: StubRequest) {
  const system = String(request.system ?? "")
  const tool = request.tools?.[0]
  const kind = tool?.name === "groucho_signal_evidence" || system.startsWith("You maintain evidence") ? "evidence"
    : tool?.name === "review_one_question_reply" || system.startsWith("Review a draft") ? "review"
    : tool?.name === "review_closing_acknowledgement" || system.startsWith("The conversation is closing") ? "closing" : "converse"
  const answers = request.messages.filter(message => message.role === "user")
  const current = String(answers.at(-1)?.content ?? "")
  const count = answers.length
  let payload: Record<string, unknown>
  if (kind === "review") {
    const draft = JSON.parse(current) as { questionSignalId?: string }
    payload = { verdict: "pass", replacement: "", usesForumReason: false, questionSignalId: draft.questionSignalId ?? "none", buildsOnQuote: "" }
  } else if (kind === "closing") {
    payload = { acknowledgement: "" }
  } else {
    const properties = tool?.input_schema.properties ?? request.output_config?.format?.schema?.properties ?? {}
    const signals = (system.match(/s_[0-9a-f]{32}/g) ?? []).filter((id, index, all) => all.indexOf(id) === index)
    const ids = (properties.questionSignalId?.enum ?? signals).filter(id => id !== "none")
    const evidence = ids.length && current.trim() ? [{ signalId: ids[(count - 1) % ids.length], status: "evidence_found", subject: "applicant",
      summary: "Stub summary.", reason: "Stub reason.", quotes: [current.trim().slice(0, 20)], supersedes: false }] : []
    if (kind === "evidence") payload = { signalEvidence: evidence, answerRelation: count === 1 ? "answered" : "partly_answered", threads: current.trim() ? [{ detail: "Stub thread.", quote: current.trim().slice(0, 20), relatedSignalIds: [] }] : [] }
    else {
      const stop = /\bstop\b/i.test(current)
      payload = { reply: stop ? "Understood." : `Stub question ${count}?`, close: stop, boundary: "none", boundaryQuestion: "", addsNewContext: true,
        choiceKey: "none", facts: [], choiceIntroduction: "", visitorIntent: stop ? "stop" : "continue", signalEvidence: evidence,
        questionSignalId: ids.length ? ids[count % ids.length] : "none", buildsOnQuote: count % 2 ? current.trim().slice(0, 20) : "" }
    }
  }
  return {
    id: `stub-${Math.random().toString(36).slice(2)}`, type: "message", role: "assistant", model: "stub", stop_reason: tool ? "tool_use" : "end_turn",
    usage: { input_tokens: 100, output_tokens: 20 },
    content: tool ? [{ type: "tool_use", id: "stub", name: tool.name, input: payload }] : [{ type: "text", text: JSON.stringify(payload) }],
  }
}
