import type { Metadata } from "next"
import { DoorCheckExperience } from "@/app/doorcheck/experience"
import { loadDemoLink } from "@/lib/project-demo-links"
import styles from "@/app/demos/demos.module.css"
import { ProjectDemoConversation } from "./project-demo-conversation"

export const metadata: Metadata = {
  title: "Project demo | Groucho",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export const dynamic = "force-dynamic"

export default async function ProjectDemoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = await loadDemoLink(token).catch(() => null)
  if (!link) {
    return <main className={styles.page}>
      <h1>Demo link unavailable</h1>
      <p className={styles.intro}>Ask the sender for a new link.</p>
    </main>
  }

  if (link.variant !== "conversation") {
    return <div className={styles.sharedDemo}>
      <header className={styles.sharedHeader}><h1>{link.project.name}</h1></header>
      <DoorCheckExperience
        key={link.id}
        demoMode="colors"
        intakeMode={link.variant}
        sharedDemo={{ id: link.id, token }}
      />
    </div>
  }

  return <ProjectDemoConversation
    key={link.id}
    token={token}
    title={link.project.name}
    host={link.config?.persona.name ?? "Groucho"}
  />
}
