import { DoorCheckExperience } from "@/app/doorcheck/experience"
import Link from "next/link"
import { NextResponse } from "next/server"
import { resolvePersonaPreview } from "@/lib/persona-preview"

export default async function ColorsForumDemoPage({ searchParams }: { searchParams: Promise<{ application?: string; orgId?: string; personaId?: string }> }) {
  const { application, orgId, personaId } = await searchParams
  if (orgId || personaId) {
    if (!orgId || !personaId) return <main>Choose a saved persona from the dashboard to start a preview.</main>
    const preview = await resolvePersonaPreview(orgId, personaId)
    if (preview instanceof NextResponse) {
      const body = await preview.json()
      return <main className="min-h-dvh bg-black p-8 text-white"><p>{body.error}</p><Link href={`/admin/organisations/${encodeURIComponent(orgId)}/personas`}>Back to personas</Link></main>
    }
    const { snapshot } = preview
    return (
      <>
        <header className="flex h-14 min-w-0 items-center justify-between gap-4 bg-black px-4 py-2 text-sm text-white">
          <span className="min-w-0 truncate" title={`Preview · ${snapshot.name} · v${snapshot.version}`}>Preview · {snapshot.name} · v{snapshot.version}</span>
          <Link href={`/admin/organisations/${encodeURIComponent(orgId)}/personas`} className="shrink-0 underline">Back to personas</Link>
        </header>
        <DoorCheckExperience
          key={`${orgId}:${personaId}:${snapshot.version}`}
          demoMode="colors"
          intakeMode={application === "artist" ? "artist" : "community"}
          personaPreview={{
            apiBase: `/api/admin/organisations/${encodeURIComponent(orgId)}/personas/${encodeURIComponent(personaId)}/preview`,
            storageKey: `${snapshot.actor}:${orgId}:${personaId}:${snapshot.version}`,
            version: snapshot.version,
          }}
        />
      </>
    )
  }
  return <DoorCheckExperience key={application === "artist" ? "artist" : "community"} demoMode="colors" intakeMode={application === "artist" ? "artist" : "community"} />
}
