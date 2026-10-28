---
"@groucho-gatekeeper/sdk": minor
---

Add createGrouchoApplicantRelay for browser-bound session ownership and private assessment filtering. Keep reports, profiles, suitability, decisions and access secrets out of applicant responses. GatekeeperV2 can opt into restoreSession to recover saved intake and the actual neutral close after refresh without creating a second application. Hosts can supply a validated invitation grant to bind all reads and writes to one assigned conversation; `lockApplicantEmail` keeps invited intake recipients fixed.
