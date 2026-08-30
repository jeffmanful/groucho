import LiveConversations from "@/components/admin/LiveConversations"

export default function AdminSessionsPage() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      <div style={{ padding: "2rem 2rem 0" }}>
        <h1
          style={{
            fontSize: "0.75rem",
            letterSpacing: "0.14em",
            fontWeight: 400,
            opacity: 0.45,
            margin: 0,
          }}
        >
          LIVE SESSIONS
        </h1>
        <p style={{ fontSize: "0.78rem", opacity: 0.35, marginTop: "0.5rem" }}>
          Choose a project, browse its sessions and follow the selected conversation.
        </p>
      </div>
      <LiveConversations />
    </div>
  )
}
