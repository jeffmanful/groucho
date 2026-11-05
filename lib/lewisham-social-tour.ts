import type { ConversationChoice } from "@/lib/conversation-engine"

export const TOUR_NIGHTS = [
  "Glasgow, Thu 8 Apr", "Manchester, Sat 10 Apr", "Leeds, Sun 11 Apr",
  "Bristol, Tue 13 Apr", "Dublin, Fri 16 Apr", "London, Sat 17 Apr", "London, Sun 18 Apr",
] as const
export const TOUR_CITIES = [...new Set(TOUR_NIGHTS.map(night => night.split(",")[0]))]
export const SEE_OTHER_CITIES = "See other cities"

/** Destination takes priority over travel origin. Only approved dates become ticket facts. */
export function resolveLewishamChoice(key: string, choice: ConversationChoice, details: Record<string, string>, message: string): ConversationChoice {
  if (key !== "night" || message.trim() === SEE_OTHER_CITIES) return choice
  const city = details.preferredCity
  const nights = TOUR_NIGHTS.filter(night => night.split(",")[0] === city)
  if (!nights.length) return choice
  return { ...choice, question: `${city}, then. What night would you prefer?`, options: [...nights, SEE_OTHER_CITIES] }
}
