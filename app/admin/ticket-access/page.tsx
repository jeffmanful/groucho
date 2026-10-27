import { notFound, redirect } from "next/navigation"
import TicketAccessDemo from "@/components/ticket-access/TicketAccessDemo"
import ConsumerDropDemo from "@/components/consumer-drop/ConsumerDropDemo"
import { ScenarioSwitcher } from "@/components/ticket-access/ScenarioSwitcher"
import { resolveAdminActor } from "@/lib/admin-actor"
import { requireOrgMember } from "@/lib/org-access"
import { supabase } from "@/lib/supabase"
import { parseProjectType } from "@/lib/project-settings"

export default async function TicketAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; org?: string; scenario?: string }>
}) {
  const actor = await resolveAdminActor()
  if (!actor) redirect("/login?next=/admin/ticket-access")
  const { project, org, scenario } = await searchParams
  if (!project && !org) {
    // Illustrative scenarios for prospects; neither touches a live Groucho flow.
    const selected = scenario === "vans" ? "vans" : "ezra"
    return (
      <>
        <ScenarioSwitcher selected={selected} />
        {selected === "vans" ? <ConsumerDropDemo /> : <TicketAccessDemo />}
      </>
    )
  }
  if (
    !project ||
    !org ||
    !/^[0-9a-f-]{36}$/i.test(project) ||
    !/^[0-9a-f-]{36}$/i.test(org)
  )
    notFound()
  if (await requireOrgMember(actor, org)) notFound()
  const { data, error } = await supabase
    .from("projects")
    .select("id,name,settings")
    .eq("id", project)
    .eq("organisation_id", org)
    .maybeSingle()
  if (error || !data || parseProjectType(data.settings) !== "ticket_access")
    notFound()
  return (
    <TicketAccessDemo
      key={data.id}
      projectId={data.id}
      projectName={data.name}
    />
  )
}
