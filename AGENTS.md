# Conversation quality

For changes that materially affect what Groucho says or how it guides a conversation, define what a good and a poor outcome look like for this project, its audience and its purpose. Use the current settings and examples to make that judgment. Record meaningful tradeoffs in the working update or change description. Ask the user only when the context leaves an important tradeoff unresolved. Routine product and implementation decisions can proceed directly.

Before shipping conversational changes, review complete conversations against those outcomes. Consider continuity, useful contribution, correct attribution and respectful handling of corrections. Judge warmth, curiosity, pace and depth by what the project needs. Mechanical checks alone are insufficient. Prefer fewer coherent controls to patches for individual phrases. Keep booking and date validation separate from conversational judgment.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
