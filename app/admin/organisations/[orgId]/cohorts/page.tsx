import { Suspense } from "react"
import { Cohorts } from "@/components/admin/drops/Cohorts"

export default function CohortsPage() {
  return (
    <Suspense fallback={null}>
      <Cohorts />
    </Suspense>
  )
}
