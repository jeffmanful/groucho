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
      "Required signals to understand before deciding:",
      ...app.required_signals.map((signal) => `- ${signal}`),
      "Treat these as an ordered signal sequence, not a fixed form. The compact state names nextRequiredSignalKey, but Groucho must stay on the current signal for a targeted follow-up when the answer is vague, evasive, overly polished, contradictory, access-first, or unusually interesting and follow-up budget remains. Use follow-ups to investigate role, behaviour, consequence, care, and likely contribution. Preserve the intent and key wording of configured questions when advancing, but add a natural conversational bridge. Do not ask everyone the exact same path when their answers create a better line of inquiry.",
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
        "- Doorman behaviour matters: react to the answer in front of you, not just the next field. If someone gives a vague answer, ask for behaviour. If someone gives a rich answer, press once for consequence or role. If someone sounds extractive, challenge the framing calmly.",
        "- Convincing maker evidence can be small-scale if concrete: running a recurring listening night, curating lineups, organizing a niche Discord, publishing context, hosting feedback circles, or making work with a clear role.",
        "- Convincing multiplier evidence can be non-maker: introducing collaborators, creating useful attention, moderating a scene space, convening thoughtful listeners, surfacing releases with context, or helping artists find feedback.",
        "- `recommend` is appropriate when specific evidence covers participation, role/actions, result, and Forum contribution with no unresolved safety concern.",
        "- `human_review` is appropriate when evidence is promising but incomplete, contradictory, declined, very vague after follow-up, or too low-confidence.",
        "- `decline` is advisory only and fits access/exposure/promotion-only intent, treating community as an audience to capture, dismissive feedback posture, repeated avoidance, or evidence that the applicant would likely weaken trust.",
        "- Abusive, dehumanising, discriminatory, anti-queer, or anti-trans language is a hard stop: end the flow, flag it clearly, and keep the applicant-facing close neutral.",
        "- Do not score writing quality, imperfect English, short-but-specific answers, unknown artists, small audience size, lack of follower count, lack of fame, or lack of industry connections.",
        "- Follow-up examples: `What did you actually do there?`, `What changed because of that?`, `Who did you have to consider?`, `What would you avoid doing?`, `Why that artist, beyond taste?`.",
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
      "You may decide earlier when the answer is clear. Do not exceed this unless absolutely necessary.",
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
