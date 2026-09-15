import {
  normaliseMediaChoiceInteraction,
  type MediaChoiceInteraction,
  type MediaChoiceMode,
} from "@/lib/gatekeeper-interaction-spec"

export const COLORS_YOUTUBE_CHANNEL_ID = "UC2Qw1dzXDBAZPwS7zm37g8g"
export const COLORS_ALL_SHOWS_PLAYLIST_ID =
  "PLWa4R2I19VH7Mtxo3VvqwnNlXgLpf4_d3"

const COLORS_PLAYLIST_FEED = `https://www.youtube.com/feeds/videos.xml?playlist_id=${COLORS_ALL_SHOWS_PLAYLIST_ID}`
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/

export type ColorsYoutubeShow = {
  videoId: string
  title: string
  artist?: string
  publishedAt?: string
}

export type ColorsMediaQuestion = {
  message: string
  interaction: MediaChoiceInteraction
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim()
}

function elementText(entry: string, tag: string): string | undefined {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = entry.match(
    new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i"),
  )
  return match ? decodeXmlText(match[1]) : undefined
}

export function parseColorsYoutubePlaylistFeed(
  xml: string,
  limit = 4,
): ColorsYoutubeShow[] {
  if (!xml.includes(`<yt:channelId>${COLORS_YOUTUBE_CHANNEL_ID}</yt:channelId>`)) {
    return []
  }

  const shows: ColorsYoutubeShow[] = []
  const seen = new Set<string>()
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const entry = match[1]
    const channelId = elementText(entry, "yt:channelId")
    const videoId = elementText(entry, "yt:videoId")
    const title = elementText(entry, "title")
    if (
      channelId !== COLORS_YOUTUBE_CHANNEL_ID ||
      !videoId ||
      !YOUTUBE_VIDEO_ID_RE.test(videoId) ||
      !title ||
      !/\|\s*A COLORS SHOW\s*$/i.test(title) ||
      seen.has(videoId)
    ) {
      continue
    }

    seen.add(videoId)
    const artist = title.split(/\s+-\s+/, 1)[0]?.trim()
    const publishedAt = elementText(entry, "published")
    shows.push({
      videoId,
      title,
      ...(artist ? { artist } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    })
    if (shows.length >= Math.max(2, Math.min(8, limit))) break
  }
  return shows
}

export function buildColorsMediaChoice(
  shows: ColorsYoutubeShow[],
  mode: MediaChoiceMode = "remove",
): MediaChoiceInteraction | undefined {
  const options = shows.slice(0, 8).map((show) => ({
    id: `yt_${show.videoId}`,
    label: show.title.replace(/\s*\|\s*A COLORS SHOW\s*$/i, ""),
    ...(show.publishedAt
      ? { description: `Official COLORS release · ${show.publishedAt.slice(0, 10)}` }
      : {}),
    media: {
      type: "video" as const,
      provider: "youtube" as const,
      videoId: show.videoId,
      title: show.title,
      ...(show.artist ? { artist: show.artist } : {}),
      thumbnailUrl: `https://i.ytimg.com/vi/${show.videoId}/hqdefault.jpg`,
      alt: `${show.title} official COLORS performance thumbnail`,
    },
  }))
  if (options.length < 2) return undefined

  const selectionCount = mode === "remove" ? 1 : Math.min(3, options.length)
  const idSuffix = options
    .map((option) => option.media.videoId.slice(0, 6))
    .join("_")
  return normaliseMediaChoiceInteraction({
    id: `colors_${mode}_${idSuffix}`,
    options,
    selection: {
      mode,
      minSelections: selectionCount,
      maxSelections: selectionCount,
    },
    rationale: {
      required: true,
      prompt:
        mode === "remove"
          ? "What does that decision protect in the programme?"
          : mode === "rank"
            ? "What is the thinking behind this order?"
            : "What connects these performances for you?",
      minLength: 24,
      maxLength: 1200,
    },
  })
}

export function buildColorsMediaQuestion(
  shows: ColorsYoutubeShow[],
  mode: MediaChoiceMode = "remove",
): ColorsMediaQuestion | undefined {
  const interaction = buildColorsMediaChoice(shows, mode)
  if (!interaction) return undefined
  return {
    message:
      mode === "remove"
        ? "Four recent COLORS shows. You’re shaping a three-performance programme with a clear point of view. Which one do you leave out?"
        : mode === "rank"
          ? "Choose three recent COLORS shows for one programme, then put them in the order you would present them."
          : "Choose three recent COLORS shows that you would programme together.",
    interaction,
  }
}

export async function fetchLatestColorsShows(limit = 4): Promise<ColorsYoutubeShow[]> {
  const response = await fetch(COLORS_PLAYLIST_FEED, {
    headers: { Accept: "application/atom+xml, application/xml;q=0.9" },
    signal: AbortSignal.timeout(8_000),
    next: { revalidate: 900 },
  })
  if (!response.ok) {
    throw new Error(`Official COLORS feed returned ${response.status}`)
  }
  const xml = await response.text()
  if (xml.length > 1_500_000) throw new Error("Official COLORS feed was too large")
  const shows = parseColorsYoutubePlaylistFeed(xml, limit)
  if (shows.length < Math.min(4, limit)) {
    throw new Error("Official COLORS feed did not contain enough full shows")
  }
  return shows
}
