import { NextResponse } from "next/server"

/** Self-contained example — no auth (contrast with repo root `proxy.ts`). */
export function proxy() {
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
