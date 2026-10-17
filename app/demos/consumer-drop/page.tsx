import Link from "next/link"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { DEMO_AUTH_COOKIE, verifyDemoToken } from "@/lib/colors-demo-token"
import ConsumerDropDemo from "@/components/consumer-drop/ConsumerDropDemo"
import styles from "../demos.module.css"

export default async function ConsumerDropPage() {
  const tester = await verifyDemoToken(
    (await cookies()).get(DEMO_AUTH_COOKIE)?.value,
    "tester",
  )
  if (!tester) redirect("/demos?next=/demos/consumer-drop")
  return (
    <div className={styles.demoSurface}>
      <nav className={styles.demoHeader} aria-label="Demo navigation">
        <Link href="/demos">← All demos</Link>
        <Link href="/login">Admin sign in</Link>
      </nav>
      <ConsumerDropDemo />
    </div>
  )
}
