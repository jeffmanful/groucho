import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient, isSupabaseServerConfigured } from "@/lib/supabase-server"
import { safeAuthPath, authRequestOrigin } from "@/lib/auth-redirect"

export async function GET(request: NextRequest) {
  const origin = authRequestOrigin(request.url, request.headers.get("host"))
  const failure = new URL("/login?error=google", origin)
  if (!isSupabaseServerConfigured()) return NextResponse.redirect(failure)
  const settings = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, cache: "no-store",
  }).then(async response => response.ok ? response.json() : null).catch(() => null)
  if (!settings?.external?.google) return NextResponse.redirect(new URL("/login?error=google_unavailable", origin))
  const callback = new URL("/api/auth/callback", origin)
  callback.searchParams.set("next", safeAuthPath(request.nextUrl.searchParams.get("next")))
  const client = await createSupabaseServerClient()
  const { data, error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback.toString() } })
  if (error || !data.url) return NextResponse.redirect(failure)
  return NextResponse.redirect(data.url)
}
