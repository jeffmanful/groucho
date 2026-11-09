"use client"

import { useRef, useState, type FormEvent } from "react"
import dashboard from "@/components/admin/dashboard/dashboard.module.css"
import client from "@/components/admin/client/client.module.css"
import styles from "./drops.module.css"

export function ImportEntries({ endpoint, onImport }: { endpoint: string; onImport: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [source, setSource] = useState("")
  const [preview, setPreview] = useState<{ csv: string; valid: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [result, setResult] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || busy) return
    const apply = preview !== null
    setBusy(true)
    setErrors([])
    setResult("")
    try {
      if (file.size > 256_000) throw new Error("Choose a CSV file up to 256 KB.")
      const csv = preview?.csv ?? await file.text()
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, source, apply }),
      })
      const data = await response.json()
      if (!response.ok) {
        setErrors([data.error ?? "The import request failed.", ...(data.errors ?? [])])
        return
      }
      if (apply) {
        setResult(`${data.created} added, ${data.existing} already present.`)
        if (fileInput.current) fileInput.current.value = ""
        setFile(null)
        setPreview(null)
      } else {
        setPreview({ csv, valid: data.valid })
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "The import request failed."])
    } finally {
      setBusy(false)
      if (apply) onImport()
    }
  }

  return (
    <div>
      <button type="button" className={client.button} aria-expanded={open} disabled={busy} onClick={() => {
        setOpen(!open)
        setFile(null)
        setPreview(null)
        setErrors([])
        setResult("")
      }}>
        {open ? "Hide CSV import" : "Import CSV"}
      </button>
      {open ? (
        <form className={client.panel} style={{ padding: 16, marginTop: 8, display: "grid", gap: 12 }} onSubmit={submit}>
          <p className={client.secondary} style={{ margin: 0 }}>
            Upload up to 100 entries to this project. Include registration_id, email and signed_up_at (UTC).
            Optional columns are name, phone and connection_group.
          </p>
          <label>
            CSV file{" "}
            <input ref={fileInput} type="file" accept=".csv,text/csv" required disabled={busy} onChange={(event) => {
              setResult("")
              setFile(event.target.files?.[0] ?? null)
              setPreview(null)
              setErrors([])
            }} />
          </label>
          <label>
            Source name{" "}
            <input className={styles.input} value={source} maxLength={100} required disabled={busy} onChange={(event) => {
              setSource(event.target.value)
              setPreview(null)
              setErrors([])
            }} />
          </label>
          <p className={client.secondary} style={{ margin: 0 }}>Use the same source name for retries of the same export.</p>
          {errors.length ? (
            <ul className={dashboard.error} role="alert">
              {errors.map((error, index) => <li key={index}>{error}</li>)}
            </ul>
          ) : null}
          {preview ? <p role="status">{preview.valid} valid entries. Preview complete. Confirm to import.</p> : null}
          {result ? <p role="status">{result}</p> : null}
          <div>
            <button type="submit" className={client.buttonPrimary} disabled={busy || !file || !source.trim()}>
              {busy ? (preview ? "Importing…" : "Validating…") : preview ? "Confirm import" : "Preview import"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
