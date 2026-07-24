import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/",
  "/api/cron/",
  "/invite",
  "/api/invitations/",
  "/signup",
  "/api/organisations/signup",
  "/api/me/",
]
const STATIC_PREFIXES = ["/_next/", "/favicon.ico"]
const REQUEST_ID_HEADER = "x-request-id"

type MiddlewareAuthClient = {
  getUser(): Promise<{ data: { user: { id: string } | null } }>
}

function authFailure(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname.startsWith("/api/") || pathname.startsWith("/v1/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.redirect(new URL("/login", req.url))
}

function getRequestIdFromHeaders(headers: Headers): string | undefined {
  const requestId = headers.get(REQUEST_ID_HEADER)?.trim()
  if (requestId) return requestId
  const correlationId = headers.get("x-correlation-id")?.trim()
  if (correlationId) return correlationId
  return undefined
}

function nextWithRequestId(req: NextRequest): NextResponse {
  const id = getRequestIdFromHeaders(req.headers) ?? crypto.randomUUID()
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set(REQUEST_ID_HEADER, id)
  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set(REQUEST_ID_HEADER, id)
  return res
}

async function verifyPeAuthEmail(
  token: string,
  secret: string,
): Promise<string | null> {
  try {
    const [payloadB64, sigB64] = token.split(".")
    if (!payloadB64 || !sigB64) return null

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    )

    const sigBytes = Uint8Array.from(
      atob(sigB64.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    )
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(payloadB64),
    )
    if (!valid) return null

    const payload = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))
    const [email] = payload.split("|")
    return email || null
  } catch {
    return null
  }
}

function isAllowedPlatformEmail(email: string): boolean {
  const allowed = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
  return allowed.includes(email.trim().toLowerCase())
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (STATIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next()

  /** Public API + legacy chat/access: trace id + auth only via route (API key), not session cookie. */
  if (
    pathname.startsWith("/v1/") ||
    pathname === "/api/chat" ||
    pathname === "/api/access" ||
    pathname === "/api/onboarding/start"
  ) {
    return nextWithRequestId(req)
  }

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next()

  const secret = process.env.AUTH_SECRET
  if (!secret) {
    console.error("AUTH_SECRET env var is not set")
    return authFailure(req)
  }

  const token = req.cookies.get("pe_auth")?.value
  if (token) {
    const email = await verifyPeAuthEmail(token, secret)
    if (email && isAllowedPlatformEmail(email)) {
      return NextResponse.next()
    }
  }

  const res = NextResponse.next({ request: { headers: req.headers } })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (url && anon) {
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
        },
      },
    })
    const auth = supabase.auth as unknown as MiddlewareAuthClient
    const {
      data: { user },
    } = await auth.getUser()
    if (user) {
      return res
    }
  }

  if (token) {
    const clear = authFailure(req)
    clear.cookies.delete("pe_auth")
    return clear
  }

  return authFailure(req)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
