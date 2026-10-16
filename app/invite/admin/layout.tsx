import type { Metadata } from "next"
export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
  title: "Admin invitation · Groucho",
}
export default function AdminInviteLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
