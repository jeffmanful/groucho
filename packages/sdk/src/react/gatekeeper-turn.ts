import type {
  GrouchoInteractionUi,
  StartSessionResponse,
} from "../client.js"

export const DEFAULT_GATEKEEPER_UI: GrouchoInteractionUi = {
  intent: "probe",
  inputType: "text",
  emotionalState: "neutral",
  visualState: "idle",
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
