import { privacyDatabaseError, privacyJson } from "@/lib/session-privacy"
import { supabase } from "@/lib/supabase"

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return privacyJson({ error: "Not configured" }, 503)
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return privacyJson({ error: "Unauthorized" }, 401)
  const { data, error } = await supabase.rpc("process_session_retention", { p_limit: 100 })
  if (error) return privacyDatabaseError(error)
  return privacyJson({ erased: data })
}
