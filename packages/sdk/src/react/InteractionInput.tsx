"use client"

import { useCallback, useState } from "react"
import type { GrouchoInteractionUi } from "../client.js"
import { Composer } from "./Composer.js"
import { serializeInteractionInput } from "./serialize-interaction-input.js"

export type InteractionInputProps = {
  ui: GrouchoInteractionUi
  disabled?: boolean
  onSubmit: (message: string) => void
  className?: string
}

export function InteractionInput({
  ui,
  disabled,
  onSubmit,
  className,
}: InteractionInputProps) {
  const [draft, setDraft] = useState("")
  const [selected, setSelected] = useState<string[]>([])

  const submitValue = useCallback(
    (value: string | string[]) => {
      const message = serializeInteractionInput(ui.inputType, value)
      if (!message) return
      onSubmit(message)
      setDraft("")
      setSelected([])
    },
    [onSubmit, ui.inputType],
  )

  if (ui.inputType === "singleSelect" && ui.options?.length) {
    return (
      <div
        className={`groucho-interaction groucho-interaction--single${className ? ` ${className}` : ""}`}
        role="group"
        aria-label="Choose one option"
      >
        {ui.options.map((option) => (
          <button
            key={option}
            type="button"
            className="groucho-interaction__option"
            disabled={disabled}
            onClick={() => submitValue(option)}
          >
            {option}
          </button>
        ))}
      </div>
    )
  }

  if (ui.inputType === "multiSelect" && ui.options?.length) {
    return (
      <div
        className={`groucho-interaction groucho-interaction--multi${className ? ` ${className}` : ""}`}
        role="group"
        aria-label="Choose one or more options"
      >
        {ui.options.map((option) => {
          const active = selected.includes(option)
          return (
            <button
              key={option}
              type="button"
              className={`groucho-interaction__option${active ? " groucho-interaction__option--active" : ""}`}
              disabled={disabled}
              aria-pressed={active}
              onClick={() =>
                setSelected((prev) =>
                  prev.includes(option)
                    ? prev.filter((item) => item !== option)
                    : [...prev, option],
                )
              }
            >
              {option}
            </button>
          )
        })}
        <button
          type="button"
          className="groucho-interaction__continue"
          disabled={disabled || selected.length === 0}
          onClick={() => submitValue(selected)}
        >
          Continue
        </button>
      </div>
    )
  }

  return (
    <Composer
      className={className}
      value={draft}
      onChange={setDraft}
      onSubmit={() => submitValue(draft)}
      disabled={disabled}
      inputLabel="Your response"
    />
  )
}
