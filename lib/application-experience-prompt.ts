import {
  DEFAULT_APPLICATION_CLOSING_MESSAGE,
  type ApplicationExperience,
} from "@/lib/project-settings"

export function buildApplicationExperiencePromptAppendix(
  app: ApplicationExperience,
): string {
  const sections: string[] = []

  if (app.required_signals?.length) {
    sections.push(
      "Required signals to understand before deciding:",
      ...app.required_signals.map((signal) => `- ${signal}`),
      "Treat these as an ordered signal sequence. Follow the compact state's nextRequiredSignalKey. When a signal label is written as a question, ask it verbatim. Infer from what the applicant already said and ask a follow-up only for a genuine gap.",
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
