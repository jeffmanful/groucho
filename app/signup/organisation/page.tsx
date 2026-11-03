import { redirect } from "next/navigation"

/** Retired public onboarding URL; creation is restricted to platform administrators. */
export default function OrganisationSignupPage() {
  redirect("/login?error=invitation_required")
}
