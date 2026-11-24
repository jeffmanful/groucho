/**
 * Save the pilot projects' current conversation configurations for the harness. Read-only.
 * Run with `pnpm pilot:pull`, optionally followed by project slugs.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { supabase } from "../../lib/supabase"
import { readProjectConversation, validateProjectConversation } from "../../lib/project-conversation-config"

const COLORS_ORGANISATION_ID = "8f945897-31bf-4072-9aad-1c02e090e6dd"
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : ["forum-early-access", "forum-artists"]

async function main() {
  const directory = path.join("evals", "pilot", "flows")
  mkdirSync(directory, { recursive: true })
  for (const slug of slugs) {
    const { data, error } = await supabase.from("projects").select("id, name, slug, settings")
      .eq("organisation_id", COLORS_ORGANISATION_ID).eq("slug", slug).maybeSingle()
    if (error) throw error
    if (!data) throw new Error(`No COLORS project with slug "${slug}"`)
    const stored = readProjectConversation(data.settings)
    const validated = validateProjectConversation(stored)
    if (!validated.ok || validated.config.version !== 2) throw new Error(`"${slug}" has no version 2 conversation configuration`)
    const file = path.join(directory, `${slug}.json`)
    writeFileSync(file, `${JSON.stringify({ slug, name: data.name, organisationId: COLORS_ORGANISATION_ID, projectId: data.id, pulledAt: new Date().toISOString(), config: validated.config }, null, 2)}\n`)
    console.log(`${file}: ${validated.config.signals.length} signals, reply style ${validated.config.replyStyle ?? "none"}, ceiling ${validated.config.maxAnswers}`)
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
