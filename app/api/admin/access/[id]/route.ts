import { NextRequest, NextResponse } from "next/server"
import { resolveAdminActor } from "@/lib/admin-actor"
import { supabase } from "@/lib/supabase"
import {
  isSameOriginMutation,
  protectedAdmins,
} from "@/lib/platform-admin-access"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveAdminActor()
  if (!actor || actor.kind !== "platform")
    return NextResponse.json(
      { error: "Platform admin access required." },
      { status: actor ? 403 : 401 },
    )
  if (!isSameOriginMutation(request))
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    )
  const { id } = await params
  if (!id.startsWith("legacy:") && !/^[a-f0-9-]{36}$/i.test(id))
    return NextResponse.json(
      { error: "Protected administrators cannot be removed here." },
      { status: 400 },
    )
  try {
    const operators = await protectedAdmins()
    if (id.startsWith("legacy:")) {
      const email = id.slice(7).toLowerCase()
      const legacy = operators.find(
        (user) => !user.protected && user.email === email,
      )
      if (
        !legacy ||
        email === actor.email.toLowerCase() ||
        operators.some((user) => user.protected && user.email === email)
      )
        return NextResponse.json(
          { error: "You cannot remove yourself or a protected administrator." },
          { status: 409 },
        )
      const { error } = await supabase
        .from("platform_admin_access")
        .upsert(
          {
            email,
            status: "revoked",
            token_hash: null,
            invited_by: actor.email,
            expires_at: new Date().toISOString(),
            revoked_at: new Date().toISOString(),
            revoked_by: actor.email,
          },
          { onConflict: "email" },
        )
      if (error) throw error
      return NextResponse.json({ ok: true })
    }
    const { data: row, error } = await supabase
      .from("platform_admin_access")
      .select("email")
      .eq("id", id)
      .maybeSingle()
    if (error) throw error
    if (!row)
      return NextResponse.json(
        { error: "Access record not found." },
        { status: 404 },
      )
    if (
      row.email === actor.email.toLowerCase() ||
      operators.some((user) => user.protected && user.email === row.email)
    )
      return NextResponse.json(
        { error: "You cannot remove yourself or a protected administrator." },
        { status: 409 },
      )
    const { error: updateError } = await supabase
      .from("platform_admin_access")
      .update({
        status: "revoked",
        token_hash: null,
        revoked_at: new Date().toISOString(),
        revoked_by: actor.email,
      })
      .eq("id", id)
    if (updateError) throw updateError
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { error: "Access could not be removed. Please try again." },
      { status: 503 },
    )
  }
}
