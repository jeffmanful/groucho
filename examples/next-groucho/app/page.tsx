"use client"

import { GatekeeperV2, GrouchoProvider } from "@groucho-gatekeeper/sdk/react"

export default function Home() {
  return (
    <div style={{ padding: "2rem" }}>
      <p style={{ fontSize: "0.75rem", opacity: 0.45, marginBottom: "1.5rem" }}>
        Example host using the recommended proxy pattern (see{" "}
        <code style={{ opacity: 0.7 }}>docs/adr/0001-api-key-and-client-access.md</code>
        ). Set <code style={{ opacity: 0.7 }}>GROUPCHO_API_BASE_URL</code> and{" "}
        <code style={{ opacity: 0.7 }}>GROUPCHO_API_KEY</code> for{" "}
        <code style={{ opacity: 0.7 }}>/api/groucho</code>.
      </p>
      <GrouchoProvider proxyBasePath="/api/groucho">
        <GatekeeperV2 />
      </GrouchoProvider>
    </div>
  )
}
