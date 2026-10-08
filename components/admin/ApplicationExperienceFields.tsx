"use client"

import type { CSSProperties } from "react"
import {
  DEFAULT_APPLICATION_CLOSING_MESSAGE,
  DEFAULT_APPLICATION_OPENING_MESSAGE,
  MAX_APPLICATION_MAX_TURNS,
  MIN_APPLICATION_MAX_TURNS,
  type ApplicationOpeningInputType,
} from "@/lib/project-settings"
import { setupInput, setupLabel } from "@/components/admin/project-setup-ui"

const INPUT_TYPE_OPTIONS: Array<{
  value: "" | ApplicationOpeningInputType
  label: string
}> = [
  { value: "", label: "Default (text)" },
  { value: "text", label: "Text" },
  { value: "singleSelect", label: "Single select" },
  { value: "multiSelect", label: "Multi select" },
  { value: "mediaChoice", label: "Media choice with rationale" },
]

const PREFERRED_INPUT_OPTIONS: Array<{
  value: ApplicationOpeningInputType
  label: string
}> = [
  { value: "text", label: "Text" },
  { value: "singleSelect", label: "Single select" },
  { value: "multiSelect", label: "Multi select" },
  { value: "mediaChoice", label: "Media choice" },
]

export type ApplicationExperienceFieldValues = {
  openingMessage: string
  closingMessage: string
  openingInputType: "" | ApplicationOpeningInputType
  openingOptions: string
  requiredSignals: string
  preferredInputTypes: ApplicationOpeningInputType[]
  maxTurns: number | ""
}

type ApplicationExperienceFieldsProps = ApplicationExperienceFieldValues & {
  onChange: (patch: Partial<ApplicationExperienceFieldValues>) => void
  labelStyle?: CSSProperties
  inputStyle?: CSSProperties
}

function textareaStyle(inputStyle?: CSSProperties): CSSProperties {
  return {
    ...setupInput,
    ...(inputStyle ?? {}),
    maxWidth: "100%",
    minHeight: "4rem",
    resize: "vertical",
    border: "1px solid rgba(255,255,255,0.1)",
    padding: "0.45rem 0",
  }
}

