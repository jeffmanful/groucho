"use client"

import { useMemo, useState } from "react"
import type {
  MediaChoiceAnswer,
  MediaChoiceInteraction,
} from "../client.js"

export type MediaChoiceInputProps = {
  interaction: MediaChoiceInteraction
  disabled?: boolean
  onSubmit: (message: string, answer: MediaChoiceAnswer) => void
  className?: string
}

function durationLabel(seconds: number | undefined): string | null {
  if (!seconds) return null
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${String(remainder).padStart(2, "0")}`
}

function answerMessage(
  interaction: MediaChoiceInteraction,
  optionIds: string[],
  rationale: string,
): string {
  const labels = optionIds.map(
    (id) => interaction.options.find((option) => option.id === id)?.label ?? id,
  )
  const choice =
    interaction.selection.mode === "rank"
      ? `Ranked: ${labels.map((label, index) => `${index + 1}. ${label}`).join("; ")}`
      : `${interaction.selection.mode === "remove" ? "Removed" : "Selected"}: ${labels.join(", ")}`
  return rationale ? `${choice}\nReason: ${rationale}` : choice
}

function selectionInstruction(interaction: MediaChoiceInteraction): string {
  const { mode, minSelections, maxSelections } = interaction.selection
  const count =
    minSelections === maxSelections
      ? `${minSelections}`
      : `${minSelections}–${maxSelections}`
  if (mode === "remove") return `Choose ${count} to remove`
  if (mode === "rank") return `Choose and rank ${count}`
  return `Choose ${count}`
}

export function MediaChoiceInput({
  interaction,
  disabled,
  onSubmit,
  className,
}: MediaChoiceInputProps) {
  const [optionIds, setOptionIds] = useState<string[]>([])
  const [rationale, setRationale] = useState("")
  const [playingId, setPlayingId] = useState<string | null>(null)
  const { minSelections, maxSelections, mode } = interaction.selection
  const minimumRationale = interaction.rationale.required
    ? Math.max(1, interaction.rationale.minLength ?? 1)
    : interaction.rationale.minLength ?? 0
  const rationaleLength = rationale.trim().length
  const validSelection =
    optionIds.length >= minSelections && optionIds.length <= maxSelections
  const validRationale =
    rationaleLength >= minimumRationale &&
    rationaleLength <= interaction.rationale.maxLength
  const canSubmit = !disabled && validSelection && validRationale

  const rankById = useMemo(
    () => new Map(optionIds.map((id, index) => [id, index + 1])),
    [optionIds],
  )

  const toggle = (id: string) => {
    setOptionIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id)
      if (current.length >= maxSelections) return current
      return [...current, id]
    })
  }

  const move = (id: string, direction: -1 | 1) => {
    setOptionIds((current) => {
      const index = current.indexOf(id)
      const destination = index + direction
      if (index < 0 || destination < 0 || destination >= current.length) return current
      const next = [...current]
      ;[next[index], next[destination]] = [next[destination], next[index]]
      return next
    })
  }

  return (
    <div
      className={`groucho-media-choice${className ? ` ${className}` : ""}`}
      aria-busy={disabled || undefined}
    >
      <div className="groucho-media-choice__header">
        <p className="groucho-media-choice__instruction">
          {selectionInstruction(interaction)}
        </p>
        <p
          className="groucho-media-choice__count"
          aria-live="polite"
          aria-atomic="true"
        >
          {optionIds.length}/{maxSelections}
        </p>
      </div>

      <div
        className="groucho-media-choice__grid"
        role="group"
        aria-label={selectionInstruction(interaction)}
      >
        {interaction.options.map((option) => {
          const selected = optionIds.includes(option.id)
          const rank = rankById.get(option.id)
          const duration = durationLabel(option.media.durationSeconds)
          const thumbnail =
            option.media.thumbnailUrl ??
            `https://i.ytimg.com/vi/${option.media.videoId}/hqdefault.jpg`
          const playerUrl = `https://www.youtube-nocookie.com/embed/${option.media.videoId}?rel=0${option.media.startSeconds ? `&start=${option.media.startSeconds}` : ""}`

          return (
            <article
              key={option.id}
              className={`groucho-media-choice__card${selected ? " groucho-media-choice__card--selected" : ""}`}
            >
              <div className="groucho-media-choice__media">
                {playingId === option.id ? (
                  <iframe
                    src={playerUrl}
                    title={option.media.title}
                    className="groucho-media-choice__player"
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                ) : (
                  <>
                    {/* Plain img keeps the published SDK independent of Next.js. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbnail}
                      alt={option.media.alt}
                      className="groucho-media-choice__image"
                      loading="lazy"
                    />
                    <button
                      type="button"
                      className="groucho-media-choice__play"
                      onClick={() => setPlayingId(option.id)}
                      disabled={disabled}
                      aria-label={`Play ${option.media.title}`}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 7.25v9.5L17 12 9 7.25Z" fill="currentColor" />
                      </svg>
                    </button>
                  </>
                )}
                {duration ? (
                  <span className="groucho-media-choice__duration">{duration}</span>
                ) : null}
                {rank ? (
                  <span className="groucho-media-choice__rank" aria-label={`Rank ${rank}`}>
                    {rank}
                  </span>
                ) : null}
              </div>

              <div className="groucho-media-choice__body">
                <div className="groucho-media-choice__copy">
                  <h3>{option.label}</h3>
                  {option.media.artist ? <p>{option.media.artist}</p> : null}
                  {option.description ? <p>{option.description}</p> : null}
                </div>
                <button
                  type="button"
                  className="groucho-media-choice__select"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => toggle(option.id)}
                >
                  {selected
                    ? mode === "remove"
                      ? "Removing"
                      : "Chosen"
                    : mode === "remove"
                      ? "Remove"
                      : mode === "rank"
                        ? "Add"
                        : "Choose"}
                </button>
              </div>

              {mode === "rank" && selected ? (
                <div className="groucho-media-choice__rank-controls">
                  <button
                    type="button"
                    onClick={() => move(option.id, -1)}
                    disabled={disabled || rank === 1}
                    aria-label={`Move ${option.label} earlier`}
                  >
                    Earlier
                  </button>
                  <button
                    type="button"
                    onClick={() => move(option.id, 1)}
                    disabled={disabled || rank === optionIds.length}
                    aria-label={`Move ${option.label} later`}
                  >
                    Later
                  </button>
                </div>
              ) : null}

              {option.media.transcript || option.media.captionsUrl ? (
                <details className="groucho-media-choice__accessibility">
                  <summary>Transcript and captions</summary>
                  {option.media.transcript ? <p>{option.media.transcript}</p> : null}
                  {option.media.captionsUrl ? (
                    <a href={option.media.captionsUrl} target="_blank" rel="noreferrer">
                      Open captions
                    </a>
                  ) : null}
                </details>
              ) : null}
            </article>
          )
        })}
      </div>

      <label className="groucho-media-choice__rationale">
        <span>{interaction.rationale.prompt}</span>
        <textarea
          value={rationale}
          onChange={(event) =>
            setRationale(event.target.value.slice(0, interaction.rationale.maxLength))
          }
          disabled={disabled}
          required={interaction.rationale.required}
          minLength={interaction.rationale.minLength}
          maxLength={interaction.rationale.maxLength}
          rows={3}
        />
        <span className="groucho-media-choice__rationale-meta">
          {minimumRationale > 0 && rationaleLength < minimumRationale
            ? `${minimumRationale - rationaleLength} more characters`
            : `${rationaleLength}/${interaction.rationale.maxLength}`}
        </span>
      </label>

      <button
        type="button"
        className="groucho-interaction__continue groucho-media-choice__submit"
        disabled={!canSubmit}
        onClick={() => {
          const trimmedRationale = rationale.trim()
          const answer: MediaChoiceAnswer = {
            type: "mediaChoice",
            questionId: interaction.id,
            mode,
            optionIds,
            ...(trimmedRationale ? { rationale: trimmedRationale } : {}),
          }
          onSubmit(
            answerMessage(interaction, optionIds, trimmedRationale),
            answer,
          )
        }}
      >
        Send answer
      </button>
    </div>
  )
}
