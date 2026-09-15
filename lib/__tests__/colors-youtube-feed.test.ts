import { describe, expect, it } from "vitest"
import {
  buildColorsMediaChoice,
  buildColorsMediaQuestion,
  COLORS_YOUTUBE_CHANNEL_ID,
  parseColorsYoutubePlaylistFeed,
} from "@/lib/colors-youtube-feed"

const entry = (videoId: string, title: string, channelId = COLORS_YOUTUBE_CHANNEL_ID) => `
  <entry>
    <yt:videoId>${videoId}</yt:videoId>
    <yt:channelId>${channelId}</yt:channelId>
    <title>${title}</title>
    <published>2026-09-14T16:00:06+00:00</published>
  </entry>`

describe("COLORS YouTube feed", () => {
  it("keeps only full shows from the official channel", () => {
    const xml = `<feed><yt:channelId>${COLORS_YOUTUBE_CHANNEL_ID}</yt:channelId>
      ${entry("96W0krDK3_A", "Villano Antillano - XXL | A COLORS SHOW")}
      ${entry("shorts12345", "Artist | A COLORS MOMENT")}
      ${entry("wPjrfpkEfMY", "JayaHadADream - Dive Not Dip | A COLORS SHOW")}
      ${entry("1SV7mlXnFJs", "Wrong artist - Track | A COLORS SHOW", "UC_not_colors")}
    </feed>`

    expect(parseColorsYoutubePlaylistFeed(xml)).toEqual([
      {
        videoId: "96W0krDK3_A",
        title: "Villano Antillano - XXL | A COLORS SHOW",
        artist: "Villano Antillano",
        publishedAt: "2026-09-14T16:00:06+00:00",
      },
      {
        videoId: "wPjrfpkEfMY",
        title: "JayaHadADream - Dive Not Dip | A COLORS SHOW",
        artist: "JayaHadADream",
        publishedAt: "2026-09-14T16:00:06+00:00",
      },
    ])
  })

  it("builds valid exact-limit questions for every supported mode", () => {
    const shows = [
      ["96W0krDK3_A", "Villano Antillano - XXL | A COLORS SHOW"],
      ["wPjrfpkEfMY", "JayaHadADream - Dive Not Dip | A COLORS SHOW"],
      ["1SV7mlXnFJs", "Maria Arnal - QUE ME QUITEN | A COLORS SHOW"],
      ["xKfqugkRIVQ", "Florence Road - No Better Woman | A COLORS SHOW"],
    ].map(([videoId, title]) => ({ videoId, title }))

    expect(buildColorsMediaChoice(shows, "remove")?.selection).toEqual({
      mode: "remove",
      minSelections: 1,
      maxSelections: 1,
    })
    expect(buildColorsMediaChoice(shows, "select")?.selection).toEqual({
      mode: "select",
      minSelections: 3,
      maxSelections: 3,
    })
    expect(buildColorsMediaChoice(shows, "rank")?.selection).toEqual({
      mode: "rank",
      minSelections: 3,
      maxSelections: 3,
    })
    expect(buildColorsMediaQuestion(shows, "remove")?.message).toContain(
      "three-performance programme",
    )
  })

  it("rejects a feed that does not identify the official channel", () => {
    expect(parseColorsYoutubePlaylistFeed("<feed />")).toEqual([])
  })
})
