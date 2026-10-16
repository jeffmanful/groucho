"use client"

import { safeAuthPath } from "@/lib/auth-redirect"
import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"

export default function LoginForm({
  initialError,
  nextPath,
  demoLogin = false,
}: {
  initialError: string
  nextPath: string
  demoLogin?: boolean
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState(initialError)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        const requestedPath = new URLSearchParams(window.location.search).get(
          "next",
        )
        const safePath = safeAuthPath(requestedPath ?? nextPath)
        router.push(
          data.role === "colors_demo_tester"
            ? safePath === "/demo/colors" ||
              safePath === "/demos" ||
              safePath.startsWith("/demos/")
              ? safePath
              : "/demos"
            : safePath,
        )
        router.refresh()
      } else {
        setError("Email or password was not recognised.")
      }
    } catch {
      setError("Something went wrong.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen py-12 items-center justify-center">
      <div className="w-[80%] max-w-[400px]">
        <div
          style={{
            fontSize: "0.7rem",
            letterSpacing: "0.12em",
            opacity: 0.3,
            marginBottom: "2.5rem",
          }}
        >
          GROUCHO
        </div>
        <h1 className="text-3xl mb-3">
          {demoLogin ? "Demo sign in" : "Admin sign in"}
        </h1>
        <p className="text-sm text-white/60 mb-8">
          {demoLogin
            ? "Use your demo tester account."
            : "Sign in to manage your Groucho dashboard."}
        </p>
        {!demoLogin && (
          <a
            href={`/api/auth/google?next=${encodeURIComponent(nextPath)}`}
            className="block w-full rounded-lg border border-white/30 px-4 py-3 text-center text-white hover:bg-white/10 mb-6"
          >
            Continue with Google
          </a>
        )}
        <p className="text-sm opacity-60 mb-6">
          {demoLogin
            ? "Enter your demo email and password."
            : "Or sign in with your email and password."}
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[1.5rem]">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            aria-label="Email"
            autoComplete="username"
            required
            autoFocus
            disabled={loading}
            className="w-full font-inherit text-white text-md py-[0.5rem] outline-none border-b border-b-white/40 focus:border-b-white/60 bg-transparent disabled:opacity-30"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password"
            autoComplete="current-password"
            required
            disabled={loading}
            className="w-full font-inherit text-white text-md py-[0.5rem] outline-none border-b border-b-white/40 focus:border-b-white/60 bg-transparent disabled:opacity-30"
          />
          {error && (
            <div role="alert" style={{ fontSize: "0.85rem", opacity: 0.8 }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="self-start text-white text-md py-[0.5rem] opacity-60 hover:opacity-100 transition-opacity disabled:opacity-30 bg-transparent border-none cursor-pointer font-inherit"
          >
            {loading
              ? "Signing in…"
              : demoLogin
              ? "Open demo"
              : "Sign in to dashboard"}
          </button>
        </form>
        {!demoLogin && (
          <Link
            href="/demos"
            className="block w-full mt-8 rounded-lg border border-white/25 px-4 py-3 text-center text-white/80 hover:text-white hover:bg-white/10"
          >
            Access public demos
          </Link>
        )}
        {demoLogin && (
          <Link
            href="/login"
            className="block mt-5 text-center text-sm text-white/60 hover:text-white"
          >
            Back to admin sign in
          </Link>
        )}
        {!demoLogin && (
          <p className="mt-8 text-center text-sm opacity-40 space-y-2 flex flex-col">
            <Link
              href="/signup/organisation"
              className="text-white/50 hover:text-white/70 underline-offset-4 hover:underline"
            >
              Create an organisation (email code, no invite)
            </Link>
            <span className="text-white/35 text-xs">
              Organisation members: complete the email code on your invite or{" "}
              <Link
                href="/signup/organisation"
                className="text-white/45 hover:text-white/65"
              >
                /signup/organisation
              </Link>
              , then open{" "}
              <Link
                href="/admin/organisations"
                className="text-white/45 hover:text-white/65"
              >
                /admin/organisations
              </Link>
              .
            </span>
          </p>
        )}
      </div>
    </div>
  )
}
