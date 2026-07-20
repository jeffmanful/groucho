"use client"

import type { OnboardingExperience } from "@/lib/project-settings"
import { setupLabel } from "@/components/admin/project-setup-ui"

type Props = {
  value: OnboardingExperience
  onChange: (value: OnboardingExperience) => void
}

const TOGGLES: {
  key: keyof OnboardingExperience
  label: string
  description: string
}[] = [
  {
    key: "bridge_enabled",
    label: "Bridge acknowledgements",
    description: "Short persona-voiced transitions between questions.",
  },
  {
    key: "followup_enabled",
    label: "Follow-up prompts",
    description: "Ask once for more detail on brief or vague answers.",
  },
  {
    key: "boundary_enabled",
    label: "Boundary responses",
    description: "Calm pushback when answers undermine dignity or safety.",
  },
  {
    key: "personalized_completion",
    label: "Personalized completion",
    description: "Custom closing line after the last answer.",
  },
]

export function OnboardingExperienceToggles({ value, onChange }: Props) {
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <span style={{ ...setupLabel, display: "block", marginBottom: "0.5rem" }}>
        Onboarding intelligence (optional)
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {TOGGLES.map((t) => (
          <label
            key={t.key}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.5rem",
              fontSize: "0.78rem",
              opacity: 0.85,
            }}
          >
            <input
              type="checkbox"
              checked={value[t.key]}
              onChange={(e) => onChange({ ...value, [t.key]: e.target.checked })}
              style={{ marginTop: "0.15rem" }}
            />
            <span>
              <strong style={{ fontWeight: 400 }}>{t.label}</strong>
              <span style={{ display: "block", opacity: 0.55, fontSize: "0.7rem" }}>
                {t.description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
