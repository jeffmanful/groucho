/** Project selection is shared by the organisation's review screens. */
export function projectStorageKey(actor: string, organisationId: string): string {
  return `groucho_project:${encodeURIComponent(actor)}:${encodeURIComponent(organisationId)}`
}

export function projectInPath(pathname: string): string | null {
  const match = /\/applications\/([^/]+)\/[^/]+|\/projects\/([^/]+)/.exec(pathname)
  const id = match?.[1] ?? match?.[2]
  return id && id !== "new" ? decodeURIComponent(id) : null
}

export function isProjectView(pathname: string): boolean {
  return /^\/admin\/organisations\/[^/]+\/?$/.test(pathname) || /\/organisations\/[^/]+\/(applications|entries|cohorts|decisions|conversations|integrations|advanced)(\/|$)/.test(pathname) || projectInPath(pathname) !== null
}

export function resolveProjectSelection<T extends { id: string }>(projects: T[], requested: string | null, remembered: string | null) {
  const wanted = requested ?? remembered
  return {
    project: wanted !== null ? projects.find((project) => project.id === wanted) ?? null : projects.length === 1 ? projects[0] : null,
    unavailable: wanted !== null && !projects.some((project) => project.id === wanted),
  }
}

export function withProject(href: string, projectId: string | null): string {
  if (!projectId) return href
  const url = new URL(href, "https://groucho.invalid")
  url.searchParams.set("project", projectId)
  return url.pathname + url.search + url.hash
}

/** Switching from a person's detail returns to the list; project settings keep their subpage. */
export function projectSwitchHref(pathname: string, search: string, orgId: string, projectId: string): string {
  const base = `/admin/organisations/${orgId}`
  let path = pathname
  if (/\/applications\/[^/]+\/[^/]+$/.test(pathname)) path = `${base}/applications`
  else if (pathname.startsWith(`${base}/projects/`) && projectInPath(pathname)) {
    path = pathname.replace(/\/projects\/[^/]+/, `/projects/${projectId}`)
  }
  const params = new URLSearchParams(search)
  for (const key of ["session", "offset", "queue", "view", "cohort", "new"]) params.delete(key)
  return withProject(`${path}${params.size ? `?${params}` : ""}`, projectId)
}
