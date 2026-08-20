import { createHash, randomBytes } from "crypto"
import { createClient } from "@supabase/supabase-js"

const PROJECT_ID = "e9e6aa45-5ef3-4ec3-9451-1703d32abed3"
const BASE_URL = process.env.IDENTITY_REPLAY_BASE_URL ?? "http://127.0.0.1:3000"

type IdentityName = "artist" | "curator" | "enthusiast" | "hybrid"
type Turn = { role: "assistant" | "user"; content: string }

const profiles: Record<IdentityName, Record<string, string>> = {
  artist: {
    opening: "Share Work",
    colors: "COLORS performances make restraint feel intentional rather than unfinished. I want to see whether that same attention can exist between artists in the Forum.",
    scene: "I am adjacent to a small electronic scene where artists trade unfinished versions privately; what outsiders miss is how much of the work happens through patient listening before a release.",
    community: "A place where unfinished ideas can be understood before they are judged or turned into content.",
    orientation: "I make electronic soul and mostly want honest exchange around process, not promotion.",
    artist: "Tirzah. She leaves awkward space around a vocal instead of polishing the feeling away.",
    song: "Devotion. I would share it because the restraint makes every small change feel deliberate.",
    practice: "I am making songs that leave breaths and rough harmony edges in place so the emotion is not edited out.",
    feedback: "I would first ask what the artist wants the unfinished piece to become, then respond to that intention rather than my taste.",
    participation: "I mostly make work, but I also trade rough versions with a small group and talk through the choices we are unsure about.",
    contribution: "I would start a monthly process thread where one person shares a rough section and everyone responds to the intention before suggesting changes.",
    fallback: "The useful part for me is staying with the work long enough to understand the choice before reacting.",
  },
  curator: {
    opening: "Community",
    colors: "COLORS gives unfamiliar artists enough context without explaining the work away. I want the Forum to extend that kind of attention into an ongoing exchange.",
    scene: "I am part of the independent listening scene around me through the night I host and the radio introductions I make. Outsiders often miss the quieter artists because the most immediate work dominates the room.",
    community: "Community means people taking responsibility for the attention they create. I run a monthly listening night and connect emerging artists with independent radio hosts when the match is thoughtful.",
    orientation: "I run a monthly listening night and connect emerging artists with independent radio hosts when the match is thoughtful.",
    artist: "Mabe Fratti. Her cello work can feel fragile and confrontational at the same time, and people often flatten that tension into genre.",
    song: "Pantalla Azul. I would share it with enough context for someone to notice how the arrangement keeps changing the emotional centre.",
    practice: "I sequence the room so quieter work is not swallowed by the most immediate track, and I change the introduction depending on who is listening.",
    feedback: "When work is not for me, I separate my taste from whether the artist's intention is coming through. At the last session I asked about a muddy vocal only after checking that intimacy was the aim.",
    participation: "I select, host, introduce, and follow up. The role is making attention useful to both the artist and the people in the room.",
    contribution: "I would host a fortnightly listening thread, introduce three contrasting tracks with context, and invite people to explain where their reading changed.",
    fallback: "I try to make the context specific enough that disagreement becomes useful rather than performative.",
  },
  enthusiast: {
    opening: "Community",
    colors: "COLORS has changed how I hear artists I thought I already understood. I want a Forum where that slower kind of listening can continue after the performance.",
    scene: "I am mostly adjacent to the local scene rather than inside it. I notice which releases keep travelling through small friend groups even when they receive little public attention.",
    community: "Community means listening does not end with consumption; people remember what moved someone else and return with something considered.",
    orientation: "I mostly listen. I am looking for conversation that goes beyond algorithmic playlists and quick ratings.",
    artist: "Liv.e. Her songs reward returning because details that first sound loose start to feel emotionally exact.",
    song: "Wild Animals. I would share it because the off-centre rhythm takes time to settle, and that delayed connection is the point.",
    practice: "I keep notes after repeat listens and bring one observation into conversations with friends rather than sending a stream of links.",
    feedback: "I would ask what kind of response they wanted and be honest about what I could hear without pretending to be a maker.",
    participation: "I mostly listen, but music becomes social when friends exchange one track and come back after living with it for a few days.",
    contribution: "I would start one weekly repeat-listen thread, share what changed for me, reply to other listeners, and carry one observation into the following week.",
    fallback: "My goal is to become a more active listener by returning, responding, and giving other people's discoveries real time.",
  },
  hybrid: {
    opening: "Share Work",
    colors: "COLORS treats presentation as part of the work without letting it overpower the artist. That balance matters to both my own music and the context I make on radio.",
    scene: "I am inside one part of the local scene through radio and adjacent to another as an artist. What people outside it miss is how often collaborations begin through informal listening rather than industry events.",
    community: "Community is where making and creating context for other people's work can strengthen each other without becoming networking.",
    orientation: "I produce my own music and run a small radio show where I curate local releases and introduce artists to possible collaborators.",
    artist: "Nourished by Time. The writing feels intimate while the production keeps resisting a clean nostalgic reading. I produce my own music and run a small radio show where I curate local releases.",
    song: "Daddy. I would share it because the tension between warmth and unease explains more than a genre label would.",
    practice: "In my own work I use familiar drum textures, then interrupt the pattern so the memory never becomes comfortable. On radio I explain why that choice matters.",
    feedback: "I ask whether I am hearing the work's intention before offering changes. With artists on the show, I keep programming feedback separate from personal taste.",
    participation: "I make, select, contextualise, and connect people when there is a real creative reason for the introduction.",
    contribution: "I would host a monthly exchange pairing one unfinished work with two contextual references, then connect people only when both sides want that introduction.",
    fallback: "The common thread is helping a creative choice become legible without over-explaining or taking ownership away from the artist.",
  },
}

