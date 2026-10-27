"use client"

import { useEffect, useState } from "react"
import { Moon, Monitor, Sun } from "lucide-react"
import styles from "@/components/admin/admin-workspace.module.css"

export type ThemePreference = "system" | "light" | "dark"
const STORAGE_KEY = "groucho-dashboard-theme"
const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
]

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system"
  } catch {
    return "system"
  }
}

/** The dashboard theme the person chose, remembered in this browser, and what it resolves to. */
export function useThemePreference(): {
  preference: ThemePreference
  resolved: "light" | "dark"
  setPreference: (value: ThemePreference) => void
} {
  // Dark until the browser's choice is known, matching the server render.
  const [preference, setPreferenceState] = useState<ThemePreference>("dark")
  const [systemDark, setSystemDark] = useState(true)

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const sync = () => setSystemDark(media.matches)
    // Reading browser-only state after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreferenceState(readPreference())
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])

  function setPreference(value: ThemePreference) {
    setPreferenceState(value)
    try {
      window.localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // Private windows can refuse storage; the choice still applies until reload.
    }
  }

  const resolved = preference === "system" ? (systemDark ? "dark" : "light") : preference
  return { preference, resolved, setPreference }
}

export function ThemeToggle({ preference, onChange }: { preference: ThemePreference; onChange: (value: ThemePreference) => void }) {
  return (
    <div className={styles.themeToggle} role="radiogroup" aria-label="Theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={label}
          title={label}
          onClick={() => onChange(value)}
        >
          <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
