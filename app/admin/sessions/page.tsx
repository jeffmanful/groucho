import LiveConversations from "@/components/admin/LiveConversations"

export default function AdminSessionsPage() {
  return (
    <div>
      <div style={{ padding: "28px 32px 0" }}>
        <h1 style={{ fontSize: "var(--text-2xl)", fontWeight: 500, letterSpacing: "-0.01em", margin: 0 }}>
          Conversations
        </h1>
        <p style={{ color: "var(--text-secondary)", margin: "6px 0 0" }}>
          Read each conversation as it happened, and the report Groucho wrote about it.
        </p>
      </div>
      <LiveConversations />
    </div>
  )
}
