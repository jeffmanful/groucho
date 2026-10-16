import { redirect } from "next/navigation"

/** The main entrance is the dashboard; demos have their own explicit entry. */
export default function Home() {
  redirect("/admin")
}
