// Short relative times for the dashboard: "2 hours", "3 days".
export function durationSince(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ""
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (minutes < 60) return minutes <= 1 ? "a minute" : `${minutes} minutes`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? "an hour" : `${hours} hours`
  const days = Math.round(hours / 24)
  return days === 1 ? "a day" : `${days} days`
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "–"
  const date = new Date(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })
}
