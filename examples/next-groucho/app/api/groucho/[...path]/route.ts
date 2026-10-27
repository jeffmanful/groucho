import { createGrouchoRelay } from "@groucho-gatekeeper/sdk/server"

// Keeps the key on this server and forwards the applicant's IP, user agent and language to Groucho.
const relay = createGrouchoRelay({
  baseUrl: process.env.GROUPCHO_API_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:3000",
  apiKey: process.env.GROUPCHO_API_KEY ?? "",
})

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (!process.env.GROUPCHO_API_KEY) {
    return Response.json({ error: "GROUPCHO_API_KEY is not set on the host" }, { status: 500 })
  }
  return relay(req, (await ctx.params).path)
}

export const GET = handle
export const POST = handle
