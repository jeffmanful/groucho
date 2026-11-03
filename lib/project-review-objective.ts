/** Shared guidance for reviewers. This metadata is independent of assessment and decision rules. */
export const MAX_OBJECTIVE_LENGTH = 1200

export type ProjectReviewObjective = {
  text: string
  cohortId: string | null
  revision: string
  updatedAt: string
  updatedBy: string | null
}

export function readProjectObjective(settings: unknown): ProjectReviewObjective | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null
  const raw = (settings as Record<string, unknown>).review_objective
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (typeof value.text !== "string" || typeof value.revision !== "string" || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) return null
  return {
    text: value.text,
    cohortId: typeof value.cohortId === "string" ? value.cohortId : null,
    revision: value.revision,
    updatedAt: value.updatedAt,
    updatedBy: typeof value.updatedBy === "string" ? value.updatedBy : null,
  }
}

export function parseObjectiveUpdate(body: unknown):
  | { ok: true; text: string; cohortId: string | null; revision: string | null }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid request." }
  const value = body as Record<string, unknown>
  if (typeof value.text !== "string" || value.text.length > MAX_OBJECTIVE_LENGTH) return { ok: false, error: `Use up to ${MAX_OBJECTIVE_LENGTH} characters for the objective.` }
  if (value.cohortId !== null && (typeof value.cohortId !== "string" || !value.cohortId.trim() || value.cohortId.length > 100)) return { ok: false, error: "Select a cohort or leave it empty." }
  if (value.revision !== null && (typeof value.revision !== "string" || !value.revision || value.revision.length > 100)) return { ok: false, error: "Refresh the objective before saving." }
  return { ok: true, text: value.text.trim(), cohortId: value.cohortId, revision: value.revision }
}
