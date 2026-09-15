import { describe, expect, it } from "vitest"
import {
  changedProjectSettingKeys,
  projectSettingsAuditActor,
} from "@/lib/project-settings-audit"

describe("project settings audit", () => {
  it("reports only top-level settings that changed", () => {
    expect(
      changedProjectSettingKeys(
        { session_mode: "live", profile_extract_on: false, untouched: 1 },
        { session_mode: "live", profile_extract_on: ["passed"], added: true, untouched: 1 },
      ),
    ).toEqual(["added", "profile_extract_on"])
  })

  it("records member and platform identity safely", () => {
    expect(
      projectSettingsAuditActor({
        kind: "member",
        userId: "member-1",
        email: "member@example.com",
      }),
    ).toEqual({
      actor_kind: "member",
      actor_user_id: "member-1",
      actor_email: "member@example.com",
    })
    expect(projectSettingsAuditActor({ kind: "platform", email: "ops@example.com" })).toEqual({
      actor_kind: "platform",
      actor_user_id: null,
      actor_email: "ops@example.com",
    })
  })
})
