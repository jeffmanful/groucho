import { describe, expect, it } from "vitest"
import { isProjectView, projectInPath, projectStorageKey, projectSwitchHref, resolveProjectSelection, withProject } from "@/lib/admin-project-selection"

const projects = [{ id: "a" }, { id: "b" }]
const base = "/admin/organisations/colors"

describe("shared dashboard project selection", () => {
  it("asks on first visit with several projects, and selects a sole project", () => {
    expect(resolveProjectSelection(projects, null, null).project).toBeNull()
    expect(resolveProjectSelection([projects[0]], null, null).project?.id).toBe("a")
  })

  it("honours explicit links and browser history ahead of the remembered project", () => {
    expect(resolveProjectSelection(projects, "b", "a").project?.id).toBe("b")
    expect(resolveProjectSelection(projects, "a", "b").project?.id).toBe("a")
    expect(resolveProjectSelection(projects, null, "b").project?.id).toBe("b")
  })

  it("never silently falls back from unavailable projects, even with only one remaining", () => {
    expect(resolveProjectSelection(projects, "removed", "a")).toEqual({ project: null, unavailable: true })
    expect(resolveProjectSelection([projects[0]], null, "removed")).toEqual({ project: null, unavailable: true })
    expect(resolveProjectSelection([], null, null)).toEqual({ project: null, unavailable: false })
  })

  it("keeps remembered selections separate by account and organisation", () => {
    expect(projectStorageKey("user-a", "colors")).not.toBe(projectStorageKey("user-b", "colors"))
    expect(projectStorageKey("user-a", "colors")).not.toBe(projectStorageKey("user-a", "other"))
  })

  it("takes the project from a detail path ahead of query parameters", () => {
    expect(projectInPath(`${base}/applications/b/person`)).toBe("b")
    expect(projectInPath(`${base}/projects/b/edit`)).toBe("b")
    expect(projectInPath(`${base}/projects/new`)).toBeNull()
  })

  it("scopes review screens while allowing organisation settings and directory access", () => {
    for (const view of ["", "applications", "entries", "cohorts", "decisions", "conversations", "integrations", "advanced", "projects/b/edit"]) {
      expect(isProjectView(`${base}/${view}`), view).toBe(true)
    }
    for (const view of ["/organisation-overview", "/settings", "/projects", "/projects/new", "/personas"]) {
      expect(isProjectView(`${base}${view}`), view).toBe(false)
    }
  })

  it("preserves status and fragment in navigation links", () => {
    expect(withProject(`${base}/applications?queue=approved#list`, "b")).toBe(`${base}/applications?queue=approved&project=b#list`)
  })

  it("switches from a person's detail to the new project's list", () => {
    expect(projectSwitchHref(`${base}/applications/a/person`, "project=a&session=person&queue=approved&offset=50", "colors", "b"))
      .toBe(`${base}/applications?project=b`)
  })

  it("retains the project settings subpage and clears the old conversation selection", () => {
    expect(projectSwitchHref(`${base}/projects/a/edit`, "", "colors", "b")).toBe(`${base}/projects/b/edit?project=b`)
    expect(projectSwitchHref(`${base}/conversations`, "session=old&view=report", "colors", "b")).toBe(`${base}/conversations?project=b`)
  })
})
