import { NextRequest, NextResponse } from "next/server"
import { processPendingWebhookDeliveries } from "@/lib/verdict-webhook"
import { processPendingSessionCompletionJobs } from "@/lib/session-completion-jobs"

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("CRON_SECRET is not set")
    return NextResponse.json({ error: "Not configured" }, { status: 500 })
  }

  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const completions = await processPendingSessionCompletionJobs(10)
  const webhookDeliveries = await processPendingWebhookDeliveries(50)
  return NextResponse.json({ completions, webhookDeliveries })
}
