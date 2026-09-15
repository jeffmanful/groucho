"use client"

import type { ClientDecisionPolicy } from "@/lib/decision-policy"

type Props = {
  value: ClientDecisionPolicy
  onChange: (value: ClientDecisionPolicy) => void
}

const heading: React.CSSProperties = {
  display: "block",
  fontSize: "0.65rem",
  letterSpacing: "0.1em",
  opacity: 0.55,
  marginBottom: "0.35rem",
}

const numberInput: React.CSSProperties = {
  width: "6rem",
  minHeight: "2.75rem",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.14)",
  color: "#fff",
  padding: "0.45rem 0.6rem",
  fontFamily: "inherit",
  fontSize: "0.85rem",
  fontVariantNumeric: "tabular-nums",
  boxSizing: "border-box",
}

function toPercent(value: number): number {
  return Math.round(value * 100)
}

function fromPercent(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) / 100 : fallback
}

function ToggleRow({
  checked,
  title,
  description,
  caution,
  onChange,
}: {
  checked: boolean
  title: string
  description: string
  caution?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "2.75rem 1fr",
        gap: "0.75rem",
        alignItems: "start",
        padding: "0.75rem",
        border: `1px solid ${
          checked
            ? caution
              ? "rgba(248,113,113,0.4)"
              : "rgba(255,255,255,0.28)"
            : "rgba(255,255,255,0.09)"
        }`,
        background: checked ? "rgba(255,255,255,0.05)" : "transparent",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          width: "2.75rem",
          minHeight: "2.75rem",
          display: "grid",
          placeItems: "center",
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={title}
        />
      </span>
      <span>
        <strong style={{ display: "block", fontSize: "0.78rem", fontWeight: 500 }}>
          {title}
        </strong>
        <span
          style={{
            display: "block",
            marginTop: "0.2rem",
            fontSize: "0.72rem",
            lineHeight: 1.45,
            opacity: 0.48,
          }}
        >
          {description}
        </span>
      </span>
    </label>
  )
}

export function DecisionPolicyFields({ value, onChange }: Props) {
  const thresholdError = value.reviewThreshold >= value.acceptanceThreshold

  return (
    <div style={{ display: "grid", gap: "1rem", maxWidth: "32rem" }}>
      <p style={{ margin: 0, fontSize: "0.76rem", lineHeight: 1.5, opacity: 0.5 }}>
        Groucho supplies a suitability score. These rules decide what your project does with it.
        Automatic actions are off by default.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))",
          gap: "0.75rem",
        }}
      >
        <label>
          <span style={heading}>RECOMMEND ACCEPTANCE AT</span>
          <span style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
            <input
              style={numberInput}
              type="number"
              min={1}
              max={100}
              step={1}
              value={toPercent(value.acceptanceThreshold)}
              onChange={(event) =>
                onChange({
                  ...value,
                  acceptanceThreshold: fromPercent(
                    event.target.value,
                    value.acceptanceThreshold,
                  ),
                })
              }
            />
            <span style={{ opacity: 0.45 }}>% and above</span>
          </span>
        </label>
        <label>
          <span style={heading}>SEND TO REVIEW AT</span>
          <span style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
            <input
              style={numberInput}
              type="number"
              min={0}
              max={99}
              step={1}
              value={toPercent(value.reviewThreshold)}
              onChange={(event) =>
                onChange({
                  ...value,
                  reviewThreshold: fromPercent(event.target.value, value.reviewThreshold),
                })
              }
            />
            <span style={{ opacity: 0.45 }}>% and above</span>
          </span>
        </label>
      </div>

      <div
        aria-live="polite"
        style={{
          minHeight: "1.25rem",
          color: thresholdError ? "#fca5a5" : "rgba(255,255,255,0.42)",
          fontSize: "0.7rem",
          lineHeight: 1.4,
        }}
      >
        {thresholdError
          ? "Review must begin below the acceptance threshold."
          : `Scores from ${toPercent(value.reviewThreshold)}–${toPercent(value.acceptanceThreshold) - 1}% need review. Scores below ${toPercent(value.reviewThreshold)}% are below threshold.`}
      </div>

      <div style={{ display: "grid", gap: "0.6rem" }}>
        <ToggleRow
          checked={value.automaticAcceptanceEnabled}
          title="Automatically accept suitable applicants"
          description={`Applicants scoring ${toPercent(value.acceptanceThreshold)}% or higher receive approval automatically. When off, they remain recommended for human review.`}
          onChange={(automaticAcceptanceEnabled) =>
            onChange({ ...value, automaticAcceptanceEnabled })
          }
        />
        <ToggleRow
          checked={value.automaticDeclineEnabled}
          title="Automatically decline below-threshold applicants"
          description={`Applicants scoring below ${toPercent(value.reviewThreshold)}% are declined automatically. Keep this off if every rejection should be reviewed by a person.`}
          caution
          onChange={(automaticDeclineEnabled) =>
            onChange({ ...value, automaticDeclineEnabled })
          }
        />
      </div>
    </div>
  )
}
