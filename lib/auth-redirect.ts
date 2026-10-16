/** Only allow local paths, including after URL normalisation. */
export function safeAuthPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value)) return "/admin"
  try {
    const url = new URL(value, "https://groucho.invalid")
    return url.origin === "https://groucho.invalid" ? url.pathname + url.search + url.hash : "/admin"
  } catch { return "/admin" }
}

/** Preserve the browser host locally: PKCE cookies cannot cross localhost/127.0.0.1. */
export function authRequestOrigin(requestUrl: string, host: string | null): string {
  const url = new URL(requestUrl)
  if (process.env.NODE_ENV !== "production" && host && /^(localhost|127\.0\.0\.1):\d+$/.test(host)) {
    return `http://${host}`
  }
  return url.origin
}