function answerFor(identity: IdentityName, question: string, ui?: { inputType?: string; options?: string[] }): string {
  const profile = profiles[identity]
  const questionSegments = question.match(/[^?]+\?/g)
  const value = (questionSegments?.at(-1) ?? question).toLowerCase()
  if (ui?.inputType !== "text" && ui?.options?.length) {
    if (ui.options.includes(profile.opening)) return profile.opening
    if (identity === "artist" && ui.options.includes("I like discussing music")) return "I like discussing music"
    if (identity === "curator" && ui.options.includes("I regularly share discoveries")) return "I regularly share discoveries"
    if (identity === "enthusiast" && ui.options.includes("I mostly listen")) return "I mostly listen"
    if (identity === "hybrid" && ui.options.includes("I regularly share discoveries")) return "I regularly share discoveries"
    return ui.options[0]
  }
  if (value.includes("community mean")) return profile.community
  if (/\b(colors|this particular door|performances? cannot|performances? can(?:not|'t))\b/.test(value)) return profile.colors
  if (/\b(scene|where you live|where you are|outside it|adjacent to it|outsiders? might miss)\b/.test(value)) return profile.scene
  if (/\b(unfinished|feedback|honesty|not naturally for you|still working on)\b/.test(value)) return profile.feedback
  if (/\b(contribute|contribution|first month|add to|start, share|bring (?:here|into)|do (?:here|in the forum)|share with people here|realistically bring|something concrete)\b/.test(value)) return profile.contribution
  if (value.includes("artist") || value.includes("making work") || value.includes("people tend to miss")) return profile.artist
  if (/\b(songs?|tracks?|pieces?|recommend|share with someone|hear first)\b/.test(value)) return profile.song
  if (/\b(own music|your music|your practice|trying to express|making at the moment)\b/.test(value)) return profile.practice
  if (/\b(participate|around music|music become social|exchange with|role do you|other people)\b/.test(value)) return profile.participation
  if (/\b(hoping|looking for|find here|take part)\b/.test(value)) return profile.orientation
  return profile.fallback
}

async function jsonRequest(url: string, apiKey: string, body: unknown) {
  const started = Date.now()
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const data = await response.json() as Record<string, unknown>
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(data)}`)
  return { data, durationMs: Date.now() - started }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error("Supabase service configuration is required")
  const supabase = createClient(url, key)
  const projectResult = await supabase
    .from("projects")
    .select("id, organisation_id, name")
    .eq("id", PROJECT_ID)
    .single()
  if (projectResult.error) throw projectResult.error

  const plaintext = `gk_${randomBytes(24).toString("base64url")}`
  const keyHash = createHash("sha256").update(plaintext, "utf8").digest("hex")
  const keyRow = await supabase
    .from("api_keys")
    .insert({
      organisation_id: projectResult.data.organisation_id,
      project_id: PROJECT_ID,
      key_hash: keyHash,
      key_prefix: plaintext.slice(0, 12),
      label: "Temporary COLORS identity replay",
    })
    .select("id")
    .single()
  if (keyRow.error) throw keyRow.error

  const runStamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14)
  const summaries: Record<string, unknown>[] = []
  try {
    const requestedIdentities = new Set(
      (process.env.IDENTITY_REPLAY_IDENTITIES ?? "artist,curator,enthusiast,hybrid")
        .split(",")
        .map((value) => value.trim()),
    )
    for (const identity of (Object.keys(profiles) as IdentityName[]).filter(
      (candidate) => requestedIdentities.has(candidate),
    )) {
      const sessionId = `colors-${identity}-integrity-rerun-${runStamp}`
      const applicant = {
        email: `${sessionId}@example.invalid`,
        name: `Synthetic ${identity}`,
      }
      const transcript: Turn[] = []
      const durations: number[] = []
      const started = await jsonRequest(
        `${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/start`,
        plaintext,
        { applicant },
      )
      durations.push(started.durationMs)
      let response = started.data
      let assistantMessage = String(response.message ?? "")
      transcript.push({ role: "assistant", content: assistantMessage })

      for (let turn = 0; turn < 14 && response.status === "active"; turn += 1) {
        if (/it was good getting to understand you better/i.test(assistantMessage)) {
          break
        }
        const answer = answerFor(
          identity,
          assistantMessage,
          response.ui as { inputType?: string; options?: string[] } | undefined,
        )
        transcript.push({ role: "user", content: answer })
        process.stdout.write(`\n[${identity} ${turn + 1}] ${assistantMessage}\n> ${answer}\n`)
        const next = await jsonRequest(
          `${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
          plaintext,
          { message: answer, applicant },
        )
        durations.push(next.durationMs)
        response = next.data
        assistantMessage = String(response.message ?? "")
        transcript.push({ role: "assistant", content: assistantMessage })
      }

      const sessionResult = await supabase
        .from("sessions")
        .select("id, status")
        .eq("session_id", sessionId)
        .eq("project_id", PROJECT_ID)
        .single()
      if (sessionResult.error) throw sessionResult.error
      const messageResult = await supabase
        .from("messages")
        .select("role, content, metadata, sent_at")
        .eq("session_id", sessionResult.data.id)
        .order("sent_at", { ascending: true })
      if (messageResult.error) throw messageResult.error
      const assistantRows = messageResult.data.filter((row) => row.role === "assistant")
      const terminal = [...assistantRows].reverse().find((row) => {
        const metadata = row.metadata as Record<string, unknown> | null
        return metadata?.gatekeeper_terminal && metadata.gatekeeper_terminal !== "none"
      })
      const finalMetadata = (terminal?.metadata ?? assistantRows.at(-1)?.metadata ?? {}) as Record<string, unknown>
      const orientation = finalMetadata.participant_orientation as Record<string, unknown> | undefined
      const report = finalMetadata.reviewer_report as Record<string, unknown> | undefined
      const allText = assistantRows.map((row) => String(row.content)).join("\n")
      const activeFalseClose = assistantRows.some((row) => {
        const metadata = row.metadata as Record<string, unknown> | null
        return metadata?.gatekeeper_terminal === "none" &&
          /it was good getting to understand you better/i.test(String(row.content))
      })
      const activeWithoutQuestion = assistantRows.filter((row) => {
        const metadata = row.metadata as Record<string, unknown> | null
        return metadata?.gatekeeper_terminal === "none" && !/[?]|(?:tell me|describe|share|choose|select|pick)\b/i.test(String(row.content))
      }).length
      summaries.push({
        identity,
        sessionId,
        status: sessionResult.data.status,
        userTurns: messageResult.data.filter((row) => row.role === "user").length,
        orientation: orientation?.primary ?? null,
        orientationScores: orientation?.scores ?? null,
        feedbackQuestion: /feedback|unfinished|not naturally for you|useful honesty/i.test(allText),
        communityMeaningQuestion: /what does community mean to you/i.test(allText),
        processLanguage: /before we (?:wrap|finish|close|go further)|one last (?:thing|question)|let me ask differently/i.test(allText),
        activeFalseClose,
        activeWithoutQuestion,
        reportEvidenceItems: Array.isArray(report?.evidence_summary) ? report.evidence_summary.length : 0,
        reportWeakItems: Array.isArray(report?.weak_or_missing_signals) ? report.weak_or_missing_signals.length : 0,
        reviewerRecommendation: report?.advisory_recommendation ?? null,
        receiptRepairs: assistantRows.filter((row) => {
          const metadata = row.metadata as Record<string, unknown> | null
          return metadata?.application_grounded_receipt_preserved === true
        }).length,
        insufficientEvidenceSignals: messageResult.data.filter((row) => {
          const metadata = row.metadata as Record<string, unknown> | null
          return Boolean(metadata?.application_insufficient_evidence)
        }).length,
        averageMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
        maxMs: Math.max(...durations),
        transcript,
      })
      process.stdout.write(`\n[${identity} complete] ${sessionResult.data.status}\n`)
    }
  } finally {
    await supabase
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", keyRow.data.id)
  }

  process.stdout.write(`\nIDENTITY_REPLAY_RESULT=${JSON.stringify(summaries)}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
