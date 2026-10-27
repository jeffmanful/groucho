/**
 * Heuristic classification of automated / script clients from HTTP headers.
 * Tune lists as false positives appear; this is not a substitute for CAPTCHA or WAF rules.
 */

export type BotSignal = {
  likelyBot: boolean
  /** Stable token for logs (e.g. empty_user_agent, ua_contains:curl/). */
  reason?: string
}

/** CLI, HTTP libraries, headless automation — substring match on lowercased UA. */
const AUTOMATION_PATTERNS: readonly string[] = [
  "curl/",
  "wget/",
  "python-requests",
  "libwww-perl",
  "axios/",
  "go-http-client",
  "httpie/",
  "urllib",
  "okhttp",
  "java/",
  "scrapy",
  "httpx/",
  "headlesschrome",
  "playwright",
  "puppeteer",
  "phantomjs",
  "selenium",
  "webdriver",
]

/** Common crawlers / monitoring — substring match on lowercased UA. */
const CRAWLER_PATTERNS: readonly string[] = [
  "googlebot",
  "bingbot",
  "yandexbot",
  "baiduspider",
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "discordbot",
  "embedly",
  "ahrefsbot",
  "semrushbot",
  "dotbot",
  "petalbot",
  "applebot",
]

export function isLikelyAutomatedUserAgent(userAgent: string | null | undefined): BotSignal {
  const raw = userAgent?.trim() ?? ""
  if (!raw) {
    return { likelyBot: true, reason: "empty_user_agent" }
  }

  const lower = raw.toLowerCase()

  for (const p of AUTOMATION_PATTERNS) {
    if (lower.includes(p)) {
      return { likelyBot: true, reason: `ua_contains:${p}` }
    }
  }

  for (const p of CRAWLER_PATTERNS) {
    if (lower.includes(p)) {
      return { likelyBot: true, reason: `ua_contains:${p}` }
    }
  }

  return { likelyBot: false }
}

export function botSignalFromHeaders(headers: Headers): BotSignal {
  return isLikelyAutomatedUserAgent(headers.get("user-agent"))
}

/**
 * The bot check for the applicant's own browser. When a client's server relays the request without
 * forwarding the applicant's details, the user agent we see is the client's server, so we don't judge it.
 */
export function botSignalForApplicant(signals: { source: "forwarded" | "direct" | "relay"; userAgent: string | null }): BotSignal {
  if (signals.source === "relay") return { likelyBot: false }
  return isLikelyAutomatedUserAgent(signals.userAgent)
}
