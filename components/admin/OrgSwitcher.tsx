"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import type { OverviewOrganisation } from "@/lib/admin-overview"
import { SearchField } from "@/components/arc/search-field/search-field"
import styles from "./org-switcher.module.css"

export function OrgSwitcher({
  organisations,
  isPlatform,
  onNavigate,
}: {
  organisations: OverviewOrganisation[]
  isPlatform: boolean
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const currentOrgId =
    pathname.match(/^\/admin\/organisations\/([^/]+)/)?.[1] ?? null
  const current = organisations.find((o) => o.id === currentOrgId) ?? null

  const [lastPathname, setLastPathname] = useState(pathname)
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setOpen(false)
    setQuery("")
  }

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        triggerRef.current?.focus()
        setOpen(false)
      }
    }
    document.addEventListener("pointerdown", handlePointer)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("pointerdown", handlePointer)
      document.removeEventListener("keydown", handleKey)
    }
  }, [open])

  const filtered = query.trim()
    ? organisations.filter((o) =>
        `${o.name} ${o.slug}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : organisations

  function go() {
    setOpen(false)
    onNavigate?.()
  }

  return (
    <div className={styles.switcher} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.initial} aria-hidden="true">
          {(current?.name ?? "Groucho").charAt(0).toUpperCase()}
        </span>
        <span className={styles.label}>
          <span>{current?.name ?? "All organisations"}</span>
          <small>
            {current
              ? `${current.projectCount} project${current.projectCount === 1 ? "" : "s"}`
              : isPlatform
                ? "Platform administrator"
                : null}
          </small>
        </span>
        <ChevronsUpDown
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
          className={styles.chevron}
        />
      </button>
      {open && (
        <div className={styles.panel}>
          {organisations.length > 8 && (
            <div className={styles.search}>
              <SearchField
                label="Filter organisations"
                value={query}
                onValueChange={setQuery}
                placeholder="Find an organisation…"
                autoFocus
              />
            </div>
          )}
          <div className={styles.list}>
            {organisations.length === 0 ? (
              <p className={styles.empty}>No organisations yet.</p>
            ) : filtered.length === 0 ? (
              <p className={styles.empty}>
                No organisations match &ldquo;{query}&rdquo;.
              </p>
            ) : (
              filtered.map((o) => (
                <Link
                  key={o.id}
                  href={`/admin/organisations/${o.id}`}
                  aria-current={o.id === currentOrgId ? "page" : undefined}
                  className={styles.item}
                  onClick={go}
                >
                  <span className={styles.itemText}>
                    <span className={styles.itemName}>{o.name}</span>
                    <span className={styles.itemSlug}>{o.slug}</span>
                  </span>
                  {o.id === currentOrgId && (
                    <Check size={15} strokeWidth={2} aria-hidden="true" />
                  )}
                </Link>
              ))
            )}
          </div>
          <div className={styles.footer}>
            {isPlatform ? (
              <Link href="/admin/organisations" onClick={go}>
                <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                Manage organisations
              </Link>
            ) : (
              <Link href="/signup/organisation" onClick={go}>
                <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                Create organisation
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
