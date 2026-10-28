import type {
  GrouchoInteractionUi,
  StartSessionResponse,
  Session,
  ApplicantIdentity,
} from "../client.js"
import { isTerminalOutcome } from "./decision-moment.js"

export const DEFAULT_GATEKEEPER_UI: GrouchoInteractionUi = {
  intent: "probe",
  inputType: "text",
  emotionalState: "neutral",
  visualState: "idle",
}

/** Restore only saved intake matching this entry; a completed session needs its actual close. */
export function gatekeeperRestoration(session: Session, intakeMode: "email" | "community" | "artist", expectedEmail?: string) {
  const applicant = session.applicant as ApplicantIdentity | undefined
  if (!applicant?.email || (expectedEmail && applicant.email.toLowerCase() !== expectedEmail.toLowerCase())) return null
  if (intakeMode === "community" && !applicant.details || intakeMode === "artist" && !applicant.artist) return null
  if (session.status === "active") return { applicant, outcome: "active" as const, turn: null }
  if (!session.status || !isTerminalOutcome(session.status) || !session.message?.trim()) return null
  return { applicant, outcome: session.status, turn: { message: session.message, ui: session.ui ?? DEFAULT_GATEKEEPER_UI } }
}

export function turnFromStartResponse(response: StartSessionResponse): {
  message: string
  ui: GrouchoInteractionUi
} {
  return {
    message: response.message,
    ui: response.ui ?? DEFAULT_GATEKEEPER_UI,
  }
}
