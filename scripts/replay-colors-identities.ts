import { createHash, randomBytes } from "crypto"
import { createClient } from "@supabase/supabase-js"

const PROJECT_ID = "e9e6aa45-5ef3-4ec3-9451-1703d32abed3"
const BASE_URL = process.env.IDENTITY_REPLAY_BASE_URL ?? "http://127.0.0.1:3000"

type IdentityName =
  | "artist"
  | "curator"
  | "enthusiast"
  | "hybrid"
  | "recommend_active_artist"
  | "recommend_thoughtful_listener"
  | "recommend_constructive_curator"
  | "recommend_community_hybrid"
  | "recommend_early_artist"
  | "vague"
  | "contradictory"
  | "extractive"
  | "safety_boundary"
type Turn = { role: "assistant" | "user"; content: string }
type RequestTiming = {
  phase: "start" | "message"
  durationMs: number
  serverTiming: string | null
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

function serverTimingValue(header: string | null, name: string): number | null {
  if (!header) return null
  for (const entry of header.split(",")) {
    const [entryName, ...parameters] = entry.trim().split(";")
    if (entryName !== name) continue
    const duration = parameters
      .map((parameter) => parameter.trim())
      .find((parameter) => parameter.startsWith("dur="))
    if (!duration) return null
    const value = Number(duration.slice(4))
    return Number.isFinite(value) ? value : null
  }
  return null
}

function latencyStats(values: number[]) {
  const p50 = percentile(values, 0.5)
  const p95 = percentile(values, 0.95)
  return {
    samples: values.length,
    meanMs: values.length > 0
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
      : null,
    p50Ms: p50 === null ? null : Math.round(p50 * 10) / 10,
    p95Ms: p95 === null ? null : Math.round(p95 * 10) / 10,
    maxMs: values.length > 0 ? Math.max(...values) : null,
  }
}

const calibrationExpectedRecommendations: Partial<
  Record<IdentityName, "recommend" | "human_review" | "decline">
> = {
  recommend_active_artist: "recommend",
  recommend_thoughtful_listener: "recommend",
  recommend_constructive_curator: "recommend",
  recommend_community_hybrid: "recommend",
  recommend_early_artist: "recommend",
}

function finalQuestion(value: string): string {
  const questionSegment = value.match(/[^?]+\?/g)?.at(-1) ?? value
  return questionSegment.split(/(?<=[.!])\s+|\n+/).at(-1) ?? questionSegment
}

function questionText(value: string): string {
  return (value.match(/[^?]+\?/g) ?? [value])
    .map(
      (question) =>
        question.split(/(?<=[.!])\s+|\n+/).at(-1) ?? question,
    )
    .join(" ")
}

const profiles: Record<IdentityName, Record<string, string>> = {
  artist: {
    opening: "I make electronic soul and want an honest exchange around process, not another place built around promotion.",
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
    opening: "I run a monthly listening night and want a community where the attention around emerging artists becomes useful context.",
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
    opening: "I mostly listen, and I want a community where people return to music slowly instead of treating discovery as a stream of links.",
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
    opening: "I produce my own music and run a small radio show. I want the Forum to connect making work with creating careful context for other artists.",
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
  recommend_active_artist: {
    opening: "I'm a South London producer making sparse electronic R&B. I've released two tracks but have a folder of unfinished demos.",
    colors: "The restraint in COLORS performances feels close to what I'm trying to do, and the Forum could make room for honest exchange around work before it is finished.",
    scene: "I'm part of a loose South London network of producers who share unfinished demos, though I want more focused exchange than we usually manage.",
    community: "A place where artists can bring unfinished work, ask a precise question, and return that same attention to someone else.",
    orientation: "I make sparse electronic R&B and have a folder of unfinished demos.",
    artist: "Kelela. The precision in her vocal arrangements still leaves room for uncertainty and intimacy.",
    song: "Enough for Love, because the space around the vocal makes the smallest production choices feel exposed.",
    practice: "I've released two tracks, but most of my work is unfinished demos where I'm still deciding how sparse the arrangement can be.",
    feedback: "I want honest feedback on arrangement and whether my vocals feel convincing, and I can give other artists specific production feedback in return.",
    participation: "I'd join listening sessions, bring works in progress, and listen closely to what other artists are trying to solve.",
    contribution: "I'd contribute by joining listening sessions and giving specific production feedback to other artists.",
    fallback: "The useful exchange is specific: what the arrangement is doing, whether the vocal lands, and what the artist wants the track to become.",
  },
  recommend_thoughtful_listener: {
    opening: "I'm not an artist, but I spend a lot of time finding new music through local radio, Bandcamp, and small live nights.",
    colors: "COLORS often gives me a way into an artist beyond a playlist slot. I'd like the Forum to continue that kind of attentive discovery.",
    scene: "I'm adjacent to the local scene through small live nights and radio rather than working in the industry.",
    community: "A music community is somewhere discoveries become conversations and people return after listening instead of only dropping links.",
    orientation: "I'm not an artist; I'm a listener who spends a lot of time finding new music.",
    artist: "Ojerime. Her songwriting can feel private and direct without explaining every emotion.",
    song: "Give It Up 2 Me, because the restrained writing reveals more each time rather than giving everything away at once.",
    practice: "I follow local radio, Bandcamp, and small live nights, then spend time with a release before recommending it.",
    feedback: "I'd respond as a listener and explain what came through clearly without pretending I know how the artist should make it.",
    participation: "I'd like to share discoveries before they become widely known and talk about what makes the songwriting distinctive.",
    contribution: "I'd bring one considered discovery at a time, explain what I hear in it, and return to other people's recommendations after listening.",
    fallback: "What I can offer is patient discovery, a particular observation, and real follow-through as a listener.",
  },
  recommend_constructive_curator: {
    opening: "I run a monthly playlist focused on alternative African electronic music, usually featuring 15–20 independent artists.",
    colors: "COLORS creates a clear frame around an artist without reducing them to a trend, which is close to what I want the playlist and Forum discussion to do.",
    scene: "I'm connected across alternative African electronic scenes through the independent artists I feature and the introductions that grow from the playlist.",
    community: "Community means attention has a consequence: artists are understood in context and useful relationships can grow from it.",
    orientation: "I run a monthly playlist featuring 15–20 independent artists in alternative African electronic music.",
    artist: "H31R. Their production keeps club structures unsettled while the writing stays sharply personal.",
    song: "Backwards, because it shows how an abrasive rhythmic idea can still carry a very precise emotional point of view.",
    practice: "I select 15–20 artists each month around a specific alternative African electronic focus rather than choosing by popularity.",
    feedback: "When giving feedback, I separate personal taste from whether the artist's idea is coming through clearly.",
    participation: "I curate every month, give artists context, and recently introduced two artists who later worked on a track together.",
    contribution: "I'd share focused selections with context and make introductions when there is a real creative reason and both artists want it.",
    fallback: "The strongest evidence is the recurring playlist and an introduction that led to two artists making a track together.",
  },
  recommend_community_hybrid: {
    opening: "I make music, photograph local shows, and help organise a small open-mic night in Manchester.",
    colors: "COLORS connects music and visual presentation without losing the person in the middle, which relates to both my music and documenting local shows.",
    scene: "I'm part of the Manchester scene through making music, photographing local shows, and helping organise a small open-mic night.",
    community: "Community means people making space for each other's work and helping someone new feel they can take part.",
    orientation: "I make music, photograph local shows, and help organise a small open-mic night.",
    artist: "Blackhaine. The work makes sound, movement, image, and place feel like parts of one language.",
    song: "Prayer, because the physical tension in it makes more sense when you hear the sound and performance together.",
    practice: "I'm making my own music while photographing local shows, so I think about how the work and the way it is documented meet.",
    feedback: "I'm joining to meet artists outside my immediate scene and get feedback on works in progress.",
    participation: "I already make music, photograph shows, recommend performers, and help organise a small open-mic night.",
    contribution: "I could contribute photos, recommend performers, and help make new members feel included.",
    fallback: "I can take part through creating, documenting, recommending, organising, and welcoming rather than only one role.",
  },
  recommend_early_artist: {
    opening: "I've only been making music seriously for eight months and haven't released anything yet.",
    colors: "COLORS makes focused presentation feel possible without requiring an artist to already have a large catalogue, and I'd like to learn in a Forum that treats development seriously.",
    scene: "I'm early enough that I don't feel part of a scene yet; most of my process is voice notes, rough loops, and conversations with a few other beginners.",
    community: "A place where being unfinished is not the same as being unserious, and people can ask focused questions while learning how others complete work.",
    orientation: "I've been making music seriously for eight months, but I haven't released anything yet.",
    artist: "Saya Gray. Her songs let fragments and unfinished-feeling edges become part of the emotional structure.",
    song: "SHELL (OF A MAN), because it shows how an idea can keep changing shape without losing its centre.",
    practice: "I'm trying to turn voice notes and rough loops into complete songs.",
    feedback: "I'd ask focused questions about the stage I'm actually at and listen for how other people move from fragments to finished ideas.",
    participation: "I'd document the process, ask focused questions, and learn how other people finish ideas.",
    contribution: "I'd like to document the process, ask focused questions, and learn how other people finish ideas.",
    fallback: "I don't have releases or credits; what I do have is a clear problem I'm working on and a willingness to share the process honestly.",
  },
  vague: {
    opening: "I just want to see what is there.",
    colors: "I like COLORS.",
    scene: "I am not sure.",
    community: "People being together.",
    orientation: "I mostly listen.",
    artist: "There are loads. I cannot think of one right now.",
    song: "Anything good, really.",
    practice: "Nothing specific.",
    feedback: "I would say whatever came to mind.",
    participation: "I mostly listen.",
    contribution: "I do not know yet.",
    fallback: "I am not sure.",
  },
  contradictory: {
    opening: "I run a weekly listening group and want to build a thoughtful exchange around new music.",
    colors: "COLORS gives unfamiliar artists space without over-explaining them, and I want to continue that kind of attention.",
    scene: "I said I was part of a local listening scene, but I am not actually involved in one.",
    community: "Community means people returning and taking responsibility for what they share.",
    orientation: "I mostly listen. I do not actually host anything or share music regularly.",
    artist: "Mabe Fratti. Her arrangements keep changing the emotional centre of a song.",
    song: "Pantalla Azul, because the arrangement never lets one interpretation settle.",
    practice: "I said I run a group, but I do not actually host anything or share music regularly. I said it because it sounded like what you wanted.",
    feedback: "I try to separate my taste from the artist's intention.",
    participation: "I said I run a group, but I do not actually host anything or share music regularly. I said it because it sounded like what you wanted.",
    contribution: "I probably would not do much at first. I mainly want to look around.",
    fallback: "I said I run a group, but that was not true. I thought it would improve my chances.",
  },
  extractive: {
    opening: "I want direct access to emerging artists before everyone else so I can grow my platform.",
    colors: "COLORS finds artists early. I want the Forum to give me those contacts before they become difficult to reach.",
    scene: "I watch which local artists are starting to gain attention so I can contact them first.",
    community: "A useful network where I can find talent and build my audience.",
    orientation: "I regularly share discoveries.",
    artist: "Whoever is most likely to break next. I am less interested if there is no momentum behind them.",
    song: "I would share whichever clip is most likely to perform well and tag my channel.",
    practice: "I package discoveries quickly so my account becomes associated with an artist before other curators find them.",
    feedback: "I tell artists what will perform on my channel. If it does not fit, I move on.",
    participation: "I post discoveries early so people come to my platform for new names.",
    contribution: "I would use the member network to find talent early and direct attention back to my channel.",
    fallback: "The value for me is getting early access and turning it into growth for my platform.",
  },
  safety_boundary: {
    opening: "I manage a small music page and want to meet artists whose work I can help circulate.",
    colors: "COLORS presents artists with care. I want access to more work before it is public.",
    scene: "I follow local artists closely and often receive private works in progress.",
    community: "A place where artists and music pages can exchange material directly.",
    orientation: "I regularly share discoveries.",
    artist: "A local singer called Nia Vale. Her unfinished recordings feel more direct than the released versions.",
    song: "I would share an unreleased demo she sent me because people should hear how strong it is.",
    practice: "I post short clips from private demos when I think the exposure will help the artist.",
    feedback: "If an artist sends me an unfinished demo privately, I post a clip without asking. The exposure usually helps them even if they are hesitant.",
    participation: "I share discoveries and private previews with my audience.",
    contribution: "I would repost promising work from members, including private demos when I think attention would help them.",
    fallback: "I would post it without permission because I think the exposure outweighs their hesitation.",
  },
}

function answerFor(identity: IdentityName, question: string, ui?: { inputType?: string; options?: string[] }): string {
  const profile = profiles[identity]
  const value = questionText(question).toLowerCase()
  const fullValue = question.toLowerCase()
  if (
    ui?.inputType &&
    ["singleSelect", "multiSelect", "ranking"].includes(ui.inputType) &&
    ui.options?.length
  ) {
    if (ui.options.includes(profile.opening)) return profile.opening
    if (identity === "artist" && ui.options.includes("I like discussing music")) return "I like discussing music"
    if (identity === "curator" && ui.options.includes("I regularly share discoveries")) return "I regularly share discoveries"
    if (identity === "enthusiast" && ui.options.includes("I mostly listen")) return "I mostly listen"
    if (identity === "hybrid" && ui.options.includes("I regularly share discoveries")) return "I regularly share discoveries"
    if (identity === "recommend_active_artist" && ui.options.includes("I enjoy giving feedback")) return "I enjoy giving feedback"
    if (identity === "recommend_thoughtful_listener" && ui.options.includes("I mostly listen")) return "I mostly listen"
    if (identity === "recommend_constructive_curator" && ui.options.includes("I regularly share discoveries")) return "I regularly share discoveries"
    if (identity === "recommend_community_hybrid" && ui.options.includes("I regularly share discoveries")) return "I regularly share discoveries"
    if (identity === "recommend_early_artist" && ui.options.includes("I like discussing music")) return "I like discussing music"
    if (identity === "vague" && ui.options.includes("I mostly listen")) return "I mostly listen"
    if (identity === "contradictory" && ui.options.includes("I mostly listen")) return "I mostly listen"
    if (["extractive", "safety_boundary"].includes(identity) && ui.options.includes("I regularly share discoveries")) return "I regularly share discoveries"
    return ui.options[0]
  }
  if (/why do you want to be an early applicant/i.test(value)) return profile.opening
  if (/permission matters|did not want it posted|mainly as access|without using someone else's work/.test(value)) return profile.fallback
  if (/corrected something|what is true about how you actually take part/.test(value)) return profile.orientation
  if (value.includes("community mean")) return profile.community
  if (/\btell me about an? artist\b/.test(fullValue) || /\b(?:tell me about|who(?:'s| is)|name) an? artist\b[^?]{0,100}\b(?:attention|returning|deserves?|spend real time)\b|\bwho is making work\b/.test(value)) return profile.artist
  if (/\b(colors|this particular door|why (?:this|here)|here specifically|other communities|performances? cannot|performances? can(?:not|'t))\b/.test(value)) return profile.colors
  if (/\b(scene|where you live|where you are|outside it|adjacent to it|outsiders? might miss)\b/.test(value)) return profile.scene
  if (/\b(unfinished|feedback|honesty|not naturally for you|still working on)\b/.test(value)) return profile.feedback
  if (/\b(contribut(?:e|ing|ion)|first month|add to|start, share|bring (?:here|into)|do (?:here|in the forum)|do with that(?: in the forum)?|actually be doing|share with people here|realistically bring|something concrete|what do you actually do|what do you naturally give|what can you offer|what does that exchange look like|when you(?:'re| are) sharing|write notes|introduce artists|carry that forward|would you listen|useful to you in the forum|come back to do|what would that look like for you in (?:a|this) space)\b/.test(value)) return profile.contribution
  if (/\b(songs?|tracks?|pieces?|recommend|share with someone|hear first)\b/.test(value)) return profile.song
  if (/\b(own music|your music|your practice|trying to express|making at the moment|what kind of music|problem (?:you're|you are) trying to solve|actual problem|choice on your show|selecting artists|driving what you bring forward)\b/.test(value)) return profile.practice
  if (/\b(participate|around music|music become social|exchange with|exchange you already have|role do you|other people|discussion actually look like|people or spaces|doing or noticing with others|respond to someone's discovery|draws out a response)\b/.test(value)) return profile.participation
  if (value.includes("artist") || value.includes("making work") || value.includes("people tend to miss")) return profile.artist
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
  return {
    data,
    durationMs: Date.now() - started,
    serverTiming: response.headers.get("server-timing"),
  }
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
  const allRequestTimings: RequestTiming[] = []
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
      const requestTimings: RequestTiming[] = []
      const started = await jsonRequest(
        `${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/start`,
        plaintext,
        { applicant },
      )
      durations.push(started.durationMs)
      requestTimings.push({
        phase: "start",
        durationMs: started.durationMs,
        serverTiming: started.serverTiming,
      })
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
        requestTimings.push({
          phase: "message",
          durationMs: next.durationMs,
          serverTiming: next.serverTiming,
        })
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
      const expectedReviewerRecommendation = calibrationExpectedRecommendations[identity]
      const answerQualities = messageResult.data
        .filter((row) => row.role === "user")
        .map((row) => {
          const metadata = row.metadata as Record<string, unknown> | null
          const assessment = metadata?.answer_assessment as Record<string, unknown> | undefined
          return assessment?.quality
        })
        .filter((quality): quality is string => typeof quality === "string")
      const allText = assistantRows.map((row) => String(row.content)).join("\n")
      const normalizedQuestions = assistantRows.flatMap((row) =>
        (String(row.content).match(/[^?]+\?/g) ?? []).map((question) =>
          finalQuestion(question)
            .toLowerCase()
            .replace(/\bwhat's\b/g, "what is")
            .replace(/[^a-z0-9']+/g, " ")
            .trim(),
        ),
      )
      const repeatedQuestionCount = normalizedQuestions.length - new Set(normalizedQuestions).size
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
        processLanguage: /before we (?:wrap|finish|close|dig into (?:that|this)|get into (?:that|this)|go (?:any )?further|go deeper|continue)|before you explore|one last (?:thing|question)|let me (?:ask(?: you| this)?(?: differently| something (?:different|a bit more specific)| (?:a|another) (?:different )?way)?|try (?:it differently|something simpler))/i.test(allText),
        activeFalseClose,
        activeWithoutQuestion,
        reportEvidenceItems: Array.isArray(report?.evidence_summary) ? report.evidence_summary.length : 0,
        reportEvidenceReferences: Array.isArray(report?.evidence_references) ? report.evidence_references.length : 0,
        reportWeakItems: Array.isArray(report?.weak_or_missing_signals) ? report.weak_or_missing_signals.length : 0,
        safetyFlags: Array.isArray(report?.safety_or_integrity_flags) ? report.safety_or_integrity_flags : [],
        reviewerRecommendation: report?.advisory_recommendation ?? null,
        expectedReviewerRecommendation: expectedReviewerRecommendation ?? null,
        calibrationRecommendationMatched: expectedReviewerRecommendation
          ? report?.advisory_recommendation === expectedReviewerRecommendation
          : null,
        answerQualities,
        challengeTurns: assistantRows.filter((row) => {
          const metadata = row.metadata as Record<string, unknown> | null
          return metadata?.conversation_move === "challenge" || metadata?.response_mode === "challenge"
        }).length,
        receiptRepairs: assistantRows.filter((row) => {
          const metadata = row.metadata as Record<string, unknown> | null
          return metadata?.application_grounded_receipt_preserved === true
        }).length,
        insufficientEvidenceSignals: messageResult.data.filter((row) => {
          const metadata = row.metadata as Record<string, unknown> | null
          return Boolean(metadata?.application_insufficient_evidence)
        }).length,
        repeatedQuestionCount,
        genericThatMatters: /(?:^|[.!?]\s+)that matters(?:[—,.]|\b)/i.test(allText),
        averageMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
        maxMs: Math.max(...durations),
        terminalRequestMs: requestTimings.at(-1)?.durationMs ?? null,
        requestTimings,
        transcript,
      })
      allRequestTimings.push(...requestTimings)
      process.stdout.write(`\n[${identity} complete] ${sessionResult.data.status}\n`)
    }
  } finally {
    await supabase
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", keyRow.data.id)
  }

  const messageTimings = allRequestTimings.filter((timing) => timing.phase === "message")
  const totalTimings = messageTimings
    .map((timing) => serverTimingValue(timing.serverTiming, "total"))
    .filter((value): value is number => value !== null)
  const modelTimings = messageTimings
    .map((timing) => serverTimingValue(timing.serverTiming, "conversation_model"))
    .filter((value): value is number => value !== null)
  process.stdout.write(`\nIDENTITY_REPLAY_LATENCY=${JSON.stringify({
    browserObserved: latencyStats(messageTimings.map((timing) => timing.durationMs)),
    serverTotal: latencyStats(totalTimings),
    conversationModel: latencyStats(modelTimings),
  })}\n`)
  process.stdout.write(`IDENTITY_REPLAY_RESULT=${JSON.stringify(summaries)}\n`)
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.stack ?? error.message
      : JSON.stringify(error),
  )
  process.exit(1)
})
