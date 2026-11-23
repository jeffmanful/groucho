# Project wizard production release — 23 November 2026

## Released

- Vercel team: Verlay (`team_1kRWnejzVWXdQw9LDhmoATaM`).
- Project: Groucho Gatekeeper (`prj_izKr0k2Fk4GxRiwIKHzYYXrWFQDJ`), Next.js.
- Live dashboard: https://admin.groucho.app.
- Production deployment: `dpl_56bEFMTy6BhiHDPKsoXRzjDFwAbT`, READY.
- Deployment URL: https://groucho-gatekeeper-ckxl6jw7b-verlay.vercel.app.
- Release source: `323be70` (use `codex/project-conversation-wizard` for the complete SHA). The release branch was pushed to `origin`. Main was not advanced or merged.
- Previous production deployment: `dpl_DNY1TGD8LEonB6mCTD9jnKBxYzKs`, based on `e59745a93a08f6e80326c84802b8bfc5a7137a5c`, remains the rollback reference.

Created an isolated checkout at `/tmp/groucho-wizard-release` from the deployed base and included only the wizard/shared-engine changes, tests and related API/docs. Excluded all unrelated privacy implementation, dependency changes and the privacy migration; removed the privacy-only hunks from session startup in the release checkout. No database migration ran. The original workspace and its unrelated edits were preserved.

## Staging and conversation-quality gate

Will this change positively or negatively affect the conversation experience? Project controls give clients an explicit opening, context, progression and closing, while signals guide understanding. Staged verification exposed an evidence bug: a correction acknowledged in the goodbye was not replacing its earlier evidence. Production traffic stayed on the previous release while this was addressed.

The final implementation separates the closing evidence review from the host's conversation instructions. It reads signal definitions, prior evidence and the transcript, returns evidence updates only, and does not generate another applicant question. The model call adds closing latency; failure keeps the turn retryable before conversation writes. This supersedes the earlier local review's description of a single model call. Exact-quote and registered-signal validation still apply; semantic interpretation remains probabilistic.

Two initial staged builds were not promoted. The final staged build passed normal app login and a complete real-model conversation, including known project cost, a correction combined with stopping, replacement of the obsolete quote, and the exact configured closing message. It was promoted without rebuilding.

### Complete final staged conversation

**Alex:** Hi, I’m Alex. I’d like to hear about the communities you’re part of and what you’d enjoy contributing.

What would you like to find in a new creative community?

**Synthetic applicant:** I welcome newcomers to an online writing group because I remember feeling nervous when I joined. I could bring writing prompts because I have enjoyed sharing them with friends online. For this project, is attendance free?

**Alex:** Yes, attendance is free, with no charge to join. Beginners and informal participation are welcome too. Your memory of feeling nervous when you joined sounds like it would help you make newcomers feel at ease. Have you been part of an online writing group like that before?

**Synthetic applicant:** Small correction: I shared the prompts with friends in person, not online. The writing group is online. Please stop here; I do not want to add anything more.

**Alex:** Thanks for the correction, I'll note that you shared the prompts with friends in person.

Thanks for sharing your ideas for this community.

The contribution evidence after closing stated that prompts were shared with friends **in person**, replaced the obsolete online-sharing quote with the exact correction at Answer 2, and retained valid online-group participation separately. Both signals remained Partly understood; no acceptance decision was implied.

## Verification

- 154 targeted tests passed in the isolated release checkout (six test files), including 63 project-conversation tests and the closing-review failure/retry path. Existing public-demo tests passed.
- TypeScript and changed engine/test lint passed.
- Vercel production build succeeded; final build transitioned to READY in about 20 seconds. No environment values were changed.
- Live domain inspection confirmed it resolves to `dpl_56bEFMTy6BhiHDPKsoXRzjDFwAbT`.
- On `admin.groucho.app`, normal application sign-in returned 200; authenticated new-project and existing edit routes returned 200; the new route rendered the five-step wizard; preview start returned 200 with the saved custom opening.
- Verified with the configured development/platform administrator account and the existing synthetic Development project, not Philip's identity. No production application sessions were created by preview testing.
- Runtime error/fatal log scan for this deployment over the last 15 minutes found no matching records. This is a smoke check, not continuous monitoring or a guarantee against later errors.
- The CLI created an automation bypass for protected staging checks. It was revoked after verification; existing deployment protection settings were retained. Temporary login/cookie/signed-preview files were removed.

The user-facing entry points are organisation dashboard → Projects → New project, and Setup on an existing custom project. Philip's demo-only login/access is unchanged and still needs separate dashboard access work.
