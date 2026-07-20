import type { GrouchoInteractionUi } from "../client.js"

export function serializeInteractionInput(
  inputType: GrouchoInteractionUi["inputType"],
  value: string | string[],
): string {
  if (inputType === "multiSelect" && Array.isArray(value)) {
    return value.length > 0 ? `Selected: ${value.join(", ")}` : ""
  }
  if (typeof value === "string") return value.trim()
  return value.join(", ")
}
