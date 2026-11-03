export type AdminSearchParams = Record<string, string | string[] | undefined>

/** Keep project selection, cohort links and focused sessions when old routes move. */
export function adminRouteRedirect(path: string, search: AdminSearchParams): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item)
  }
  return `${path}${params.size ? `?${params}` : ""}`
}
