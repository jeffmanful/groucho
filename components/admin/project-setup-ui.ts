import type { CSSProperties } from "react"

export const setupLabel: CSSProperties = {
  display: "block",
  fontSize: "0.65rem",
  letterSpacing: "0.1em",
  opacity: 0.4,
  marginBottom: "0.35rem",
}

export const setupInput: CSSProperties = {
  width: "100%",
  maxWidth: "26rem",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid rgba(255,255,255,0.15)",
  color: "#fff",
  outline: "none",
  padding: "0.45rem 0",
  fontFamily: "inherit",
  fontSize: "0.85rem",
  boxSizing: "border-box",
}

export function setupBtn(primary: boolean): CSSProperties {
  return {
    background: "transparent",
    border: primary
      ? "1px solid rgba(255,255,255,0.45)"
      : "1px solid rgba(255,255,255,0.15)",
    color: primary ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)",
    padding: "0.4rem 0.85rem",
    cursor: "pointer",
    fontSize: "0.72rem",
    letterSpacing: "0.06em",
    fontFamily: "inherit",
  }
}

export function slugify(str: string) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Wizard slug: `^[a-z0-9][a-z0-9-]{1,30}$` (2–31 chars). */
export function isValidProjectSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,30}$/.test(s)
}
