import { writeFile } from "node:fs/promises"
import { supabase } from "../lib/supabase"
import { normalizeProjectSettings } from "../lib/project-settings"
import { startGatekeeperSession } from "../lib/start-gatekeeper-session"
import { postDemoConversation, DEMO_CONVERSATION_PROFILES, type DemoConversationId } from "../lib/demo-conversation-profiles"

const projects: Record<DemoConversationId, string> = {
  loptimiste: "aecfc938-f1e5-4464-b8f4-e6f8c1a3b81f",
  saltings: "dbf3afa8-ac2d-4fcc-822b-fe8b1ed50e17",
  "lewisham-social": "fd51f412-8689-461d-b510-b8153bb237e7",
}
const answers: Record<DemoConversationId, Record<string, string>> = {
  loptimiste: {
    recipient: "For me", scentMemory: "Woodsmoke from my father’s stove in Yorkshire, after a cold walk. I remember damp wool drying beside it.",
    burnLocation: "In my living room after dinner, while I read. I enjoy smoky scents.", ritual: "A candle for long evenings",
  },
  saltings: {
    workingOn: "A novel about two sisters running the last ferry to an island before a bridge opens.",
    stuck: "The younger sister has no reason to stay. I keep rewriting their argument at the landing.",
    wants: "Someone to read it", line: "The bridge arrived in pieces, but the leaving happened all at once.",
    attendance: "Yes, the whole fortnight",
  },
  "lewisham-social": {
    discovery: "My sister took me to a small Deptford show. I loved how the brass left room for the crowd to sing.",
    companion: "My sister, just the two of us.", location: "We live in Bristol.", night: "Bristol, Tue 13 Apr",
  },
}

const publicMode = process.argv.includes("--public")

async function verify(id: DemoConversationId) {
  const { data: project, error } = publicMode
    ? { data: { id: projects[id], organisation_id: "unused", settings: {} as Record<string, unknown> }, error: null }
    : await supabase.from("projects").select("id,organisation_id,settings").eq("id", projects[id]).single()
  if (error || !project) throw error ?? new Error("Project missing")
  // The verification session uses an explicit context overlay, without changing live project settings.
  const settings = normalizeProjectSettings({ ...project.settings, conversation_engine: "conversation_v1", conversation_profile: id,
    application_experience: { ...(project.settings.application_experience as object ?? {}), max_turns: 8 } })
  const context = { organisationId: project.organisation_id, projectId: project.id, apiKeyId: null, settings }
  const sessionId = crypto.randomUUID()
  const applicant = { email: "conversation-engine-verification@example.com", name: "Synthetic runtime verification" }
  const publicRequest = (action: string, body: unknown) => fetch(`${process.env.GROUCHO_DEMO_SITE_URL || "https://demos.grcho.com"}/api/groucho/${id}/v1/sessions/${sessionId}/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
  })
  let response = publicMode ? await publicRequest("start", { applicant }) : await startGatekeeperSession({ sessionId, applicantIdentity: applicant, context, projectSettings: settings })
  let data = await response.json()
  const transcript: unknown[] = [{ opening: data }]
  const fieldOrder = DEMO_CONVERSATION_PROFILES[id].fields
  for (let turn = 0; turn < 9 && data.status === "active"; turn++) {
    if (!response.ok || data.engine !== "groucho_conversation_v1") throw new Error(`${id}: wrong engine or failed request ${JSON.stringify(data)}`)
    const options = data.ui?.inputType === "singleSelect" ? data.ui.options as string[] : undefined
    if (options && options.length < 2) throw new Error(`${id}: empty choice`)
    if (!data.message.includes("?")) throw new Error(`${id}: stalled reply ${data.message}`)
    const details = data.details ?? {}
    const nextField = fieldOrder.find(field => !details[field.key])?.key ?? "ritual"
    const answer = options
      ? options.find(option => Object.values(answers[id]).includes(option)) ?? options[0]
      : answers[id][nextField] ?? "That covers what I wanted to share, thank you."
    response = publicMode ? await publicRequest("messages", { message: answer }) : await postDemoConversation({ context, sessionId, message: answer, runCompletion: false })
    data = await response.json()
    transcript.push({ answer, httpStatus: response.status, response: data })
    console.log(JSON.stringify({ brand: id, turn: turn + 1, httpStatus: response.status, reply: data.message, status: data.status, options: data.ui?.options, details: data.details, completion: data.completion, error: data.error }))
    if (!response.ok) throw new Error(`${id}: request failed ${JSON.stringify(data)}`)
  }
  if (data.status !== "completed" || data.completion?.mode !== "simulation" || data.secret || !data.completion.complete) {
    throw new Error(`${id}: incomplete or invalid completion ${JSON.stringify(data)}`)
  }
  return { brand: id, sessionId, transcript }
}

async function main() {
  const results = await Promise.allSettled((Object.keys(projects) as DemoConversationId[]).map(verify))
  await writeFile("/tmp/reusable-conversation-live-verification.json", JSON.stringify(results, (_key, value) => value instanceof Error ? value.message : value, 2))
  for (const result of results) if (result.status === "rejected") { console.error(result.reason); process.exitCode = 1 }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
