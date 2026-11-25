import type { NextRequest } from "next/server"
import { colorsDemoProject } from "@/lib/colors-demo-access"
import { demoSession, demoTester } from "@/lib/colors-demo-token"
import { DEMO_LINK_HEADER, DEMO_UUID, demoJson, loadSharedColorsDemo, sharedColorsSessionId } from "@/lib/project-demo-links"
import { isSameOriginMutation } from "@/lib/platform-admin-access"
import { checkRateLimit } from "@/lib/rate-limit"

export async function authorizeColorsDemo(req: NextRequest, action: "project" | "start" | "session", clientId = "") {
  const token = req.headers.get(DEMO_LINK_HEADER)
  if (token !== null) {
    if (req.method === "POST" && !isSameOriginMutation(req)) return demoJson({ error: "Invalid request origin." }, 403)
    try {
      if (action !== "project" && !DEMO_UUID.test(clientId)) return demoJson({ error: "Invalid demo session." }, 400)
      const link = await loadSharedColorsDemo(token)
      if (!link) return demoJson({ error: "This demo link is unavailable. Ask the sender for a new link." }, 404)
      if (req.method === "POST" && !checkRateLimit({
        namespace: "shared-colors-demo", key: link.id, limit: 40, windowMs: 60_000,
      }).ok) return demoJson({ error: "Please wait a minute before trying again." }, 429)
      return { project: link.colors, link, tester: null, sessionId: action === "project" ? "" : sharedColorsSessionId(link.id, clientId) }
    } catch {
      return demoJson({ error: "Demo is unavailable. Please retry." }, 503)
    }
  }
  const tester = await (action === "session" ? demoSession(req, clientId) : demoTester(req))
  if (!tester) return demoJson({ error: action === "session" ? "Unauthorized demo session" : "Unauthorized" }, 401)
  const project = await colorsDemoProject()
  if (!project) return demoJson({ error: "COLORS Forum demo is not configured" }, 503)
  return { project, link: null, tester, sessionId: clientId }
}
