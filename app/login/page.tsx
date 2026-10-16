import LoginForm from "./login-form"

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  const message = !error ? "" : error === "google_unavailable"
    ? "Google sign-in is awaiting configuration. Please use email and password."
    : "Google sign-in could not be completed. Please try again."
  return <LoginForm initialError={message} />
}
