import { redirect } from "next/navigation"
import { resolveAdminActor } from "@/lib/admin-actor"
import AdminAccessManager from "@/components/admin/AdminAccessManager"

export default async function AdminAccessPage() {
  const actor = await resolveAdminActor()
  if (!actor) redirect("/login?next=/admin/access")
  if (actor.kind !== "platform")
    return (
      <div style={{ padding: "2rem" }}>
        <h1>Admin access required</h1>
        <p>Only platform administrators can manage dashboard access.</p>
      </div>
    )
  return <AdminAccessManager />
}
