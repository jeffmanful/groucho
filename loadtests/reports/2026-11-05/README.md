# Culture flow staging load test results

5 November 2026. Both requested runs passed: 100 and 200 concurrent applicants completed the Lewisham culture flow with simulated AI. Message latency remained similar across these two short runs.

## Results

| Metric | 100 applicants | 200 applicants |
| --- | ---: | ---: |
| Peak active applicants | 100 | 200 |
| Completed conversations | 100 / 100 | 200 / 200 |
| Failed requests / throttled requests | 0 / 0 | 0 / 0 |
| Saved applicant answers | 600 | 1,200 |
| Successful session resumes | 100 | 200 |
| Message response p50 | 2,191 ms | 2,215 ms |
| Message response p95 | 2,458 ms | 2,484 ms |
| Message response p99 | 2,617 ms | 2,569 ms |
| Start response p95 | 348 ms | 336 ms |
| Resume response p95 | 223 ms | 263 ms |
| Conversation duration p95, including simulated thinking | 33.45 s | 33.38 s |
| Peak simultaneous simulated model calls | 45 | 79 |
| Total measured run duration, including ramp | 51.98 s | 53.15 s |

Each test checked all six captured details, neutral demo completion, resume continuity, exact persisted message/session counts, and absence of completion jobs. There were no simulator rejections, unexpected external fetch attempts or logged application/usage-persistence errors. A two-applicant smoke test also passed.

## Test conditions

- Actual start/message API handlers and the shared conversation engine ran in an existing local Node process, with no Docker, local database or new local dependency installation. The database was an isolated hosted Supabase branch with no production applicant data copied.
- This was not a GitHub Actions or Vercel deployment run. The GitHub CLI was not authenticated for publishing/running the prepared workflow; the lightweight runner used the hosted staging database directly.
- Each run ramped from zero to its target over 20 seconds, then let every applicant finish one conversation. All applicants were active together at peak.
- Each applicant supplied six answers with approximately three seconds of thinking time between answers, and resumed the same session after answer two.
- Synthetic model delay was 1,500 ms plus 0–500 ms jitter per response. Recorded response latency includes that delay and database/application work.
- The simulator supplied grounded discovery, connection, other interests, companion, location and exact tour-night facts. The fixture used the current Mo persona prompt. No real model provider was contacted; dummy credentials and the fetch allowlist remained active.
- The isolated runner used an API-key allowance of 100,000 messages/minute to measure capacity without the normal 60/minute limit dominating the result. The per-session allowance remained 30/minute. This did not change a deployed application's configuration.

These results establish successful handler/database operation for this particular synthetic workload. They do not establish 200 simultaneous model calls, real-model capacity, conversation quality, a sustained operating limit, waiting-room behaviour, bot resistance, or full Vercel/relay/browser capacity. Repeat longer tests through the intended hosting stack before making public-drop availability claims.

## Staging preparation and cleanup

The temporary branch was created at 09:57:40 UTC and was confirmed absent by 10:03:44 UTC. Supabase returned success for branch deletion. The quoted branch rate was $0.01344/hour; no actual infrastructure invoice was obtained.

Initial fresh-branch migration replay stopped after `20261007120000`. The remaining repository schema migrations were applied successfully to the disposable branch, and the necessary schema was checked before the smoke test. No production schema or application data was modified. Fresh-branch migration replay needs a separate repair before relying on unattended CI provisioning.

The partial branch initially reported missing row-level security on `personas`, `profiles` and `profile_eligibility`. No real applicant data was copied, and the entire test branch has been deleted. This observation is not a production security audit.

Each run cleaned up its generated organisation, persona, project, sessions and usage rows. A final staging SQL check found zero test organisations, sessions and usage records before branch deletion. Temporary connection credentials and the launch wrapper were removed from the computer afterward.

## Evidence

- [100-applicant report](culture-100.json)
- [200-applicant report](culture-200.json)
- [Two-applicant smoke report](culture-2.json)
- [Source manifest and staging identifiers](manifest.json)
- [Harness and rerun instructions](../../culture/README.md)

The source manifest records the working-tree file hashes used for the runs. These tests used the current uncommitted culture-flow changes as well as the load-test harness; the base commit alone does not reproduce the run.
