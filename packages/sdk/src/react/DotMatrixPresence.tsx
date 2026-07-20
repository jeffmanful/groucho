"use client"

import type { GrouchoInteractionUi } from "../client.js"

export type DotMatrixPresenceProps = {
  visualState: GrouchoInteractionUi["visualState"]
  className?: string
}

const GRID_SIZE = 8

export function DotMatrixPresence({
  visualState,
  className,
}: DotMatrixPresenceProps) {
  const dots = Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => index)

  return (
    <div
      className={`groucho-presence groucho-presence--${visualState}${className ? ` ${className}` : ""}`}
      aria-hidden
    >
      <div className="groucho-presence__grid">
        {dots.map((index) => (
          <span
            key={index}
            className="groucho-presence__dot"
            style={{
              animationDelay: `${((index % GRID_SIZE) + Math.floor(index / GRID_SIZE)) * 0.04}s`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
