import { describe, expect, it, vi } from "vitest"
vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }))
import { supabase } from "@/lib/supabase"
import { startGatekeeperSession } from "@/lib/start-gatekeeper-session"
import { normalizeProjectSettings } from "@/lib/project-settings"
describe("invitation-only starts", () => {
  it("rejects missing or malformed invitations before creating a session, including identity-free auto-starts", async () => {
    const settings = normalizeProjectSettings({ application_invitation_required: true, project_type: "gatekeeper" })
    for (const invitationToken of [undefined, "invalid-token"]) {
      const response = await startGatekeeperSession({ sessionId: "guessed-session", invitationToken, allowMissingApplicantIdentity: true, context: { organisationId: "org", projectId: "project", apiKeyId: null, settings }, projectSettings: settings })
      expect(response.status).toBe(403)
    }
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
