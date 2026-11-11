/** COLORS adapter for the shared conversational runtime. Keep these exports stable for existing callers. */
import { postConversation } from "@/lib/conversation-engine"
import { colorsThinConversationPrompt, DEFAULT_CONSENT_QUESTION, DEFAULT_CONSENT_STATEMENT } from "@/lib/colors-conversation-profile"
import { COLORS_THIN_PILOT_MARKER } from "@/lib/colors-engine"
import { COLORS_FORUM_MEMBERSHIP_OBJECTIVE } from "@/lib/colors-forum-membership-brief"
import { colorsInteractionCatalog, resolveApplicationRichInteraction } from "@/lib/application-rich-interaction"
import { fetchLatestColorsShows, type ColorsYoutubeShow } from "@/lib/colors-youtube-feed"
import { colorsThinConversationModel } from "@/lib/gatekeeper-models"

export { colorsThinConversationPrompt, DEFAULT_CONSENT_QUESTION, DEFAULT_CONSENT_STATEMENT } from "@/lib/colors-conversation-profile"
export { COLORS_THIN_PILOT_MARKER, applicantAsksQuestion } from "@/lib/colors-engine"
export {
  partialReplyFromJson, conversationalClosing, oneQuestion, UNSCORED_TURN,
  isConsentQuestion,
  WRAP_UP_ANSWERS, SOFT_CLOSE_ANSWERS,
  conversationResponseTool as colorsThinResponseTool,
  CONVERSATION_OUTPUT_SCHEMA as COLORS_THIN_OUTPUT_SCHEMA,
} from "@/lib/conversation-engine"

export function postColorsThinConversation(input: Omit<Parameters<typeof postConversation>[0], "configuration"> & { personaPrompt?: string }) {
  const { personaPrompt, ...turn } = input
  return postConversation({ ...turn, configuration: {
    id: "colors_forum",
    marker: COLORS_THIN_PILOT_MARKER,
    model: colorsThinConversationModel(),
    operationPrefix: "colors_thin",
    loadMedia: () => fetchLatestColorsShows(4),
    consentQuestion: DEFAULT_CONSENT_QUESTION,
    consentStatement: DEFAULT_CONSENT_STATEMENT,
    resolveInteraction: (proposal, items) => resolveApplicationRichInteraction(proposal, items as ColorsYoutubeShow[]),
    buildPrompt: ({ shows, ...context }) => colorsThinConversationPrompt({
      ...context, objective: COLORS_FORUM_MEMBERSHIP_OBJECTIVE,
      personaPrompt,
      mediaCatalog: colorsInteractionCatalog(shows as ColorsYoutubeShow[]),
    }),
  } })
}
