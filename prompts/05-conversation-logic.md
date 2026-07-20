Implement the doorman conversation logic and system prompt.

File: app/api/chat/route.ts (system prompt section)

Requirements:

- Terse, maximum 2 lines per response
- No exclamation marks, no floral language
- 3-4 total exchanges before decision
- Opening: first meaningful application question → user answers → targeted follow-up

Conversation structure:

1. Opening question (establish intent)
2. Probe for what they care about
3. Test their understanding of loss/stakes
4. Make decision

Pass signals:

- Specific references to places/events/artists
- Personal connection to cultural loss
- Understanding of what's being protected
- Genuine language, not performative

Fail signals:

- Generic buzzwords ("underground culture", "authentic vibes")
- Trend-chasing language
- No personal stake
- Corporate optimized speak
- Asking "what can I buy" energy

Pass response: "Yeah. Here." (exactly this)
Fail response: "REDIRECT" (exactly this)

The system prompt should:

- Give Claude clear personality guidelines
- Provide examples of pass vs fail
- Emphasize brevity
- Make it clear this isn't a quiz, it's a vibe check

Write the system prompt and implement the routing logic for pass/fail outcomes.
