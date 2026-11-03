import { safeAuthPath } from "@/lib/auth-redirect"
import LoginForm from "./login-form"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; demo?: string }>
}) {
  const { error, next, demo } = await searchParams
  const message = !error
    ? ""
    : error === "invitation_required"
    ? "Groucho is invite only. Open your invitation link or contact your administrator."
    : error === "google_unavailable"
    ? "Google sign-in is awaiting configuration. Please use email and password."
    : "Google sign-in could not be completed. Please try again."
  return (
    <LoginForm
      initialError={message}
      nextPath={safeAuthPath(next)}
      demoLogin={demo === "colors"}
    />
  )
}
