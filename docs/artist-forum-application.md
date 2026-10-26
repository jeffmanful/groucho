# Shared intake and artist Forum application

The artist application is a separate mode of the existing gatekeeper flow. It keeps the general community application available and uses the same public session/message engine as the Forum integration.

The normal application now uses the same expanded intake by default. Its conversation remains focused on general community participation; providing an artist name or music links does not switch the audience.

## First step

Collect email, name, city and age directly before starting the conversation. Artist name, social links and music streaming links are optional; an artist without releases or public links can continue. Age validates as a whole number from 0 to 120 for input sanity only; no minimum admission age or automatic decision rule is introduced.

The API accepts `applicant.details` for community applications or `applicant.artist` for artist applications (never both), each an object with `city`, `age`, optional `artistName`, `socialLinks` and `musicLinks`. Link lists may be empty and contain up to eight complete HTTP(S) URLs each. Links are stored for reviewer context; Groucho does not fetch them or claim to have listened to the music.

Submitted facts are stored in `sessions.applicant_details` with `application_audience`, separate from model-extracted `profile`. New artist sessions start with an artist-focused invitation; subsequent turns derive their mode from the saved snapshot, not mutable per-turn client input. The conversational context avoids re-asking captured facts and does not supply demographic values or submitted links to the model. An existing session's snapshot is retained on resume rather than overwritten by later input.

## Local and reviewer entry

The protected COLORS demo has an artist entry at `/demo/colors?application=artist`, also linked from `/demos`. It uses existing demo permissions. Artist and community attempts use separate browser session keys. New artist demo sessions always use the newer conversation engine; community demo sessions use it when `GROUCHO_COLORS_THIN_PILOT=1`. Artist direction comes from the saved application audience on every turn and repair, while model, stopping rules and post-conversation membership assessment stay shared. The artist browser session key is versioned so the entry starts a fresh session rather than silently resuming a previous standard-engine attempt. Explicitly resumed historical sessions retain their recorded engine. The public SDK/API still uses the standard engine; this change concerns the COLORS demo entry being evaluated.

Apply both local migrations in order: `20261026190110_artist_applicant_profile.sql` and `20261026192656_shared_applicant_intake.sql` to the intended test database before exercising the data path. Creating the migration file does not apply it. No live database is changed by this implementation branch.

## SDK integration

After building/adopting the updated SDK, a host can render:

```tsx
<GrouchoProvider proxyBasePath="/api/groucho/forum">
  <GatekeeperV2 intakeMode="artist" />
</GrouchoProvider>
```

An already known email/name may be passed with `applicant`; the remaining artist fields are still collected. A host collecting the full form itself can pass the complete identity with `collectApplicant={false}`. The reusable `ArtistIntakeForm` is also exported from the React entry point. Both `Gatekeeper` and `GatekeeperV2` default to expanded community intake. Use `intakeMode="email"` explicitly only for a legacy email-only host. `ApplicantIntakeForm` is the reusable general form; `ArtistIntakeForm` remains available as an artist wrapper. Normal `/doorcheck` and `/demo/colors` collect the same fields.

The completion payload carries the saved `applicant.details` community snapshot or `applicant.artist` artist snapshot. Consumers must persist/display the relevant object independently of the inferred profile. Updating Groucho does not automatically publish the SDK or upgrade the COLORS Forum deployment. The existing Forum receiver retains the full webhook payload, but its dedicated review presentation must adopt the new details when integrated; live host handoff and invitation checks remain a separate deployment gate.

The Groucho reviewer workspace displays the supplied artist name, city, age and submitted social/music links under its existing authenticated project access. Model recommendations remain advisory; this change does not modify decision policy, invitations or Forum access grants.

## Conversation direction

Ask about creative practice, current explorations, hopes for the Forum and realistic exchange with other artists. Follow the applicant's actual thread, one question at a time. Missing releases, links, artist name, industry recognition or audience size are not negative evidence. Do not turn the conversation into an audition or promise access. Use human review for the initial supervised pilot unless a separate policy choice is made.

## Verification boundary

Regression tests cover identity validation and storage round trips, artist startup/resume, demographic/link omission from model context and completion handoff. Browser checks use synthetic data and a mocked API. A production build is checked from an isolated copy without service credentials. Applying migrations, a live-model calibration, deployed SDK/Forum adoption, access-control clearance and actual invitations require separate verification before opening the pilot.
