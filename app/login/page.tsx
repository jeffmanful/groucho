"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
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
        const requestedPath = new URLSearchParams(window.location.search).get("next")
        const safePath =
          requestedPath?.startsWith("/") && !requestedPath.startsWith("//")
            ? requestedPath
            : "/"
        router.push(data.role === "colors_demo_tester" ? "/demo/colors" : safePath)
        router.refresh()
      } else {
        setError("Access denied.")
      }
    } catch {
      setError("Something went wrong.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-screen items-center justify-center">
      <div className="w-[80%] max-w-[400px]">
        <div
          style={{
            fontSize: "0.7rem",
            letterSpacing: "0.12em",
            opacity: 0.3,
            marginBottom: "2.5rem",
          }}
        >
          PUBLIC EQUITY™
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[1.5rem]">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
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
            required
            disabled={loading}
            className="w-full font-inherit text-white text-md py-[0.5rem] outline-none border-b border-b-white/40 focus:border-b-white/60 bg-transparent disabled:opacity-30"
          />
          {error && (
            <div style={{ fontSize: "0.85rem", opacity: 0.5 }}>{error}</div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="self-start text-white text-md py-[0.5rem] opacity-60 hover:opacity-100 transition-opacity disabled:opacity-30 bg-transparent border-none cursor-pointer font-inherit"
          >
            {loading ? "..." : "Enter"}
          </button>
        </form>
        <p className="mt-8 text-center text-sm opacity-40 space-y-2 flex flex-col">
          <Link href="/signup/organisation" className="text-white/50 hover:text-white/70 underline-offset-4 hover:underline">
            Create an organisation (email code, no invite)
          </Link>
          <span className="text-white/35 text-xs">
            Organisation members: complete the email code on your invite or{" "}
            <Link href="/signup/organisation" className="text-white/45 hover:text-white/65">
              /signup/organisation
            </Link>
            , then open{" "}
            <Link href="/admin/organisations" className="text-white/45 hover:text-white/65">
              /admin/organisations
            </Link>
            .
          </span>
        </p>
      </div>
    </div>
  )
}
