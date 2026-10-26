"use client"

import { useId, useState, type FormEvent } from "react"
import type { ApplicantIdentity } from "../client.js"

export type ApplicantIntakeFormProps = {
  audience?: "community" | "artist"
  initialEmail?: string
  initialName?: string
  disabled?: boolean
  onSubmit: (applicant: ApplicantIdentity) => void
}

function linksFromText(raw: string, label: string): string[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length > 8) throw new Error(`Add up to eight ${label.toLowerCase()}.`)
  return [...new Set(lines.map((line) => {
    let url: URL
    try { url = new URL(line) } catch { throw new Error(`${label} need complete links starting with https:// or http://.`) }
    if (line.length > 2048 || !["https:", "http:"].includes(url.protocol) || url.username || url.password) {
      throw new Error(`${label} need complete web links without sign-in details.`)
    }
    return url.href
  }))]
}

export function ApplicantIntakeForm({ audience = "community", initialEmail = "", initialName = "", disabled, onSubmit }: ApplicantIntakeFormProps) {
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled) return
    const form = new FormData(event.currentTarget)
    const value = (key: string) => String(form.get(key) ?? "").trim()
    try {
      const name = value("name")
      const city = value("city")
      const age = Number(value("age"))
      if (!name || !city || !value("age") || !Number.isInteger(age) || age < 0 || age > 120) {
        throw new Error("Enter your name, city and age before continuing.")
      }
      const artistName = value("artistName")
      const applicant: ApplicantIdentity = {
        email: value("email").toLowerCase(),
        name,
        [audience === "artist" ? "artist" : "details"]: {
          city,
          age,
          ...(artistName ? { artistName } : {}),
          socialLinks: linksFromText(value("socialLinks"), "Social links"),
          musicLinks: linksFromText(value("musicLinks"), "Music streaming links"),
        },
      }
      setError(null)
      onSubmit(applicant)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check your details and try again.") }
  }
  return (
    <form className="groucho-applicant-form groucho-artist-intake" onSubmit={submit} aria-describedby={`${id}-help`}>
      <p id={`${id}-help`} className="groucho-muted">Tell us a little about yourself. An artist name and links are optional, whether you make music or simply enjoy it.</p>
      <fieldset disabled={disabled} className="groucho-artist-intake__fields">
        <label className="groucho-field"><span className="groucho-field__label">Name</span><input className="groucho-field__input" name="name" autoComplete="name" defaultValue={initialName} maxLength={160} required /></label>
        <label className="groucho-field"><span className="groucho-field__label">Email</span><input className="groucho-field__input" name="email" type="email" autoComplete="email" defaultValue={initialEmail} maxLength={320} required /></label>
        <div className="groucho-artist-intake__row">
          <label className="groucho-field"><span className="groucho-field__label">City</span><input className="groucho-field__input" name="city" autoComplete="address-level2" maxLength={120} required /></label>
          <label className="groucho-field"><span className="groucho-field__label">Age</span><input className="groucho-field__input" name="age" type="number" inputMode="numeric" min={0} max={120} step={1} required /></label>
        </div>
        <label className="groucho-field"><span className="groucho-field__label">Artist name (optional)</span><input className="groucho-field__input" name="artistName" autoComplete="nickname" maxLength={160} /></label>
        <label className="groucho-field"><span className="groucho-field__label">Social links (optional)</span><textarea className="groucho-field__input" name="socialLinks" rows={2} maxLength={16392} placeholder="One complete link per line" aria-describedby={`${id}-links`} autoCapitalize="none" spellCheck={false} /></label>
        <label className="groucho-field"><span className="groucho-field__label">Music streaming links (optional)</span><textarea className="groucho-field__input" name="musicLinks" rows={2} maxLength={16392} placeholder="One complete link per line" aria-describedby={`${id}-links`} autoCapitalize="none" spellCheck={false} /></label>
        <p id={`${id}-links`} className="groucho-muted">Share up to eight links in each list, or leave them empty.</p>
        {error ? <p role="alert" className="groucho-error">{error}</p> : null}
        <button className="groucho-composer__send" type="submit">{disabled ? "Starting…" : "Start application"}</button>
      </fieldset>
    </form>
  )
}

export type ArtistIntakeFormProps = Omit<ApplicantIntakeFormProps, "audience">

export function ArtistIntakeForm(props: ArtistIntakeFormProps) {
  return <ApplicantIntakeForm {...props} audience="artist" />
}
