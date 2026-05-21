"use client"

import Link from "next/link"
import { setupLabel } from "@/components/admin/project-setup-ui"
import type { ProjectType } from "@/lib/project-settings"

type PersonaOption = {
  id: string
  name: string
  slug: string
}

type Props = {
  projectType: ProjectType
  personaId: string
  personas: PersonaOption[]
}

export function PersonaSetupNote({ projectType, personaId, personas }: Props) {
  const selected = personas.find((p) => p.id === personaId)

  return (
    <div
      style={{
        marginBottom: "1.25rem",
        padding: "0.75rem 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        fontSize: "0.72rem",
        lineHeight: 1.5,
        opacity: 0.45,
      }}
    >
      <span style={{ ...setupLabel, marginBottom: "0.35rem" }}>Prompt vs questions</span>
      {projectType === "onboarding" ? (
        <p style={{ margin: "0 0 0.5rem" }}>
          <strong style={{ fontWeight: 400, opacity: 0.75 }}>Questions</strong> define step order
          and profile keys. The{" "}
          <strong style={{ fontWeight: 400, opacity: 0.75 }}>persona prompt</strong> shapes
          acknowledgements, follow-ups, and boundaries when intelligence is enabled; it also
          guides profile extraction at the end.
        </p>
      ) : (
        <p style={{ margin: "0 0 0.5rem" }}>
          Gatekeeper conversations use the{" "}
          <strong style={{ fontWeight: 400, opacity: 0.75 }}>persona prompt</strong> as the
          system instructions (not the question list below).
        </p>
      )}
      {selected ? (
        <Link
          href="/admin/personas"
          style={{ color: "rgba(255,255,255,0.65)", textDecoration: "underline" }}
        >
          Edit prompt for {selected.name} →
        </Link>
      ) : (
        <Link
          href="/admin/personas"
          style={{ color: "rgba(255,255,255,0.65)", textDecoration: "underline" }}
        >
          Edit personas →
        </Link>
      )}
      {projectType === "onboarding" && (
        <span style={{ display: "block", marginTop: "0.35rem", opacity: 0.7 }}>
          See <code style={{ fontFamily: "monospace" }}>COLORS_PERSONA_SPEC.md</code> for a
          ready-made COLORS prompt and question set.
        </span>
      )}
    </div>
  )
}
