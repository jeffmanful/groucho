import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient, isSupabaseServerConfigured } from "@/lib/supabase-server"
import { safeAuthPath, authRequestOrigin } from "@/lib/auth-redirect"
import { DEMO_AUTH_COOKIE } from "@/lib/colors-demo-token"

export async function GET(request: NextRequest) {
  const origin = authRequestOrigin(request.url, request.headers.get("host"))
  const code = request.nextUrl.searchParams.get("code")
  if (code && isSupabaseServerConfigured()) {
    const client = await createSupabaseServerClient()
    const { error } = await client.auth.exchangeCodeForSession(code)
    if (!error) {
      const response = NextResponse.redirect(new URL(safeAuthPath(request.nextUrl.searchParams.get("next")), origin))
      response.cookies.delete("pe_auth")
      response.cookies.delete(DEMO_AUTH_COOKIE)
      return response
    }
  }
  return NextResponse.redirect(new URL("/login?error=google", origin))
}
