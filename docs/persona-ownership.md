# Persona ownership

Status: implemented 27 October 2026 (migration `20261027100000_persona_ownership.sql`).

## The model

Every persona has an owner.

- **Groucho personas** (`owner_organisation_id` is null) are built and maintained by Groucho. Only platform
  admins can edit them. They include personas Groucho wrote for a specific client, such as the COLORS
  personas: Groucho owns the original, and the client runs on a clone.
- **Organisation personas** belong to one organisation. Only that organisation's projects can use them, and
  no other organisation can see them. A clone records the Groucho persona and version it came from
  (`source_persona_id`, `source_version`).

An organisation uses a persona in one of two ways:

- **Use as is.** A project points straight at a Groucho persona and follows its latest version.
- **Clone.** The organisation gets its own editable copy. Changes to the Groucho original never reach the
  clone automatically. When the original moves on, the clone shows "update available", and an
  organisation admin can compare the two and accept the update.

Nobody outside Groucho can change a persona that another organisation depends on. To change a Groucho
persona, an organisation clones it.

## Visibility

A Groucho persona is either visible to every organisation (`visibility = 'all'`) or only to the
organisations listed in `persona_organisation_access` (`visibility = 'restricted'`). Client-specific
personas are restricted, so another client never sees COLORS's voice in its library.

## Versions

Each persona carries a `version`, starting at 1. A database trigger increases it whenever the content
changes (name, prompt, thresholds, profile schema or extractor hint) and keeps a snapshot of every version
in `persona_versions`. Switching a persona on or off, or changing which one is the default, does not
create a version.

A clone is behind when `source_version` is lower than the original's current `version`. Accepting the
update copies the original's content into the clone, replacing the clone's own edits but keeping the clone's
name, and sets `source_version` to the original's version. The comparison is shown first, the update is only
applied against the version that was compared, and the clone's previous content is kept in
`persona_versions`. An organisation that can no longer see the original can't read or accept its updates.

## Who can do what

| Action | Platform admin | Organisation owner or admin | Organisation member |
| --- | --- | --- | --- |
| Create, edit, delete Groucho personas; set visibility and the default | Yes | No | No |
| See Groucho personas | All | Those visible to the organisation | Those visible to the organisation |
| Clone a visible Groucho persona into the organisation | Yes | Yes | No |
| Edit the organisation's own personas, accept updates | Yes | Yes | No |
| Choose a project's persona | Own and visible Groucho personas only | Same | No |

A project can only point at a persona it is allowed to use: one owned by its organisation, or a Groucho
persona visible to it. The project settings API refuses anything else, and so does every conversation route:
a persona id sent by an API caller is ignored unless the project's organisation may use it.

A platform admin can't restrict a Groucho persona away from an organisation whose projects use it as is;
those projects have to move to another persona first.

The workspace default is the fallback for a project that names no persona. It must be a Groucho persona, and
it is used by every organisation regardless of visibility. Today that is COLORS GROUCHO, which only matters
for the internal Development project; a neutral Groucho persona should replace it once one exists.

## What lives on a persona, and what does not

- **On the persona:** the voice and the conversation — prompt, profile fields and extractor hint. The pass
  and reject thresholds are still on the persona for the older conversation engine (see follow-ups).
- **On the project:** the client decision policy (acceptance and review thresholds, automatic actions).
- **In the engine, never in a persona:** rules every conversation must follow, such as the terminal decision
  appendix and the COLORS consent fallback. A clone can't lose them, and fixes reach every persona.

The newer COLORS conversation engine takes its voice from `lib/colors-forum-persona.ts`, not from the
database persona. For COLORS projects on that engine, the persona row still sets the profile fields and
extractor hint, and is what the dashboard shows. Moving that prompt into the persona row is a follow-up.

## What the migration does to existing personas

1. Every existing persona becomes a Groucho persona at version 1, with a snapshot in `persona_versions`.
2. Personas whose name starts with "COLORS" become restricted. COLORS can see them, and so can any other
   organisation with a project already using one.
3. For every organisation and persona pair in use by its projects, the organisation gets one clone, and its
   projects are pointed at the clone. Production today:

   | Groucho persona | Clone | Used by |
   | --- | --- | --- |
   | COLORS Forum Groucho (pilot) | COLORS | Forum Application |
   | COLORS GROUCHO | COLORS | Forum application test, Converse competition (retired) |
   | COLORS GROUCHO | JacobCorp | New Jacob Drop |

4. COLORS also gets a clone of each COLORS persona it isn't yet using (COLORS ONBOARDING), so it has a
   copy of every persona built for it.
5. Lou stays a Groucho persona visible to every organisation.

The prompt text does not change, so conversations stay the same. Past sessions keep pointing at the
persona they ran with.

## Rolling it out

Apply the migration and deploy the code together, migration first. Before the migration, the new persona
admin routes return errors (conversations keep working on the old shape). After the migration but on the old
code, organisation members would see every organisation's clones in the persona list.

`scripts/configure-colors-forum-persona.ts` now updates the Groucho original only and leaves Forum
Application on COLORS's clone; COLORS then accepts the update from its personas page.

The organisation personas page is at `/admin/organisations/<id>/personas`, linked from the organisation page.

## Follow-ups

- Write two or three general Groucho personas (community application, artist application) from what has
  worked for COLORS. Today Lou is the only one not tied to a client.
- Let a project pin a version of a Groucho persona it uses as is, and show "Groucho updated this persona"
  with a summary of what changed.
- Move the pass and reject thresholds off the persona once the older engine is retired.
- Move the COLORS Forum prompt from code into the persona row, so its clone controls the voice.
