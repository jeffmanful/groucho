import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { DEMO_AUTH_COOKIE, DEMO_SESSION_COOKIE } from "@/lib/colors-demo-token"

export async function POST() {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  let res = NextResponse.json({ ok: true })
  res.cookies.delete("pe_auth")
  res.cookies.delete(DEMO_AUTH_COOKIE)
  res.cookies.delete(DEMO_SESSION_COOKIE)

  if (url && anon) {
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
        },
      },
    })
    await supabase.auth.signOut()
  }

  return res
}
