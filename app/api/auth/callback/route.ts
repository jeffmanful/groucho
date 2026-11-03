import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient, isSupabaseServerConfigured } from "@/lib/supabase-server"
import { safeAuthPath, authRequestOrigin } from "@/lib/auth-redirect"
import { DEMO_AUTH_COOKIE } from "@/lib/colors-demo-token"
import { canSignInToDashboard } from "@/lib/dashboard-access"

export async function GET(request: NextRequest) {
  const origin = authRequestOrigin(request.url, request.headers.get("host"))
  const code = request.nextUrl.searchParams.get("code")
  if (code && isSupabaseServerConfigured()) {
    const client = await createSupabaseServerClient()
    const { error } = await client.auth.exchangeCodeForSession(code)
    if (!error) {
      const { data: { user } } = await client.auth.getUser()
      if (!user || !await canSignInToDashboard(user, request.nextUrl.searchParams.get("next"))) {
        await client.auth.signOut({ scope: "local" })
        const response = NextResponse.redirect(new URL("/login?error=invitation_required", origin))
        response.cookies.delete("pe_auth")
        response.cookies.delete(DEMO_AUTH_COOKIE)
        return response
      }
      const response = NextResponse.redirect(new URL(safeAuthPath(request.nextUrl.searchParams.get("next")), origin))
      response.cookies.delete("pe_auth")
      response.cookies.delete(DEMO_AUTH_COOKIE)
      return response
    }
  }
  return NextResponse.redirect(new URL("/login?error=google", origin))
}
