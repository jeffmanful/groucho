"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type AdminFeedbackType = "error" | "success" | "info"

type AlertState = {
  type: AdminFeedbackType
  message: string
} | null

type ToastItem = {
  id: string
  type: AdminFeedbackType
  message: string
}

type AdminFeedbackContextValue = {
  alert: AlertState
  showError: (message: string) => void
  showSuccess: (message: string) => void
  showInfo: (message: string) => void
  clearAlert: () => void
}

const AdminFeedbackContext = createContext<AdminFeedbackContextValue | null>(
  null,
)

const TOAST_MS = 5000

const alertStyles: Record<
  AdminFeedbackType,
  { border: string; background: string; color: string }
> = {
  error: {
    border: "1px solid rgba(248,113,113,0.45)",
    background: "rgba(248,113,113,0.08)",
    color: "#fca5a5",
  },
  success: {
    border: "1px solid rgba(74,222,128,0.4)",
    background: "rgba(74,222,128,0.08)",
    color: "#86efac",
  },
  info: {
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(255,255,255,0.75)",
  },
}

function AdminAlertBanner({
  alert,
  onDismiss,
}: {
  alert: NonNullable<AlertState>
  onDismiss: () => void
}) {
  const s = alertStyles[alert.type]
  return (
    <div
      role={alert.type === "error" ? "alert" : "status"}
      aria-live="polite"
      style={{
        ...s,
        padding: "0.75rem 1rem",
        marginBottom: "1.25rem",
        fontSize: "0.82rem",
        lineHeight: 1.45,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "1rem",
      }}
    >
      <span>{alert.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          border: "none",
          color: "inherit",
          opacity: 0.55,
          cursor: "pointer",
          fontSize: "0.75rem",
          fontFamily: "inherit",
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  )
}

function AdminToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}) {
  if (toasts.length === 0) return null
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      style={{
        position: "fixed",
        right: "1.25rem",
        bottom: "1.25rem",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        maxWidth: "min(22rem, calc(100vw - 2.5rem))",
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => {
        const s = alertStyles[t.type]
        return (
          <div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            style={{
              ...s,
              padding: "0.65rem 0.85rem",
              fontSize: "0.78rem",
              lineHeight: 1.4,
              boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
              pointerEvents: "auto",
              display: "flex",
              alignItems: "flex-start",
              gap: "0.65rem",
            }}
          >
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                opacity: 0.5,
                cursor: "pointer",
                fontSize: "0.7rem",
                fontFamily: "inherit",
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function AdminFeedbackProvider({ children }: { children: ReactNode }) {
  const [alert, setAlert] = useState<AlertState>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const pushToast = useCallback(
    (type: AdminFeedbackType, message: string) => {
      const id = crypto.randomUUID()
      setToasts((prev) => [...prev, { id, type, message }])
      window.setTimeout(() => dismissToast(id), TOAST_MS)
    },
    [dismissToast],
  )

  const show = useCallback(
    (type: AdminFeedbackType, message: string) => {
      setAlert({ type, message })
      pushToast(type, message)
    },
    [pushToast],
  )

  const showError = useCallback((message: string) => show("error", message), [show])
  const showSuccess = useCallback((message: string) => show("success", message), [show])
  const showInfo = useCallback((message: string) => show("info", message), [show])
  const clearAlert = useCallback(() => setAlert(null), [])

  const value = useMemo<AdminFeedbackContextValue>(
    () => ({
      alert,
      showError,
      showSuccess,
      showInfo,
      clearAlert,
    }),
    [alert, showError, showSuccess, showInfo, clearAlert],
  )

  return (
    <AdminFeedbackContext.Provider value={value}>
      {children}
      <AdminToastViewport toasts={toasts} onDismiss={dismissToast} />
    </AdminFeedbackContext.Provider>
  )
}

export function useAdminFeedback(): AdminFeedbackContextValue {
  const ctx = useContext(AdminFeedbackContext)
  if (!ctx) {
    throw new Error("useAdminFeedback must be used within AdminFeedbackProvider")
  }
  return ctx
}

/** Inline alert for wizard pages (pairs with toasts from the provider). */
export function AdminFormAlert({
  alert,
  onDismiss,
}: {
  alert: AlertState
  onDismiss: () => void
}) {
  if (!alert) return null
  return <AdminAlertBanner alert={alert} onDismiss={onDismiss} />
}
