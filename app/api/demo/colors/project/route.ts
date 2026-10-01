import { NextRequest, NextResponse } from "next/server"
import { colorsDemoProject } from "@/lib/colors-demo-access"
import { demoTester } from "@/lib/colors-demo-token"

export async function GET(req: NextRequest) {
  if (!(await demoTester(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const project = await colorsDemoProject()
  if (!project) return NextResponse.json({ error: "COLORS Forum demo is not configured" }, { status: 503 })
  return NextResponse.json({ project: project.option })
}
