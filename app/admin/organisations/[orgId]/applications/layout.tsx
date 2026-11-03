import type { ReactNode } from "react"
import { ApplicationsSection } from "@/components/admin/applications/ApplicationsSection"

export default function ApplicationsLayout({ children }: { children: ReactNode }) {
  return <ApplicationsSection>{children}</ApplicationsSection>
}
