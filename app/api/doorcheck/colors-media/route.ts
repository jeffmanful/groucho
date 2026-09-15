import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import {
  buildColorsMediaQuestion,
  COLORS_ALL_SHOWS_PLAYLIST_ID,
  COLORS_YOUTUBE_CHANNEL_ID,
  fetchLatestColorsShows,
} from "@/lib/colors-youtube-feed"
import type { MediaChoiceMode } from "@/lib/gatekeeper-interaction-spec"
import { requirePersonasReader, unauthorized } from "@/lib/org-access"

const MODES = new Set<MediaChoiceMode>(["select", "remove", "rank"])

export async function GET(request: NextRequest) {
  const actor = await resolveAdminActor()
  if (!actor) return unauthorized()
  const deny = await requirePersonasReader(actor)
  if (deny) return deny

  const requestedMode = request.nextUrl.searchParams.get("mode")
  const mode = MODES.has(requestedMode as MediaChoiceMode)
    ? (requestedMode as MediaChoiceMode)
    : "remove"

  try {
    const shows = await fetchLatestColorsShows(4)
    const question = buildColorsMediaQuestion(shows, mode)
    if (!question) throw new Error("Could not build a valid media question")

    return NextResponse.json({
      ...question,
      source: {
        channelId: COLORS_YOUTUBE_CHANNEL_ID,
        playlistId: COLORS_ALL_SHOWS_PLAYLIST_ID,
        channelUrl: "https://www.youtube.com/@COLORSxSTUDIOS",
        playlistUrl: `https://www.youtube.com/playlist?list=${COLORS_ALL_SHOWS_PLAYLIST_ID}`,
      },
    })
  } catch (error) {
    console.error("COLORS media test feed:", error)
    return NextResponse.json(
      { error: "The latest COLORS shows could not be loaded right now." },
      { status: 502 },
    )
  }
}
