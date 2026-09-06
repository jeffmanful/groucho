"use client"

import { useEffect, useId, useRef } from "react"

export type ResumeSessionPromptProps = {
  onContinue: () => void
  onStartOver: () => void
}

export function ResumeSessionPrompt({
  onContinue,
  onStartOver,
}: ResumeSessionPromptProps) {
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  return (
    <section className="groucho-resume" aria-labelledby={titleId}>
      <div className="groucho-resume__copy">
        <p className="groucho-resume__eyebrow">Welcome back</p>
        <h2
          ref={titleRef}
          id={titleId}
          className="groucho-resume__title"
          tabIndex={-1}
        >
          Continue your conversation?
        </h2>
        <p className="groucho-resume__description">
          We found an unfinished conversation. You can pick up from the last
          question or begin again with a fresh conversation.
        </p>
      </div>
      <div className="groucho-resume__actions">
        <button
          type="button"
          className="groucho-resume__button groucho-resume__button--primary"
          onClick={onContinue}
        >
          Continue
        </button>
        <button
          type="button"
          className="groucho-resume__button groucho-resume__button--secondary"
          onClick={onStartOver}
        >
          Start over
        </button>
      </div>
    </section>
  )
}
