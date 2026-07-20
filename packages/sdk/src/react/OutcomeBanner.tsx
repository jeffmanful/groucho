"use client"

import type { SessionOutcome } from "../client.js"

export type OutcomeBannerProps = {
  status: SessionOutcome
  className?: string
}

const COPY: Record<SessionOutcome, string> = {
  active: "",
  passed: "Application received.",
  redirected: "Application received.",
  rejected: "Application received.",
}

export function OutcomeBanner({ status, className }: OutcomeBannerProps) {
  if (status === "active") return null
  const text = COPY[status]
  return (
    <div
      className={`groucho-outcome groucho-outcome--${status}${className ? ` ${className}` : ""}`}
      role="status"
    >
      {text}
    </div>
  )
}
