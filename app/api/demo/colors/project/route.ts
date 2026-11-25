import { NextRequest, NextResponse } from "next/server"
import { demoJson } from "@/lib/project-demo-links"
import { authorizeColorsDemo } from "@/lib/shared-colors-demo"

export async function GET(req: NextRequest) {
  const access = await authorizeColorsDemo(req, "project")
  return access instanceof NextResponse ? access : demoJson({ project: access.project.option })
}