export function ApplicationExperienceFields({
  openingMessage,
  closingMessage,
  openingInputType,
  openingOptions,
  requiredSignals,
  preferredInputTypes,
  maxTurns,
  onChange,
  labelStyle = setupLabel,
  inputStyle,
}: ApplicationExperienceFieldsProps) {
  const showOpeningOptions =
    openingInputType === "singleSelect" ||
    openingInputType === "multiSelect" ||
    openingInputType === "mediaChoice"

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Opening message</label>
        <textarea
          value={openingMessage}
          onChange={(e) => onChange({ openingMessage: e.target.value })}
          rows={3}
          placeholder={DEFAULT_APPLICATION_OPENING_MESSAGE}
          style={textareaStyle(inputStyle)}
        />
        <p style={{ fontSize: "0.72rem", opacity: 0.35, lineHeight: 1.45 }}>
          Shown as the first assistant message before the applicant replies.
          Tone and decision logic still live in the persona.
        </p>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Opening input type</label>
        <select
          value={openingInputType}
          onChange={(e) =>
            onChange({
              openingInputType: e.target.value as "" | ApplicationOpeningInputType,
            })
          }
          style={{
            ...setupInput,
            ...(inputStyle ?? {}),
            border: "1px solid rgba(255,255,255,0.1)",
            padding: "0.35rem 0.5rem",
          }}
        >
          {INPUT_TYPE_OPTIONS.map((option) => (
            <option key={option.value || "default"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p style={{ fontSize: "0.72rem", opacity: 0.35, lineHeight: 1.45 }}>
          Optional first-turn input control. Clients can override per session.
        </p>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Closing message</label>
        <textarea
          value={closingMessage}
          onChange={(e) => onChange({ closingMessage: e.target.value })}
          rows={3}
          placeholder={DEFAULT_APPLICATION_CLOSING_MESSAGE}
          style={textareaStyle(inputStyle)}
        />
        <p style={{ fontSize: "0.72rem", opacity: 0.35, lineHeight: 1.45 }}>
          Shown when the application ends. The internal outcome is still recorded
          for webhooks and admin review.
        </p>
      </div>

      {showOpeningOptions && (
        <div style={{ marginBottom: "1rem" }}>
          <label style={labelStyle}>
            {openingInputType === "mediaChoice"
              ? "Media choice configuration (JSON)"
              : "Opening options (one per line)"}
          </label>
          <textarea
            value={openingOptions}
            onChange={(e) => onChange({ openingOptions: e.target.value })}
            rows={4}
            placeholder={
              openingInputType === "mediaChoice"
                ? '{\n  "id": "programme-room",\n  "options": [],\n  "selection": { "mode": "rank", "minSelections": 3, "maxSelections": 3 },\n  "rationale": { "required": true, "prompt": "Tell us why…", "minLength": 24, "maxLength": 1200 }\n}'
                : "Artist\nCurator\nOrganiser"
            }
            style={{
              ...textareaStyle(inputStyle),
              ...(openingInputType === "mediaChoice"
                ? { minHeight: "12rem", fontFamily: "monospace", fontSize: "0.75rem" }
                : {}),
            }}
          />
          {openingInputType === "mediaChoice" ? (
            <p style={{ fontSize: "0.72rem", opacity: 0.35, lineHeight: 1.45 }}>
              Use stable option IDs and YouTube video IDs. Selection limits and
              rationale rules are validated when the project is saved.
            </p>
          ) : null}
        </div>
      )}

      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Reviewer evidence lenses (one per line)</label>
        <textarea
          value={requiredSignals}
          onChange={(e) => onChange({ requiredSignals: e.target.value })}
          rows={4}
          placeholder={"Motivation for joining\nWays of taking part\nPotential contribution"}
          style={textareaStyle(inputStyle)}
        />
        <p style={{ fontSize: "0.72rem", opacity: 0.35, lineHeight: 1.45 }}>
          Context for the reviewer, not questions Groucho must ask. New COLORS Forum sessions use five versioned evidence IDs; these text entries remain for older sessions and other projects. Answers link to source messages, and unexplored lenses remain unknown.
        </p>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <span style={{ ...labelStyle, display: "block", marginBottom: "0.35rem" }}>
          Preferred input types
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          {PREFERRED_INPUT_OPTIONS.map((option) => {
            const checked = preferredInputTypes.includes(option.value)
            return (
              <label
                key={option.value}
                style={{ fontSize: "0.78rem", opacity: 0.75, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    onChange({
                      preferredInputTypes: checked
                        ? preferredInputTypes.filter((value) => value !== option.value)
                        : [...preferredInputTypes, option.value],
                    })
                  }}
                  style={{ marginRight: "0.35rem" }}
                />
                {option.label}
              </label>
            )
          })}
        </div>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Max turns before decision</label>
        <input
          type="number"
          min={MIN_APPLICATION_MAX_TURNS}
          max={MAX_APPLICATION_MAX_TURNS}
          value={maxTurns}
          onChange={(e) => {
            const raw = e.target.value
            onChange({
              maxTurns: raw === "" ? "" : Number(raw),
            })
          }}
          placeholder="e.g. 4"
          style={{
            ...setupInput,
            ...(inputStyle ?? {}),
            border: "1px solid rgba(255,255,255,0.1)",
            padding: "0.35rem 0.5rem",
            maxWidth: "6rem",
          }}
        />
        <p style={{ fontSize: "0.72rem", opacity: 0.35, lineHeight: 1.45 }}>
          Optional guidance for Doorman. Leave blank for persona defaults.
        </p>
      </div>
    </>
  )
}
