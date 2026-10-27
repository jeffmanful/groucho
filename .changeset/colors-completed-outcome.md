---
"@groucho-gatekeeper/sdk": minor
---

Treat the `completed` session outcome as terminal in `Gatekeeper`, `GatekeeperV2` and `isTerminalOutcome`. The newer COLORS conversation engine finishes conversations with `completed` instead of passed/redirected/rejected, and sends a neutral placeholder for per-turn `scores`; its suitability score and reviewer report follow on the completed session and webhook. Hosts running COLORS projects must upgrade before those projects are switched to the newer engine.
