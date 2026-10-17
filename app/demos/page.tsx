import Link from "next/link"
import { cookies } from "next/headers"
import { DEMO_AUTH_COOKIE, verifyDemoToken } from "@/lib/colors-demo-token"
import { safeAuthPath } from "@/lib/auth-redirect"
import LoginForm from "@/app/login/login-form"
import styles from "./demos.module.css"

export default async function DemosPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const tester = await verifyDemoToken(
    (await cookies()).get(DEMO_AUTH_COOKIE)?.value,
    "tester",
  )
  const { next } = await searchParams
  if (!tester) {
    const destination = next?.startsWith("/demos/")
      ? safeAuthPath(next)
      : "/demos"
    return <LoginForm initialError="" nextPath={destination} demoLogin />
  }
  return (
    <main className={styles.page}>
      <nav className={styles.nav} aria-label="Demo navigation">
        <Link href="/demos" className={styles.brand}>
          groucho.
        </Link>
        <Link href="/login">Admin sign in</Link>
      </nav>
      <h1>Explore Groucho</h1>
      <p className={styles.intro}>
        Choose a demo to try. You’re signed in with your demo account.
      </p>
      <div className={styles.grid}>
        <article className={styles.card}>
          <h2>Fair ticket access</h2>
          <p>
            Review registrations, explore verification signals, and run a fair
            allocation.
          </p>
          <small>
            Fictional registrations and simulated checks. Changes reset when you
            refresh.
          </small>
          <Link className={styles.button} href="/demos/ticket-access">
            Open ticket demo
          </Link>
        </article>
        <article className={styles.card}>
          <h2>Fair product drops</h2>
          <p>
            Register for an illustrative Vans drop, review suspicious clusters,
            and run a ballot by shoe size.
          </p>
          <small>
            Synthetic inventory, verification and reserved purchase windows. No
            brand affiliation or payments.
          </small>
          <Link className={styles.button} href="/demos/consumer-drop">
            Open drop demo
          </Link>
        </article>
        <article className={styles.card}>
          <h2>COLORS Forum</h2>
          <p>
            Try the conversation-led application experience for the COLORS
            community.
          </p>
          <small>This pilot uses your existing COLORS demo permissions.</small>
          <Link className={styles.button} href="/demo/colors">
            Open COLORS demo
          </Link>
        </article>
      </div>
    </main>
  )
}
