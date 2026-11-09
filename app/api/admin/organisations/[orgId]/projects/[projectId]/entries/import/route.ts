import { NextResponse } from "next/server"
import { projectRoute, serverError } from "@/lib/admin-project-route"
import { createEntry } from "@/lib/entries"
import { preparePresaleImport } from "@/lib/presale-import"

const MAX_CSV_LENGTH = 256_000
const MAX_ENTRIES = 100

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string; projectId: string }> }) {
  const route = await projectRoute(params, "admin")
  if (!route.ok) return route.response

  const body = await request.json().catch(() => null)
  const csv = typeof body?.csv === "string" ? body.csv : ""
  const source = typeof body?.source === "string" ? body.source.trim() : ""
  if (!csv || csv.length > MAX_CSV_LENGTH || !source || source.length > 100 || typeof body.apply !== "boolean") {
    return NextResponse.json({ error: "Supply a CSV up to 256,000 characters and a source name up to 100 characters." }, { status: 400 })
  }

  let prepared: ReturnType<typeof preparePresaleImport>
  try {
    prepared = preparePresaleImport(csv, source)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid CSV." }, { status: 400 })
  }
  if (prepared.errors.length) {
    return NextResponse.json({
      error: `Found ${prepared.errors.length} CSV error(s).`,
      errors: prepared.errors.slice(0, 20),
    }, { status: 400 })
  }
  if (prepared.entries.length > MAX_ENTRIES) {
    return NextResponse.json({ error: `Import up to ${MAX_ENTRIES} entries per upload.` }, { status: 400 })
  }
  if (!body.apply) return NextResponse.json({ valid: prepared.entries.length })

  let created = 0
  let existing = 0
  try {
    for (const { recordNumber, body: row, entry } of prepared.entries) {
      const result = await createEntry({
        organisationId: route.value.orgId,
        projectId: route.value.projectId,
        clientSessionKey: row.sessionId,
        entry,
      })
      if (!result.ok) {
        return NextResponse.json({
          error: `Stopped at record ${recordNumber}. ${result.error} ${created} added, ${existing} already present. Retry with the same file and source name.`,
        }, { status: result.status })
      }
      if (result.created) created++
      else existing++
    }
    return NextResponse.json({ created, existing })
  } catch (error) {
    return serverError("entries import:", error)
  }
}
