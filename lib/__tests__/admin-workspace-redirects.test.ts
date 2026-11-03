import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))

describe("consolidated admin routes", () => {
  it.each([
    ["entries", "applications/entries"],
    ["cohorts", "applications/cohorts"],
    ["decisions", "applications/decisions"],
    ["conversations", "integrations/conversations"],
  ])("keeps old %s links scoped to the same project and selection", async (old, target) => {
    const routes = {
      entries: () => import("@/app/admin/organisations/[orgId]/entries/page"),
      cohorts: () => import("@/app/admin/organisations/[orgId]/cohorts/page"),
      decisions: () => import("@/app/admin/organisations/[orgId]/decisions/page"),
      conversations: () => import("@/app/admin/organisations/[orgId]/conversations/page"),
    }
    const { default: Page } = await routes[old as keyof typeof routes]()
    await expect(Page({
      params: Promise.resolve({ orgId: "colors" }),
      searchParams: Promise.resolve({ project: "pilot", cohort: "pool", new: "1", session: "person", view: "report", tag: ["one", "two"] }),
    })).rejects.toThrow(`redirect:/admin/organisations/colors/${target}?project=pilot&cohort=pool&new=1&session=person&view=report&tag=one&tag=two`)
  })
})
