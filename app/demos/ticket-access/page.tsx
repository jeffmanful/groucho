import Link from "next/link"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { DEMO_AUTH_COOKIE, verifyDemoToken } from "@/lib/colors-demo-token"
import TicketAccessDemo from "@/components/ticket-access/TicketAccessDemo"
import styles from "../demos.module.css"

export default async function TicketDemoPage() {
  const tester = await verifyDemoToken(
    (await cookies()).get(DEMO_AUTH_COOKIE)?.value,
    "tester",
  )
  if (!tester) redirect("/demos?next=/demos/ticket-access")
  return (
    <div className={styles.demoSurface}>
      <nav className={styles.demoHeader} aria-label="Demo navigation">
        <Link href="/demos">← All demos</Link>
        <Link href="/login">Admin sign in</Link>
      </nav>
      <TicketAccessDemo />
    </div>
  )
}
