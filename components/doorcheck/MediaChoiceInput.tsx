"use client"

import { useMemo, useState } from "react"
import type {
  MediaChoiceAnswer,
  MediaChoiceInteraction,
} from "@/lib/gatekeeper-interaction-spec"
import { cn } from "@/lib/utils"

export function MediaChoiceInput({
  interaction,
  disabled,
  onSubmit,
  section = "all",
  selected: controlledSelected,
  rationale: controlledRationale,
  onSelectedChange,
  onRationaleChange,
}: {
  interaction: MediaChoiceInteraction
  disabled?: boolean
  onSubmit?: (message: string, answer: MediaChoiceAnswer) => void
  section?: "all" | "options" | "composer"
  selected?: string[]
  rationale?: string
  onSelectedChange?: (selected: string[]) => void
  onRationaleChange?: (rationale: string) => void
}) {
  const [internalSelected, setInternalSelected] = useState<string[]>([])
  const [internalRationale, setInternalRationale] = useState("")
  const [playing, setPlaying] = useState<string | null>(null)
  const selected = controlledSelected ?? internalSelected
  const rationale = controlledRationale ?? internalRationale
  const { mode, minSelections, maxSelections } = interaction.selection
  const ranks = useMemo(
    () => new Map(selected.map((id, index) => [id, index + 1])),
    [selected],
  )
  const rationaleLength = rationale.trim().length
  const minimumRationale = interaction.rationale.required
    ? Math.max(1, interaction.rationale.minLength ?? 1)
    : interaction.rationale.minLength ?? 0
  const canSubmit =
    !disabled &&
    selected.length >= minSelections &&
    selected.length <= maxSelections &&
    rationaleLength >= minimumRationale &&
    rationaleLength <= interaction.rationale.maxLength

  const countLabel =
    minSelections === maxSelections
      ? `${minSelections}`
      : `${minSelections}–${maxSelections}`
  const instruction =
    mode === "remove"
      ? `Choose ${countLabel} to remove`
      : mode === "rank"
        ? `Choose and rank ${countLabel}`
        : `Choose ${countLabel}`

  function toggle(id: string) {
    const next = (() => {
      const current = selected
      if (current.includes(id)) return current.filter((value) => value !== id)
      return current.length < maxSelections ? [...current, id] : current
    })()
    if (onSelectedChange) onSelectedChange(next)
    else setInternalSelected(next)
  }

  function move(id: string, direction: -1 | 1) {
    const next = (() => {
      const current = selected
      const index = current.indexOf(id)
      const destination = index + direction
      if (index < 0 || destination < 0 || destination >= current.length) return current
      const next = [...current]
      ;[next[index], next[destination]] = [next[destination], next[index]]
      return next
    })()
    if (onSelectedChange) onSelectedChange(next)
    else setInternalSelected(next)
  }

  return (
    <div className="flex w-full flex-col gap-4" aria-busy={disabled || undefined}>
      {section !== "composer" ? <><div className="flex items-baseline justify-between gap-4 text-[0.68rem] tracking-[0.07em] text-white/45">
        <p>{instruction}</p>
        <p className="shrink-0 tabular-nums" aria-live="polite">
          {selected.length}/{maxSelections}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label={instruction}>
        {interaction.options.map((option) => {
          const active = selected.includes(option.id)
          const rank = ranks.get(option.id)
          const thumbnail =
            option.media.thumbnailUrl ??
            `https://i.ytimg.com/vi/${option.media.videoId}/hqdefault.jpg`
          const player = `https://www.youtube-nocookie.com/embed/${option.media.videoId}?rel=0${option.media.startSeconds ? `&start=${option.media.startSeconds}` : ""}`
          return (
            <article
              key={option.id}
              className={cn(
                "overflow-hidden rounded-xl border bg-black/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-[border-color,background-color,box-shadow] duration-150 ease-out",
                active
                  ? "border-white/45 bg-white/[0.055] shadow-[0_12px_28px_rgba(0,0,0,0.18),inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                  : "border-white/12",
              )}
            >
              <div className="relative aspect-video overflow-hidden bg-zinc-950 outline -outline-offset-1 outline-white/10">
                {playing === option.id ? (
                  <iframe
                    src={player}
                    title={option.media.title}
                    className="h-full w-full border-0"
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                ) : (
                  <>
                    {/* External posters are intentional; the SDK contract restricts them to HTTPS. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbnail}
                      alt={option.media.alt}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <button
                      type="button"
                      onClick={() => setPlaying(option.id)}
                      disabled={disabled}
                      aria-label={`Play ${option.media.title}`}
                      className="absolute top-1/2 left-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-black/65 text-white backdrop-blur-md transition-[scale,background-color,opacity] duration-150 ease-out hover:bg-black/85 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <svg viewBox="0 0 24 24" className="size-5 translate-x-px" aria-hidden="true">
                        <path d="M9 7.25v9.5L17 12 9 7.25Z" fill="currentColor" />
                      </svg>
                    </button>
                  </>
                )}
                {rank ? (
                  <span className="absolute top-2 left-2 grid min-h-7 min-w-7 place-items-center rounded-full border border-white/25 bg-black/70 px-2 text-[0.68rem] font-medium text-white tabular-nums backdrop-blur-sm" aria-label={`Rank ${rank}`}>
                    {rank}
                  </span>
                ) : null}
              </div>

              <div className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <h3 className="text-pretty text-[0.78rem] leading-snug font-medium text-white/90">
                    {option.label}
                  </h3>
                  {option.media.artist ? (
                    <p className="mt-1 text-pretty text-[0.67rem] leading-snug text-white/45">
                      {option.media.artist}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => toggle(option.id)}
                  className={cn(
                    "min-h-10 shrink-0 rounded-lg border px-3 text-[0.67rem] transition-[scale,border-color,background-color,color,opacity] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40",
                    active
                      ? "border-white bg-white text-black"
                      : "border-white/15 bg-transparent text-white/70 hover:border-white/35",
                  )}
                >
                  {active
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

              {mode === "rank" && active ? (
                <div className="grid grid-cols-2 gap-2 px-3 pb-3">
                  {([-1, 1] as const).map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      onClick={() => move(option.id, direction)}
                      disabled={
                        disabled ||
                        (direction === -1 ? rank === 1 : rank === selected.length)
                      }
                      aria-label={`Move ${option.label} ${direction === -1 ? "earlier" : "later"}`}
                      className="min-h-10 rounded-lg border border-white/12 text-[0.65rem] text-white/55 transition-[scale,border-color,color,opacity] duration-150 ease-out hover:border-white/25 hover:text-white/80 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-25"
                    >
                      {direction === -1 ? "Earlier" : "Later"}
                    </button>
                  ))}
                </div>
              ) : null}

              {option.media.transcript || option.media.captionsUrl ? (
                <details className="mx-3 mb-3 text-[0.67rem] leading-relaxed text-white/45">
                  <summary className="flex min-h-10 cursor-pointer items-center">Transcript and captions</summary>
                  {option.media.transcript ? <p className="pb-2 text-pretty">{option.media.transcript}</p> : null}
                  {option.media.captionsUrl ? (
                    <a className="text-white/75 underline underline-offset-2" href={option.media.captionsUrl} target="_blank" rel="noreferrer">
                      Open captions
                    </a>
                  ) : null}
                </details>
              ) : null}
            </article>
          )
        })}
      </div></> : null}

      {section !== "options" ? <><label className="flex flex-col gap-2 text-[0.7rem] tracking-[0.04em] text-white/50">
        <span>{interaction.rationale.prompt}</span>
        <textarea
          value={rationale}
          onChange={(event) => {
            const next = event.target.value.slice(0, interaction.rationale.maxLength)
            if (onRationaleChange) onRationaleChange(next)
            else setInternalRationale(next)
          }}
          rows={3}
          required={interaction.rationale.required}
          minLength={interaction.rationale.minLength}
          maxLength={interaction.rationale.maxLength}
          disabled={disabled}
          className="min-h-24 resize-y rounded-xl border border-white/12 bg-white/[0.055] p-3 text-[0.82rem] leading-relaxed tracking-normal text-white outline-none transition-[border-color,box-shadow,opacity] duration-150 placeholder:text-white/30 focus:border-white/30 focus:shadow-[0_0_0_3px_rgba(255,255,255,0.05)] disabled:cursor-not-allowed disabled:opacity-40"
        />
        <span className="self-end text-[0.64rem] tabular-nums text-white/35">
          {minimumRationale > rationaleLength
            ? `${minimumRationale - rationaleLength} more characters`
            : `${rationaleLength}/${interaction.rationale.maxLength}`}
        </span>
      </label>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => {
          const trimmed = rationale.trim()
          const labels = selected.map(
            (id) => interaction.options.find((option) => option.id === id)?.label ?? id,
          )
          const choice =
            mode === "rank"
              ? `Ranked: ${labels.map((label, index) => `${index + 1}. ${label}`).join("; ")}`
              : `${mode === "remove" ? "Removed" : "Selected"}: ${labels.join(", ")}`
          onSubmit?.(trimmed ? `${choice}\nReason: ${trimmed}` : choice, {
            type: "mediaChoice",
            questionId: interaction.id,
            mode,
            optionIds: selected,
            ...(trimmed ? { rationale: trimmed } : {}),
          })
        }}
        className="min-h-11 self-start rounded-lg border border-white/20 px-4 text-[0.68rem] tracking-[0.07em] text-white/75 transition-[scale,border-color,background-color,color,opacity] duration-150 ease-out hover:border-white/40 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-30"
      >
        Send answer
      </button></> : null}
    </div>
  )
}
