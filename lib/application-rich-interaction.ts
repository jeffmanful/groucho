import {
  normaliseMediaChoiceInteraction,
  type MediaChoiceInteraction,
  type MediaChoiceMode,
  type ReferenceCard,
} from "@/lib/gatekeeper-interaction-spec"
import {
  buildColorsMediaChoice,
  type ColorsYoutubeShow,
} from "@/lib/colors-youtube-feed"

export type ApplicationRichInteraction =
  | {
      kind: "reference"
      question: string
      purpose: string
      cards: ReferenceCard[]
    }
  | {
      kind: "choice"
      question: string
      purpose: string
      interaction: MediaChoiceInteraction
    }

export function colorsInteractionCatalog(shows: ColorsYoutubeShow[]) {
  return shows.slice(0, 4).map((show) => ({
    id: `yt_${show.videoId}`,
    title: show.title.replace(/\s*\|\s*A COLORS SHOW\s*$/i, ""),
    ...(show.artist ? { artist: show.artist } : {}),
    availableFormats: ["videoChoice", "imageReference", "linkReference"],
  }))
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function conciseQuestion(value: unknown): string | null {
  if (typeof value !== "string") return null
  const question = value.trim()
  if (question.length < 12 || question.length > 320 || /https?:\/\//i.test(question)) {
    return null
  }
  return question.endsWith("?") ? question : null
}

/** Resolve model-selected IDs only against the server's official COLORS feed. */
export function resolveApplicationRichInteraction(
  raw: unknown,
  shows: ColorsYoutubeShow[],
): ApplicationRichInteraction | null {
  const proposal = record(raw)
  if (!proposal || proposal.kind === "none") return null
  const question = conciseQuestion(proposal.question)
  const purpose = typeof proposal.purpose === "string"
    ? proposal.purpose.trim().slice(0, 180)
    : ""
  const selectedIds = Array.isArray(proposal.assetIds)
    ? proposal.assetIds.filter((id): id is string => typeof id === "string")
    : []
  if (!question || !purpose || selectedIds.length === 0 ||
    selectedIds.length !== new Set(selectedIds).size) return null
  const byId = new Map(shows.slice(0, 4).map((show) => [`yt_${show.videoId}`, show]))
  const selectedShows = selectedIds.map((id) => byId.get(id))
  if (selectedShows.some((show) => !show)) return null
  const approvedShows = selectedShows as ColorsYoutubeShow[]

  if (proposal.kind === "reference") {
    if (selectedIds.length > 2 ||
      (proposal.format !== "image" && proposal.format !== "link")) return null
    const kind = proposal.format
    return {
      kind: "reference",
      question,
      purpose,
      cards: approvedShows.map((show) => ({
        id: `yt_${show.videoId}`,
        kind,
        title: show.title.replace(/\s*\|\s*A COLORS SHOW\s*$/i, ""),
        url: `https://www.youtube.com/watch?v=${show.videoId}`,
        ...(kind === "image" ? {
          imageUrl: `https://i.ytimg.com/vi/${show.videoId}/hqdefault.jpg`,
          alt: `${show.title} official COLORS performance thumbnail`,
        } : {}),
      })),
    }
  }

  if (proposal.kind !== "choice" || proposal.format !== "video" || selectedIds.length < 2 ||
    selectedIds.length > 4 ||
    (proposal.mode !== "select" && proposal.mode !== "remove" && proposal.mode !== "rank")) {
    return null
  }
  const mode = proposal.mode as MediaChoiceMode
  const rationalePrompt = typeof proposal.rationalePrompt === "string"
    ? proposal.rationalePrompt.trim()
    : ""
  if (rationalePrompt.length < 8 || rationalePrompt.length > 180) return null
  const base = buildColorsMediaChoice(approvedShows, mode)
  if (!base) return null
  const selectionCount = mode === "rank" ? approvedShows.length : 1
  const interaction = normaliseMediaChoiceInteraction({
    ...base,
    selection: {
      mode,
      minSelections: selectionCount,
      maxSelections: selectionCount,
    },
    rationale: {
      ...base.rationale,
      prompt: rationalePrompt,
    },
  })
  return interaction ? { kind: "choice", question, purpose, interaction } : null
}
