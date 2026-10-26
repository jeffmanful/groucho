---
"@groucho-gatekeeper/sdk": minor
---

Add optional artist intake to Gatekeeper and GatekeeperV2, plus the reusable ArtistIntakeForm. Collect name, city and age with email, and optional artist name, social links and music streaming links. Keep artist application attempts separate from email-only attempts in session storage and carry structured applicant details through the API contract.

Use the same expanded intake for normal community applications by default, retaining their community conversation. Store and hand off contact/onboarding details separately from the artist audience. Hosts needing legacy intake must opt into `intakeMode="email"`.

Expose neutral evidence limits separately from material decision gaps in reviewer reports.
