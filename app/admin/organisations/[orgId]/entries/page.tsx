import { Suspense } from "react"
import { Entries } from "@/components/admin/drops/Entries"

export default function EntriesPage() {
  return (
    <Suspense fallback={null}>
      <Entries />
    </Suspense>
  )
}
