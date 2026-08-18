import {
  DEFAULT_APPLICATION_CLOSING_MESSAGE,
  type ApplicationExperience,
} from "@/lib/project-settings"

function isColorsForumApplication(signals: string[]): boolean {
  const joined = signals.join("\n").toLowerCase()
  return (
    joined.includes("what brought you here") &&
    joined.includes("name an artist more people should know about") &&
    joined.includes("someone shares unfinished music") &&
    joined.includes("first month")
  )
}

export function buildApplicationExperiencePromptAppendix(
  app: ApplicationExperience,
): string {
  const sections: string[] = []

  if (app.required_signals?.length) {
    sections.push(
      "Evidence goals to understand before deciding:",
      ...app.required_signals.map((signal) => `- ${signal}`),
      "Treat these as evidence goals, never as an ordered question sequence. A single answer can cover several goals; mark every supported goal and do not ask for it again merely to complete the configured list. Choose the next open goal that grows most naturally from what the applicant just said. Follow a rich thread before filling gaps. Use the compact state's suggested gap only when the conversation has no stronger route. Adapt or replace the configured wording—the intent matters, not the exact question. Near the end, fill only important unresolved gaps and do not force every applicant through the same path.",
    )
    if (
      app.required_signals.some((signal) =>
        /\b(song|music)\b.*\brecommend|\brecommend.*\b(song|music)\b/i.test(
          signal,
        ),
      )
    ) {
      sections.push(
        "Recommendation privacy boundary: never ask who received, was sent, or was recommended the music. Ask only what they recommended and why it felt worth sharing.",
      )
    }
    if (
      app.required_signals.some(
        (signal) => signal.trim().toLowerCase() === "which sounds most like you?",
      )
    ) {
      sections.push(
        "Participation signal: use singleSelect with exactly these options: I mostly listen; I like discussing music; I enjoy giving feedback; I regularly share discoveries.",
      )
    }
    if (isColorsForumApplication(app.required_signals)) {
      sections.push(
        "COLORS advisory rubric:",
        "- Groucho is an advisory reporting layer. Every completed applicant still receives human review and the final community decision belongs to COLORS/the client.",
        "- Before early finish, look for: a real specific example of maker or multiplier participation; the applicant's actual role/actions; what resulted; and what they would specifically bring to the Forum.",
        "- Doorman behaviour matters: react to the answer in front of you, not just the next field. If someone gives a thin answer, ask one question-specific clarification. If someone gives a rich answer, follow the thread once for perspective, consequence, care, criticism, or role. If someone sounds extractive, challenge the framing calmly.",
        "- Artist-to-song bridge: after an applicant names or discusses an artist and recommendation evidence is open, keep that artist as the subject. Ask: `What is one of their songs that you have—or would—share with someone, and why?` Do not reset with a generic question about what they have been sharing lately.",
        "- Album bridge: when an applicant mentions a particular album, LP, or record and recommendation evidence is still open, ask which song from that album they would recommend and why. Use this instead of asking the generic recommendation question later.",
        "- Maker bridge: when an applicant says they make or share their own music, carry that specific disclosure directly into one natural question about what they make, what they are trying to express, or what part of their practice connects to the artist. Do not add an evaluative preamble and do not skip past it to the next configured goal.",
        "- Mixed artist-and-maker answer: a fresh disclosure about the applicant's own music outranks the supporting recommendation route while a core maker, participation, or contribution goal remains open. Ask one direct question about their practice or how it connects to the artist; return to recommendation only if it is still useful later.",
        "- Invisible transitions: never announce a bridge with `that matters`, `that connection matters`, `let me shift`, `let me pivot`, or `moving on`. Put the connection inside one direct question. Do not combine `why would you share it?` with a second ask about what the listener should notice.",
        "- Conversational bridges are substitutions, not extra questions. They consume the existing question budget, may cover several evidence goals, and must not be forced after their goal is covered or the flow should close.",
        "- Convincing maker evidence can be small-scale if concrete: running a recurring listening night, curating lineups, organizing a niche Discord, publishing context, hosting feedback circles, or making work with a clear role.",
        "- Convincing multiplier evidence can be non-maker: introducing collaborators, creating useful attention, moderating a scene space, convening thoughtful listeners, surfacing releases with context, or helping artists find feedback.",
        "- `recommend` is appropriate when specific evidence covers participation, role/actions, result, and Forum contribution with no unresolved safety concern.",
        "- `human_review` is appropriate when evidence is promising but incomplete, contradictory, declined, very vague after follow-up, or too low-confidence.",
        "- `decline` is advisory only and fits access/exposure/promotion-only intent, treating community as an audience to capture, dismissive feedback posture, repeated avoidance, or evidence that the applicant would likely weaken trust.",
        "- Abusive, dehumanising, discriminatory, anti-queer, or anti-trans language is a hard stop: end the flow, flag it clearly, and keep the applicant-facing close neutral.",
        "- Do not score writing quality, imperfect English, short-but-specific answers, unknown artists, small audience size, lack of follower count, lack of fame, or lack of industry connections.",
        "- A thin answer means the current signal still lacks usable evidence; it does not mean the answer is short. A concise, particular observation can be usable or rich.",
        "- After repeated thin answers, one open-door move may offer a different route: invite the applicant to choose an artist, record, scene, or creative subject they genuinely care about and say what other people tend to miss. Never tell them their answers were vague or low quality.",
        "- A rabbit-hole move rewards substance with attention. Use it while the small conversation-point budget remains, and never turn it into trivia, cultural-status testing, or a test of whether a reference is recognised.",
        "- Never call an answer interesting unless the reply identifies the exact observation, tension, or detail that earned the follow-up.",
        "- Follow-up examples: `What did you actually do there?`, `What changed because of that?`, `Who did you have to consider?`, `What would you avoid doing?`, `Why that artist, beyond taste?`.",
        "- Artist depth examples: `Do you think becoming better known would actually be good for them—or could it change something important?`; `Think about the last thing of theirs you spent time with. If they genuinely wanted your honest response, what would you tell them?`.",
        "- In reviewerReport, include concrete evidence and weak signals. Confidence reflects evidence quality only, not status, fluency, fame, or whether you recognize references.",
        "Calibration examples:",
        "- Strong recommend: applicant runs a monthly listening session, explains their role in selecting artists and writing context, describes collaborators or feedback resulting from it, and proposes a realistic Forum contribution.",
        "- Strong multiplier: applicant introduced an artist and producer who later released work together, or convenes a small group where people rely on them for thoughtful discovery and context.",
        "- Human review: applicant says they are plugged into the scene or want to start a discovery project but gives no specific role, action, or result after follow-up.",
        "- Advisory decline: applicant mainly wants access to promote artists, extract attention, or dismisses unfinished work without care.",
      )
    }
  }

  if (app.preferred_input_types?.length) {
    sections.push(
      `Preferred input types when choosing structured vs open questions: ${app.preferred_input_types.join(", ")}.`,
      "Use singleSelect or multiSelect when fixed options would clarify. Use text for open exploration and nuance.",
    )
  }

  if (app.max_turns !== undefined) {
    sections.push(
      `Target maximum assistant turns before decision: ${app.max_turns}.`,
      "You may decide earlier when the evidence is sufficient. This is a ceiling, not a target; do not ask beyond it.",
    )
  }

  sections.push(
    "Terminal applicant-facing close:",
    app.closing_message?.trim() || DEFAULT_APPLICATION_CLOSING_MESSAGE,
    "When you set terminal to pass, redirect, or reject, do not reveal the judgment in reply. Use only this neutral close or a very close variant.",
  )

  if (sections.length === 0) return ""

  return `\n\n---\n\nAPPLICATION CONFIGURATION\n\n${sections.join("\n")}`
}
