import { NextResponse } from "next/server"

/** Retired endpoint: authenticated identities cannot self-provision organisations here. */
export async function POST() {
  return NextResponse.json({ error: "Groucho is invite only. Contact your administrator.", code: "invitation_required" }, { status: 403 })
}
