---
"@groucho-gatekeeper/sdk": minor
---

Add `signalEvidencePending` to shared-engine message responses. Open-style conversations now reply as soon as the reply is written and save that answer's evidence review straight afterwards. A continuing turn may return `signalEvidencePending: true`, with `signalEvidence` covering the applicant's earlier answers. The next turn and the closing turn include this answer.
