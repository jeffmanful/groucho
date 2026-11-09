import { createHash } from "node:crypto"
import { parseEntryInput } from "./entries"

const columns = ["registration_id", "email", "signed_up_at", "name", "phone", "connection_group"]
const required = columns.slice(0, 3)

function readCsv(csv: string): string[][] {
  const source = csv.replace(/^\uFEFF/, "")
  const field = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r\n|\n|\r|$)/y
  const rows: string[][] = []
  let row: string[] = []
  while (field.lastIndex < source.length) {
    const match = field.exec(source)
    if (!match) throw new Error(`Malformed CSV record ${rows.length + 1}`)
    row.push(match[1]?.replace(/""/g, '"') ?? match[2])
    if (match[3] !== ",") {
      rows.push(row)
      row = []
    }
  }
  if (row.length) rows.push([...row, ""])
  return rows
}

export function preparePresaleImport(csv: string, source: string) {
  const [header, ...records] = readCsv(csv)
  if (!header || new Set(header).size !== header.length ||
      required.some((column) => !header.includes(column)) ||
      header.some((column) => !columns.includes(column))) {
    throw new Error(`CSV must contain ${required.join(", ")}. Optional columns are ${columns.slice(3).join(", ")}.`)
  }

  const ids = new Set<string>()
  const errors: string[] = []
  const entries = []
  for (const [index, record] of records.entries()) {
    if (record.length === 1 && record[0].trim() === "") continue
    const recordNumber = index + 2
    if (record.length !== header.length) {
      errors.push(`Record ${recordNumber}: expected ${header.length} columns`)
      continue
    }
    const values = Object.fromEntries(header.map((column, i) => [column, record[i].trim()]))
    const id = values.registration_id
    if (!id || ids.has(id)) {
      errors.push(`Record ${recordNumber}: registration_id must be present and unique within the file`)
      continue
    }
    ids.add(id)
    const timestamp = values.signed_up_at
    const time = Date.parse(timestamp)
    const canonicalTimestamp = timestamp.length === 20 ? timestamp.replace(/Z$/, ".000Z") : timestamp
    // Round-trip UTC to reject overflow dates such as February 30.
    if (!Number.isFinite(time) ||
        new Date(time).toISOString() !== canonicalTimestamp) {
      errors.push(`Record ${recordNumber}: signed_up_at must be a valid ISO 8601 UTC timestamp`)
      continue
    }
    const body = {
      applicant: { email: values.email, name: values.name },
      phone: values.phone,
      fields: {
        source_registration_id: id,
        signed_up_at: canonicalTimestamp,
        ...(values.connection_group ? { connection_group: values.connection_group } : {}),
      },
    }
    const parsed = parseEntryInput(body)
    if (!parsed.ok) {
      errors.push(`Record ${recordNumber}: ${parsed.error}`)
      continue
    }
    const key = createHash("sha256").update(JSON.stringify([source, id])).digest("hex")
    entries.push({ recordNumber, entry: parsed.value, body: { sessionId: `presale-${key}`, ...body } })
  }
  if (!entries.length && !errors.length) errors.push("CSV contains no registrations")
  return { entries, errors }
}

