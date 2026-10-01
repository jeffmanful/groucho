import { contextFromIds, type ProjectContext } from "@/lib/project-resolution"
import { supabase } from "@/lib/supabase"

export async function colorsDemoProject(): Promise<{
  context: ProjectContext
  option: {
    id: string
    name: string
    slug: string
    organisationName: string
    projectType: "gatekeeper"
    applicationOpeningMessage: string
  }
} | null> {
  const { data: organisation, error: organisationError } = await supabase
    .from("organisations")
    .select("id, name")
    .ilike("name", "colors")
    .maybeSingle()
  if (organisationError || !organisation) return null
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, slug, organisation_id")
    .eq("organisation_id", organisation.id)
    .eq("slug", "forum-application")
    .maybeSingle()
  if (projectError || !project) return null
  const context = await contextFromIds(project.organisation_id, project.id, null)
  if (context.settings.projectType !== "gatekeeper") return null
  return {
    context,
    option: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      organisationName: organisation.name,
      projectType: "gatekeeper",
      applicationOpeningMessage: context.settings.applicationExperience.opening_message,
    },
  }
}
