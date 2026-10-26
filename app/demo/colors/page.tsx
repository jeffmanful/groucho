import { DoorCheckExperience } from "@/app/doorcheck/experience"

export default async function ColorsForumDemoPage({ searchParams }: { searchParams: Promise<{ application?: string }> }) {
  const { application } = await searchParams
  return <DoorCheckExperience key={application === "artist" ? "artist" : "community"} demoMode="colors" intakeMode={application === "artist" ? "artist" : "community"} />
}
