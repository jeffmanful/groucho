import { writeFile } from "node:fs/promises"
import { LEWISHAM_SOCIAL_OPENING, LEWISHAM_SOCIAL_PERSONA_PROMPT } from "../lib/lewisham-social-persona"

// Emit a reviewable, atomic update for execution through the authenticated database connector.
// Persona content versions are snapshotted by the existing database trigger.
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`
const sql = `begin;
do $$
declare
  project public.projects%rowtype;
  persona public.personas%rowtype;
begin
  select * into strict project from public.projects
    where id = 'fd51f412-8689-461d-b510-b8153bb237e7' and slug = 'lewisham-social' for update;
  if project.settings->>'conversation_engine' is distinct from 'conversation_v1'
    or project.settings->>'conversation_profile' is distinct from 'lewisham-social' then
    raise exception 'Unexpected Lewisham Social runtime; no changes applied';
  end if;
  select * into strict persona from public.personas
    where id::text = project.settings->>'persona_id' for update;
  if persona.name <> 'Mo' or not persona.is_active
    or persona.owner_organisation_id is distinct from project.organisation_id then
    raise exception 'Expected the active organisation-owned Mo persona; no changes applied';
  end if;
  if exists (select 1 from public.projects p where p.id <> project.id
    and p.settings->>'persona_id' = persona.id::text) then
    raise exception 'Mo is shared with another project; no changes applied';
  end if;
  update public.personas set prompt = ${literal(LEWISHAM_SOCIAL_PERSONA_PROMPT)}
    where id = persona.id and prompt is distinct from ${literal(LEWISHAM_SOCIAL_PERSONA_PROMPT)};
  update public.projects set settings = project.settings || jsonb_build_object(
    'application_experience', coalesce(project.settings->'application_experience', '{}'::jsonb)
      || jsonb_build_object('max_turns', 10, 'opening_message', ${literal(LEWISHAM_SOCIAL_OPENING)})
  ) where id = project.id;
end $$;
commit;
select p.id, p.slug, p.settings->'application_experience' as application_experience,
  pe.id as persona_id, pe.name, pe.version, pe.prompt = ${literal(LEWISHAM_SOCIAL_PERSONA_PROMPT)} as prompt_matches
from public.projects p join public.personas pe on pe.id::text = p.settings->>'persona_id'
where p.id = 'fd51f412-8689-461d-b510-b8153bb237e7';
`

async function main() {
  const output = process.argv[2]
  if (!output) throw new Error("Usage: node --import tsx scripts/configure-lewisham-social.ts <output.sql>")
  await writeFile(output, sql)
  console.log(`Wrote scoped Mo persona and project update to ${output}`)
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
