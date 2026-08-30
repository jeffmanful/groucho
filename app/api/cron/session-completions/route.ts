import { NextRequest, NextResponse } from "next/server"
import { processPendingSessionCompletionJobs } from "@/lib/session-completion-jobs"

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const processed = await processPendingSessionCompletionJobs(10)
  return NextResponse.json({ processed })
}
