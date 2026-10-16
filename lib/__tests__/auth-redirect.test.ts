import { describe, expect, it } from "vitest"
import { safeAuthPath, authRequestOrigin } from "../auth-redirect"

describe("safeAuthPath", () => {
  it("preserves local destinations", () => {
    expect(safeAuthPath("/admin/projects?view=all")).toBe("/admin/projects?view=all")
  })
  it.each([null, "https://evil.test", "//evil.test", "/\\evil.test", "/\nevil.test", " /admin"])("rejects external and malformed redirects: %s", value => {
    expect(safeAuthPath(value)).toBe("/admin")
  })
})

it("preserves the local browser origin for PKCE cookies", () => {
  expect(authRequestOrigin("http://localhost:3010/api/auth/google", "127.0.0.1:3010")).toBe("http://127.0.0.1:3010")
  expect(authRequestOrigin("https://groucho.test/api/auth/google", "evil.test")).toBe("https://groucho.test")
})
