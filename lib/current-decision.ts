// An application can have several decisions once a client corrects one. Only the decision that
// hasn't been superseded counts. Before the corrections migration there is exactly one row, and no
// superseded_by column, so these helpers fall back to the plain lookup.
import { supabase } from "@/lib/supabase"

type DbError = { code?: string; message?: string } | null

function missingSupersededColumn(error: DbError): boolean {
  return error?.code === "42703" || (error?.code === "PGRST204" && /superseded_by/.test(error.message ?? ""))
}

/** The current decision for one application (internal session id). */
export async function currentDecisionFor<T = Record<string, unknown>>(
  sessionId: string,
  columns: string,
): Promise<{ data: T | null; error: DbError }> {
  const result = await supabase
    .from("application_decisions")
    .select(columns)
    .eq("session_id", sessionId)
    .is("superseded_by", null)
    .maybeSingle()
  if (!missingSupersededColumn(result.error)) return { data: result.data as T | null, error: result.error }
  const legacy = await supabase.from("application_decisions").select(columns).eq("session_id", sessionId).maybeSingle()
  return { data: legacy.data as T | null, error: legacy.error }
}

/** Current decisions for several applications. */
export async function currentDecisionsFor<T = Record<string, unknown>>(
  sessionIds: string[],
  columns: string,
): Promise<{ data: T[]; error: DbError }> {
  if (!sessionIds.length) return { data: [], error: null }
  const result = await supabase
    .from("application_decisions")
    .select(columns)
    .in("session_id", sessionIds)
    .is("superseded_by", null)
  if (!missingSupersededColumn(result.error)) return { data: (result.data ?? []) as T[], error: result.error }
  const legacy = await supabase.from("application_decisions").select(columns).in("session_id", sessionIds)
  return { data: (legacy.data ?? []) as T[], error: legacy.error }
}
