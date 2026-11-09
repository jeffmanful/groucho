import { readFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import { preparePresaleImport } from "../lib/presale-import"

const fixture = new URL("./fixtures/presale-signups.csv", import.meta.url)

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      apply: { type: "boolean" },
      source: { type: "string" },
    },
    allowPositionals: true,
  })
  const [file] = positionals
  const source = file ? values.source?.trim() : values.source?.trim() || "synthetic-presale"
  if (!source || positionals.length > 1) {
    throw new Error("Usage: pnpm import:presale [file.csv --source stable-export-name] [--apply]")
  }
  const { entries, errors } = preparePresaleImport(await readFile(file ?? fixture, "utf8"), source)
  if (errors.length) {
    throw new Error(`CSV has ${errors.length} error(s). No requests sent.\n${errors.slice(0, 20).join("\n")}`)
  }
  if (!values.apply) {
    console.log(`Dry run: ${entries.length} valid registrations. No requests sent.`)
    return
  }

  const base = process.env.GROUCHO_SANDBOX_URL?.trim()
  const key = process.env.GROUCHO_SANDBOX_API_KEY?.trim()
  if (!base || !key || /\s/.test(key)) {
    throw new Error("Set GROUCHO_SANDBOX_URL and a project API key in GROUCHO_SANDBOX_API_KEY.")
  }
  const endpoint = new URL("/v1/entries", base)
  if (endpoint.protocol !== "https:" &&
      !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname))) {
    throw new Error("Use HTTPS or a local loopback address for the sandbox URL.")
  }

  let created = 0
  let existing = 0
  for (const { recordNumber, body } of entries) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null)
    if (response?.status === 201) created++
    else if (response?.status === 200) existing++
    else {
      throw new Error(`Stopped at record ${recordNumber} (${response ? `HTTP ${response.status}` : "request failed"}). ` +
        `${created} created, ${existing} already present. Retry with the same file and source.`)
    }
  }
  console.log(`Import complete: ${created} created, ${existing} already present.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Import failed")
  process.exitCode = 1
})
