import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"
import { verifyPeAuthEmail, isAllowedPlatformEmail } from "@/lib/pe-auth"
import { nextWithRequestId } from "@/lib/with-request-trace"

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
