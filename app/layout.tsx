import type { Metadata } from "next"
import "./globals.css"
import "@/components/arc/foundation.css"

export const metadata: Metadata = {
  title: "Groucho Demo",
  description: "Demo for Postern's Groucho",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" data-theme="dark" data-accent="neutral">
      <body>{children}</body>
    </html>
  )
}
