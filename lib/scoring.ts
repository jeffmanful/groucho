export type Score = {
  specificity: number
  authenticity: number
  cultural_depth: number
  overall: number
}

export type ConversationMessage = {
  role: "user" | "assistant"
  content: string
}
